import { Booking, type BookingDocument } from '../../models/Booking';
import { redis } from '../../config/redis';
import { format, now, toDate } from '../../config/timezone';
import { appWebUrl } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../utils/logger';
import { round2 } from '../../utils/money';
import {
  cancelPaymentIntent,
  createCheckoutSession,
  createPaymentIntent,
  expireCheckoutSession,
  isStripeEnabled,
  refundToCard,
  retrievePaymentIntent,
  type StripeCheckoutSession,
  type StripePaymentIntentFull,
} from '../../integrations/paymentGateway';
import { ensureStripeCustomer, saveCardFromIntent } from '../payments/cardPayments';
import * as pricingService from '../pricing/pricing.service';
import * as vehicleService from '../vehicle/vehicle.service';
import { createBooking } from './booking.service';
import { sendPrePaymentInvoice } from './booking.prePayInvoice';
import { nextTripNo } from './booking.tripNo';
import { assertVehicleRules } from './booking.rules';
import type { CreateBookingInput } from './booking.validation';

/**
 * Pay-at-booking checkout (pre-deployment checklist §3).
 *
 *   1. startCheckout  — price every leg on the server, create a Stripe PaymentIntent for
 *                       the total, and park the legs in Redis under the intent id.
 *   2. the browser    — confirms the card with Stripe.js (3-D Secure handled there).
 *   3. completeCheckout — once Stripe says the payment SUCCEEDED, create the bookings.
 *
 * No booking exists until the money does, so a declined card leaves nothing behind. Step
 * 3 runs from the browser and again from the payment_intent.succeeded webhook, whichever
 * comes first; the unique (intentId, leg) index makes the second one a no-op. If a paid
 * booking cannot be created, that leg's money goes straight back to the card.
 */

const DRAFT_TTL_SECONDS = 24 * 60 * 60;
const draftKey = (intentId: string) => `checkout:${intentId}`;

interface CheckoutDraft {
  userId: string;
  legs: CreateBookingInput[];
  /** What each leg was charged, in dollars — the booking records exactly this. */
  fares: number[];
  /** Reserved at Pay click so the invoice emailed then carries the number the booking will. */
  tripNo?: string;
  /** The emailed Pay Now page for this trip, so paying by card can close it. */
  linkSessionId?: string;
}

/**
 * Wallet credit is not part of a card checkout: the card pays the whole fare, so a
 * requested credit would be spent on top of a fare already paid.
 */
const cardLeg = (leg: CreateBookingInput): CreateBookingInput => {
  const { walletCreditRequested: _credit, ...rest } = leg;
  return rest;
};

export async function startCheckout(userId: string, input: CreateBookingInput[]) {
  if (!isStripeEnabled()) throw ApiError.badRequest('Card payments are not switched on');

  const legs = input.map(cardLeg);
  const fares: number[] = [];
  const quotes: pricingService.FareBreakdown[] = [];
  const vehicleClasses: string[] = [];
  for (const [index, leg] of legs.entries()) {
    // The same calculator booking creation uses, so the charge matches the booking.
    const vehicleClass = await vehicleService.resolveBookableClass(leg.vehicleClass, leg.tripType);
    // Refused here, before a payment is opened, so nobody is charged for a booking that
    // would be turned down once it is made.
    await assertVehicleRules({
      vehicleClass,
      occasion: leg.occasion,
      checkedBags: leg.checkedBags,
      carryOnBags: leg.carryOnBags,
    });
    const fare = await pricingService.calculateFare({
      city: leg.city,
      tripType: leg.tripType,
      requestedAt: leg.scheduledAt,
      hours: leg.hours,
      customerId: userId,
      vehicleClass,
      packageId: leg.packageId,
      pickupAddress: leg.pickup.address,
      dropAddress: leg.drop.address,
      meetAndGreet: leg.meetAndGreet,
      stopCount: leg.stops?.length,
      stopAddresses: leg.stops?.map((s) => s.address),
      gratuityPct: leg.gratuityPct,
      // Leg 2 is priced as the trip after leg 1, as it will be once leg 1 is saved.
      tripsAhead: index,
    });
    fares.push(fare.fare);
    quotes.push(fare);
    vehicleClasses.push(vehicleClass);
  }

  const amount = round2(fares.reduce((sum, f) => sum + f, 0));
  const customerId = await ensureStripeCustomer(userId);
  const first = legs[0];
  const intent = await createPaymentIntent({
    amount,
    customerId,
    description: `ABL booking · ${first.vehicleClass} · ${first.scheduledAt ? format(first.scheduledAt) : 'ASAP'}${legs.length > 1 ? ' · round trip' : ''}`,
    metadata: { kind: 'booking', userId, fares: fares.join(',') },
  });

  // Pay was clicked: reserve the trip number and email the unpaid invoice, as the old site did.
  const tripNo = await nextTripNo();
  const draft: CheckoutDraft = { userId, legs, fares, ...(tripNo ? { tripNo } : {}) };
  await redis.set(draftKey(intent.id), JSON.stringify(draft), 'EX', DRAFT_TTL_SECONDS);
  if (tripNo) {
    void (async () => {
      // The email also carries a Pay Now link. Making it must never hold up or break the checkout.
      const pay = await openDraftLink({ userId, intentId: intent.id, amount, tripNo, first }).catch((err) => {
        logger.warn('[checkout] could not make the Pay Now link for the invoice email', err);
        return null;
      });
      await sendPrePaymentInvoice({ userId, legs, fares: quotes, vehicleClasses, tripNo, pay });
    })();
  }

  return { paymentIntentId: intent.id, clientSecret: intent.client_secret, amount, fares };
}

const LINK_LIFETIME_SECONDS = 24 * 60 * 60 - 60;
const claimKey = (cardIntentId: string) => `checkout:claim:${cardIntentId}`;

/**
 * A trip can be paid two ways: the card form on the site, or the Pay Now link in the invoice
 * email. Whichever gets here first claims the draft and books it; a payment that arrives
 * second is refunded (or, if it has not been made yet, closed), so nobody is charged twice.
 */
async function claimDraft(cardIntentId: string, way: 'card' | 'link'): Promise<boolean> {
  const key = claimKey(cardIntentId);
  await redis.set(key, way, 'EX', DRAFT_TTL_SECONDS, 'NX');
  return (await redis.get(key)) === way;
}

/** The Stripe page behind the invoice email's Pay Now button, remembered on the draft. */
async function openDraftLink(input: {
  userId: string;
  intentId: string;
  amount: number;
  tripNo: string;
  first: CreateBookingInput;
}): Promise<{ amount: number; link: string; expiresLabel: string } | null> {
  const expiresAt = now().plus({ seconds: LINK_LIFETIME_SECONDS });
  const session = await createCheckoutSession({
    amount: input.amount,
    customerId: await ensureStripeCustomer(input.userId),
    name: `ABL trip #${input.tripNo}`,
    description: `ABL booking · ${input.first.vehicleClass} · ${input.first.scheduledAt ? format(input.first.scheduledAt) : 'ASAP'}`.slice(0, 450),
    metadata: { kind: 'booking_draft_link', paymentIntentId: input.intentId, userId: input.userId },
    successUrl: `${appWebUrl}/trips?paid=1`,
    cancelUrl: `${appWebUrl}/trips`,
    expiresAt: Math.floor(expiresAt.toSeconds()),
    idempotencyKey: `abl_draftlink_${input.intentId}`,
  });
  if (!session.url) return null;

  const raw = await redis.get(draftKey(input.intentId));
  if (!raw) {
    // Already paid by card (or expired) while this was being made: the link must not live.
    await expireCheckoutSession(session.id).catch(() => undefined);
    return null;
  }
  const draft = JSON.parse(raw) as CheckoutDraft;
  draft.linkSessionId = session.id;
  await redis.set(draftKey(input.intentId), JSON.stringify(draft), 'KEEPTTL');
  return { amount: input.amount, link: session.url, expiresLabel: format(toDate(expiresAt)) };
}

const isDuplicateKey = (err: unknown) => (err as { code?: number })?.code === 11000;

/**
 * Turns a succeeded payment into its bookings. `userId` is the caller when it comes
 * from the browser, or null from the webhook (which is trusted after its signature).
 */
export async function completeCheckout(
  userId: string | null,
  paymentIntentId: string,
): Promise<{ bookings: BookingDocument[]; error?: string }> {
  const existing = await Booking.find({ 'payment.intentId': paymentIntentId }).sort({ 'payment.leg': 1 });
  if (existing.length) {
    if (userId && existing.some((b) => String(b.customerId) !== userId)) {
      throw ApiError.forbidden('That payment belongs to another customer');
    }
    return { bookings: existing };
  }

  const intent = await retrievePaymentIntent(paymentIntentId);
  if (intent.metadata?.kind !== 'booking') throw ApiError.badRequest('That is not a booking payment');
  if (userId && intent.metadata.userId !== userId) {
    throw ApiError.forbidden('That payment belongs to another customer');
  }
  if (intent.status !== 'succeeded') {
    throw new ApiError(402, 'The payment has not gone through, so no booking was made.', {
      code: 'PAYMENT_NOT_COMPLETE',
      status: intent.status,
    });
  }

  if (!(await claimDraft(paymentIntentId, 'card'))) {
    // The Pay Now link in the invoice email was paid first and booked this trip: this card
    // payment is a second payment for it.
    await refundToCard({
      paymentIntentId,
      amount: intent.amount_received / 100,
      metadata: { reason: 'checkout_paid_by_link' },
      idempotencyKey: `abl_refund_checkout_${paymentIntentId}_paid_by_link`,
    });
    throw new ApiError(409, 'This trip was already paid through the payment link in your email, so this card payment has been refunded.');
  }

  const raw = await redis.get(draftKey(paymentIntentId));
  if (!raw) {
    // Paid, but the details are gone (expired or lost): give the money back.
    await refundToCard({
      paymentIntentId,
      amount: intent.amount_received / 100,
      metadata: { reason: 'checkout_expired' },
      idempotencyKey: `abl_refund_checkout_${paymentIntentId}_expired`,
    });
    throw new ApiError(410, 'This checkout expired before the booking was made. Your payment has been refunded.');
  }
  const draft = JSON.parse(raw) as CheckoutDraft;
  return bookDraft(draft, paymentIntentId, intent, paymentIntentId, 'card');
}

/**
 * The Pay Now link in the invoice email was paid (Stripe webhook): book the trip, exactly as
 * a card payment on the site would have. Safe to run twice.
 */
export async function completeLinkCheckout(session: StripeCheckoutSession): Promise<void> {
  if (session.metadata?.kind !== 'booking_draft_link' || session.payment_status !== 'paid') return;
  const cardIntentId = session.metadata.paymentIntentId;
  const linkIntentId = session.payment_intent;
  if (!cardIntentId || !linkIntentId) {
    logger.error(`Payment link ${session.id} was paid but carries no checkout or payment id`);
    return;
  }
  // A replayed event: this payment has already been booked.
  if (await Booking.exists({ 'payment.intentId': linkIntentId })) return;

  const paid = round2((session.amount_total ?? 0) / 100);
  const refundLink = (reason: string) =>
    refundToCard({
      paymentIntentId: linkIntentId,
      amount: paid,
      metadata: { reason },
      idempotencyKey: `abl_refund_checkout_${linkIntentId}_${reason}`,
    });

  if (!(await claimDraft(cardIntentId, 'link'))) {
    logger.warn(`Payment link ${session.id} paid after the card payment for the same trip — refunding the link payment`);
    await refundLink('checkout_paid_by_card');
    return;
  }
  const raw = await redis.get(draftKey(cardIntentId));
  if (!raw) {
    if (await Booking.exists({ 'payment.intentId': linkIntentId })) return;
    logger.error(`Payment link ${session.id} was paid but the checkout details are gone — refunding`);
    await refundLink('checkout_expired');
    return;
  }
  await bookDraft(JSON.parse(raw) as CheckoutDraft, linkIntentId, await retrievePaymentIntent(linkIntentId), cardIntentId, 'link');
}

/** Makes the bookings for a paid draft. `paymentIntentId` is the payment that was taken. */
async function bookDraft(
  draft: CheckoutDraft,
  paymentIntentId: string,
  intent: StripePaymentIntentFull,
  cardIntentId: string,
  way: 'card' | 'link',
): Promise<{ bookings: BookingDocument[]; error?: string }> {
  const pm = typeof intent.payment_method === 'object' ? intent.payment_method : null;
  const bookings: BookingDocument[] = [];
  // One trip number for the whole journey: its legs are one trip, as on the old site.
  const tripNo = draft.tripNo ?? (await nextTripNo());

  for (const [leg, input] of draft.legs.entries()) {
    try {
      const { booking } = await createBooking(draft.userId, input, {
        chargedFare: draft.fares[leg],
        // Only a journey of several legs is "a journey"; a single trip stays untagged.
        ...(draft.legs.length > 1 ? { journey: { index: leg, count: draft.legs.length } } : {}),
        payment: {
          provider: 'stripe',
          intentId: paymentIntentId,
          leg,
          amount: draft.fares[leg],
          currency: intent.currency.toUpperCase(),
          status: 'paid',
          brand: pm?.card?.brand,
          last4: pm?.card?.last4,
          refundedAmount: 0,
          refundIds: [],
          paidAt: toDate(now()),
        },
      }, undefined, tripNo);
      bookings.push(booking);
    } catch (err) {
      if (isDuplicateKey(err)) {
        // The webhook (or a second click) made this leg first — use theirs.
        const made = await Booking.findOne({ 'payment.intentId': paymentIntentId, 'payment.leg': leg });
        if (made) bookings.push(made);
        continue;
      }

      // Paid for, but it cannot be booked: return this leg and any after it.
      const unbooked = round2(draft.fares.slice(leg).reduce((sum, f) => sum + f, 0));
      logger.error(`Checkout ${paymentIntentId}: leg ${leg} could not be booked — refunding ${unbooked}`, err);
      await refundToCard({
        paymentIntentId,
        amount: unbooked,
        metadata: { reason: 'checkout_failed', leg: String(leg) },
        idempotencyKey: `abl_refund_checkout_${paymentIntentId}_${leg}`,
      });
      const why = err instanceof ApiError ? err.message : 'Something went wrong';
      if (leg === 0) {
        throw new ApiError(422, `${why}. No booking was made and your payment has been refunded.`);
      }
      await finish(draft, intent, paymentIntentId, cardIntentId, way);
      return {
        bookings,
        error: partialJourneyMessage(draft.legs.length, leg, why),
      };
    }
  }

  await finish(draft, intent, paymentIntentId, cardIntentId, way);
  return { bookings };
}

async function finish(
  draft: CheckoutDraft,
  intent: Parameters<typeof saveCardFromIntent>[1],
  id: string,
  cardIntentId: string,
  way: 'card' | 'link',
) {
  await saveCardFromIntent(draft.userId, intent).catch((err) =>
    logger.warn(`Could not save the card from ${id}`, err),
  );
  await redis.del(draftKey(cardIntentId));
  // The other way to pay this trip is closed, so it cannot be paid again.
  if (way === 'card' && draft.linkSessionId) {
    await expireCheckoutSession(draft.linkSessionId).catch(() => undefined);
  }
  if (way === 'link') await cancelPaymentIntent(cardIntentId).catch(() => undefined);
}

/**
 * What to tell a customer when only part of a paid journey could be booked. A round trip
 * keeps its familiar wording; a longer itinerary says which leg stopped it and that every
 * leg from there on has been refunded (the refund above covers `leg` and everything after).
 */
export function partialJourneyMessage(totalLegs: number, failedLeg: number, why: string): string {
  if (totalLegs === 2) {
    return `Your outbound journey is booked, but the return could not be (${why}). Its fare has been refunded to your card.`;
  }
  const booked = failedLeg;
  const later = totalLegs - failedLeg;
  return `The first ${booked} leg${booked === 1 ? ' is' : 's are'} booked, but leg ${failedLeg + 1} could not be (${why}). ${
    later === 1 ? 'Its fare has' : `Its fare and the ${later - 1} after it have`
  } been refunded to your card.`;
}
