import "server-only";
import { api } from "./client";
import type { Paginated, Trip, TripStatus, TripType } from "./types";

export const listTrips = (params: { status?: TripStatus; page?: number; limit?: number } = {}) =>
  api.get<Paginated<Trip>>("/trips", { query: { ...params } });

export const getTrip = (id: string) => api.get<Trip>(`/trips/${id}`);

/* ------------------------------ customer side ----------------------------- */

/** The API field is `score` (1-5), not `rating`. */
export const rateTrip = (id: string, score: number, comment?: string) =>
  api.post<unknown>(`/trips/${id}/rate`, { score, ...(comment ? { comment } : {}) });

/** Either end may move; the API rejects a call that supplies neither. */
export const changeTripLocation = (
  id: string,
  input: {
    pickup?: { lat: number; lng: number; address: string };
    drop?: { lat: number; lng: number; address: string };
  },
) => api.patch<Trip>(`/trips/${id}/location`, input);

export const changeVehicleClass = (id: string, vehicleClass: string) =>
  api.patch<Trip>(`/trips/${id}/vehicle-class`, { vehicleClass });

/**
 * Cancelling a trip that already has a driver. Three endpoints funnel into one
 * service; the trip type is read from the booking, so calling the hourly path on a
 * point-to-point trip cannot buy a longer refund window.
 */
const CANCEL_PATH: Record<TripType, string> = {
  point2point: "point-to-point",
  airport: "airport",
  hourly: "hourly",
};

export const cancelAssignedTrip = (id: string, tripType: TripType, reason?: string) =>
  api.post<{ refundPct?: number; refundAmount?: number }>(
    `/trips/${id}/cancel/${CANCEL_PATH[tripType]}`,
    reason ? { reason } : undefined,
  );

/* ------------------------------- driver side ------------------------------ */

export const acceptTrip = (id: string) => api.post<Trip>(`/trips/${id}/accept`);
export const startTrip = (id: string) => api.post<Trip>(`/trips/${id}/start`);
export const completeTrip = (id: string) => api.post<Trip>(`/trips/${id}/complete`);
export const driverCancelTrip = (id: string, reason?: string) =>
  api.post<Trip>(`/trips/${id}/cancel`, reason ? { reason } : undefined);

/* ---------------------------------- chat ---------------------------------- */

export interface ChatMessage {
  _id: string;
  tripId: string;
  senderId: string | { _id: string; name: string };
  senderRole: string;
  message: string;
  createdAt: string;
}

/** REST send — see POST /trips/:id/chat/messages in viaro-backend. */
export const sendChatMessage = (tripId: string, message: string) =>
  api.post<ChatMessage>(`/trips/${tripId}/chat/messages`, { message });

export const getChatHistory = (tripId: string) =>
  api.get<ChatMessage[] | Paginated<ChatMessage>>(`/trips/${tripId}/chat/history`);
