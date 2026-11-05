import { Booking, type BookingDocument } from '../../models/Booking';
import { PaymentMethod } from '../../models/PaymentMethod';
import { User } from '../../models/User';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../utils/logger';
import { round2 } from '../../utils/money';
import {
  createStripeCustomer,
  listRefunds,
  retrieveStripeCustomer,
  refundToCard,
  StripeError,
  type StripePaymentIntentFull,
} from '../../integrations/paymentGateway';
import * as notify from '../notifications/notifications.service';
import * as events from '../events/events.bus';
import { NOTIFICATION_TYPES } from '../notifications/notifications.service';
import { amountPaid, refundable, refundSources, splitRefund, type RefundSource } from './balance';

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
  if (user.stripeCustomerId) {
    // The id saved on the account may come from Stripe's test mode (or a deleted customer), and
    // the live key cannot see it: "No such customer". Check, and make a fresh one when it is gone.
    try {
      const saved = await retrieveStripeCustomer(user.stripeCustomerId);
      if (!saved.deleted) return user.stripeCustomerId;
    } catch (err) {
      if (!(err instanceof StripeError) || (err.status !== 404 && err.code !== 'resource_missing')) throw err;
    }
    logger.warn(`Stripe customer ${user.stripeCustomerId} is not in this Stripe mode; creating a new one for ${userId}`);
  }

  let customer: { id: string };
  try {
    customer = await createStripeCustomer({ email: user.email, name: user.name, userId });
  } catch (err) {
    // Two requests creating the same customer at once (an invoice email and a checkout): Stripe
    // tells the second its twin is still running. Wait for the twin and use the customer it made.
    if (!(err instanceof StripeError) || !/in-progress|idempotent/i.test(err.message)) throw err;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const fresh = await User.findById(userId).select('stripeCustomerId');
    if (fresh?.stripeCustomerId) return fresh.stripeCustomerId;
    customer = await createStripeCustomer({ email: user.email, name: user.name, userId });
  }
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

/** Counts a refund against the payment it came out of: the first payment, or an upgrade payment. */
function applyRefundTo(booking: BookingDocument, source: RefundSource, refundId: string, amount: number) {
  if (source.kind === 'original') return applyRefund(booking, refundId, amount);
  const extra = booking.extraPayments![source.index];
  extra.refundIds.push(refundId);
  extra.refundedAmount = round2(extra.refundedAmount + amount);
  booking.markModified('extraPayments');
}

/** Whether a refund id is already counted anywhere on the booking (webhook replays, retries). */
const refundCounted = (booking: BookingDocument, refundId: string) =>
  Boolean(booking.payment?.refundIds.includes(refundId) || booking.extraPayments?.some((p) => p.refundIds.includes(refundId)));

/**
 * One idempotency key per payment the refund draws on. The first payment keeps the key it has
 * always had, so a retried refund made before upgrades existed still maps to the same Stripe refund.
 */
const refundKey = (base: string, source: RefundSource) => (source.kind === 'original' ? base : `${base}_${source.intentId}`);

/**
 * The money has already left Stripe, so recording it must not be blocked by unrelated
 * fields. Imported and hand-made bookings can lack a fare breakdown, and full validation
 * would then reject the save and leave the refund unrecorded.
 */
async function saveRefund(booking: BookingDocument) {
  await booking.save({ validateBeforeSave: false });
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

  // The percentage applies to everything the client paid, an upgrade payment included.
  const sources = refundSources(booking);
  const amount = Math.min(round2((amountPaid(booking) * refundPct) / 100), refundable(booking));
  if (amount <= 0) return 0;

  for (const part of splitRefund(sources, amount)) {
    const refund = await refundToCard({
      paymentIntentId: part.source.intentId,
      amount: part.amount,
      metadata: { bookingId: String(booking._id), reason },
      idempotencyKey: refundKey(`abl_refund_${String(booking._id)}_${reason}`, part.source),
    });

    // A replayed idempotent request returns the same refund — count it once.
    if (!refundCounted(booking, refund.id)) {
      applyRefundTo(booking, part.source, refund.id, refund.amount / 100);
      await saveRefund(booking);
    }
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

/** Counts refunds Stripe has issued on the booking, skipping any the webhook already recorded. */
async function recordRefunds(
  bookingId: string,
  fallback: BookingDocument,
  issued: { source: RefundSource; id: string; amount: number }[],
): Promise<BookingDocument> {
  const fresh = (await Booking.findById(bookingId)) ?? fallback;
  for (const r of issued) {
    if (!refundCounted(fresh, r.id)) applyRefundTo(fresh, r.source, r.id, r.amount);
  }
  if (issued.length) await saveRefund(fresh);
  return fresh;
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

  // Everything the client paid by card counts: the first payment and any upgrade payment.
  const remaining = refundable(booking);
  const amount = round2(input.amount);
  if (remaining <= 0) throw ApiError.conflict('This booking has already been refunded in full.');
  if (!(amount > 0)) throw ApiError.badRequest('Enter an amount greater than zero.');
  if (amount > remaining) {
    throw ApiError.badRequest(`The most that can still be refunded is $${remaining.toFixed(2)}.`);
  }

  const parts = splitRefund(refundSources(booking), amount);
  const issued: { source: RefundSource; id: string; amount: number }[] = [];
  try {
    for (const part of parts) {
      const refund = await refundToCard({
        paymentIntentId: part.source.intentId,
        amount: part.amount,
        metadata: {
          bookingId: String(booking._id),
          reason: 'admin_refund',
          by: input.adminId,
          ...(input.note ? { note: input.note.slice(0, 200) } : {}),
        },
        idempotencyKey: refundKey(`abl_refund_${String(booking._id)}_admin_${input.requestId}`, part.source),
      });
      issued.push({ source: part.source, id: refund.id, amount: refund.amount / 100 });
    }
  } catch (err) {
    // A refund that already left Stripe must still be recorded, or the booking would say it
    // is refundable for money that has gone; only then is the failure reported.
    if (issued.length) await recordRefunds(input.bookingId, booking, issued);
    // Stripe's own wording ("charge already refunded", a closed account) is the useful part.
    if (err instanceof StripeError) throw new ApiError(422, `Stripe could not refund this: ${err.message}`);
    throw err;
  }

  const fresh = await recordRefunds(input.bookingId, booking, issued);

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
  return {
    refunded: amount,
    payment: { amount: p.amount, refundedAmount: p.refundedAmount, status: p.status },
    refundable: refundable(fresh),
  };
}

/**
 * The webhook path for a refund against an upgrade payment (one booking, one payment). Returns
 * whether the intent belonged to an upgrade payment at all.
 */
async function syncUpgradeRefunds(paymentIntentId: string): Promise<boolean> {
  const booking = await Booking.findOne({ 'extraPayments.intentId': paymentIntentId });
  if (!booking) return false;
  const index = booking.extraPayments!.findIndex((p) => p.intentId === paymentIntentId);
  const extra = booking.extraPayments![index];

  const refunds = (await listRefunds(paymentIntentId)).filter(
    (r) => (r.status === 'succeeded' || r.status === 'pending') && !refundCounted(booking, r.id),
  );
  for (const refund of refunds) {
    const share = Math.min(refund.amount / 100, round2(extra.amount - extra.refundedAmount));
    if (share <= 0) continue;
    applyRefundTo(booking, { kind: 'extra', index, intentId: paymentIntentId, remaining: 0 }, refund.id, share);
    await saveRefund(booking);
    if (!refund.metadata?.bookingId) {
      await notify.send(booking.customerId, NOTIFICATION_TYPES.REFUND_ISSUED, {
        message: `$${share.toFixed(2)} has been refunded to ${cardLabel(extra)}.`,
        bookingId: String(booking._id),
        refundAmount: share,
        toCard: true,
      });
    }
  }
  return true;
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
    // Not a booking's first payment: it may be an upgrade payment taken later.
    if (await syncUpgradeRefunds(paymentIntentId)) return;
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
      await saveRefund(booking);

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
