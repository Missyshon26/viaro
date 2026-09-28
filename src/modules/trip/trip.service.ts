import { Trip, type TripDocument, type TripStatus } from '../../models/Trip';
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
import * as dispatchService from '../dispatch/dispatch.service';
import * as walletService from '../wallet/wallet.service';
import * as flightService from '../flight/flight.service';
import * as notify from '../notifications/notifications.service';
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
 * Driver accepts a ride, either from a direct favourite-driver assignment or from the
 * public pool. This is the authoritative claim — the socket 'booking:claimed' event is
 * only a courtesy broadcast.
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
  // document review cannot be dispatched, so it must not be able to claim from the pool.
  const account = await User.findById(userId).select('status').lean<{ status: string }>();
  if (account?.status === 'pending_documents') {
    throw ApiError.forbidden('Upload your documents before accepting rides');
  }

  // The spec writes this route as /trips/:id/accept and the build prompt as
  // /trips/:bookingId/accept. Both are honoured: the id is resolved as a booking first,
  // then as a Trip (which exists already when a favourite driver was pre-assigned).
  let booking = await Booking.findById(id);
  if (!booking) {
    const viaTrip = await Trip.findById(id);
    if (viaTrip) booking = await Booking.findById(viaTrip.bookingId);
  }
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.status === 'cancelled') throw ApiError.conflict('This booking was cancelled');

  const existing = await Trip.findOne({ bookingId: booking._id });

  if (existing) {
    // Pre-assigned to a favourite driver: only that driver may confirm it.
    if (String(existing.driverId) !== String(driver._id)) {
      throw ApiError.conflict('This ride has already been claimed by another driver');
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

  if (booking.status !== 'dispatched') {
    throw ApiError.conflict(`Booking is '${booking.status}' and cannot be accepted`);
  }

  const trip = await Trip.create({
    bookingId: booking._id,
    driverId: driver._id,
    status: 'accepted',
    fareAmount: booking.estimatedFare ?? 0,
    timestamps: {
      requested: booking.createdAt,
      assigned: toDate(now()),
      accepted: toDate(now()),
    },
  });

  await afterAccept(trip, booking, driver);
  return trip;
}

async function afterAccept(trip: TripDocument, booking: BookingDocument, driver: DriverDocument) {
  booking.status = 'assigned';
  await booking.save();

  driver.status = 'busy';
  await driver.save();
  await dispatchService.removeDriverLocation(String(driver._id));
  dispatchService.broadcastClaimed(String(booking._id), String(driver._id));

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
   * UML: "Cancel Ride" «include» "Apply Penalty (2-min alert delay)".
   *
   * A driver abandoning a ride they already accepted is penalised the same way as one who
   * ignores an alert — this is an <<include>>, so it is unconditional, not a judgement
   * call. The event lands in the same PenaltyEvent collection the Admin and Company
   * dashboards read (spec §8 rule 5).
   */
  trip.penaltyApplied = true;
  await trip.save();

  try {
    await PenaltyEvent.create({
      bookingId: trip.bookingId,
      driverId: driver._id,
      reason: 'Driver cancelled a ride they had already accepted',
      alertDelayMinutes: 2,
    });
    driver.penaltyCount += 1;
  } catch (err) {
    // Unique (bookingId, driverId) — already penalised for this booking, nothing to add.
    if (!isDuplicateKey(err)) throw err;
  }

  driver.status = 'available';
  await driver.save();

  await notify.send(driver.userId, NOTIFICATION_TYPES.PENALTY_APPLIED, {
    message: 'You cancelled an accepted ride. Your next ride alerts will be delayed by 2 minutes.',
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
export const ADMIN_TRIP_STATUSES = ['started', 'completed', 'cancelled'] as const;
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
        ...(reason ? { reason } : {}),
      },
    );
  }

  publishTripChange(status, trip, {
    customerId: booking?.customerId,
    driverUserId: driver?.userId,
  });

  logger.info(`Admin ${adminUserId} set trip ${tripId} to '${status}'`);

  // applyRevenueSplit() loads and saves its own copy of the trip, so `trip` here is
  // stale the moment it returns — it would report settled:false on a trip that just
  // settled. Re-read so the response matches what was stored.
  return (await Trip.findById(tripId)) ?? trip;
}
