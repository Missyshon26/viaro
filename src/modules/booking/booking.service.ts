import { Booking, type BookingDocument } from '../../models/Booking';
import { Driver } from '../../models/Driver';
import { Trip } from '../../models/Trip';
import { Rating } from '../../models/Rating';
import { ApiError } from '../../utils/ApiError';
import type { AuthUser } from '../../middlewares/authGuard';
import { format, now, toDate } from '../../config/timezone';
import { paginated, toSkipLimit, type PaginationQuery } from '../../utils/pagination';
import { logger } from '../../utils/logger';
import * as pricingService from '../pricing/pricing.service';
import * as vehicleService from '../vehicle/vehicle.service';
import * as dispatchService from '../dispatch/dispatch.service';
import { scheduleCancellationWindowCheck } from '../../jobs/cancellationWindow.job';
import * as notify from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/notifications.service';
import type { CreateBookingInput, UpdateBookingInput } from './booking.validation';
import { applyAmendment, assertChangeable } from './booking.amendments';
import { companyOwnsDriver } from '../../utils/roster';
import { recordBookingCancellation } from './booking.cancellation';
import * as events from '../events/events.bus';

export async function createBooking(customerId: string, input: CreateBookingInput) {
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
  });

  const booking = await Booking.create({
    customerId,
    pickup: input.pickup,
    drop: input.drop,
    vehicleClass,
    passengers: input.passengers,
    tripType: input.tripType,
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
    // Recorded, not spent — the debit happens when a Trip exists to spend it against.
    walletCreditRequested: input.walletCreditRequested,
    estimatedFare: fare.fare,
    status: 'pending',
  });

  await notify.send(customerId, NOTIFICATION_TYPES.BOOKING_CREATED, {
    message: `Booking confirmed for ${format(booking.scheduledAt)}`,
    bookingId: String(booking._id),
    scheduledAt: format(booking.scheduledAt),
    estimatedFare: fare.fare,
  });

  // Warn the customer when their free-cancellation window is about to lapse (spec §1).
  scheduleCancellationWindowCheck(String(booking._id), booking.scheduledAt, booking.tripType).catch(
    (err) => logger.warn(`Could not arm cancellation window for booking ${String(booking._id)}`, err),
  );

  // The single cross-module wiring point (spec §4.4): dispatch takes over from here.
  // Deliberately not awaited into the response path — a dispatch hiccup must not fail a
  // booking the customer already paid attention to; it is logged and retryable instead.
  dispatchService.receiveBookingRequest(String(booking._id)).catch((err) => {
    logger.error(`Dispatch failed for booking ${String(booking._id)}`, err);
  });

  // Operations watches the pipeline; the passenger's own trip list is stale too.
  events.publish({
    topic: 'booking',
    action: 'created',
    id: String(booking._id),
    roles: ['admin', 'company'],
    userIds: [String(booking.customerId)],
  });

  return { booking, fareBreakdown: fare };
}

/**
 * Spec §2 RBAC: customers may read only their own bookings; admin and company read any.
 * Drivers have NO direct booking access — they receive pickup/drop through GET /trips/:id
 * once assigned.
 */
export async function getBookingForUser(bookingId: string, user: AuthUser) {
  const booking = await Booking.findById(bookingId)
    .populate({ path: 'customerId', select: 'name phone' })
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

  return booking;
}

export async function updateBooking(bookingId: string, customerId: string, input: UpdateBookingInput) {
  const booking = await loadOwnBooking(bookingId, customerId);

  /*
   * This used to refuse anything that was not 'pending', which made the feature almost
   * unreachable: dispatch runs the moment a booking is created, so a booking is
   * 'dispatched' within a second or two and the customer could never edit it.
   *
   * The real constraint is time, not dispatch state — a change is fine until a chauffeur
   * is close enough to be inconvenienced. assertChangeable() owns that rule and the
   * trip-level routes share it.
   */
  assertChangeable(booking);

  let changed = false;
  if (input.pickup) changed = applyAmendment(booking, 'pickup', input.pickup, 'customer') || changed;
  if (input.drop) changed = applyAmendment(booking, 'drop', input.drop, 'customer') || changed;
  if (input.vehicleClass) {
    const next = await vehicleService.resolveBookableClass(input.vehicleClass, booking.tripType);
    changed = applyAmendment(booking, 'vehicleClass', next, 'customer') || changed;
  }
  if (input.scheduledAt) {
    changed = applyAmendment(booking, 'scheduledAt', input.scheduledAt, 'customer') || changed;
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
  const repriced = Boolean((input.vehicleClass || input.scheduledAt) && booking.city);
  let previousFare: number | undefined;

  if (changed && repriced) {
    previousFare = booking.estimatedFare;
    const fare = await pricingService.calculateFare({
      city: booking.city as string,
      tripType: booking.tripType,
      requestedAt: booking.scheduledAt,
      customerId: String(booking.customerId),
      ...(booking.vehicleClass ? { vehicleClass: booking.vehicleClass } : {}),
    });
    booking.estimatedFare = fare.fare;
  }

  if (changed) {
    await booking.save();

    if (previousFare !== undefined && previousFare !== booking.estimatedFare) {
      // The customer must learn the price moved from the same change that moved it.
      await notify.send(booking.customerId, NOTIFICATION_TYPES.BOOKING_REPRICED, {
        message: `Your fare estimate changed to ${booking.estimatedFare}`,
        bookingId: String(booking._id),
        previousFare,
        estimatedFare: booking.estimatedFare,
      });
    }

    // The amendment banner on every console reads from this, and a chauffeur already
    // driving to the old address is the reason it cannot wait for a poll.
    events.publish({
      topic: 'booking',
      action: 'amended',
      id: String(booking._id),
      roles: ['admin', 'company', 'driver'],
      userIds: [String(booking.customerId)],
    });
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

  events.publish({
    topic: 'booking',
    action: 'cancelled',
    id: String(booking._id),
    roles: ['admin', 'company'],
    userIds: [String(booking.customerId)],
  });

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
    // Explicit, machine-readable so the client can fall back to normal dispatch.
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
    Booking.find({ customerId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
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

  return {
    bookingId: booking._id,
    tripId: trip?._id ?? null,
    fare,
    creditApplied: trip?.creditApplied ?? 0,
    amountDue: Math.max(0, fare - (trip?.creditApplied ?? 0)),
    tripType: booking.tripType,
    date: format(booking.scheduledAt),
    status: trip?.status ?? booking.status,
    refund: trip?.cancellation?.refundPct
      ? { refundPct: trip.cancellation.refundPct, refundedAt: trip.cancellation.refundedAt }
      : null,
  };
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
