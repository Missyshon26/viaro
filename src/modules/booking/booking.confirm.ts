import { Booking } from '../../models/Booking';
import { toDate, now, format } from '../../config/timezone';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../utils/logger';
import * as events from '../events/events.bus';
import * as notify from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/notifications.service';

/**
 * Operations accepting a new booking request: the customer is told "your trip is confirmed".
 *
 * This is the first step an operator takes on a new request; assigning a chauffeur comes
 * after it. It is a stage, not a status: the booking stays 'pending' until a chauffeur is
 * assigned, so dispatch, settlement and the console's pipeline have nothing new to learn.
 *
 * One conditional update, so a double click tells the customer once and keeps the first time.
 * Only while no chauffeur has the ride (pending, or an old 'dispatched' one): a cancelled
 * request cannot be confirmed, and an assigned one is already past this step.
 */
export async function confirmBooking(bookingId: string, adminId: string) {
  const booking = await Booking.findOneAndUpdate(
    { _id: bookingId, status: { $in: ['pending', 'dispatched'] }, confirmedAt: { $exists: false } },
    { $set: { confirmedAt: toDate(now()), confirmedBy: adminId } },
    { new: true },
  );

  if (!booking) {
    const current = await Booking.findById(bookingId).select('status confirmedAt').lean();
    if (!current) throw ApiError.notFound('Booking not found');
    if (current.status === 'cancelled') throw ApiError.conflict('This booking is cancelled and cannot be confirmed');
    if (current.confirmedAt) throw ApiError.conflict('This booking is already confirmed');
    throw ApiError.conflict('A chauffeur is already assigned to this ride');
  }

  // The booking is confirmed whether or not the notice goes out; a mail or push failure is logged, not thrown.
  try {
    await notify.send(booking.customerId, NOTIFICATION_TYPES.TRIP_CONFIRMED, {
      message: 'Your trip is confirmed',
      bookingId: String(booking._id),
      scheduledAt: format(booking.scheduledAt),
    });
    events.publish({
      topic: 'booking',
      action: 'updated',
      id: String(booking._id),
      roles: ['admin', 'company'],
      userIds: [String(booking.customerId)],
    });
  } catch (err) {
    logger.warn(`Confirmation notice failed after confirming booking ${String(booking._id)}`, err);
  }

  logger.info(`Admin ${adminId} confirmed booking ${String(booking._id)}`);
  return { booking };
}
