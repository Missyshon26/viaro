import type { QueryFilter } from 'mongoose';
import { Trip, type ITrip, type TripDocument, type TripStatus } from '../../models/Trip';
import { Booking, type BookingDocument } from '../../models/Booking';
import { applyAmendment, assertChangeable } from '../booking/booking.amendments';
import * as events from '../events/events.bus';
import * as vehicleService from '../vehicle/vehicle.service';
import {
  applyTripCancellationActor,
  recordBookingCancellation,
} from '../booking/booking.cancellation';
import { issueRefundToWallet } from '../cancellation/cancellation.service';
import { Driver, type DriverDocument } from '../../models/Driver';
import { Rating } from '../../models/Rating';
import { PenaltyEvent } from '../../models/PenaltyEvent';
import { User } from '../../models/User';
import { ApiError } from '../../utils/ApiError';
import type { AuthUser } from '../../middlewares/authGuard';
import type { UserRole } from '../../utils/roles';
import { format, now, toDate } from '../../config/timezone';
import { round2 } from '../../utils/money';
import { logger } from '../../utils/logger';
import { paginated, toSkipLimit, type PaginationQuery } from '../../utils/pagination';
import * as walletService from '../wallet/wallet.service';
import * as flightService from '../flight/flight.service';
import * as notify from '../notifications/notifications.service';
import { requestFeedback } from './trip.feedback';
import { notifyOps, OPS_NOTIFICATIONS, bookingRef } from '../notifications/ops.notify';
import { NOTIFICATION_TYPES } from '../notifications/notifications.service';
import type { ChangeLocationInput, RateInput } from './trip.validation';
import { companyDriverIds, companyOwnsDriver } from '../../utils/roster';
import {
  canSeeDriverPhone,
  stripFareIfHidden,
  MASKED_PHONE as MASKED,
} from '../../utils/visibility';

/**
 * Shown to customers instead of the driver's real number (spec §8 rule 4).
 * Re-exported for existing importers; the rule itself lives in utils/visibility.
 */
export const MASKED_PHONE = MASKED;

/* -------------------------------------------------------------------------- */
/* Shared access + shaping rules (spec §2 RBAC, §8 rules 2 and 4)              */
/* -------------------------------------------------------------------------- */

/**
 * Ownership check, kept here rather than inline in the controller so every trip endpoint
 * enforces exactly the same rule:
 *   customer -> must own the linked booking
 *   driver   -> must be the assigned driver
 *   company  -> the trip's driver must be on that company's roster
 *   admin    -> unrestricted
 */
export async function assertTripAccess(
  trip: TripDocument,
  booking: BookingDocument,
  user: AuthUser,
): Promise<void> {
  if (user.role === 'customer') {
    if (String(booking.customerId) !== user.userId) {
      throw ApiError.forbidden('This trip belongs to another customer');
    }
    return;
  }

  if (user.role === 'driver') {
    await assertDriverOwnsTrip(trip, user.userId);
    return;
  }

  /*
   * A company was previously treated as an admin here, so fixing only the trip LIST would
   * have left `GET /trips/:id` as an unscoped read of any trip by id — the same leak
   * through a narrower door. A company sees a trip only when it ran on its own roster.
   */
  if (user.role === 'company') {
    if (!(await companyOwnsDriver(user.userId, trip.driverId))) {
      throw ApiError.forbidden('That trip was not run by a driver on your roster');
    }
    return;
  }

  // admin: no ownership restriction (spec §2 RBAC matrix).
}

/** Resolves the driver's User id once, so ownership checks don't re-query per call site. */
export async function assertDriverOwnsTrip(trip: TripDocument, userId: string): Promise<DriverDocument> {
  const driver = await Driver.findById(trip.driverId);
  if (!driver) throw ApiError.notFound('Driver not found');
  if (String(driver.userId) !== userId) {
    throw ApiError.forbidden('This trip is assigned to another driver');
  }
  return driver;
}

export interface ShapedTrip extends Record<string, unknown> {
  _id: unknown;
  status: string;
}

/**
 * Response shaping — applied independently of the ownership check:
 *   driver           -> fareAmount removed entirely (spec §8 rule 2)
 *   customer         -> driver's real phone replaced with a masked placeholder (rule 4)
 *   admin / company  -> full, unredacted document
 */
export function shapeTripForRole(
  trip: Record<string, unknown>,
  role: UserRole,
): ShapedTrip {
  const shaped = stripFareIfHidden({ ...trip }, role) as ShapedTrip;

  if (!canSeeDriverPhone(role)) {
    const driver = shaped.driver as { phone?: string } | undefined;
    if (driver && typeof driver === 'object') {
      shaped.driver = { ...driver, phone: MASKED_PHONE };
    }
  }

  return shaped;
}

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A driver confirms a ride an operator assigned to them. Only the assigned driver may; a ride
 * is never offered to drivers to claim.
 */
/**
 * Announces a trip change to everyone who could be looking at it.
 *
 * The passenger and the chauffeur are addressed individually; operations and the
 * operator console get it by role. Kept as one function so a new lifecycle step cannot
 * accidentally notify a narrower audience than the step before it.
 */
function publishTripChange(
  action: string,
  trip: { _id: unknown },
  parties: { customerId?: unknown; driverUserId?: unknown },
): void {
  const userIds = [parties.customerId, parties.driverUserId]
    .filter(Boolean)
    .map((value) => String(value));

  events.publish({
    topic: 'trip',
    action,
    id: String(trip._id),
    roles: ['admin', 'company'],
    ...(userIds.length ? { userIds } : {}),
  });
}

export async function acceptBooking(id: string, userId: string) {
  const driver = await Driver.findOne({ userId });
  if (!driver) throw ApiError.notFound('Driver profile not found');

  // Same rule as going online (driver.service setOwnStatus): an account still awaiting
  // document review cannot be dispatched, so it must not be able to take a ride.
  const account = await User.findById(userId).select('status').lean<{ status: string }>();
  if (account?.status === 'pending_documents') {
    throw ApiError.forbidden('Upload your documents before accepting rides');
  }

  // The spec writes this route as /trips/:id/accept and the build prompt as
  // /trips/:bookingId/accept. Both are honoured: the id is resolved as a booking first,
  // then as a Trip (which exists once an operator has assigned the driver).
  let booking = await Booking.findById(id);
  if (!booking) {
    const viaTrip = await Trip.findById(id);
    if (viaTrip) booking = await Booking.findById(viaTrip.bookingId);
  }
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.status === 'cancelled') throw ApiError.conflict('This booking was cancelled');

  const existing = await Trip.findOne({ bookingId: booking._id });

  if (existing) {
    // Only the driver an operator assigned may confirm it.
    if (String(existing.driverId) !== String(driver._id)) {
      throw ApiError.conflict('This ride is assigned to another driver');
    }

    /*
     * Accepting is not idempotent — afterAccept() spends the passenger's requested wallet
     * credit. Without this guard the same trip could be accepted repeatedly (by booking
     * id, then by trip id) and each call debited the credit again, walking an $80 balance
     * to zero on a single ride. A confirmed trip is a 409, not a second settlement.
     */
    if (existing.timestamps.accepted) {
      throw ApiError.conflict('This ride has already been accepted');
    }

    /*
     * Claim the acceptance atomically for the same reason /complete does: two parallel
     * confirmations both read "not yet accepted" otherwise.
     */
    const claimed = await Trip.findOneAndUpdate(
      { _id: existing._id, 'timestamps.accepted': { $exists: false } },
      { $set: { 'timestamps.accepted': toDate(now()) } },
      { new: true },
    );
    if (!claimed) throw ApiError.conflict('This ride has already been accepted');

    await afterAccept(claimed, booking, driver);
    return claimed;
  }

  // Nobody claims a job from a pool: a driver confirms a ride an operator assigned to them.
  throw ApiError.conflict('This ride has not been assigned to you');
}

async function afterAccept(trip: TripDocument, booking: BookingDocument, driver: DriverDocument) {
  booking.status = 'assigned';
  await booking.save();

  driver.status = 'busy';
  await driver.save();

  await notify.send(booking.customerId, NOTIFICATION_TYPES.DRIVER_ASSIGNED, {
    message: 'A driver has accepted your ride',
    bookingId: String(booking._id),
    tripId: String(trip._id),
  });

  // Credit the passenger asked for at booking time — now there is a Trip to put it on.
  await walletService.applyRequestedCredit(trip._id).catch((err) => {
    logger.warn(`Could not apply requested credit to trip ${String(trip._id)}`, err);
  });

  // The passenger's page is showing "finding your chauffeur" at this exact moment.
  publishTripChange('accepted', trip, {
    customerId: booking.customerId,
    driverUserId: driver.userId,
  });

  // Airport pickups: push the live arrival time to the driver (spec §4.8).
  if (booking.tripType === 'airport') {
    flightService.showArrivalTimeToDriver(String(trip._id)).catch((err) => {
      logger.warn(`Could not push flight arrival for trip ${String(trip._id)}`, err);
    });
  }
}

/**
 * List trips for whoever is asking (driver Schedule screen, customer trip list).
 *
 * `GET /trips/:id` only ever answered for one trip, so a driver had no way to see the
 * work assigned to them. Scoping mirrors the RBAC matrix: driver -> own, customer ->
 * own bookings, admin/company -> all. Response shaping is applied per row, so a driver
 * still never sees fareAmount.
 */
export async function listTripsForUser(
  user: AuthUser,
  q: PaginationQuery & { status?: TripStatus },
) {
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;

  if (user.role === 'driver') {
    const driver = await Driver.findOne({ userId: user.userId }).lean();
    if (!driver) throw ApiError.notFound('Driver profile not found');
    filter.driverId = driver._id;
  } else if (user.role === 'customer') {
    const bookings = await Booking.find({ customerId: user.userId }).select('_id').lean();
    filter.bookingId = { $in: bookings.map((b) => b._id) };
  } else if (user.role === 'company') {
    /*
     * A company is NOT an admin. Without this branch a company token fell through with an
     * empty filter and read every trip on the platform — other companies' fares, other
     * customers' pickup addresses. Scope it to its own roster, the same source of truth
     * admin.service.ts already uses for the driver-list and driver-edit endpoints.
     */
    filter.driverId = { $in: await companyDriverIds(user.userId) };
  }

  const { skip, limit } = toSkipLimit(q);
  const [trips, total] = await Promise.all([
    Trip.find(filter).sort({ 'timestamps.assigned': -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    Trip.countDocuments(filter),
  ]);

  const bookings = await Booking.find({ _id: { $in: trips.map((t) => t.bookingId) } }).lean();
  const bookingById = new Map(bookings.map((b) => [String(b._id), b]));

  /*
   * Whether each trip already carries a rating.
   *
   * Exposed because a client cannot otherwise tell: the Rating lives in its own
   * collection and nothing on the Trip referenced it, so the only way to find out was to
   * post a rating and read the conflict. One query for the whole page rather than one
   * per row.
   */
  const rated = new Set(
    (await Rating.find({ tripId: { $in: trips.map((t) => t._id) } }).select('tripId').lean()).map(
      (r) => String(r.tripId),
    ),
  );

  const rows = trips.map((trip) => {
    const booking = bookingById.get(String(trip.bookingId));
    return shapeTripForRole(
      {
        ...(trip as unknown as Record<string, unknown>),
        booking,
        scheduledAtLocal: booking ? format(booking.scheduledAt) : null,
        rated: rated.has(String(trip._id)),
      },
      user.role,
    );
  });

  return paginated(rows, total, q);
}

export async function getTripForUser(tripId: string, user: AuthUser): Promise<ShapedTrip> {
  const trip = await Trip.findById(tripId);
  if (!trip) throw ApiError.notFound('Trip not found');

  const booking = await Booking.findById(trip.bookingId);
  if (!booking) throw ApiError.notFound('Linked booking not found');

  await assertTripAccess(trip, booking, user);

  const driver = await Driver.findById(trip.driverId).lean();
  const driverUser = driver ? await User.findById(driver.userId).select('name phone').lean() : null;
  const customer = await User.findById(booking.customerId).select('name phone').lean();
  const rating = await Rating.findOne({ tripId: trip._id }).select('_id score').lean();

  const full = {
    ...(trip.toJSON() as unknown as Record<string, unknown>),
    rated: Boolean(rating),
    ratingScore: rating?.score ?? null,
    scheduledAtLocal: format(booking.scheduledAt),
    booking: {
      ...(booking.toJSON() as unknown as Record<string, unknown>),
      scheduledAtLocal: format(booking.scheduledAt),
    },
    driver: driver
      ? {
          driverId: driver._id,
          name: driverUser?.name ?? null,
          phone: driverUser?.phone ?? null,
          vehicleClass: driver.vehicleClass,
          rating: driver.rating,
        }
      : null,
    customer: customer ? { customerId: customer._id, name: customer.name, phone: customer.phone } : null,
  };

  return shapeTripForRole(full, user.role);
}

export async function startTrip(tripId: string, userId: string) {
  const loaded = await loadTrip(tripId);
  await assertDriverOwnsTrip(loaded, userId);

  /*
   * Same conditional-update lock as completeTrip.
   *
   * Read-modify-write here does not lose money, but two taps of "Start" both passed the
   * status check and both notified the passenger that their trip had begun — and the
   * second overwrote the recorded start time, which the trip timeline is built from.
   */
  const startedAt = toDate(now());
  const trip = await Trip.findOneAndUpdate(
    { _id: loaded._id, status: 'accepted' },
    { $set: { status: 'started', 'timestamps.started': startedAt } },
    { new: true },
  );

  if (!trip) {
    const current = await Trip.findById(tripId).lean();
    throw ApiError.conflict(`Trip is '${current?.status ?? 'unknown'}' and cannot be started`);
  }

  const booking = await Booking.findById(trip.bookingId).lean();
  if (booking) {
    await notify.send(booking.customerId, NOTIFICATION_TYPES.TRIP_STARTED, {
      message: 'Your trip has started',
      tripId: String(trip._id),
      startedAt: format(startedAt),
    });
  }

  publishTripChange('started', trip, { customerId: booking?.customerId, driverUserId: userId });

  return trip;
}

/**
 * The two steps between accepting a ride and starting it: "on the way" and "arrived".
 *
 * They are stages, not statuses — the trip stays 'accepted' until the ride starts, so
 * nothing that depends on the status (dispatch, settlement, the console's pipeline) has a
 * new state to learn. Each one is a conditional update that only matches while the stage
 * has not been reached, so a double tap tells the passenger once and keeps the first time.
 *
 * Arriving implies being on the way: a chauffeur who goes straight to "arrived" gets both
 * times recorded, and the passenger one email. Going "on the way" after arriving is refused.
 */
export type TripStage = 'confirmed' | 'enroute' | 'arrived';

const STAGE_WORD: Record<TripStage, string> = { confirmed: 'confirmed', enroute: 'on the way', arrived: 'arrived' };
const STAGE_NOTE: Record<TripStage, { type: string; message: string }> = {
  confirmed: { type: NOTIFICATION_TYPES.TRIP_CONFIRMED, message: 'Your trip is confirmed' },
  enroute: { type: NOTIFICATION_TYPES.TRIP_ENROUTE, message: 'Your chauffeur is on the way' },
  arrived: { type: NOTIFICATION_TYPES.TRIP_ARRIVED, message: 'Your chauffeur has arrived' },
};

async function reachStage(tripId: string, stage: TripStage, driverUserId?: string, by?: string) {
  const loaded = await loadTrip(tripId);
  if (driverUserId) await assertDriverOwnsTrip(loaded, driverUserId);

  const at = toDate(now());
  const filter: QueryFilter<ITrip> =
    stage === 'confirmed'
      ? { _id: loaded._id, status: 'accepted', 'timestamps.confirmed': { $exists: false } }
      : stage === 'enroute'
      ? { _id: loaded._id, status: 'accepted', 'timestamps.enroute': { $exists: false }, 'timestamps.arrived': { $exists: false } }
      : { _id: loaded._id, status: 'accepted', 'timestamps.arrived': { $exists: false } };

  const trip = await Trip.findOneAndUpdate(
    filter,
    {
      $set: {
        [`timestamps.${stage}`]: at,
        // Arriving without having said "on the way": the second is true by implication.
        ...(stage === 'arrived' && !loaded.timestamps.enroute ? { 'timestamps.enroute': at } : {}),
      },
    },
    { new: true },
  );

  if (!trip) {
    const current = await Trip.findById(tripId).lean();
    if (!current) throw ApiError.notFound('Trip not found');
    const word = STAGE_WORD[stage];
    if (current.status !== 'accepted') {
      throw ApiError.conflict(`Trip is '${current.status}' and cannot be marked ${word}`);
    }
    throw ApiError.conflict(
      stage === 'enroute' && current.timestamps?.arrived
        ? 'The chauffeur has already arrived'
        : `Already marked ${word}`,
    );
  }

  const booking = await Booking.findById(trip.bookingId).lean();
  if (booking) {
    await notify.send(booking.customerId, STAGE_NOTE[stage].type, {
      message: STAGE_NOTE[stage].message,
      tripId: String(trip._id),
      bookingId: String(booking._id),
    });
  }
  const driver = await Driver.findById(trip.driverId).select('userId').lean();
  publishTripChange(stage, trip, { customerId: booking?.customerId, driverUserId: driver?.userId });
  if (by) logger.info(`Admin ${by} marked trip ${tripId} ${stage}`);
  return trip;
}

/** Operations confirming the trip: the passenger gets the full details of what is booked. */
export const confirmTrip = (tripId: string, adminUserId: string) => reachStage(tripId, 'confirmed', undefined, adminUserId);
export const markEnroute = (tripId: string, userId: string) => reachStage(tripId, 'enroute', userId);
export const markArrived = (tripId: string, userId: string) => reachStage(tripId, 'arrived', userId);

export async function completeTrip(tripId: string, userId: string) {
  const loaded = await loadTrip(tripId);
  const driver = await assertDriverOwnsTrip(loaded, userId);

  /*
   * The status transition IS the lock.
   *
   * This was previously read-modify-write: check `status === 'started'`, then save.
   * Five concurrent /complete calls all read 'started' before any of them wrote, so all
   * five passed the check and all five went on to settle the fare — a $100 trip paid out
   * four times over. Making the state change a single conditional update means exactly
   * one request can move the trip out of 'started'; the losers match nothing.
   */
  const completedAt = toDate(now());
  const trip = await Trip.findOneAndUpdate(
    { _id: loaded._id, status: 'started' },
    { $set: { status: 'completed', 'timestamps.completed': completedAt } },
    { new: true },
  );

  if (!trip) {
    // Lost the race, or was never startable. Re-read for the caller-facing reason.
    const current = await Trip.findById(tripId).lean();
    throw ApiError.conflict(`Trip is '${current?.status ?? 'unknown'}' and cannot be completed`);
  }

  driver.status = 'available';
  await driver.save();

  // Wallet credit + 60/40 revenue split (spec §8). Failure here must not lose the
  // completion itself, so it is logged loudly and left re-runnable — applyRevenueSplit
  // is idempotent via Trip.settled.
  try {
    await walletService.applyRevenueSplit(String(trip._id));
  } catch (err) {
    logger.error(`Revenue split failed for trip ${String(trip._id)}`, err);
  }

  const booking = await Booking.findById(trip.bookingId).lean();
  if (booking) {
    await notify.send(booking.customerId, NOTIFICATION_TYPES.TRIP_COMPLETED, {
      message: 'Your trip is complete',
      tripId: String(trip._id),
      fare: round2(trip.fareAmount),
      completedAt: format(completedAt),
    });
  }

  publishTripChange('completed', trip, { customerId: booking?.customerId, driverUserId: userId });
  // Asks GoHighLevel to send the feedback survey. Nobody waits for it.
  void requestFeedback(String(trip._id));

  // Same staleness as the admin path: the split saved its own copy, so re-read rather
  // than telling the driver settled:false about a trip that just settled.
  return (await Trip.findById(tripId)) ?? trip;
}

export async function cancelTripByDriver(tripId: string, userId: string, reason?: string) {
  const trip = await loadTrip(tripId);
  const driver = await assertDriverOwnsTrip(trip, userId);

  if (trip.status === 'completed') throw ApiError.conflict('A completed trip cannot be cancelled');
  if (trip.status === 'cancelled') throw ApiError.conflict('Trip is already cancelled');

  trip.status = 'cancelled';
  trip.cancellation = {
    ...(trip.cancellation ?? {}),
    reason: reason ?? 'Cancelled by driver',
    cancelledBy: 'driver',
  };

  /**
   * UML: "Cancel Ride" «include» "Apply Penalty".
   *
   * A driver abandoning a ride they already accepted is penalised — this is an <<include>>,
   * so it is unconditional, not a judgement call. The event lands in the PenaltyEvent
   * collection the Admin and Company dashboards read (spec §8 rule 5).
   */
  trip.penaltyApplied = true;
  await trip.save();

  try {
    await PenaltyEvent.create({
      bookingId: trip.bookingId,
      driverId: driver._id,
      reason: 'Driver cancelled a ride they had already accepted',
    });
    driver.penaltyCount += 1;
  } catch (err) {
    // Unique (bookingId, driverId) — already penalised for this booking, nothing to add.
    if (!isDuplicateKey(err)) throw err;
  }

  driver.status = 'available';
  await driver.save();

  await notify.send(driver.userId, NOTIFICATION_TYPES.PENALTY_APPLIED, {
    message: 'You cancelled an accepted ride. A penalty has been recorded.',
    tripId: String(trip._id),
  });

  const booking = await Booking.findById(trip.bookingId);
  if (booking) {
    booking.status = 'cancelled';
    // The chauffeur is the author here, so the console names them rather than the
    // passenger whose booking it was.
    const record = await recordBookingCancellation(booking, {
      by: 'driver',
      byUserId: userId,
      reason,
    });
    applyTripCancellationActor(trip, record);
    await Promise.all([booking.save(), trip.save()]);

    /*
     * The passenger is not at fault, so they get everything back.
     *
     * This path never touched the money: any wallet credit already applied to the ride
     * (and any fare collected) simply stayed spent on a trip that never ran. The
     * customer-initiated path has always reconciled this; a cancellation by the chauffeur
     * is the one case where a 100% refund is unambiguous.
     */
    try {
      await issueRefundToWallet(String(trip._id), 100);
    } catch (err) {
      logger.error(`Refund failed for driver-cancelled trip ${String(trip._id)}`, err);
    }

    publishTripChange('cancelled', trip, {
      customerId: booking.customerId,
      driverUserId: userId,
    });
    void (async () => {
      const who = await User.findById(userId).select('name').lean();
      await notifyOps(OPS_NOTIFICATIONS.DRIVER_CANCELLED, {
        message: `${who?.name ?? 'A driver'} cancelled ${bookingRef(booking._id)} after accepting it. The passenger was refunded in full and the trip needs a new driver.`,
        bookingId: String(booking._id),
        tripId: String(trip._id),
      });
    })();
    await notify.send(booking.customerId, NOTIFICATION_TYPES.TRIP_CANCELLED, {
      message: 'Your driver cancelled the trip',
      tripId: String(trip._id),
      reason: trip.cancellation.reason,
    });
  }

  return trip;
}

/* -------------------------------------------------------------------------- */
/* Customer-side trip changes (spec §4.5)                                      */
/* -------------------------------------------------------------------------- */

export async function changeVehicleClass(tripId: string, customerId: string, vehicleClass: string) {
  const { trip, booking } = await loadOwnTrip(tripId, customerId);
  assertNotStarted(trip, 'vehicle class');
  // Same deadline as an unassigned booking — a chauffeur three hours out may already be
  // planning around the car they were given.
  assertChangeable(booking);

  // Same catalogue check as booking creation — this route reaches the same field.
  const next = await vehicleService.resolveBookableClass(vehicleClass, booking.tripType);

  if (applyAmendment(booking, 'vehicleClass', next, 'customer')) {
    await booking.save();
    // 'driver' by role rather than by id: a class change can mean this job needs a
    // different chauffeur entirely, so everyone's schedule is potentially stale.
    events.publish({
      topic: 'booking',
      action: 'amended',
      id: String(booking._id),
      roles: ['admin', 'company', 'driver'],
      userIds: [customerId],
    });
  }
  return { tripId: trip._id, vehicleClass: booking.vehicleClass };
}

export async function changeLocation(tripId: string, customerId: string, input: ChangeLocationInput) {
  const { trip, booking } = await loadOwnTrip(tripId, customerId);
  assertNotStarted(trip, 'pickup or drop location');
  assertChangeable(booking);

  let changed = false;
  if (input.pickup) changed = applyAmendment(booking, 'pickup', input.pickup, 'customer') || changed;
  if (input.drop) changed = applyAmendment(booking, 'drop', input.drop, 'customer') || changed;
  if (changed) {
    await booking.save();
    // The chauffeur may be driving to the old address right now.
    events.publish({
      topic: 'booking',
      action: 'amended',
      id: String(booking._id),
      roles: ['admin', 'company', 'driver'],
      userIds: [customerId],
    });
  }

  return { tripId: trip._id, pickup: booking.pickup, drop: booking.drop };
}

/* -------------------------------------------------------------------------- */
/* Rating (spec §4.5)                                                          */
/* -------------------------------------------------------------------------- */

export async function rateTrip(tripId: string, customerId: string, input: RateInput) {
  const { trip, booking } = await loadOwnTrip(tripId, customerId);

  if (trip.status !== 'completed') {
    throw ApiError.conflict('You can only rate a completed trip');
  }

  const existing = await Rating.findOne({ tripId: trip._id }).lean();
  if (existing) throw ApiError.conflict('This trip has already been rated');

  const rating = await Rating.create({
    tripId: trip._id,
    customerId: booking.customerId,
    driverId: trip.driverId,
    score: input.score,
    comment: input.comment,
  });

  // Running average kept on the Driver so listings never aggregate the Rating collection.
  const driver = await Driver.findById(trip.driverId);
  if (driver) {
    const total = driver.rating * driver.ratingCount + input.score;
    driver.ratingCount += 1;
    driver.rating = round2(total / driver.ratingCount);
    await driver.save();

    events.publish({
      topic: 'driver',
      action: 'rated',
      id: String(driver._id),
      roles: ['admin', 'company'],
      userIds: [String(driver.userId)],
    });
  }

  return rating;
}

/* -------------------------------------------------------------------------- */
/* Live tracking support                                                       */
/* -------------------------------------------------------------------------- */

/** Persists the latest driver position so REST clients have a fallback (see Trip model). */
export async function recordTripLocation(tripId: string, lat: number, lng: number): Promise<void> {
  await Trip.updateOne(
    { _id: tripId },
    { $set: { lastLocation: { lat, lng, updatedAt: toDate(now()) } } },
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

async function loadTrip(tripId: string): Promise<TripDocument> {
  const trip = await Trip.findById(tripId);
  if (!trip) throw ApiError.notFound('Trip not found');
  return trip;
}

export async function loadOwnTrip(tripId: string, customerId: string) {
  const trip = await loadTrip(tripId);
  const booking = await Booking.findById(trip.bookingId);
  if (!booking) throw ApiError.notFound('Linked booking not found');
  if (String(booking.customerId) !== customerId) {
    throw ApiError.forbidden('This trip belongs to another customer');
  }
  return { trip, booking };
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 11000;
}

function assertNotStarted(trip: TripDocument, what: string): void {
  if (trip.status !== 'accepted') {
    throw ApiError.conflict(`The ${what} can only be changed before the trip starts`);
  }
}

/* ------------------------------ admin override ----------------------------- */

/** What an admin is allowed to move a trip to. 'accepted' is dispatch's job, not ops'. */
export const ADMIN_TRIP_STATUSES = ['confirmed', 'enroute', 'arrived', 'started', 'completed', 'cancelled'] as const;
export type AdminTripStatus = (typeof ADMIN_TRIP_STATUSES)[number];

/**
 * PATCH /trips/:id/status — operations moving a trip by hand.
 *
 * The lifecycle belongs to the chauffeur; this exists for when reality and the record
 * disagree — a driver who finished the job and never pressed Complete, a trip that has
 * to be called off from the office. It is an override, so it is admin-only and it
 * records who asked for it.
 *
 * It deliberately runs the SAME side effects as the driver's own actions rather than
 * writing the status field directly:
 *
 *   - completing settles the fare (60/40 split, driver payout). Skipping that would
 *     leave a completed trip nobody was ever paid for.
 *   - either terminal state frees the driver back to 'available', or they stay 'busy'
 *     forever and dispatch never offers them work again.
 *   - the customer is notified, because from their side nothing distinguishes an admin
 *     completion from the driver's.
 *
 * One deliberate difference: an admin cancellation does NOT penalise the driver. The
 * driver penalty exists for a chauffeur abandoning a ride they accepted; an office
 * cancellation is not that, and applying it here would punish people for someone else's
 * decision.
 */
export async function adminSetTripStatus(
  tripId: string,
  status: AdminTripStatus,
  adminUserId: string,
  reason?: string,
) {
  // "On the way" and "arrived" are stages of an accepted trip, not statuses; they share the
  // chauffeur's own code (and its once-only guarantee) rather than writing fields here.
  if (status === 'confirmed' || status === 'enroute' || status === 'arrived') {
    return reachStage(tripId, status, undefined, adminUserId);
  }

  const trip = await loadTrip(tripId);

  if (trip.status === 'completed' || trip.status === 'cancelled') {
    throw ApiError.conflict(`Trip is already '${trip.status}' and cannot be changed`);
  }
  if (status === 'started' && trip.status !== 'accepted') {
    throw ApiError.conflict(`Trip is '${trip.status}' and cannot be started`);
  }

  const driver = await Driver.findById(trip.driverId);
  const stamp = toDate(now());

  if (status === 'started') {
    trip.status = 'started';
    trip.timestamps.started = stamp;
    await trip.save();
  } else if (status === 'completed') {
    // A trip forced straight from 'accepted' never got a start time; record one so the
    // timeline is not left with a hole between assignment and completion.
    if (!trip.timestamps.started) trip.timestamps.started = stamp;
    trip.status = 'completed';
    trip.timestamps.completed = stamp;
    await trip.save();

    if (driver) {
      driver.status = 'available';
      await driver.save();
    }

    // Idempotent via Trip.settled, and logged rather than thrown: losing the settlement
    // must not lose the completion, which is the thing operations asked for.
    try {
      await walletService.applyRevenueSplit(String(trip._id));
    } catch (err) {
      logger.error(`Revenue split failed for admin-completed trip ${String(trip._id)}`, err);
    }
  } else {
    trip.status = 'cancelled';
    trip.cancellation = {
      ...(trip.cancellation ?? {}),
      reason: reason ?? 'Cancelled by operations',
      // 'admin' is a real enum value now, so an operator cancellation is attributed to
      // the operator instead of being left blank and inferred from the reason text.
      cancelledBy: 'admin',
    };
    await trip.save();

    if (driver) {
      driver.status = 'available';
      await driver.save();
    }
  }

  const booking = await Booking.findById(trip.bookingId);
  if (booking) {
    if (status === 'cancelled') {
      booking.status = 'cancelled';
      const record = await recordBookingCancellation(booking, {
        by: 'admin',
        byUserId: adminUserId,
        reason,
      });
      applyTripCancellationActor(trip, record);
      await Promise.all([booking.save(), trip.save()]);

      // Same reasoning as the driver-cancelled path: operations cancelled it, so the
      // passenger keeps none of the cost.
      try {
        await issueRefundToWallet(String(trip._id), 100);
      } catch (err) {
        logger.error(`Refund failed for admin-cancelled trip ${String(trip._id)}`, err);
      }
    }
    await notify.send(
      booking.customerId,
      status === 'completed'
        ? NOTIFICATION_TYPES.TRIP_COMPLETED
        : status === 'cancelled'
          ? NOTIFICATION_TYPES.TRIP_CANCELLED
          : NOTIFICATION_TYPES.TRIP_STARTED,
      {
        message:
          status === 'completed'
            ? 'Your trip is complete'
            : status === 'cancelled'
              ? 'Your trip was cancelled by our team'
              : 'Your trip has started',
        tripId: String(trip._id),
        // Operations closed it by hand: the rider gets the short "Trip Completed" note.
        ...(status === 'completed' ? { closedBy: 'admin' } : {}),
        ...(reason ? { reason } : {}),
      },
    );
  }

  publishTripChange(status, trip, {
    customerId: booking?.customerId,
    driverUserId: driver?.userId,
  });
  // A trip an operator closes as completed gets the same feedback survey as one the driver closes.
  if (status === 'completed') void requestFeedback(String(trip._id));

  logger.info(`Admin ${adminUserId} set trip ${tripId} to '${status}'`);

  // applyRevenueSplit() loads and saves its own copy of the trip, so `trip` here is
  // stale the moment it returns — it would report settled:false on a trip that just
  // settled. Re-read so the response matches what was stored.
  return (await Trip.findById(tripId)) ?? trip;
}

/**
 * The passenger never appeared. Operations close the trip as a no-show.
 *
 * The chauffeur went, waited and tried to reach the passenger, so this is a finished job
 * that is still charged — not a cancellation, which would refund. It therefore settles like
 * a completed trip (the chauffeur is paid and freed) and tells the passenger why, instead of
 * sending the thank-you. Only before the ride starts: after that there was a passenger.
 */
export async function markTripNoShow(tripId: string, adminUserId: string) {
  const loaded = await loadTrip(tripId);
  const stamp = toDate(now());

  const trip = await Trip.findOneAndUpdate(
    { _id: loaded._id, status: 'accepted' },
    { $set: { status: 'completed', noShow: true, 'timestamps.completed': stamp } },
    { new: true },
  );
  if (!trip) {
    const current = await Trip.findById(tripId).lean();
    throw ApiError.conflict(
      current?.status === 'started'
        ? 'The ride has already started, so it cannot be a no-show'
        : `Trip is '${current?.status ?? 'unknown'}' and cannot be marked a no-show`,
    );
  }

  const driver = await Driver.findById(trip.driverId);
  if (driver) {
    driver.status = 'available';
    await driver.save();
  }

  // Idempotent via Trip.settled, and logged rather than thrown, as for any hand-closed trip.
  try {
    await walletService.applyRevenueSplit(String(trip._id));
  } catch (err) {
    logger.error(`Revenue split failed for no-show trip ${String(trip._id)}`, err);
  }

  const booking = await Booking.findById(trip.bookingId);
  if (booking) {
    await notify.send(booking.customerId, NOTIFICATION_TYPES.TRIP_NO_SHOW, {
      message: 'Your reservation was marked as a no-show',
      tripId: String(trip._id),
      bookingId: String(booking._id),
    });
  }

  publishTripChange('completed', trip, { customerId: booking?.customerId, driverUserId: driver?.userId });
  logger.info(`Admin ${adminUserId} marked trip ${tripId} as a no-show`);
  return (await Trip.findById(tripId)) ?? trip;
}

/**
 * Undoes a no-show marked by mistake: the trip goes back to 'accepted' and its settlement is
 * taken back — the chauffeur's pay and the business's shares are reversed, entry by entry —
 * so the trip can run, or be settled afresh when it is finished.
 *
 * The passenger is told in the app, not by email: the no-show email already went, and a
 * second email about a correction would only worry them. Operations are the ones fixing it.
 *
 * Order matters. The money is reversed first, and that step is repeatable, so a crash part
 * way can simply be retried; the trip only leaves 'completed' once it is done, and the
 * conditional update at the end means two operators pressing Undo cannot both succeed.
 */
export async function revertTripNoShow(tripId: string, adminUserId: string) {
  const loaded = await loadTrip(tripId);
  if (!(loaded.status === 'completed' && loaded.noShow)) {
    throw ApiError.conflict('This trip is not marked as a no-show, so there is nothing to undo');
  }

  await walletService.reverseTripSettlement(loaded._id);

  const trip = await Trip.findOneAndUpdate(
    { _id: loaded._id, status: 'completed', noShow: true },
    { $set: { status: 'accepted', settled: false }, $unset: { noShow: 1, 'timestamps.completed': 1 } },
    { new: true },
  );
  if (!trip) throw ApiError.conflict('Another operator has already undone this no-show');

  // The chauffeur was freed when the trip closed; they are on this job again.
  const driver = await Driver.findOneAndUpdate({ _id: trip.driverId, status: 'available' }, { $set: { status: 'busy' } });
  const booking = await Booking.findById(trip.bookingId).lean();
  if (booking) {
    await notify.send(booking.customerId, NOTIFICATION_TYPES.TRIP_NO_SHOW_REVERTED, {
      message: 'Your reservation is active again',
      tripId: String(trip._id),
      bookingId: String(booking._id),
    });
  }

  const owner = driver ?? (await Driver.findById(trip.driverId).select('userId').lean());
  publishTripChange('accepted', trip, { customerId: booking?.customerId, driverUserId: owner?.userId });
  logger.info(`Admin ${adminUserId} undid the no-show on trip ${tripId}`);
  return trip;
}
