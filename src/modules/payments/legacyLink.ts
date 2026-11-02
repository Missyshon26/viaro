import { timingSafeEqual } from 'node:crypto';
import { Booking } from '../../models/Booking';
import { appWebUrl } from '../../config/env';
import { format, now, toDate } from '../../config/timezone';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../utils/logger';
import { round2 } from '../../utils/money';
import {
  cancelPaymentIntent,
  createCheckoutSession,
  isStripeEnabled,
  refundToCard,
  retrievePaymentIntent,
  StripeError,
  type StripeCheckoutSession,
  type StripePaymentIntentFull,
} from '../../integrations/paymentGateway';
import * as events from '../events/events.bus';
import { ensureStripeCustomer } from './cardPayments';

/**
 * Pay links the OLD booking site emailed: /payment/<client secret>/<trip id>.
 *
 * Those emails are still in customers' inboxes, and the old page that read them no longer exists.
 * The link carries two things: the secret of a Stripe payment the old system opened (for the
 * whole trip's total), and the old trip's id. They are checked against each other, with Stripe:
 *
 *   - the secret must be the real one for that payment (only whoever received the email has it);
 *   - the payment Stripe holds must name this very trip (its metadata, or its description, which
 *     the old system set to the trip number), so a valid secret cannot pay a different trip.
 *
 * The old payment is not charged. A fresh Stripe Checkout page is opened for the same amount, and
 * the webhook records the money on the trip's legs once it arrives (handleLegacyCheckoutCompleted).
 */
const SECRET = /^(pi_[A-Za-z0-9]+)_secret_[A-Za-z0-9]+$/;
const TRIP_ID = /^[a-f0-9]{24}$/i;
const LINK_LIFETIME_SECONDS = 24 * 60 * 60 - 60;
export const LEGACY_LINK_KIND = 'legacy_trip_link';

export interface LegacyLinkSummary {
  tripNo: string;
  amount: number;
  legs: { pickup: string; drop: string; when: string }[];
}

const invalid = () => ApiError.notFound('This payment link is not valid. Please contact us and we will send a new one.');

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function resolve(clientSecret: string, tripId: string) {
  if (!isStripeEnabled()) throw ApiError.badRequest('Card payments are not switched on');
  const parsed = SECRET.exec(clientSecret);
  if (!parsed || !TRIP_ID.test(tripId)) throw invalid();

  let intent: StripePaymentIntentFull;
  try {
    intent = await retrievePaymentIntent(parsed[1]);
  } catch (err) {
    if (err instanceof StripeError) throw invalid();
    throw err;
  }
  if (!sameSecret(intent.client_secret ?? '', clientSecret)) throw invalid();

  const legs = await Booking.find({ 'legacy.tripId': tripId }).sort({ 'legacy.legIndex': 1 });
  if (!legs.length) throw invalid();
  const tripNo = String(legs[0].legacy?.tripNo ?? '');
  // The payment Stripe holds must be for this trip.
  if (intent.metadata?.tripID !== tripId && !(tripNo && intent.description === tripNo)) throw invalid();

  const open = legs.filter((l) => l.status !== 'cancelled');
  if (!open.length) throw ApiError.conflict('This trip was cancelled, so there is nothing to pay.');
  const alreadyPaid =
    intent.status === 'succeeded' ||
    intent.status === 'canceled' ||
    open.some((l) => l.payment || String(l.legacy?.paymentStatus ?? '').toLowerCase() === 'paid');
  if (alreadyPaid) throw ApiError.conflict('This trip is already paid. Thank you!');

  const amount = round2((intent.amount ?? 0) / 100);
  if (!(amount >= 0.5)) throw ApiError.badRequest('There is nothing to charge for this trip.');
  return { intent, open, tripNo, amount };
}

export async function lookupLegacyLink(clientSecret: string, tripId: string): Promise<LegacyLinkSummary> {
  const { open, tripNo, amount } = await resolve(clientSecret, tripId);
  return {
    tripNo,
    amount,
    legs: open.map((l) => ({ pickup: l.pickup.address, drop: l.drop.address, when: format(l.scheduledAt) })),
  };
}

export async function startLegacyLink(clientSecret: string, tripId: string): Promise<{ url: string }> {
  const { intent, open, tripNo, amount } = await resolve(clientSecret, tripId);
  const expiresAt = Math.floor(now().plus({ seconds: LINK_LIFETIME_SECONDS }).toSeconds());
  const session = await createCheckoutSession({
    amount,
    customerId: await ensureStripeCustomer(String(open[0].customerId)),
    name: `ABL ride ${tripNo}`,
    description: open.map((l) => `${format(l.scheduledAt)} · ${l.pickup.address} to ${l.drop.address}`).join(' | ').slice(0, 450),
    metadata: { kind: LEGACY_LINK_KIND, tripId, oldIntentId: intent.id },
    successUrl: `${appWebUrl}/payment/done`,
    cancelUrl: `${appWebUrl}/payment/${encodeURIComponent(clientSecret)}/${tripId}`,
    expiresAt,
  });
  if (!session.url) throw new ApiError(502, 'Stripe did not return a payment page. Please try again.');
  return { url: session.url };
}

/**
 * Stripe says a pay-link page was paid: record it on the trip's unpaid legs, shared out by their
 * fares (the last takes the rounding). Safe to run twice: a leg takes money only while it has none.
 * Money that cannot be placed (the trip was paid another way, or cancelled meanwhile) is refunded.
 */
export async function handleLegacyCheckoutCompleted(session: StripeCheckoutSession): Promise<void> {
  if (session.metadata?.kind !== LEGACY_LINK_KIND || session.payment_status !== 'paid') return;
  const tripId = session.metadata.tripId;
  const intentId = session.payment_intent;
  if (!tripId || !intentId) {
    logger.error(`Pay link ${session.id} was paid but carries no trip or payment id`);
    return;
  }
  const paid = round2((session.amount_total ?? 0) / 100);
  const intent = await retrievePaymentIntent(intentId);
  const card = typeof intent.payment_method === 'object' ? intent.payment_method?.card : undefined;

  const legs = await Booking.find({ 'legacy.tripId': tripId, status: { $ne: 'cancelled' }, payment: { $exists: false } })
    .sort({ 'legacy.legIndex': 1 })
    .select('_id customerId estimatedFare')
    .lean();

  const weight = legs.reduce((sum, l) => sum + (l.estimatedFare ?? 0), 0);
  let remaining = paid;
  let placed = 0;
  for (const [i, leg] of legs.entries()) {
    const last = i === legs.length - 1;
    const share = last ? remaining : round2(weight > 0 ? (paid * (leg.estimatedFare ?? 0)) / weight : i === 0 ? paid : 0);
    remaining = round2(remaining - share);
    const claimed = await Booking.updateOne(
      { _id: leg._id, payment: { $exists: false }, status: { $ne: 'cancelled' } },
      {
        $set: {
          payment: {
            provider: 'stripe',
            intentId,
            leg: i,
            amount: share,
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
    );
    if (claimed.modifiedCount > 0) {
      placed += 1;
      void events.publish({
        topic: 'booking',
        action: 'updated',
        id: String(leg._id),
        roles: ['admin', 'company'],
        userIds: [String(leg.customerId)],
      });
    }
  }

  if (placed === 0) {
    // The same payment again is already recorded; anything else cannot be placed.
    const recorded = await Booking.exists({ 'payment.intentId': intentId });
    if (recorded) return;
    logger.error(`Pay link ${session.id}: trip ${tripId} cannot take ${paid} — refunding`);
    await refundToCard({
      paymentIntentId: intentId,
      amount: paid,
      metadata: { reason: 'legacy_link_not_applicable', tripId },
      idempotencyKey: `abl_refund_legacy_${intentId}`,
    });
    return;
  }

  // The old payment is now settled in full; close it so it can never be paid a second time.
  const oldIntentId = session.metadata.oldIntentId;
  if (oldIntentId) await cancelPaymentIntent(oldIntentId).catch((err) => logger.warn(`Could not close old payment ${oldIntentId}`, err));
}
