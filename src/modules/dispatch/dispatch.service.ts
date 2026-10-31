import { Booking, type BookingDocument } from '../../models/Booking';
import { Driver, type DriverDocument } from '../../models/Driver';
import { Trip } from '../../models/Trip';
import { format, now, toDate } from '../../config/timezone';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../utils/logger';
import * as events from '../events/events.bus';
import * as walletService from '../wallet/wallet.service';
import * as notify from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/notifications.service';

/**
 * Putting a driver on a booking.
 *
 * A booking waits as "pending" until an operator assigns a driver in the console; nothing is
 * broadcast to drivers and nobody claims a job. Assignment is the only way a Trip comes to exist
 * for a booking, and it all goes through commitAssignment() so the state it leaves behind is
 * always the same.
 */

/**
 * Commit a driver onto a booking.
 *
 * Booking assigned, a durable Trip, the driver marked busy, and both sides notified. Anything
 * that assigns work must go through here — a second implementation would be a second set of
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
        ...(booking.fareBreakdown?.tax ? { taxAmount: booking.fareBreakdown.tax } : {}),
        timestamps: { requested: booking.createdAt, assigned: toDate(now()) },
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  driver.status = 'busy';
  await driver.save();

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
 * UML «Assign Driver to Booking» — the Admin actor's own association on the DISPATCH
 * cluster.
 *
 * Operations puts a specific driver on a specific booking. It refuses the cases where doing so
 * would corrupt state, rather than silently reassigning.
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
