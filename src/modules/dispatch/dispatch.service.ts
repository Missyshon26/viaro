import { Types } from 'mongoose';
import { Booking, type BookingDocument } from '../../models/Booking';
import { Driver, type DriverDocument } from '../../models/Driver';
import { Trip } from '../../models/Trip';
import { PenaltyEvent } from '../../models/PenaltyEvent';
import { redis } from '../../config/redis';
import { format, now, toDate } from '../../config/timezone';
import { ApiError } from '../../utils/ApiError';
import type { UserRole } from '../../utils/roles';
import { logger } from '../../utils/logger';
import * as events from '../events/events.bus';
import * as walletService from '../wallet/wallet.service';
import { paginated, toSkipLimit, type PaginationQuery } from '../../utils/pagination';
import { emitTo, getIo, ns } from '../../sockets/io';
import * as notify from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/notifications.service';
import { schedulePenaltyCheck, scheduleDelayedAlert } from '../../jobs/penalty.job';

/**
 * Redis GEO set of drivers who are currently 'available'.
 * Live positions never touch Mongo — they change every few seconds and are worthless a
 * minute later, so they belong in memory (spec §1).
 */
export const AVAILABLE_DRIVERS_GEO_KEY = 'drivers:available';

/** Search radius and fan-out size for a public-pool broadcast. */
export const DISPATCH_RADIUS_KM = 25;
export const DISPATCH_MAX_DRIVERS = 10;

/** How long a driver has to respond before a penalty is recorded (spec §8 rule 5). */
export const DRIVER_RESPONSE_WINDOW_MINUTES = 2;

/* -------------------------------------------------------------------------- */
/* Driver position tracking                                                    */
/* -------------------------------------------------------------------------- */

export async function upsertDriverLocation(driverId: string, lat: number, lng: number): Promise<void> {
  const driver = await Driver.findById(driverId).lean();
  // Only drivers who can actually take a ride belong in the dispatch pool.
  if (!driver || driver.status !== 'available') {
    await removeDriverLocation(driverId);
    return;
  }
  await redis.geoadd(AVAILABLE_DRIVERS_GEO_KEY, lng, lat, driverId);
}

export async function removeDriverLocation(driverId: string): Promise<void> {
  await redis.zrem(AVAILABLE_DRIVERS_GEO_KEY, driverId);
}

export interface NearbyDriver {
  driverId: string;
  distanceKm: number;
}

export async function findNearbyDrivers(
  lat: number,
  lng: number,
  radiusKm = DISPATCH_RADIUS_KM,
  count = DISPATCH_MAX_DRIVERS,
): Promise<NearbyDriver[]> {
  const results = (await redis.geosearch(
    AVAILABLE_DRIVERS_GEO_KEY,
    'FROMLONLAT',
    lng,
    lat,
    'BYRADIUS',
    radiusKm,
    'km',
    'ASC',
    'COUNT',
    count,
    'WITHDIST',
  )) as Array<[string, string]>;

  return results.map(([driverId, distance]) => ({
    driverId,
    distanceKm: Number(distance),
  }));
}

/* -------------------------------------------------------------------------- */
/* Dispatch pipeline                                                           */
/* -------------------------------------------------------------------------- */

/** Entry point, called immediately after a Booking is created (spec §4.4). */
export async function receiveBookingRequest(bookingId: string): Promise<void> {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.status !== 'pending') {
    logger.warn(`Dispatch skipped — booking ${bookingId} is '${booking.status}', not pending`);
    return;
  }

  await assignDriverToBooking(bookingId);
}

/**
 * Favourite-driver-first assignment (spec §4.4). If the customer named a favourite and
 * that driver is free, the ride goes straight to them and never reaches the public pool.
 * Otherwise it falls through to the broadcast.
 */
export async function assignDriverToBooking(bookingId: string): Promise<void> {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');

  if (!booking.favoriteDriverId) {
    await publishToPublicPool(bookingId);
    return;
  }

  const driver = await Driver.findById(booking.favoriteDriverId);
  if (!driver || driver.status !== 'available') {
    logger.info(`Favourite driver unavailable for booking ${bookingId} — falling back to pool`);
    await publishToPublicPool(bookingId);
    return;
  }

  await commitAssignment(booking, driver, 'Your favourite driver has been assigned');
}

/**
 * Commit a driver onto a booking.
 *
 * Shared by the automatic favourite-driver path and the admin's manual assignment so
 * both produce exactly the same state: booking assigned, a durable Trip, the driver
 * marked busy and pulled out of the GEO set, and both sides notified. Anything that
 * assigns work must go through here — a second implementation would be a second set of
 * bugs.
 */
async function commitAssignment(
  booking: BookingDocument,
  driver: DriverDocument,
  customerMessage: string,
) {
  booking.status = 'assigned';
  await booking.save();

  // The Trip is created here so the assignment is durable; timestamps.accepted stays
  // unset until the driver confirms via POST /trips/:bookingId/accept.
  const trip = await Trip.findOneAndUpdate(
    { bookingId: booking._id },
    {
      $setOnInsert: {
        bookingId: booking._id,
        driverId: driver._id,
        status: 'accepted',
        fareAmount: booking.estimatedFare ?? 0,
        timestamps: { requested: booking.createdAt, assigned: toDate(now()) },
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  driver.status = 'busy';
  await driver.save();
  await removeDriverLocation(String(driver._id));

  await notify.send(driver.userId, NOTIFICATION_TYPES.DRIVER_ASSIGNED, {
    message: `You have been assigned a ride for ${format(booking.scheduledAt)}`,
    bookingId: String(booking._id),
    tripId: String(trip._id),
    pickup: booking.pickup.address,
    scheduledAt: format(booking.scheduledAt),
  });

  await notify.send(booking.customerId, NOTIFICATION_TYPES.DRIVER_ASSIGNED, {
    message: customerMessage,
    bookingId: String(booking._id),
    tripId: String(trip._id),
  });

  // Same as the accept path: honour the credit chosen at booking, now a Trip exists.
  await walletService.applyRequestedCredit(trip._id).catch((err) => {
    logger.warn(`Could not apply requested credit to trip ${String(trip._id)}`, err);
  });

  // Anyone still holding the offer should drop it.
  broadcastClaimed(String(booking._id), String(driver._id));

  // Reaches drivers by role as well as the assignee by id: every other chauffeur's
  // Requests list just lost a row and should stop showing it.
  events.publish({
    topic: 'dispatch',
    action: 'assigned',
    id: String(booking._id),
    roles: ['admin', 'company', 'driver'],
    userIds: [String(booking.customerId), String(driver.userId)],
  });

  return trip;
}

/**
 * UML «Publish Booking to Public Pool», run by hand.
 *
 * Publishing is normally automatic — createBooking fires receiveBookingRequest, which
 * either honours a free favourite driver or broadcasts. This is the retry for when that
 * did not happen or did not stick:
 *
 *   - the async dispatch threw and the booking is still 'pending'
 *   - it was broadcast, nobody claimed it, and it needs putting back in front of drivers
 *     (a chauffeur may have come online since)
 *
 * Refused once a chauffeur holds the trip, because re-broadcasting an assigned booking
 * would offer the same job twice.
 */
export async function republishToPool(bookingId: string) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');

  if (booking.status === 'cancelled') {
    throw ApiError.conflict('That booking has been cancelled');
  }
  if (booking.status === 'assigned') {
    throw ApiError.conflict('That booking already has a chauffeur assigned');
  }

  await publishToPublicPool(bookingId);

  const nearby = await findNearbyDrivers(booking.pickup.lat, booking.pickup.lng);
  logger.info(`Admin republished booking ${bookingId} — ${nearby.length} driver(s) in range`);

  // Every chauffeur's Requests list gained a row; operations sees it leave "awaiting".
  events.publish({
    topic: 'dispatch',
    action: 'published',
    id: bookingId,
    roles: ['admin', 'company', 'driver'],
    userIds: [String(booking.customerId)],
  });

  // The count is the useful part of the answer: "published, nobody in range" is a very
  // different outcome from "published to eight chauffeurs", and the UI should say which.
  return { bookingId, driversInRange: nearby.length };
}

/**
 * UML «Assign Driver to Booking» — the Admin actor's own association on the DISPATCH
 * cluster, as opposed to the automatic favourite-driver path above.
 *
 * Dispatch normally runs itself: a booking is broadcast the moment it is created. This
 * is the manual override for when operations needs a specific chauffeur on a specific
 * job, so it deliberately refuses the cases where overriding would corrupt state rather
 * than silently reassigning.
 */
export async function assignSpecificDriver(bookingId: string, driverId: string) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');

  if (booking.status === 'cancelled') {
    throw ApiError.conflict('That booking has been cancelled');
  }
  if (booking.status === 'assigned') {
    // Reassigning would strand the driver already holding the trip.
    throw ApiError.conflict('That booking already has a chauffeur assigned');
  }

  const driver = await Driver.findById(driverId);
  if (!driver) throw ApiError.notFound('Driver not found');

  if (driver.status !== 'available') {
    throw new ApiError(409, 'That chauffeur is not available', {
      code: 'DRIVER_NOT_AVAILABLE',
      driverStatus: driver.status,
    });
  }

  const trip = await commitAssignment(
    booking,
    driver,
    'A chauffeur has been assigned to your booking',
  );

  logger.info(`Admin assigned driver ${driverId} to booking ${bookingId}`);
  return { booking, tripId: String(trip._id) };
}

/**
 * Broadcast to the nearest available drivers over the '/dispatch' namespace, then arm the
 * 2-minute penalty check. The socket layer is a notification channel only — the source of
 * truth for a claim is POST /trips/:bookingId/accept.
 */
export async function publishToPublicPool(bookingId: string): Promise<void> {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');

  const nearby = await findNearbyDrivers(booking.pickup.lat, booking.pickup.lng);

  booking.status = 'dispatched';
  await booking.save();

  if (nearby.length === 0) {
    logger.warn(`No available drivers within ${DISPATCH_RADIUS_KM}km of booking ${bookingId}`);
    return;
  }

  const payload = {
    bookingId: String(booking._id),
    pickup: booking.pickup,
    drop: booking.drop,
    tripType: booking.tripType,
    vehicleClass: booking.vehicleClass,
    scheduledAt: format(booking.scheduledAt),
    estimatedFare: booking.estimatedFare ?? null,
    // Meet and Greet, car seats, cruise meeting point — worth knowing before accepting.
    serviceNotes: booking.serviceNotes ?? [],
    flightNumber: booking.flightDetails?.flightNumber ?? null,
  };

  const io = getIo();
  const offeredDriverIds: string[] = [];
  const ordered = await prioritise(nearby);

  for (const candidate of ordered) {
    offeredDriverIds.push(candidate.driverId);

    // Spec §8 rule 5: a penalised driver's ride alerts are delayed by 2 minutes. The delay
    // is scheduled through BullMQ so it survives a restart, rather than a setTimeout.
    const penalised = await hasActivePenalty(candidate.driverId);
    if (penalised) {
      await scheduleDelayedAlert(String(booking._id), candidate.driverId, payload);
      continue;
    }

    io?.of(ns.dispatch).to(driverRoom(candidate.driverId)).emit('booking:new', {
      ...payload,
      distanceKm: candidate.distanceKm,
    });

    // UML "Receive Priority Ride Notifications": the offer is also persisted, so a driver
    // whose socket was asleep still finds it in GET /notifications.
    if (candidate.userId) {
      await notify.send(candidate.userId, NOTIFICATION_TYPES.RIDE_OFFER, {
        message: `New ride ${candidate.distanceKm.toFixed(1)} km away for ${format(booking.scheduledAt)}`,
        bookingId: String(booking._id),
        pickup: booking.pickup.address,
        distanceKm: candidate.distanceKm,
        priorityRank: offeredDriverIds.length,
      });
    }
  }

  await schedulePenaltyCheck(String(booking._id), offeredDriverIds);
}

/**
 * Offer ordering — UML: "Rate Driver After Trip" «extend» "Receive Priority Ride
 * Notifications". A driver's rating is what makes their ride alerts *priority*.
 *
 * Pure rating order would hand a ride to a 5-star driver 24 km away over a 4.8-star driver
 * one street over, so candidates are bucketed into distance bands first and ranked by
 * rating inside each band. Both constants are the tunable business decision — change them
 * here, nowhere else.
 */
export const DISPATCH_DISTANCE_BAND_KM = 5;

interface PrioritisedDriver extends NearbyDriver {
  rating: number;
  userId?: string;
}

async function prioritise(candidates: NearbyDriver[]): Promise<PrioritisedDriver[]> {
  if (candidates.length === 0) return [];

  const drivers = await Driver.find({ _id: { $in: candidates.map((c) => c.driverId) } })
    .select('rating userId')
    .lean();

  const byId = new Map(drivers.map((d) => [String(d._id), d]));

  return candidates
    .map((c) => {
      const driver = byId.get(c.driverId);
      return {
        ...c,
        rating: driver?.rating ?? 0,
        userId: driver ? String(driver.userId) : undefined,
      };
    })
    .sort((a, b) => {
      const bandA = Math.floor(a.distanceKm / DISPATCH_DISTANCE_BAND_KM);
      const bandB = Math.floor(b.distanceKm / DISPATCH_DISTANCE_BAND_KM);
      if (bandA !== bandB) return bandA - bandB; // nearer band always wins
      if (b.rating !== a.rating) return b.rating - a.rating; // then better rating
      return a.distanceKm - b.distanceKm; // then strictly nearer
    });
}

/** Broadcast that a booking is taken, so other drivers can drop it from their queue. */
export function broadcastClaimed(bookingId: string, claimedByDriverId?: string): void {
  emitTo(ns.dispatch, 'booking:claimed', { bookingId, driverId: claimedByDriverId ?? null });
}

export function driverRoom(driverId: string): string {
  return `driver:${driverId}`;
}

/**
 * A driver is considered penalised while any penalty event is younger than the alert
 * delay window's lookback (24h) — matching "ride alerts delayed" being a temporary state.
 */
async function hasActivePenalty(driverId: string): Promise<boolean> {
  const since = toDate(now().minus({ hours: 24 }));
  const count = await PenaltyEvent.countDocuments({
    driverId: new Types.ObjectId(driverId),
    createdAt: { $gte: since },
  });
  return count > 0;
}

/**
 * The unclaimed-booking pool, for ops (`/admin/dispatch/pool`) and for drivers
 * (`/dispatch/pool`).
 *
 * The two audiences do NOT get the same document. Ops triages by person and needs the
 * rider's name and number; a driver is deciding whether to claim a job and needs the
 * route, the time and the money. Serving one payload to both handed every driver on the
 * platform a directory of customer names and phone numbers for rides they had not taken
 * and might never take — and the driver who does claim it gets the contact details at
 * assignment anyway, which is the point at which they actually need them.
 */
export async function listDispatchPool(q: PaginationQuery, role: UserRole = 'admin') {
  const { skip, limit } = toSkipLimit(q);
  const filter = { status: 'dispatched' as const };

  const showCustomerContact = role !== 'driver';

  const findQuery = Booking.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit);
  if (showCustomerContact) {
    findQuery.populate({ path: 'customerId', select: 'name phone' });
  }

  const [items, total] = await Promise.all([findQuery.lean(), Booking.countDocuments(filter)]);

  return paginated(
    items.map((b) => {
      const row = { ...b, scheduledAtLocal: format(b.scheduledAt) };
      if (!showCustomerContact) {
        // The id stays (a driver's claim posts against it); the person does not.
        delete (row as Record<string, unknown>).customerId;
      }
      return row;
    }),
    total,
    q,
  );
}
