import "server-only";
import { api } from "./client";
import type {
  Booking, FareBreakdown, GeoPoint, Paginated, Receipt, TripType,
} from "./types";

/* ------------------------------- pricing --------------------------------- */

export interface FareEstimateQuery {
  city: string;
  tripType: TripType;
  /** ISO string; offset-less values are read as America/Los_Angeles wall time. */
  requestedAt?: string;
  /** Hourly trips only, 1-24. */
  hours?: number;
  /** Priced at the base rate when omitted. */
  vehicleClass?: string;
}

/** Customer-only on the backend: a signed-out visitor cannot be quoted. */
export const getFareEstimate = (query: FareEstimateQuery) =>
  api.get<FareBreakdown>("/pricing/fare-estimate", { query: { ...query } });

/* ------------------------------- bookings -------------------------------- */

export interface CreateBookingInput {
  pickup: GeoPoint;
  drop: GeoPoint;
  vehicleClass: string;
  /** Party size. The API records it so operations can see it against the class booked. */
  passengers?: number;
  tripType: TripType;
  city: string;
  scheduledAt?: string;
  hours?: number;
  /** Required by the API when tripType is "airport". */
  flightDetails?: { flightNumber: string; scheduledArrival?: string };
  favoriteDriverId?: string;
  /**
   * Wallet credit to put towards this ride. Recorded on the booking, not debited — the
   * API spends it when a chauffeur is assigned and a Trip exists to spend it against.
   */
  walletCreditRequested?: number;
}

/**
 * Note the envelope: create answers `{ booking, fareBreakdown }` while get, update and
 * cancel all return the booking document directly.
 */
export interface CreatedBooking {
  booking: Booking;
  fareBreakdown: FareBreakdown;
}

export const createBooking = (input: CreateBookingInput) =>
  api.post<CreatedBooking>("/bookings", input);

export const getBooking = (id: string) => api.get<Booking>(`/bookings/${id}`);

export const updateBooking = (
  id: string,
  input: Partial<
    Pick<
      CreateBookingInput,
      "pickup" | "drop" | "vehicleClass" | "scheduledAt" | "walletCreditRequested"
    >
  >,
) => api.patch<Booking>(`/bookings/${id}`, input);

/**
 * Only valid before dispatch; the API rejects an assigned booking here.
 *
 * The reason rides on the query string rather than in a body: DELETE bodies are legal
 * but not dependably forwarded, and a silently dropped cancellation reason is worse
 * than a longer URL.
 */
export const cancelBookingBeforeDispatch = (id: string, reason?: string) =>
  api.delete<Booking>(`/bookings/${id}`, reason ? { query: { reason } } : undefined);

export const requestFavoriteDriver = (bookingId: string, driverId: string) =>
  api.post<Booking>(`/bookings/${bookingId}/favorite-driver`, { driverId });

/* --------------------------------- rides --------------------------------- */

/** What happened to the Trip behind a booking — see listMyRides in viaro-backend. */
export interface RideTripSummary {
  tripId: string;
  status: "accepted" | "started" | "completed" | "cancelled";
  completedAt?: string;
  refundPct?: number;
  refundedAt?: string;
  rated: boolean;
  driverId: string;
  driverName: string | null;
}

export type RideListItem = Booking & {
  scheduledAtLocal?: string;
  /** Null until a chauffeur accepts. Absent from an older API that did not send it. */
  trip?: RideTripSummary | null;
};

export const listMyRides = (page = 1, limit = 20) =>
  api.get<Paginated<RideListItem>>("/users/me/rides", { query: { page, limit } });

export const getReceipt = (bookingId: string) =>
  api.get<Receipt>(`/users/me/rides/${bookingId}/receipt`);

/* --------------------------- vehicle catalogue ---------------------------- */

/**
 * The bookable classes, owned by operations in the admin console rather than by a
 * constant here. `lib/constants.ts` keeps the photography and a fallback list for when
 * the call fails — the API has no image field the console populates yet.
 */
export interface ApiVehicleClass {
  _id: string;
  value: string;
  label: string;
  detail?: string;
  seats: number;
  bags: number;
  multiplier: number;
  /** all · hourly (charters only) · transfer (point-to-point and airport only). */
  usage?: "all" | "hourly" | "transfer";
  hourlyMultiplier?: number | null;
  active: boolean;
  sortOrder: number;
}

export const listVehicleClasses = () => api.get<ApiVehicleClass[]>("/vehicle-classes");
