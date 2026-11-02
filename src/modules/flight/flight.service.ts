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
/*
 * Anyone filling in the booking form can check a flight, signed in or not, and every real lookup
 * spends the flight provider's metered quota. So answers are kept for a few minutes (the same
 * flight and day is asked about again and again), and the number of real lookups per hour is
 * capped. A failed lookup is not kept: it should be tried again.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const HOURLY_PROVIDER_CALLS = 120;
const cache = new Map<string, { flight: FlightDetails; expires: number }>();
let budget = { windowStart: 0, used: 0 };

function takeProviderCall(nowMs: number): boolean {
  if (nowMs - budget.windowStart >= 3_600_000) budget = { windowStart: nowMs, used: 0 };
  if (budget.used >= HOURLY_PROVIDER_CALLS) return false;
  budget.used += 1;
  return true;
}

/** Test hook: forget kept answers and the hourly count. */
export function resetFlightLookups(): void {
  cache.clear();
  budget = { windowStart: 0, used: 0 };
}

export async function getFlight(flightNumber: string, date?: string) {
  const key = `${flightNumber.toUpperCase()}|${date ?? ''}`;
  const nowMs = Date.now();
  const hit = cache.get(key);

  let flight: FlightDetails;
  if (hit && hit.expires > nowMs) {
    flight = hit.flight;
  } else {
    if (!takeProviderCall(nowMs)) {
      throw ApiError.tooManyRequests('Flight checks are busy right now. Please try again in a few minutes.');
    }
    flight = await fetchFlightDetails(flightNumber, { date });
    // Keep a real answer, or "no record yet"; never a failure or a missing provider.
    if (!flight.placeholder || flight.unavailableReason === 'not-found') {
      if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
      cache.set(key, { flight, expires: nowMs + CACHE_TTL_MS });
    }
  }

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
