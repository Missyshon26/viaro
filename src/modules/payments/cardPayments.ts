import { Booking, type BookingDocument } from '../../models/Booking';
import { PaymentMethod } from '../../models/PaymentMethod';
import { User } from '../../models/User';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../utils/logger';
import { round2 } from '../../utils/money';
import {
  createStripeCustomer,
  listRefunds,
  refundToCard,
  StripeError,
  type StripePaymentIntentFull,
} from '../../integrations/paymentGateway';
import * as notify from '../notifications/notifications.service';
import * as events from '../events/events.bus';
import { NOTIFICATION_TYPES } from '../notifications/notifications.service';

/**
 * Card payments taken at booking (Stripe): the customer record, the saved card, and
 * refunds back to the card.
 *
 * Money rule: a booking paid by card is refunded to that card. Wallet credit is only
 * ever refunded to the wallet (cancellation.service issueRefundToWallet).
 */

/** The customer's Stripe customer id, created on first use. */
export async function ensureStripeCustomer(userId: string): Promise<string> {
  const user = await User.findById(userId).select('name email stripeCustomerId');
  if (!user) throw ApiError.notFound('Account not found');
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await createStripeCustomer({ email: user.email, name: user.name, userId });
  user.stripeCustomerId = customer.id;
  await user.save();
  return customer.id;
}

/**
 * The card saved at checkout, for off-session charges (subscriptions, legacy post-trip
 * collection). Null when the customer has never paid by card.
 */
export async function getCardOnFile(
  userId: string,
): Promise<{ customerId: string; paymentMethodId: string } | null> {
  const [user, method] = await Promise.all([
    User.findById(userId).select('stripeCustomerId').lean(),
    PaymentMethod.findOne({ userId, provider: 'stripe' }).sort({ isDefault: -1, createdAt: -1 }).lean(),
  ]);
  if (!user?.stripeCustomerId || !method) return null;
  return { customerId: user.stripeCustomerId, paymentMethodId: method.gatewayToken };
}

/** Records the card a checkout was paid with, as the customer's default. Idempotent. */
export async function saveCardFromIntent(userId: string, intent: StripePaymentIntentFull): Promise<void> {
  const pm = typeof intent.payment_method === 'object' ? intent.payment_method : null;
  if (!pm?.id) return;

  await PaymentMethod.updateMany({ userId, gatewayToken: { $ne: pm.id } }, { $set: { isDefault: false } });
  await PaymentMethod.updateOne(
    { userId, gatewayToken: pm.id },
    {
      $set: {
        provider: 'stripe',
        isDefault: true,
        ...(pm.card
          ? {
              brand: pm.card.brand,
              last4: pm.card.last4,
              expMonth: pm.card.exp_month,
              expYear: pm.card.exp_year,
            }
          : {}),
      },
      $setOnInsert: { userId, gatewayToken: pm.id },
    },
    { upsert: true },
  );
}

/** "Visa •••• 4242", or "your card". */
export const cardLabel = (payment?: { brand?: string; last4?: string }) =>
  payment?.last4
    ? `${(payment.brand ?? 'card').replace(/^\w/, (c) => c.toUpperCase())} •••• ${payment.last4}`
    : 'your card';

function applyRefund(booking: BookingDocument, refundId: string, amount: number) {
  const payment = booking.payment!;
  payment.refundIds.push(refundId);
  payment.refundedAmount = round2(payment.refundedAmount + amount);
  payment.status = payment.refundedAmount >= payment.amount ? 'refunded' : 'partially_refunded';
  booking.markModified('payment');
}

/**
 * Refund `refundPct`% of what this booking paid by card, back to the card.
 *
 * Capped at what is still unrefunded, and keyed per booking and reason, so a retried
 * cancellation can never refund twice. Returns the amount refunded (0 when the booking
 * was not paid by card, or nothing is left to refund).
 */
export async function refundBookingToCard(
  bookingId: string,
  refundPct: number,
  reason: string,
): Promise<number> {
  const booking = await Booking.findById(bookingId);
  const payment = booking?.payment;
  if (!booking || !payment) return 0;

  const remaining = round2(payment.amount - payment.refundedAmount);
  const amount = Math.min(round2((payment.amount * refundPct) / 100), remaining);
  if (amount <= 0) return 0;

  const refund = await refundToCard({
    paymentIntentId: payment.intentId,
    amount,
    metadata: { bookingId: String(booking._id), reason },
    idempotencyKey: `abl_refund_${String(booking._id)}_${reason}`,
  });

  // A replayed idempotent request returns the same refund — count it once.
  if (!payment.refundIds.includes(refund.id)) {
    applyRefund(booking, refund.id, refund.amount / 100);
    await booking.save();
  }

  await notify.send(booking.customerId, NOTIFICATION_TYPES.REFUND_ISSUED, {
    message: `$${amount.toFixed(2)} has been refunded to ${cardLabel(payment)}. It usually appears within 5–10 business days.`,
    bookingId: String(booking._id),
    refundAmount: amount,
    refundPct,
    toCard: true,
  });

  logger.info(`Refunded ${amount} (${refundPct}%) to card for booking ${String(booking._id)}`);
  return amount;
}

/**
 * A refund an operator chose to make, for any amount up to what is still unrefunded — the
 * whole fare or part of it. Does not touch the booking's status: refunding money and
 * cancelling a ride are separate decisions.
 *
 * `requestId` comes from the screen and is part of Stripe's idempotency key, so a double
 * click or a retried request refunds once; a deliberate second refund is a new request.
 * Stripe itself refuses to refund more than was charged, which covers two operators racing.
 */
export async function refundBookingAmount(input: {
  bookingId: string;
  amount: number;
  requestId: string;
  adminId: string;
  note?: string;
}) {
  const booking = await Booking.findById(input.bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');
  const payment = booking.payment;
  if (!payment) throw ApiError.conflict('This booking has no card payment to refund.');

  const remaining = round2(payment.amount - payment.refundedAmount);
  const amount = round2(input.amount);
  if (remaining <= 0) throw ApiError.conflict('This booking has already been refunded in full.');
  if (!(amount > 0)) throw ApiError.badRequest('Enter an amount greater than zero.');
  if (amount > remaining) {
    throw ApiError.badRequest(`The most that can still be refunded is $${remaining.toFixed(2)}.`);
  }

  let refund;
  try {
    refund = await refundToCard({
      paymentIntentId: payment.intentId,
      amount,
      metadata: {
        bookingId: String(booking._id),
        reason: 'admin_refund',
        by: input.adminId,
        ...(input.note ? { note: input.note.slice(0, 200) } : {}),
      },
      idempotencyKey: `abl_refund_${String(booking._id)}_admin_${input.requestId}`,
    });
  } catch (err) {
    // Stripe's own wording ("charge already refunded", a closed account) is the useful part.
    if (err instanceof StripeError) throw new ApiError(422, `Stripe could not refund this: ${err.message}`);
    throw err;
  }

  // The webhook may have recorded this refund already; count it once.
  const fresh = (await Booking.findById(input.bookingId)) ?? booking;
  if (!fresh.payment!.refundIds.includes(refund.id)) {
    applyRefund(fresh, refund.id, refund.amount / 100);
    await fresh.save();
  }

  await notify.send(fresh.customerId, NOTIFICATION_TYPES.REFUND_ISSUED, {
    message: `$${amount.toFixed(2)} has been refunded to ${cardLabel(payment)}. It usually appears within 5–10 business days.`,
    bookingId: String(fresh._id),
    refundAmount: amount,
    toCard: true,
  });

  logger.info(`Admin ${input.adminId} refunded ${amount} to card for booking ${String(fresh._id)}`);

  // The trip page's payment section changes for both the operator and the passenger.
  events.publish({
    topic: 'booking',
    action: 'refunded',
    id: String(fresh._id),
    roles: ['admin', 'company'],
    userIds: [String(fresh.customerId)],
  });
  const p = fresh.payment!;
  return { refunded: amount, payment: { amount: p.amount, refundedAmount: p.refundedAmount, status: p.status } };
}

/**
 * Brings the bookings paid by one PaymentIntent in line with Stripe's refunds — the
 * webhook path, for refunds made in the Stripe dashboard (checklist §3).
 *
 * Refunds this system issued carry metadata.bookingId and go to that booking. Anything
 * else (a dashboard refund) is allocated across the legs in order, each up to what it
 * paid. Refund ids already counted are skipped, so webhook replays are harmless.
 */
export async function syncStripeRefunds(paymentIntentId: string): Promise<void> {
  const bookings = await Booking.find({ 'payment.intentId': paymentIntentId }).sort({ 'payment.leg': 1 });
  if (!bookings.length) {
    logger.warn(`Stripe refund for ${paymentIntentId}, which matches no booking`);
    return;
  }

  const counted = new Set(bookings.flatMap((b) => b.payment?.refundIds ?? []));
  const refunds = (await listRefunds(paymentIntentId)).filter(
    (r) => (r.status === 'succeeded' || r.status === 'pending') && !counted.has(r.id),
  );

  for (const refund of refunds) {
    let left = refund.amount / 100;
    const target = bookings.find((b) => String(b._id) === refund.metadata?.bookingId);
    const order = target ? [target] : bookings;

    for (const booking of order) {
      const p = booking.payment!;
      const share = Math.min(left, round2(p.amount - p.refundedAmount));
      if (share <= 0) continue;
      applyRefund(booking, refund.id, share);
      left = round2(left - share);
      await booking.save();

      if (!refund.metadata?.bookingId) {
        // Made in the Stripe dashboard: nobody in the app has told the customer yet.
        await notify.send(booking.customerId, NOTIFICATION_TYPES.REFUND_ISSUED, {
          message: `$${share.toFixed(2)} has been refunded to ${cardLabel(p)}.`,
          bookingId: String(booking._id),
          refundAmount: share,
          toCard: true,
        });
      }
      if (left <= 0) break;
    }
  }
}
