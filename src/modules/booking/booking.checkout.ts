import { Booking, type BookingDocument } from '../../models/Booking';
import { redis } from '../../config/redis';
import { format, now, toDate } from '../../config/timezone';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../utils/logger';
import { round2 } from '../../utils/money';
import {
  createPaymentIntent,
  isStripeEnabled,
  refundToCard,
  retrievePaymentIntent,
} from '../../integrations/paymentGateway';
import { ensureStripeCustomer, saveCardFromIntent } from '../payments/cardPayments';
import * as pricingService from '../pricing/pricing.service';
import * as vehicleService from '../vehicle/vehicle.service';
import { createBooking } from './booking.service';
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
      pickupAddress: leg.pickup.address,
      dropAddress: leg.drop.address,
      meetAndGreet: leg.meetAndGreet,
      stopCount: leg.stops?.length,
      gratuityPct: leg.gratuityPct,
      // Leg 2 is priced as the trip after leg 1, as it will be once leg 1 is saved.
      tripsAhead: index,
    });
    fares.push(fare.fare);
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

  const draft: CheckoutDraft = { userId, legs, fares };
  await redis.set(draftKey(intent.id), JSON.stringify(draft), 'EX', DRAFT_TTL_SECONDS);

  return { paymentIntentId: intent.id, clientSecret: intent.client_secret, amount, fares };
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

  const pm = typeof intent.payment_method === 'object' ? intent.payment_method : null;
  const bookings: BookingDocument[] = [];

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
      });
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
      await finish(draft.userId, intent, paymentIntentId);
      return {
        bookings,
        error: partialJourneyMessage(draft.legs.length, leg, why),
      };
    }
  }

  await finish(draft.userId, intent, paymentIntentId);
  return { bookings };
}

async function finish(userId: string, intent: Parameters<typeof saveCardFromIntent>[1], id: string) {
  await saveCardFromIntent(userId, intent).catch((err) =>
    logger.warn(`Could not save the card from ${id}`, err),
  );
  await redis.del(draftKey(id));
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
