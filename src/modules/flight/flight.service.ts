import { Trip } from '../../models/Trip';
import { Booking } from '../../models/Booking';
import { Driver } from '../../models/Driver';
import { expectedArrival, fetchFlightDetails, type FlightDetails } from '../../integrations/flightApi';
import { ApiError } from '../../utils/ApiError';
import { format } from '../../config/timezone';
import * as notify from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/notifications.service';

/**
 * What a client needs to show a flight. `verified` is the honest bit: it is false for
 * generated stand-in data, and a client must not present those times as the flight's.
 * `expectedArrival` is the one time to plan around (actual, else forecast, else schedule).
 */
export async function getFlight(flightNumber: string, date?: string) {
  const flight = await fetchFlightDetails(flightNumber, { date });
  return {
    ...flight,
    verified: !flight.placeholder,
    expectedArrival: expectedArrival(flight),
  };
}

/**
 * Spec §4.8 — push the flight's arrival time to the driver assigned to an airport pickup.
 * Called from the trip accept flow when booking.tripType === 'airport'.
 *
 * Times are rendered through the shared PT helper, never formatted ad hoc, so the driver
 * sees the same clock the booking was made against (spec §8 rule 1).
 */
export async function showArrivalTimeToDriver(tripId: string): Promise<void> {
  const trip = await Trip.findById(tripId).lean();
  if (!trip) throw ApiError.notFound('Trip not found');

  const booking = await Booking.findById(trip.bookingId).lean();
  if (!booking) throw ApiError.notFound('Booking not found');

  const flightNumber = booking.flightDetails?.flightNumber;
  if (!flightNumber) throw ApiError.badRequest('This booking has no flight attached');

  const flight = await fetchFlightDetails(flightNumber);

  const driver = await Driver.findById(trip.driverId).lean();
  if (!driver) throw ApiError.notFound('Driver not found');

  await notify.send(driver.userId, NOTIFICATION_TYPES.FLIGHT_ARRIVAL, {
    message: `Flight ${flight.flightNumber} arrives at ${format(flight.scheduledArrival)}`,
    tripId: String(trip._id),
    flightNumber: flight.flightNumber,
    status: flight.status,
    scheduledArrival: format(flight.scheduledArrival),
    actualArrival: flight.actualArrival ? format(flight.actualArrival) : null,
  });
}
