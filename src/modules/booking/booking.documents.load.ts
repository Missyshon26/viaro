import { Booking } from '../../models/Booking';
import { Trip } from '../../models/Trip';
import { ApiError } from '../../utils/ApiError';
import type { Address } from '../../utils/profile';
import * as vehicleService from '../vehicle/vehicle.service';
import { generateDocument, type DocumentKind } from './booking.documents';

/**
 * The invoice or receipt PDF for a stored booking, for the system's own emails: the same
 * document the customer downloads, built without a signed-in user.
 *
 * Kept apart from booking.service so the notification code can use it without the two
 * importing each other (the booking service sends notifications).
 */
export async function renderStoredDocument(bookingId: string, kind: DocumentKind) {
  const booking = await Booking.findById(bookingId)
    .populate({ path: 'customerId', select: 'name email phone address' })
    .lean();
  if (!booking) throw ApiError.notFound('Booking not found');

  const owner = booking.customerId as unknown as {
    name?: string;
    email?: string;
    phone?: string;
    address?: Address | null;
  } | null;

  const trip = await Trip.findOne({ bookingId: booking._id }).lean();
  return generateDocument(kind, {
    booking: booking as never,
    trip,
    customer: owner,
    vehicleLabel: await vehicleService.labelFor(booking.vehicleClass),
  });
}
