import { User } from '../../models/User';
import { ApiError } from '../../utils/ApiError';
import * as pricingService from '../pricing/pricing.service';
import * as vehicleService from '../vehicle/vehicle.service';
import { assertVehicleRules } from '../booking/booking.rules';
import { createBooking } from '../booking/booking.service';
import { nextTripNo } from '../booking/booking.tripNo';
import type { CreateBookingInput } from '../booking/booking.validation';
import type { ManualDiscount } from '../pricing/pricing.adjustments';

/**
 * An operator booking a trip on a customer's behalf (phone and email requests).
 *
 * The trip goes through the same createBooking as the passenger site, so every rule the
 * customer faces — vehicle for the occasion, luggage fit, stop fee, agreement stamp, the
 * Guest tag, the confirmation notice, dispatch — applies here too, with no second
 * implementation to drift. What differs is only that it is not paid for: the fare is
 * collected afterwards with the console's "Collect fare", and the booking records who
 * made it.
 */

/** The customer a trip is for, or a plain reason it cannot be booked. */
async function bookableCustomer(customerId: string) {
  const customer = await User.findOne({ _id: customerId, role: 'customer', deletedAt: null }).select('status');
  if (!customer) throw ApiError.notFound('Client not found');
  if (customer.status === 'suspended') {
    throw new ApiError(409, 'This client is suspended. Reactivate them before booking a trip.', {
      code: 'CLIENT_SUSPENDED',
    });
  }
  return customer;
}

/** What the trip would cost, with the same checks a booking would face — nothing is saved. */
export async function quoteTrip(customerId: string, input: CreateBookingInput, tripsAhead = 0, discount?: ManualDiscount) {
  await bookableCustomer(customerId);

  const vehicleClass = await vehicleService.resolveBookableClass(input.vehicleClass, input.tripType);
  await assertVehicleRules({
    vehicleClass,
    occasion: input.occasion,
    checkedBags: input.checkedBags,
    carryOnBags: input.carryOnBags,
  });

  return pricingService.calculateFare({
    city: input.city,
    tripType: input.tripType,
    requestedAt: input.scheduledAt,
    hours: input.hours,
    customerId,
    vehicleClass,
    packageId: input.packageId,
    pickupAddress: input.pickup.address,
    dropAddress: input.drop.address,
    meetAndGreet: input.meetAndGreet,
    stopCount: input.stops?.length,
    stopAddresses: input.stops?.map((s) => s.address),
    gratuityPct: input.gratuityPct,
    manualDiscount: discount,
    tripsAhead,
  });
}

/**
 * The operator's discount as it lands on one leg of a journey: a percentage applies to every
 * leg; a flat amount comes off the first leg only, so it is taken once, not once per leg.
 */
function legDiscount(discount: ManualDiscount | undefined, index: number): ManualDiscount | undefined {
  if (!discount) return undefined;
  return discount.type === 'flat' && index > 0 ? undefined : discount;
}

/** What each leg of a journey would cost, and the total; nothing is saved. */
export async function quoteJourney(customerId: string, legs: CreateBookingInput[], discount?: ManualDiscount) {
  const fares: number[] = [];
  for (const [index, leg] of legs.entries()) {
    try {
      fares.push((await quoteTrip(customerId, leg, index, legDiscount(discount, index))).fare);
    } catch (err) {
      // Say which leg, so an operator is not left hunting through five of them.
      if (err instanceof ApiError) throw new ApiError(err.statusCode, `Leg ${index + 1}: ${err.message}`, err.details);
      throw err;
    }
  }
  return { fares, total: Math.round(fares.reduce((sum, f) => sum + f, 0) * 100) / 100 };
}

/**
 * Books every leg of a journey for the client, in pickup order, tagged as one itinerary.
 *
 * Every leg is checked and priced BEFORE the first is saved, so a rule broken on leg three
 * stops the whole thing instead of leaving two legs booked. Should a save still fail midway
 * (a database error), what was already booked is returned along with the reason, the same
 * way a partly-booked card journey is reported — never silently dropped.
 */
export async function createJourneyForCustomer(
  adminId: string,
  customerId: string,
  legs: CreateBookingInput[],
  discount?: ManualDiscount,
) {
  await quoteJourney(customerId, legs, discount);

  const bookings = [];
  // One trip number for the whole journey: its legs are one trip, as on the old site.
  const tripNo = await nextTripNo();
  for (const [index, leg] of legs.entries()) {
    try {
      const { booking } = await createBooking(customerId, leg, undefined, {
        adminId,
        journey: { index, count: legs.length },
        discount: legDiscount(discount, index),
      }, tripNo);
      bookings.push(booking);
    } catch (err) {
      if (index === 0) throw err;
      const why = err instanceof ApiError ? err.message : 'Something went wrong';
      return {
        bookings,
        error: `Legs 1–${index} were booked, but leg ${index + 1} could not be (${why}). Add the remaining legs as separate trips.`,
      };
    }
  }
  return { bookings };
}

export async function createTripForCustomer(
  adminId: string,
  customerId: string,
  input: CreateBookingInput,
  discount?: ManualDiscount,
) {
  await bookableCustomer(customerId);
  return createBooking(customerId, input, undefined, { adminId, discount });
}
