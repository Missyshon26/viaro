import { api } from "./client";
import type { Booking, FareBreakdown, GeoPoint, TripType } from "./types";

/**
 * The two endpoints the desktop booking flow runs on.
 *
 * ⚠ GET /pricing/fare-estimate is behind authGuard + roleGuard('customer') — see
 * pricing.routes.ts. A signed-out visitor cannot be quoted, so the Home hero widget
 * collects the route and hands off to step 1 rather than pricing inline.
 */

export interface FareEstimateQuery {
  city: string;
  tripType: TripType;
  /** ISO string. Offset-less values are read as America/Los_Angeles wall time. */
  requestedAt?: string;
  /** Hourly trips only, 1–24. */
  hours?: number;
}

export function getFareEstimate(query: FareEstimateQuery) {
  return api.get<FareBreakdown>("/pricing/fare-estimate", { query: { ...query } });
}

export interface CreateBookingInput {
  pickup: GeoPoint;
  drop: GeoPoint;
  vehicleClass: string;
  tripType: TripType;
  city: string;
  scheduledAt?: string;
  hours?: number;
  /** Required by the API when tripType is "airport". */
  flightDetails?: { flightNumber: string; scheduledArrival?: string };
  favoriteDriverId?: string;
}

export function createBooking(input: CreateBookingInput) {
  return api.post<Booking>("/bookings", input);
}

export function getBooking(id: string) {
  return api.get<Booking>(`/bookings/${id}`);
}

export function cancelBooking(id: string) {
  return api.delete<{ refundPct?: number }>(`/bookings/${id}`);
}
