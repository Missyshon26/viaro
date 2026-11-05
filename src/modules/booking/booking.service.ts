import {
  Booking,
  type BookingDocument,
  type IBookingJourney,
  type IBookingPayment,
  type IFareBreakdown,
} from '../../models/Booking';
import { Driver } from '../../models/Driver';
import { User } from '../../models/User';
import { Trip } from '../../models/Trip';
import { Rating } from '../../models/Rating';
import { ApiError } from '../../utils/ApiError';
import type { AuthUser } from '../../middlewares/authGuard';
import { format, now, toDate } from '../../config/timezone';
import { paginated, toSkipLimit, type PaginationQuery } from '../../utils/pagination';
import { logger } from '../../utils/logger';
import { nextTripNo } from './booking.tripNo';
import * as pricingService from '../pricing/pricing.service';
import type { ManualDiscount } from '../pricing/pricing.adjustments';
import * as vehicleService from '../vehicle/vehicle.service';
import type { Address } from '../../utils/profile';
import { assertVehicleRules } from './booking.rules';
import { applyDetailChanges } from './booking.details';
import { availableDocuments, generateDocument, type DocumentKind } from './booking.documents';
import { scheduleCancellationWindowCheck } from '../../jobs/cancellationWindow.job';
import * as notify from '../notifications/notifications.service';
import { notifyOps, OPS_NOTIFICATIONS, bookingRef } from '../notifications/ops.notify';
import { NOTIFICATION_TYPES } from '../notifications/notifications.service';
import type { AdminUpdateBookingInput, CreateBookingInput, UpdateBookingInput } from './booking.validation';
import { futureDateString } from './booking.validation';
import { applyAmendment, assertChangeable } from './booking.amendments';
import { companyOwnsDriver } from '../../utils/roster';
import { recordBookingCancellation } from './booking.cancellation';
import * as events from '../events/events.bus';
import { buildServiceNotes, totalCarSeats } from '../../config/services';
import { evaluate as cancellationPolicy } from '../cancellation/cancellation.service';
import { cardLabel, refundBookingToCard } from '../payments/cardPayments';

/**
 * The fare's make-up, to store on the booking — or nothing, when it cannot be stated
 * honestly. A card checkout charges the fare it computed when the payment opened; if rates
 * moved before the booking was made, the lines recomputed now would not add up to what was
 * charged, and an invoice that does not add up is worse than one with a single line.
 */
/**
 * Runs something that follows a change that is ALREADY SAVED — a notification, a live
 * update to the consoles — without letting it fail the request.
 *
 * Once the booking is committed, a failing side effect (the notification store, a socket)
 * used to surface as a 500. The customer read that as "my booking failed", tried again and
 * either made a duplicate or found the first attempt had worked — all for a message that
 * only mattered as a courtesy. The failure is logged, with which booking it was, and the
 * request reports what actually happened: the change was made.
 */
async function afterCommit(
  what: string,
  bookingId: unknown,
  effect: () => unknown | Promise<unknown>,
): Promise<void> {
  try {
    await effect();
  } catch (err) {
    logger.warn(`${what} failed after saving booking ${String(bookingId)}`, err);
  }
}

export function fareBreakdownFor(
  fare: pricingService.FareBreakdown,
  chargedTotal?: number,
): IFareBreakdown | undefined {
  if (chargedTotal !== undefined && Math.abs(chargedTotal - fare.fare) > 0.005) return undefined;
  return {
    classFare: fare.classFare,
    primetimeSurcharge: fare.primetimeSurcharge,
    meetAndGreetFee: fare.meetAndGreetFee,
    stopCount: fare.stopCount,
    stopFee: fare.stopFee,
    ...(fare.distanceFee > 0 || fare.distanceMiles !== undefined
      ? {
          ...(fare.distanceMiles !== undefined ? { distanceMiles: fare.distanceMiles } : {}),
          ...(fare.includedMiles !== undefined ? { includedMiles: fare.includedMiles } : {}),
          ...(fare.extraMiles !== undefined ? { extraMiles: fare.extraMiles } : {}),
          ...(fare.perMileRate !== undefined ? { perMileRate: fare.perMileRate } : {}),
          distanceFee: fare.distanceFee,
        }
      : {}),
    ...(fare.pricingModel ? { pricingModel: fare.pricingModel } : {}),
    ...(fare.packageName ? { packageName: fare.packageName } : {}),
    ...(fare.route ? { route: fare.route } : {}),
    ...(fare.hours !== undefined ? { hours: fare.hours } : {}),
    subtotal: fare.subtotal,
    fuelSurchargePct: fare.fuelSurchargePct,
    fuelSurcharge: fare.fuelSurcharge,
    gratuityPct: fare.gratuityPct,
    gratuity: fare.gratuity,
    ...(fare.discountKind ? { discountKind: fare.discountKind } : {}),
    discount: fare.discount,
    taxPct: fare.taxPct,
    tax: fare.tax,
  };
}

/**
 * The tip, tax rate and discount a booking was billed with, for re-pricing it. A booking
 * from before these existed (no stored make-up) locks to none of them.
 */
export function lockedAdjustments(booking: { fareBreakdown?: IFareBreakdown }) {
  const b = booking.fareBreakdown;
  return {
    gratuityPct: b?.gratuityPct ?? 0,
    fuelPct: b?.fuelSurchargePct ?? 0,
    taxPct: b?.taxPct ?? 0,
    discount: b?.discountKind && b.discount ? { kind: b.discountKind, amount: b.discount } : null,
  };
}

export async function createBooking(
  customerId: string,
  input: CreateBookingInput,
  /**
   * Set by checkout (booking.checkout.ts) once the card has been charged: the payment
   * record, and the fare actually taken — stored as estimatedFare so the booking says
   * exactly what the customer paid.
   */
  paid?: { payment: IBookingPayment; chargedFare: number; journey?: IBookingJourney },
  /** Set when an operator books on the customer's behalf (admin.trips.ts). */
  madeBy?: { adminId: string; journey?: IBookingJourney; discount?: ManualDiscount },
  /** The trip number the legs of a journey share; absent = take the next one. */
  tripNo?: string,
) {
  /*
   * Checked against the catalogue before anything is priced or stored.
   *
   * `vehicleClass` is a free string on the schema and nothing validated it, so the API
   * accepted any value: an unknown key was quietly billed at the base rate and saved as
   * a booking no console could render and no chauffeur could ever be matched to. The
   * canonical key is used from here on, so casing from the client cannot diverge from
   * what the rest of the system looks up.
   */
  const vehicleClass = await vehicleService.resolveBookableClass(input.vehicleClass, input.tripType);

  // The vehicle must suit the occasion and hold the luggage — see booking.rules.ts.
  await assertVehicleRules({
    vehicleClass,
    occasion: input.occasion,
    checkedBags: input.checkedBags,
    carryOnBags: input.carryOnBags,
  });

  // Quote through the shared calculator so the estimate matches what pricing would charge.
  const fare = await pricingService.calculateFare({
    city: input.city,
    tripType: input.tripType,
    requestedAt: input.scheduledAt,
    hours: input.hours,
    customerId,
    // The class the customer picked is priced here too, so the estimate they were
    // shown and the estimatedFare stored on the booking cannot diverge.
    vehicleClass,
    packageId: input.packageId,
    pickupAddress: input.pickup.address,
    dropAddress: input.drop.address,
    meetAndGreet: input.meetAndGreet,
    stopCount: input.stops?.length,
    stopAddresses: input.stops?.map((s) => s.address),
    gratuityPct: input.gratuityPct,
    manualDiscount: madeBy?.discount,
  });

  const extras = {
    ...(input.stops?.length ? { stops: input.stops } : {}),
    meetAndGreet: Boolean(input.meetAndGreet),
    // Seats by age, when given, are the truth and `carSeats` their total.
    carSeats: input.carSeatTypes ? totalCarSeats(input.carSeatTypes) : (input.carSeats ?? 0),
    ...(input.carSeatTypes && totalCarSeats(input.carSeatTypes) > 0 ? { carSeatTypes: input.carSeatTypes } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.cruisePort ? { cruisePort: input.cruisePort } : {}),
    ...(input.cruisePort && input.cruiseShip ? { cruiseShip: input.cruiseShip } : {}),
    ...(input.occasion ? { occasion: input.occasion } : {}),
    ...(input.occasion === 'Other' && input.occasionDetails
      ? { occasionDetails: input.occasionDetails }
      : {}),
    ...(input.carryOnBags !== undefined ? { carryOnBags: input.carryOnBags } : {}),
    ...(input.checkedBags !== undefined ? { checkedBags: input.checkedBags } : {}),
    ...(input.passengerName ? { passengerName: input.passengerName } : {}),
    // Each is optional on its own: a number to ring needs no name, and a name needs no number.
    ...(input.passengerPhone ? { passengerPhone: input.passengerPhone } : {}),
  };

  const breakdown = fareBreakdownFor(fare, paid?.chargedFare);

  // Read from the account, never the request: the tag is the server's statement.
  const customer = await User.findById(customerId).select('isGuest agreement').lean();

  const booking = await Booking.create({
    customerId,
    tripNo: tripNo ?? (await nextTripNo()),
    ...(customer?.isGuest ? { isGuest: true } : {}),
    ...(madeBy ? { source: 'admin' as const, createdBy: madeBy.adminId } : {}),
    ...(customer?.agreement
      ? { agreementVersion: customer.agreement.version, agreementSignedAt: customer.agreement.signedAt }
      : {}),
    pickup: input.pickup,
    drop: input.drop,
    vehicleClass,
    passengers: input.passengers,
    tripType: input.tripType,
    ...(input.packageId && fare.packageName ? { packageId: input.packageId, packageName: fare.packageName } : {}),
    city: input.city,
    // Every stored time goes through the shared PT helper — never `new Date()` (spec §8.1).
    scheduledAt: input.scheduledAt ? toDate(input.scheduledAt) : toDate(now()),
    // Frozen at creation — the cancellation policy measures notice against this, not
    // against a time the customer can move.
    originalScheduledAt: input.scheduledAt ? toDate(input.scheduledAt) : toDate(now()),
    flightDetails: input.flightDetails
      ? {
          flightNumber: input.flightDetails.flightNumber,
          scheduledArrival: input.flightDetails.scheduledArrival
            ? toDate(input.flightDetails.scheduledArrival)
            : undefined,
        }
      : undefined,
    favoriteDriverId: input.favoriteDriverId,
    ...(input.tripType === 'hourly' && input.hours ? { hours: input.hours } : {}),
    ...extras,
    serviceNotes: buildServiceNotes({ vehicleClass, packageName: fare.packageName, ...extras }),
    // Recorded, not spent — the debit happens when a Trip exists to spend it against.
    walletCreditRequested: input.walletCreditRequested,
    estimatedFare: paid ? paid.chargedFare : fare.fare,
    ...(breakdown ? { fareBreakdown: breakdown } : {}),
    ...(paid ? { payment: paid.payment } : {}),
    ...(paid?.journey ?? madeBy?.journey ? { journey: paid?.journey ?? madeBy?.journey } : {}),
    status: 'pending',
  });

  await afterCommit('Booking confirmation', booking._id, () =>
    notify.send(customerId, NOTIFICATION_TYPES.BOOKING_CREATED, {
      message: `Booking confirmed for ${format(booking.scheduledAt)}`,
      bookingId: String(booking._id),
      scheduledAt: format(booking.scheduledAt),
      estimatedFare: booking.estimatedFare,
    }),
  );

  // Operations hears about every booking a customer makes (one an operator entered themselves
  // needs no announcement to the same operators).
  if (!madeBy) {
    void (async () => {
      const label = await vehicleService.labelFor(vehicleClass).catch(() => vehicleClass);
      await notifyOps(OPS_NOTIFICATIONS.BOOKING_CREATED, {
        message: `New booking ${bookingRef(booking._id)}: ${fare.packageName ? `${fare.packageName}, ` : ''}${label}, ${format(booking.scheduledAt)} · $${(booking.estimatedFare ?? 0).toFixed(2)}${booking.payment ? ' (paid by card)' : ''}`,
        bookingId: String(booking._id),
      });
    })();
  }

  // Warn the customer when their free-cancellation window is about to lapse (spec §1).
  scheduleCancellationWindowCheck(String(booking._id), booking.scheduledAt, booking.tripType).catch(
    (err) => logger.warn(`Could not arm cancellation window for booking ${String(booking._id)}`, err),
  );

  // Operations watches the pipeline; the passenger's own trip list is stale too.
  await afterCommit('Live update', booking._id, () =>
    events.publish({
      topic: 'booking',
      action: 'created',
      id: String(booking._id),
      roles: ['admin', 'company'],
      userIds: [String(booking.customerId)],
    }),
  );

  return { booking, fareBreakdown: fare };
}

/**
 * Spec §2 RBAC: customers may read only their own bookings; admin and company read any.
 * Drivers have NO direct booking access — they receive pickup/drop through GET /trips/:id
 * once assigned.
 */
export async function getBookingForUser(bookingId: string, user: AuthUser) {
  const booking = await Booking.findById(bookingId)
    // The console shows the customer's email (and mails the invoice to it): admins only, as a
    // company must not be handed an address along with another operator's passenger.
    .populate({ path: 'customerId', select: user.role === 'admin' ? 'name email phone' : 'name phone' })
    .lean();

  if (!booking) throw ApiError.notFound('Booking not found');

  if (user.role === 'customer') {
    const ownerId = extractId(booking.customerId);
    if (ownerId !== user.userId) throw ApiError.forbidden('This booking belongs to another customer');
  }

  /*
   * A company sees a booking only once one of ITS chauffeurs is on the trip.
   *
   * There was no company branch, so any booking could be read by id — and this response
   * populates the customer's name and phone, so it handed over another operator's
   * passenger's contact details along with their pickup address. Booking ids are not
   * secret; the roster is the boundary. An unassigned booking has no trip yet and so
   * belongs to no operator.
   */
  if (user.role === 'company') {
    const trip = await Trip.findOne({ bookingId: booking._id }).select('driverId').lean();
    if (!trip || !(await companyOwnsDriver(user.userId, trip.driverId))) {
      throw ApiError.forbidden('That booking is not assigned to a driver on your roster');
    }
  }

  // The calendar record is operations' bookkeeping (and links into their calendar): nobody
  // else's response carries it.
  if (user.role !== 'admin') delete (booking as { calendar?: unknown }).calendar;

  // The rest of the journey, for the people who may see it. A chauffeur or an operator is
  // shown their own job only: the other legs may belong to someone else's roster.
  // The pickup as Pacific wall time, so every screen reads the same hour whatever the viewer's zone.
  const withLocal = booking.scheduledAt ? { ...booking, scheduledAtLocal: format(booking.scheduledAt) } : booking;

  if ((user.role === 'customer' || user.role === 'admin') && booking.journey) {
    return { ...withLocal, journeyLegs: await journeyLegsOf(booking) };
  }

  return withLocal;
}

/**
 * Every leg of the journey a booking belongs to, in pickup order, trimmed to what the
 * trip page lists. Legs are found through their shared payment — it is what binds a
 * journey together — so a booking with no payment record has no siblings to show.
 */
export async function journeyLegsOf(booking: {
  customerId: unknown;
  payment?: { intentId?: string } | null;
}) {
  const intentId = booking.payment?.intentId;
  if (!intentId) return [];

  const legs = await Booking.find({ 'payment.intentId': intentId })
    .select('journey pickup drop scheduledAt status vehicleClass estimatedFare')
    .sort({ 'journey.index': 1, scheduledAt: 1 })
    .lean();
  return legs;
}

export async function updateBooking(bookingId: string, customerId: string, input: UpdateBookingInput) {
  const booking = await loadOwnBooking(bookingId, customerId);

  /*
   * The constraint is time — a change is fine until a chauffeur is close enough to be
   * inconvenienced. assertChangeable() owns that rule and the trip-level routes share it.
   */
  assertChangeable(booking);

  return applyBookingUpdate(booking, input, 'customer', true);
}

/**
 * Operations changing any booking, whoever made it, at any time. There is no deadline here:
 * the people who dispatch the job are the ones who would otherwise be told to "call us", so
 * they can fix a pickup an hour before it is due. A completed or cancelled booking can be
 * corrected too (a wrong address, date or head count in the records): those edits are
 * recorded in the change trail like any other, but the fare is not re-quoted, because the trip
 * is already settled. The customer is emailed unless `notifyCustomer` is false.
 */
export async function adminUpdateBooking(bookingId: string, input: AdminUpdateBookingInput) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');
  const trip = await Trip.findOne({ bookingId: booking._id }).select('status').lean();
  const finished = booking.status === 'cancelled' || trip?.status === 'completed';

  // The vehicle sets the price. A finished trip's price is settled (the payout is posted), so it
  // keeps the vehicle it was driven with; everything else about it can still be corrected.
  if (finished && input.vehicleClass && input.vehicleClass !== booking.vehicleClass) {
    throw ApiError.conflict('The vehicle cannot be changed on a completed or cancelled trip, because its price is settled.');
  }

  // An open booking is still a future pickup; only a finished one may be given a past date.
  if (input.scheduledAt && !finished) {
    const check = futureDateString.safeParse(input.scheduledAt);
    if (!check.success) throw ApiError.badRequest(check.error.issues[0]?.message ?? 'Not a valid pickup time');
  }

  const { notifyCustomer, ...fields } = input;
  return applyBookingUpdate(booking, fields, 'admin', notifyCustomer ?? true, finished);
}

/** The shared change: one set of rules, re-pricing, trail and live updates for both actors. */
async function applyBookingUpdate(
  booking: BookingDocument,
  input: UpdateBookingInput & Pick<AdminUpdateBookingInput, 'passengers' | 'description'>,
  by: 'customer' | 'admin',
  notifyCustomer: boolean,
  /** Completed or cancelled: the details are corrected, but the settled fare is left alone. */
  finished = false,
) {
  // What the vehicle rules read, before this edit touches it. They are judged only if one
  // of these actually ends up different — the edit screen posts every field every time, so
  // "the vehicle was in the request" would block an unrelated change to an older booking
  // that predates a rule.
  const before = {
    vehicleClass: booking.vehicleClass,
    occasion: booking.occasion,
    checkedBags: booking.checkedBags ?? 0,
    carryOnBags: booking.carryOnBags ?? 0,
  };

  let changed = false;
  if (input.pickup) changed = applyAmendment(booking, 'pickup', input.pickup, by) || changed;
  if (input.drop) changed = applyAmendment(booking, 'drop', input.drop, by) || changed;
  if (input.vehicleClass) {
    const next = await vehicleService.resolveBookableClass(input.vehicleClass, booking.tripType);
    changed = applyAmendment(booking, 'vehicleClass', next, by) || changed;
  }
  if (input.scheduledAt) {
    changed = applyAmendment(booking, 'scheduledAt', input.scheduledAt, by) || changed;
  }

  // Stops, occasion, luggage, passenger and flight — see booking.details.ts.
  const details = applyDetailChanges(booking, input, by);
  changed = details.changed || changed;

  // The vehicle has to suit the finished booking, whichever field moved. Only judged when
  // a field a rule reads actually changed: a booking made before a rule existed must stay
  // editable for unrelated things (a new pickup time, say).
  const touchesRules =
    booking.vehicleClass !== before.vehicleClass ||
    booking.occasion !== before.occasion ||
    (booking.checkedBags ?? 0) !== before.checkedBags ||
    (booking.carryOnBags ?? 0) !== before.carryOnBags;
  if (touchesRules) {
    await assertVehicleRules({
      vehicleClass: booking.vehicleClass,
      occasion: booking.occasion,
      checkedBags: booking.checkedBags,
      carryOnBags: booking.carryOnBags,
    });
  }

  /*
   * Not an amendment: nothing has been spent yet, so there is no "from" worth recording
   * in a trail whose job is to warn a chauffeur that the job moved. It is simply the
   * latest answer to "put my credit towards this?", and 0 is a valid answer.
   */
  if (input.walletCreditRequested !== undefined) {
    const next = input.walletCreditRequested;
    if ((booking.walletCreditRequested ?? 0) !== next) {
      booking.walletCreditRequested = next > 0 ? next : undefined;
      changed = true;
    }
  }

  /*
   * Re-price whenever the amendment touches something the fare depends on.
   *
   * `calculateFare` reads vehicle class and the requested time (peak multiplier), so a
   * booking amended from an off-peak sedan to a peak-hour luxury SUV kept its original,
   * cheaper quote — the customer chose the expensive option and paid for the cheap one.
   * The trip is created from `estimatedFare`, so this was real money.
   */
  // `city` is optional on the model and pricing is city-based, so a booking without one
  // cannot be re-quoted; it keeps its original estimate rather than being priced wrongly.
  // Addresses count too: a route price (Tacoma ↔ Sea-Tac) depends on where it goes.
  const repriced = Boolean(
    !finished &&
    (input.vehicleClass || input.scheduledAt || input.pickup || input.drop || details.stopCountChanged) &&
      booking.city,
  );
  let previousFare: number | undefined;

  if (changed && repriced) {
    previousFare = booking.estimatedFare;
    const fare = await pricingService.calculateFare({
      city: booking.city as string,
      tripType: booking.tripType,
      requestedAt: booking.scheduledAt,
      customerId: String(booking.customerId),
      ...(booking.vehicleClass ? { vehicleClass: booking.vehicleClass } : {}),
      // A package stays priced by its package: the name was stored, the package may have changed.
      ...(booking.packageId ? { packageId: String(booking.packageId) } : {}),
      // Re-priced as booked: the real duration (it used to fall back to 1 hour) and
      // the same add-ons.
      ...(booking.hours ? { hours: booking.hours } : {}),
      pickupAddress: booking.pickup.address,
      dropAddress: booking.drop.address,
      meetAndGreet: booking.meetAndGreet,
      // A stop is part of the booking, so amending something else must not drop its charge.
      stopCount: booking.stops?.length,
      stopAddresses: booking.stops?.map((s) => s.address),
      // The tip, tax and discount it was booked with — today's settings do not move it.
      locked: lockedAdjustments(booking),
    });
    booking.estimatedFare = fare.fare;
    booking.fareBreakdown = fareBreakdownFor(fare);
  }

  // A different vehicle can change the cruise meeting point (vans use Islands 3–4).
  if (changed) {
    booking.serviceNotes = buildServiceNotes({
      vehicleClass: booking.vehicleClass,
      meetAndGreet: booking.meetAndGreet,
      carSeats: booking.carSeats,
      carSeatTypes: booking.carSeatTypes,
      description: booking.description,
      cruisePort: booking.cruisePort,
      cruiseShip: booking.cruiseShip,
      stops: booking.stops,
      occasion: booking.occasion,
      occasionDetails: booking.occasionDetails,
      carryOnBags: booking.carryOnBags,
      checkedBags: booking.checkedBags,
      passengerName: booking.passengerName,
      passengerPhone: booking.passengerPhone,
    });
  }

  if (changed) {
    await booking.save();

    const fareMoved = previousFare !== undefined && previousFare !== booking.estimatedFare;
    // Dispatch copied the fare onto the trip when a driver was assigned; the invoice and the
    // charge after the ride read that copy, so it follows the booking until the trip is settled.
    if (fareMoved) {
      await Trip.updateOne(
        { bookingId: booking._id, status: { $nin: ['completed', 'cancelled'] }, settled: { $ne: true } },
        { $set: { fareAmount: booking.estimatedFare ?? 0, ...(booking.fareBreakdown?.tax !== undefined ? { taxAmount: booking.fareBreakdown.tax } : {}) } },
      );
    }
    if (fareMoved && notifyCustomer) {
      // The customer must learn the price moved from the same change that moved it.
      await afterCommit('Re-price notice', booking._id, () =>
        notify.send(booking.customerId, NOTIFICATION_TYPES.BOOKING_REPRICED, {
          message: `Your fare estimate changed to ${booking.estimatedFare}`,
          bookingId: String(booking._id),
          previousFare,
          estimatedFare: booking.estimatedFare,
        }),
      );
    }

    void notifyOps(OPS_NOTIFICATIONS.BOOKING_CHANGED, {
      message: `${bookingRef(booking._id)} was changed by ${by === 'admin' ? 'operations' : 'the customer'}${fareMoved ? ` (fare $${previousFare?.toFixed(2)} → $${booking.estimatedFare?.toFixed(2)})` : ''}`,
      bookingId: String(booking._id),
    });

    // The updated-booking email: the new details, and the fare change when there was one.
    if (notifyCustomer) await afterCommit('Update notice', booking._id, () =>
      notify.send(booking.customerId, NOTIFICATION_TYPES.BOOKING_UPDATED, {
        message: `Your booking for ${format(booking.scheduledAt)} was updated`,
        bookingId: String(booking._id),
        scheduledAt: format(booking.scheduledAt),
        ...(fareMoved ? { previousFare } : {}),
        estimatedFare: booking.estimatedFare,
      }),
    );

    // The amendment banner on every console reads from this, and a chauffeur already
    // driving to the old address is the reason it cannot wait for a poll.
    await afterCommit('Live update', booking._id, () =>
      events.publish({
        topic: 'booking',
        action: 'amended',
        id: String(booking._id),
        roles: ['admin', 'company', 'driver'],
        userIds: [String(booking.customerId)],
      }),
    );
  }
  return booking;
}

export async function cancelBookingByCustomer(
  bookingId: string,
  customerId: string,
  /** Optional free text from the customer. Operations reads it; nothing branches on it. */
  reason?: string,
) {
  const booking = await loadOwnBooking(bookingId, customerId);
  if (booking.status === 'cancelled') throw ApiError.conflict('Booking is already cancelled');
  if (booking.status === 'assigned') {
    throw ApiError.conflict('A driver is already assigned — use the trip cancellation endpoints');
  }

  booking.status = 'cancelled';
  // Before this, a booking cancelled at this stage carried no author and no reason at
  // all — the console could only say that it had ended, not who ended it.
  await recordBookingCancellation(booking, { by: 'customer', byUserId: customerId, reason });
  await booking.save();

  /*
   * Paid by card at booking: the cancellation policy decides how much goes back to the
   * card — notice measured against the ORIGINAL pickup time, as for trip cancellations.
   * A booking from before card payments was never charged, so there is nothing to refund.
   */
  let refundAmount = 0;
  let message = 'Your booking was cancelled. No chauffeur had been assigned, so nothing was charged.';
  if (booking.payment) {
    const policy = cancellationPolicy(booking.tripType, booking.originalScheduledAt ?? booking.scheduledAt);
    refundAmount =
      policy.refundPct > 0
        ? await refundBookingToCard(String(booking._id), policy.refundPct, 'customer_cancellation')
        : 0;
    message =
      refundAmount > 0
        ? `Your booking was cancelled. $${refundAmount.toFixed(2)} (${policy.refundPct}%) is being refunded to ${cardLabel(booking.payment)}.`
        : `Your booking was cancelled within ${policy.thresholdHours} hours of pickup, so the fare is not refunded.`;
  }

  // The refund above is deliberately NOT guarded: if the card refund fails the caller must
  // hear about it, because the customer is owed money. These two are only messages.
  await afterCommit('Cancellation notice', booking._id, () =>
    notify.send(booking.customerId, NOTIFICATION_TYPES.BOOKING_CANCELLED, {
      message,
      bookingId: String(booking._id),
      scheduledAt: format(booking.scheduledAt),
      ...(reason ? { reason } : {}),
      ...(refundAmount > 0 ? { refundAmount } : {}),
    }),
  );
  void notifyOps(OPS_NOTIFICATIONS.BOOKING_CANCELLED, {
    message: `${bookingRef(booking._id)} was cancelled by the customer${reason ? `: ${reason}` : ''}${refundAmount > 0 ? ` ($${refundAmount.toFixed(2)} refunded)` : ''}`,
    bookingId: String(booking._id),
  });
  await afterCommit('Live update', booking._id, () =>
    events.publish({
      topic: 'booking',
      action: 'cancelled',
      id: String(booking._id),
      roles: ['admin', 'company'],
      userIds: [String(booking.customerId)],
    }),
  );

  return booking;
}

/** Spec §4.3 `<<extend>>`: request a favourite driver, if they are not already busy. */
export async function requestFavoriteDriver(bookingId: string, customerId: string, driverId: string) {
  const booking = await loadOwnBooking(bookingId, customerId);

  if (booking.status !== 'pending') {
    throw ApiError.conflict('A favourite driver can only be requested before dispatch');
  }

  const driver = await Driver.findById(driverId).lean();
  if (!driver) throw ApiError.notFound('Driver not found');

  if (driver.status !== 'available') {
    // Explicit, machine-readable so the client can carry on without a favourite.
    throw new ApiError(409, 'Favourite driver is not available right now', {
      code: 'FAVORITE_DRIVER_BUSY',
      driverStatus: driver.status,
    });
  }

  booking.favoriteDriverId = driver._id;
  await booking.save();
  return booking;
}

/**
 * What happened to the Trip behind a booking, for the passenger's history list.
 *
 * A Booking's own status stops at pending / dispatched / assigned / cancelled, so without
 * this the list could not say "Completed" or "Refunded" and had to guess from the clock.
 * The chauffeur's id and name are included so a finished ride can be favourited
 * directly — passengers were being asked to paste a 24-character driver id instead.
 */
export interface RideTripSummary {
  tripId: string;
  status: 'accepted' | 'started' | 'completed' | 'cancelled';
  completedAt?: Date;
  refundPct?: number;
  refundedAt?: Date;
  rated: boolean;
  driverId: string;
  driverName: string | null;
}

export async function listMyRides(customerId: string, q: PaginationQuery) {
  const { skip, limit } = toSkipLimit(q);
  const [items, total] = await Promise.all([
    // `calendar` is operations' bookkeeping, not part of what a customer is shown.
    Booking.find({ customerId }).select('-calendar').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Booking.countDocuments({ customerId }),
  ]);

  // One query each for the page's trips, their drivers' names and their ratings — not
  // one per row.
  const trips = await Trip.find({ bookingId: { $in: items.map((b) => b._id) } })
    .select('bookingId driverId status timestamps.completed cancellation.refundPct cancellation.refundedAt')
    .populate({ path: 'driverId', select: 'userId', populate: { path: 'userId', select: 'name' } })
    .lean();
  const ratedTripIds = new Set(
    (await Rating.find({ tripId: { $in: trips.map((t) => t._id) } }).select('tripId').lean()).map(
      (r) => String(r.tripId),
    ),
  );

  const tripByBooking = new Map<string, RideTripSummary>();
  for (const trip of trips) {
    const driver = trip.driverId as unknown as {
      _id: unknown;
      userId?: { name?: string } | null;
    } | null;
    tripByBooking.set(String(trip.bookingId), {
      tripId: String(trip._id),
      status: trip.status,
      completedAt: trip.timestamps?.completed,
      refundPct: trip.cancellation?.refundPct,
      refundedAt: trip.cancellation?.refundedAt,
      rated: ratedTripIds.has(String(trip._id)),
      driverId: String(driver?._id ?? trip.driverId),
      driverName: driver?.userId?.name ?? null,
    });
  }

  return paginated(
    items.map((b) => ({
      ...b,
      scheduledAtLocal: format(b.scheduledAt),
      trip: tripByBooking.get(String(b._id)) ?? null,
    })),
    total,
    q,
  );
}

/**
 * JSON receipt (spec §4.3). PDF rendering is deliberately out of scope here — the reports
 * module owns document generation.
 */
export async function getReceipt(bookingId: string, customerId: string) {
  const booking = await loadOwnBooking(bookingId, customerId);
  const trip = await Trip.findOne({ bookingId: booking._id }).lean();

  const fare = trip?.fareAmount ?? booking.estimatedFare ?? 0;
  // Paid by card at booking: nothing is due, whatever the trip's state.
  const paidByCard = booking.payment
    ? {
        amount: booking.payment.amount,
        brand: booking.payment.brand ?? null,
        last4: booking.payment.last4 ?? null,
        refundedAmount: booking.payment.refundedAmount,
        status: booking.payment.status,
      }
    : null;

  return {
    bookingId: booking._id,
    tripId: trip?._id ?? null,
    fare,
    creditApplied: trip?.creditApplied ?? 0,
    amountDue: paidByCard ? 0 : Math.max(0, fare - (trip?.creditApplied ?? 0)),
    paidByCard,
    tripType: booking.tripType,
    date: format(booking.scheduledAt),
    status: trip?.status ?? booking.status,
    refund: trip?.cancellation?.refundPct
      ? { refundPct: trip.cancellation.refundPct, refundedAt: trip.cancellation.refundedAt }
      : null,
    // Which PDFs can be downloaded now; the receipt only exists once the ride is paid.
    documents: availableDocuments(booking, trip),
  };
}

/**
 * An invoice or receipt for a booking, as a PDF. A customer gets their own; an admin can
 * produce one for any customer (they send these on request). Anyone else is refused as
 * "not yours", the same answer as for the booking itself.
 */
export async function getDocument(bookingId: string, kind: DocumentKind, user: AuthUser) {
  const booking = await Booking.findById(bookingId).populate({ path: 'customerId', select: 'name email phone address' }).lean();
  if (!booking) throw ApiError.notFound('Booking not found');

  const owner = booking.customerId as unknown as {
    _id: unknown;
    name?: string;
    email?: string;
    phone?: string;
    address?: Address | null;
  } | null;
  if (user.role === 'customer' && String(owner?._id ?? booking.customerId) !== user.userId) {
    throw ApiError.forbidden('This booking belongs to another customer');
  }

  const trip = await Trip.findOne({ bookingId: booking._id }).lean();
  return generateDocument(kind, {
    booking: booking as never,
    trip,
    customer: owner,
    vehicleLabel: await vehicleService.labelFor(booking.vehicleClass),
  });
}

/* -------------------------------- helpers --------------------------------- */

async function loadOwnBooking(bookingId: string, customerId: string): Promise<BookingDocument> {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');
  if (String(booking.customerId) !== customerId) {
    throw ApiError.forbidden('This booking belongs to another customer');
  }
  return booking;
}

function extractId(value: unknown): string {
  if (value && typeof value === 'object' && '_id' in value) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
}
