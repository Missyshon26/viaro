import { api } from "./client";
import type { Booking, Paginated, Trip, TripType, User, Wallet } from "./types";

/** Endpoints behind the customer's own screens: 06–10 on the desktop design. */

/* --------------------------------- rides ---------------------------------- */

/** `GET /users/me/rides` lists **bookings**, newest first — not trips. */
export type RideListItem = Booking & { scheduledAtLocal?: string };

export function listMyRides(page = 1, limit = 20) {
  return api.get<Paginated<RideListItem>>("/users/me/rides", { query: { page, limit } });
}

export interface Receipt {
  bookingId: string;
  tripId: string | null;
  fare: number;
  creditApplied: number;
  amountDue: number;
  tripType: TripType;
  date: string;
  /** The trip's status when one exists, otherwise the booking's. */
  status: string;
  refund: { refundPct: number; refundedAt?: string } | null;
}

export function getReceipt(bookingId: string) {
  return api.get<Receipt>(`/users/me/rides/${bookingId}/receipt`);
}

/* --------------------------------- wallet --------------------------------- */

export function getMyWallet(page = 1, limit = 20) {
  return api.get<Wallet>("/wallet/me", { query: { page, limit } });
}

export interface PaymentMethod {
  _id: string;
  brand?: string;
  last4?: string;
  expMonth?: number;
  expYear?: number;
  isDefault: boolean;
  provider: string;
}

export function listPaymentMethods() {
  return api.get<PaymentMethod[]>("/wallet/methods");
}

export function deletePaymentMethod(id: string) {
  return api.delete<{ deleted: boolean }>(`/wallet/methods/${id}`);
}

/* -------------------------------- profile --------------------------------- */

export function updateProfile(input: { name?: string; phone?: string }) {
  return api.patch<User>("/users/me", input);
}

export function deleteAccount() {
  return api.delete<{ deleted: boolean }>("/users/me");
}

/* ------------------------------ trips + cancel ----------------------------- */

export function getTrip(id: string) {
  return api.get<Trip>(`/trips/${id}`);
}

/**
 * Cancellation runs down two different paths depending on how far the booking got,
 * and the API enforces the split: cancelBookingByCustomer rejects an assigned booking
 * with "use the trip cancellation endpoints".
 *
 *  - not yet assigned → DELETE /bookings/:id, no money has moved
 *  - assigned         → POST /trips/:id/cancel/<type>, which computes the refund
 */
const CANCEL_PATH: Record<TripType, string> = {
  point2point: "point-to-point",
  airport: "airport",
  hourly: "hourly",
};

export function cancelBookingBeforeDispatch(bookingId: string) {
  return api.delete<Booking>(`/bookings/${bookingId}`);
}

export function cancelAssignedTrip(tripId: string, tripType: TripType, reason?: string) {
  return api.post<{ refundPct?: number; refundAmount?: number }>(
    `/trips/${tripId}/cancel/${CANCEL_PATH[tripType]}`,
    reason ? { reason } : undefined,
  );
}
