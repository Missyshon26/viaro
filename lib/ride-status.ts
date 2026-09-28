import type { BookingStatus, TripStatus } from "@/lib/api/types";

/**
 * The one place a passenger-facing ride status is decided.
 *
 * The API has two records with two vocabularies — a Booking (pending, dispatched,
 * assigned, cancelled) and, once a chauffeur accepts, a Trip (accepted, started,
 * completed, cancelled) — and neither is language a passenger should read. "Offered to
 * chauffeurs" and "Finished" were internal states leaking into the UI; the business asked
 * for Confirmed → Chauffeur assigned → Completed, or Cancelled / Refunded.
 */
export type RideStatusKey =
  | "confirmed"
  | "assigned"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "refunded";

export const RIDE_STATUS_LABEL: Record<RideStatusKey, string> = {
  confirmed: "Confirmed",
  assigned: "Chauffeur assigned",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export interface RideStatusInput {
  bookingStatus?: BookingStatus | string | null;
  tripStatus?: TripStatus | string | null;
  /** Percentage refunded on cancellation, if any. */
  refundPct?: number | null;
}

export function rideStatus({ bookingStatus, tripStatus, refundPct }: RideStatusInput): RideStatusKey {
  if (tripStatus === "completed") return "completed";
  if (tripStatus === "cancelled" || bookingStatus === "cancelled") {
    return (refundPct ?? 0) > 0 ? "refunded" : "cancelled";
  }
  if (tripStatus === "started") return "in_progress";
  if (tripStatus === "accepted" || bookingStatus === "assigned") return "assigned";
  // pending / dispatched: the booking is taken and paid for; who drives is our problem.
  return "confirmed";
}
