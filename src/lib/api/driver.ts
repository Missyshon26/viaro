import { api } from "./client";
import type { Booking, Driver, Paginated, Trip, TripStatus } from "./types";

/** Endpoints the driver portal runs on. All are `roleGuard('driver')` unless noted. */

/* ------------------------------ own account ------------------------------- */

/**
 * Note the envelope: GET /drivers/me answers `{ driver, stats }`, not a bare Driver.
 * PATCH /drivers/me/status, by contrast, returns the driver document directly.
 */
export interface DriverProfile {
  driver: Driver;
  stats: { activeTrips: number; completedTrips: number };
}

export function getMyDriver() {
  return api.get<DriverProfile>("/drivers/me");
}

/**
 * A driver may only set themselves available or offline — 'busy' is system-owned, so
 * that nobody can hide from dispatch while still holding a trip (driver.validation.ts).
 * `lat`/`lng` are sent when going online so dispatch can place them immediately.
 */
export function setMyStatus(
  status: "available" | "offline",
  position?: { lat: number; lng: number },
) {
  return api.patch<Driver>("/drivers/me/status", { status, ...position });
}

/* --------------------------------- trips ---------------------------------- */

export function listMyTrips(params: { status?: TripStatus; page?: number; limit?: number } = {}) {
  return api.get<Paginated<Trip>>("/trips", { query: { ...params } });
}

export function getTrip(id: string) {
  return api.get<Trip>(`/trips/${id}`);
}

/* -------------------------------- reports --------------------------------- */

export interface ReportRange {
  /** ISO date (yyyy-mm-dd). Omit for all time. */
  from?: string;
  to?: string;
}

/**
 * ⚠ `fareAmount` and `totalFare` are stripped for drivers (spec §8 rule 2), so this
 * endpoint answers "how many trips", never "how much money". Earnings come from
 * earnings-payout below, which reports the driver's own wallet credits.
 */
export interface TripsCompletedReport {
  scope: "own" | "all";
  count: number;
  rows: { tripId: string; bookingId: string; driverId: string; completedAt: string | null }[];
}

export function getTripsCompleted(range: ReportRange = {}) {
  return api.get<TripsCompletedReport>("/reports/trips-completed", { query: { ...range } });
}

/** For a driver this is scoped to their own wallet: what they were actually paid. */
export interface EarningsPayoutReport {
  scope: "own";
  count: number;
  balance: number;
  totalCredited: number;
  totalWithdrawn: number;
  rows: {
    /**
     * The API sends `transactionId` and `at`, not `_id` and `createdAt`.
     *
     * This type claimed otherwise, so TypeScript happily accepted `row._id` (undefined —
     * every row rendered with the same missing React key) and `row.createdAt` (undefined,
     * which the driver's earnings table passed to `new Date()` and printed as
     * "Invalid Date"). `at` is already formatted in America/Los_Angeles by the server,
     * so render it as-is rather than re-parsing it.
     */
    transactionId: string;
    type: string;
    amount: number;
    feeApplied: number;
    reason?: string | null;
    at: string;
  }[];
}

export function getEarningsPayout(range: ReportRange = {}) {
  return api.get<EarningsPayoutReport>("/reports/earnings-payout", { query: { ...range } });
}

/** Traced from reports.service.ts — two lists plus a counts summary, not `rows`. */
export interface CancellationsReport {
  scope: string;
  cancellations: {
    tripId: string;
    driverId: string;
    status: string;
    cancelledBy: string | null;
    reason: string | null;
    refundPct: number;
    refundedAt: string | null;
  }[];
  penalties: {
    penaltyId: string;
    bookingId: string;
    driverId: string;
    reason: string;
    alertDelayMinutes: number;
    at: string;
  }[];
  counts: { cancellations: number; penalties: number };
}

export function getCancellations(range: ReportRange = {}) {
  return api.get<CancellationsReport>("/reports/cancellations-penalties", {
    query: { ...range },
  });
}

/* -------------------------------- dispatch -------------------------------- */

/** `GET /admin/dispatch/pool` is roleGuard('driver','admin') — the open request pool. */
/**
 * The pool returns whole Booking documents (paginated), with the customer populated —
 * not a slim offer object. `_id` here is the BOOKING id, which is what
 * POST /trips/:id/accept expects: it resolves the id as a booking first.
 */
export interface PoolEntry extends Omit<Booking, "customerId"> {
  /** Populated with just the contact fields the driver needs, not the whole User. */
  customerId: string | { _id: string; name: string; phone: string };
  scheduledAtLocal?: string;
}

export function getDispatchPool() {
  return api.get<PoolEntry[] | { items: PoolEntry[] }>("/admin/dispatch/pool");
}

/* --------------------------------- dates ---------------------------------- */

const iso = (date: Date) => date.toISOString().slice(0, 10);

export const todayRange = (): ReportRange => ({ from: iso(new Date()) });

/** Week starts Monday, matching the design's "This week" tile. */
export function weekRange(): ReportRange {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  return { from: iso(monday) };
}

/* ------------------------------ trip lifecycle ----------------------------- */

/** Driver-side transitions. Each is `roleGuard('driver')` and ownership-checked. */
export const acceptTrip = (id: string) => api.post<Trip>(`/trips/${id}/accept`);
export const startTrip = (id: string) => api.post<Trip>(`/trips/${id}/start`);
export const completeTrip = (id: string) => api.post<Trip>(`/trips/${id}/complete`);
export const cancelTrip = (id: string, reason?: string) =>
  api.post<Trip>(`/trips/${id}/cancel`, reason ? { reason } : undefined);

/* -------------------------------- documents -------------------------------- */

/**
 * The API records upload *metadata*; storage is a placeholder on the backend
 * (utils/s3.ts), so the bytes are not shipped anywhere yet.
 */
export const uploadDocument = (input: {
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
}) => api.post<unknown>("/users/me/documents", input);

/* --------------------------------- wallet ---------------------------------- */

export interface WalletPage {
  walletId: string;
  ownerType: string;
  balance: number;
  transactions: Paginated<{
    _id: string;
    type: string;
    amount: number;
    feeApplied: number;
    reason?: string | null;
    createdAt: string;
  }>;
}

export const getMyWallet = (page = 1, limit = 20) =>
  api.get<WalletPage>("/wallet/me", { query: { page, limit } });

/** Driver-only: customers cannot withdraw. A 10% fee applies. */
export const withdraw = (amount: number, destination?: string) =>
  api.post<unknown>("/wallet/withdraw", { amount, ...(destination ? { destination } : {}) });

/* -------------------------------- support ---------------------------------- */

export interface Ticket {
  _id: string;
  category: string;
  subject: string;
  status: string;
  messages: { senderRole: string; message: string; createdAt: string }[];
  createdAt: string;
}

export const listTickets = () =>
  api.get<Paginated<Ticket> | Ticket[]>("/support/tickets", { query: { limit: 50 } });
export const getTicket = (id: string) => api.get<Ticket>(`/support/tickets/${id}`);
export const createTicket = (input: {
  category: string;
  subject: string;
  message: string;
  tripId?: string;
}) => api.post<Ticket>("/support/tickets", input);
export const replyToTicket = (id: string, message: string) =>
  api.post<Ticket>(`/support/tickets/${id}/messages`, { message });
