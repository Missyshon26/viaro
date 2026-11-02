import { Booking } from '../../models/Booking';
import { User } from '../../models/User';
import { appWebUrl } from '../../config/env';
import { format, now, toDate } from '../../config/timezone';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../utils/logger';
import { round2 } from '../../utils/money';
import {
  createCheckoutSession,
  expireCheckoutSession,
  isStripeEnabled,
  refundToCard,
  retrieveCheckoutSession,
  retrievePaymentIntent,
  StripeError,
  type StripeCheckoutSession,
} from '../../integrations/paymentGateway';
import { sendEmail } from '../../integrations/email';
import { paymentRequestedEmail } from '../../integrations/emailTemplates';
import * as events from '../events/events.bus';
import * as vehicleService from '../vehicle/vehicle.service';
import { bookingRef } from '../notifications/notification.emails';
import { ensureStripeCustomer } from './cardPayments';

/**
 * "Send a payment link" — for a booking an operator made on the customer's behalf (or any
 * unpaid booking). Stripe hosts the page; we only ask for the booking's fare, email the
 * link, and record the payment when Stripe's webhook says it arrived.
 *
 * Money safety:
 *  - one live link per booking: sending a new one expires the old one at Stripe first;
 *  - the webhook fills `payment` with one atomic update that only matches an unpaid,
 *    uncancelled booking, so a replayed event cannot record it twice;
 *  - a payment that lands on a booking that is already paid or has been cancelled is
 *    refunded to the card straight away rather than kept.
 */

/** Stripe allows a Checkout Session to live for at most 24 hours. */
const LINK_LIFETIME_SECONDS = 24 * 60 * 60 - 60;

export async function sendPaymentLink(bookingId: string, adminId: string) {
  if (!isStripeEnabled()) throw ApiError.badRequest('Card payments are not switched on');

  const booking = await Booking.findById(bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.status === 'cancelled') throw ApiError.conflict('This booking is cancelled, so there is nothing to pay.');
  if (booking.payment) throw ApiError.conflict('This booking is already paid.');

  const amount = round2(booking.estimatedFare ?? 0);
  if (!(amount > 0)) throw ApiError.badRequest('This booking has no fare to charge.');

  const customer = await User.findById(booking.customerId).select('name email');
  if (!customer?.email) throw ApiError.notFound('The client has no email address to send a link to');

  // Retire the previous link first. If it was paid in the meantime, say so instead.
  if (booking.paymentLink?.sessionId) {
    try {
      await expireCheckoutSession(booking.paymentLink.sessionId);
    } catch (err) {
      const session = await retrieveCheckoutSession(booking.paymentLink.sessionId).catch(() => null);
      if (session?.payment_status === 'paid') {
        await handleCheckoutCompleted(session);
        throw ApiError.conflict('The last link was just paid. The booking is now marked as paid.');
      }
      if (!(err instanceof StripeError)) throw err;
      // Already expired or ended: nothing to retire.
    }
  }

  const label = await vehicleService.labelFor(booking.vehicleClass);
  const ref = bookingRef(booking._id);
  const expiresAt = now().plus({ seconds: LINK_LIFETIME_SECONDS });
  const session = await createCheckoutSession({
    amount,
    customerId: await ensureStripeCustomer(String(booking.customerId)),
    name: `ABL ride ${ref}`,
    description: `${label} · ${format(booking.scheduledAt)} · ${booking.pickup.address} to ${booking.drop.address}`.slice(0, 450),
    metadata: { kind: 'booking_link', bookingId: String(booking._id) },
    successUrl: `${appWebUrl}/trips/${String(booking._id)}?paid=1`,
    cancelUrl: `${appWebUrl}/trips/${String(booking._id)}`,
    expiresAt: Math.floor(expiresAt.toSeconds()),
  });
  if (!session.url) throw new ApiError(502, 'Stripe did not return a payment page. Please try again.');

  const emailed = await emailLink({
    name: customer.name,
    to: customer.email,
    link: session.url,
    ref,
    scheduledAt: format(booking.scheduledAt),
    pickup: booking.pickup.address,
    drop: booking.drop.address,
    vehicle: label,
    amount,
    expiresLabel: format(toDate(expiresAt)),
  });

  // A targeted update, not save(): imported and hand-made bookings may lack fare-breakdown
  // fields, and full-document validation would fail after the email has already gone out.
  const paymentLink = {
    sessionId: session.id,
    url: session.url,
    amount,
    sentAt: toDate(now()),
    expiresAt: toDate(expiresAt),
    sentBy: adminId,
    emailed,
  };
  await Booking.updateOne({ _id: booking._id }, { $set: { paymentLink } });

  return { url: session.url, amount, expiresAt: paymentLink.expiresAt, emailed, sentTo: customer.email };
}

async function emailLink(input: {
  name: string;
  to: string;
  link: string;
  ref: string;
  scheduledAt: string;
  pickup: string;
  drop: string;
  vehicle: string;
  amount: number;
  expiresLabel: string;
}): Promise<boolean> {
  try {
    const message = paymentRequestedEmail({
      name: input.name,
      ref: input.ref,
      amount: input.amount,
      link: input.link,
      expiresLabel: input.expiresLabel,
      trip: { pickup: input.pickup, drop: input.drop, when: input.scheduledAt, vehicle: input.vehicle },
    });
    const result = await sendEmail({ to: input.to, ...message });
    return result.sent;
  } catch (err) {
    logger.warn('[email] could not send the payment link', err);
    return false;
  }
}

/**
 * Stripe says a payment page was paid: record it on the booking. Safe to run twice.
 * Called from the webhook for `checkout.session.completed`.
 */
export async function handleCheckoutCompleted(session: StripeCheckoutSession): Promise<void> {
  if (session.metadata?.kind !== 'booking_link' || session.payment_status !== 'paid') return;

  const bookingId = session.metadata.bookingId;
  const intentId = session.payment_intent;
  if (!bookingId || !intentId) {
    logger.error(`Payment link ${session.id} was paid but carries no booking or payment id`);
    return;
  }
  const paidDollars = round2((session.amount_total ?? 0) / 100);

  // Only an unpaid, uncancelled booking takes the money; a replay finds it already filled.
  const intent = await retrievePaymentIntent(intentId);
  const card = typeof intent.payment_method === 'object' ? intent.payment_method?.card : undefined;
  const claimed = await Booking.findOneAndUpdate(
    { _id: bookingId, payment: { $exists: false }, status: { $ne: 'cancelled' } },
    {
      $set: {
        payment: {
          provider: 'stripe',
          intentId,
          leg: 0,
          amount: paidDollars,
          currency: (session.currency ?? 'usd').toUpperCase(),
          status: 'paid',
          brand: card?.brand,
          last4: card?.last4,
          refundedAmount: 0,
          refundIds: [],
          paidAt: toDate(now()),
        },
      },
    },
    { returnDocument: 'after' },
  );

  if (claimed) {
    void events.publish({
      topic: 'booking',
      action: 'updated',
      id: String(claimed._id),
      roles: ['admin', 'company'],
      userIds: [String(claimed.customerId)],
    });
    return;
  }

  const booking = await Booking.findById(bookingId).select('status payment').lean();
  // The same payment again (a replayed event) is already recorded: nothing to do.
  if (booking?.payment?.intentId === intentId) return;

  // Paid, but the booking cannot take it (cancelled, already paid another way, or gone).
  logger.error(`Payment link ${session.id}: booking ${bookingId} cannot take ${paidDollars} — refunding`);
  await refundToCard({
    paymentIntentId: intentId,
    amount: paidDollars,
    metadata: { reason: 'payment_link_not_applicable', bookingId },
    idempotencyKey: `abl_refund_link_${intentId}`,
  });
}

