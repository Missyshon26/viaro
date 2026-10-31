import { Booking } from '../../models/Booking';
import { format } from '../../config/timezone';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../utils/logger';
import * as events from '../events/events.bus';
import * as notify from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/notifications.service';
import { cardLabel, refundBookingToCard } from '../payments/cardPayments';
import { recordBookingCancellation } from './booking.cancellation';

/**
 * Operations turning down a booking request, with a reason the customer is told.
 *
 * Only while no chauffeur has taken the ride (still pending): after that
 * the trip is somebody's job and has its own cancellation, which frees the chauffeur and
 * settles the money. The move is one conditional update, so a chauffeur accepting at the
 * same instant either wins — and this is refused as "already accepted" — or loses, and
 * never ends up with a ride that has just been rejected. (An old 'dispatched' booking, from
 * when bookings were offered to drivers, can still be rejected too.)
 *
 * The customer did nothing wrong, so a card payment is refunded in full. If the refund
 * itself fails the booking is still rejected (and the customer told), and the failure comes
 * back to the operator to finish from the Refund button — retrying here would not be
 * possible, the booking is already closed.
 */
export async function rejectBooking(bookingId: string, adminId: string, reason: string) {
  const booking = await Booking.findOneAndUpdate(
    { _id: bookingId, status: { $in: ['pending', 'dispatched'] } },
    { $set: { status: 'cancelled' } },
    { new: true },
  );

  if (!booking) {
    const current = await Booking.findById(bookingId).select('status').lean();
    if (!current) throw ApiError.notFound('Booking not found');
    if (current.status === 'cancelled') throw ApiError.conflict('This booking is already cancelled');
    throw ApiError.conflict('A chauffeur has already accepted this ride. Cancel the trip instead of rejecting the request.');
  }

  const record = await recordBookingCancellation(booking, { by: 'admin', byUserId: adminId, reason, rejected: true });
  await booking.save();

  let refundAmount = 0;
  let refundError: string | undefined;
  if (booking.payment) {
    try {
      refundAmount = await refundBookingToCard(String(booking._id), 100, 'rejection');
    } catch (err) {
      logger.error(`Refund failed for rejected booking ${String(booking._id)}`, err);
      refundError = 'The booking was rejected, but the refund to the card failed. Use Refund on this trip to send it.';
    }
  }

  try {
    await notify.send(booking.customerId, NOTIFICATION_TYPES.BOOKING_CANCELLED, {
      message: `Your booking request could not be accepted${refundAmount > 0 ? `. ${`$${refundAmount.toFixed(2)}`} is being refunded to ${cardLabel(booking.payment)}.` : '.'}`,
      bookingId: String(booking._id),
      scheduledAt: format(booking.scheduledAt),
      rejected: true,
      reason: record.reason,
      ...(refundAmount > 0 ? { refundAmount } : {}),
    });
    events.publish({
      topic: 'booking',
      action: 'cancelled',
      id: String(booking._id),
      roles: ['admin', 'company'],
      userIds: [String(booking.customerId)],
    });
  } catch (err) {
    logger.warn(`Rejection notice failed after saving booking ${String(booking._id)}`, err);
  }

  logger.info(`Admin ${adminId} rejected booking ${String(booking._id)}`);
  return { booking, refunded: refundAmount, ...(refundError ? { refundError } : {}) };
}
