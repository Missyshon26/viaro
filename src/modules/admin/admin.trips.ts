import { Types } from 'mongoose';
import { User } from '../../models/User';
import { ApiError } from '../../utils/ApiError';
import * as pricingService from '../pricing/pricing.service';
import * as vehicleService from '../vehicle/vehicle.service';
import { assertVehicleRules } from '../booking/booking.rules';
import { createBooking } from '../booking/booking.service';
import { nextTripNo } from '../booking/booking.tripNo';
import { createCustomer } from './admin.customers';
import type { AdminNewClientInput } from './admin.validation';
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
  return priceTrip(customerId, input, tripsAhead, discount);
}

/**
 * The same price and the same checks, for a client who has no account yet. They are priced as
 * a brand-new customer (a stand-in id that has no bookings), so the welcome discount shows, and
 * nothing is looked up or saved.
 */
const standIn = () => new Types.ObjectId().toString();

async function priceTrip(customerId: string, input: CreateBookingInput, tripsAhead = 0, discount?: ManualDiscount) {
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
export async function quoteJourney(
  customerId: string,
  legs: CreateBookingInput[],
  discount?: ManualDiscount,
  /** True for a client with no account yet: priced as brand new, nothing looked up. */
  asNewClient = false,
) {
  const fares: number[] = [];
  const price = asNewClient ? priceTrip : quoteTrip;
  for (const [index, leg] of legs.entries()) {
    try {
      fares.push((await price(customerId, leg, index, legDiscount(discount, index))).fare);
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

/* ---------------------------- a client with no account yet ---------------------------- */

/**
 * The email must be free before anything is priced or saved, and the operator is told what to
 * do about it: the account exists, so find them with the search instead.
 */
async function assertEmailFree(email: string) {
  if (await User.exists({ email })) {
    throw ApiError.conflict('An account with this email already exists. Search for them above instead.');
  }
}

/** The price of a trip for a client who has no account yet. Nothing is saved. */
export async function quoteTripForNewClient(newClient: AdminNewClientInput, input: CreateBookingInput, discount?: ManualDiscount) {
  await assertEmailFree(newClient.email);
  return priceTrip(standIn(), input, 0, discount);
}

/** The price of each leg of a journey for a client who has no account yet. Nothing is saved. */
export async function quoteJourneyForNewClient(newClient: AdminNewClientInput, legs: CreateBookingInput[], discount?: ManualDiscount) {
  await assertEmailFree(newClient.email);
  return quoteJourney(standIn(), legs, discount, true);
}

/**
 * Said when the account was made but the booking then failed, so the operator does not make the
 * client a second time: the account exists and can be found with the search.
 */
function accountKept(err: unknown, name: string): never {
  if (err instanceof ApiError) {
    throw new ApiError(
      err.statusCode,
      `${name}'s account was created, but the trip could not be booked: ${err.message} Search for them and add the trip again.`,
      err.details,
    );
  }
  throw err;
}

/**
 * Books a trip for someone who is not a client yet, making their account first.
 *
 * Everything is checked and priced BEFORE the account is made, so a trip that breaks a rule
 * (the vehicle for the occasion, the luggage) leaves nothing behind. Then, in this order, the
 * client is emailed to set up their account, and the trip is booked, which emails them the
 * invoice with the link to pay it.
 */
export async function createTripForNewClient(
  adminId: string,
  newClient: AdminNewClientInput,
  input: CreateBookingInput,
  discount?: ManualDiscount,
) {
  await quoteTripForNewClient(newClient, input, discount);
  const { user, inviteSent } = await createCustomer({ ...newClient, sendInvite: true });
  try {
    const made = await createBooking(String(user._id), input, undefined, { adminId, discount });
    return { ...made, client: { _id: String(user._id), name: user.name, email: user.email, created: true, inviteSent } };
  } catch (err) {
    return accountKept(err, user.name);
  }
}

/** The same for a multi-city journey or round trip: one new account, then every leg. */
export async function createJourneyForNewClient(
  adminId: string,
  newClient: AdminNewClientInput,
  legs: CreateBookingInput[],
  discount?: ManualDiscount,
) {
  await quoteJourneyForNewClient(newClient, legs, discount);
  const { user, inviteSent } = await createCustomer({ ...newClient, sendInvite: true });
  try {
    const made = await createJourneyForCustomer(adminId, String(user._id), legs, discount);
    return { ...made, client: { _id: String(user._id), name: user.name, email: user.email, created: true, inviteSent } };
  } catch (err) {
    return accountKept(err, user.name);
  }
}
