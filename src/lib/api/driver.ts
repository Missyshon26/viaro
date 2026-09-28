import { api } from "./client";
import type { Booking, Driver, Paginated, Trip, TripStatus } from "./types";

/** Endpoints the driver portal runs on. All are `roleGuard('driver')` unless noted. */

/* ------------------------------ own account ------------------------------- */

/**
 * Note the envelope: GET /drivers/me answers `{ driver, stats }`, not a bare Driver.
 * PATCH /drivers/me/status, by contrast, returns the driver document directly.
 */
export interface PayTier {
  mode: "percentage" | "flat";
  /** The rate the owner set, before the rating adjustment. */
  baseValue: number;
  /** What is actually applied to the next trip. */
  effectiveValue: number;
  tier: "excellent" | "standard" | "below" | "poor" | "new";
  label: string;
  adjustmentPct: number;
  rating: number;
  ratingCount: number;
  ratingsToQualify: number;
  minRatings: number;
  enabled: boolean;
  tiers: { key: string; label: string; min: number; adjustmentPct: number }[];
}

export interface DriverProfile {
  driver: Driver;
  stats: { activeTrips: number; completedTrips: number };
  /** Present from the API that ships rating-based pay. */
  pay?: PayTier;
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

/**
 * Registering as a driver already creates the profile; this lets an existing account
 * (re)apply — after a rejection, or when changing vehicle class. Documents are sent as
 * URLs because storage is a placeholder on the backend.
 */
export const applyAsDriver = (vehicleClass: string, documents?: string[]) =>
  api.post<Driver>("/drivers/apply", {
    vehicleClass,
    ...(documents ? { documents } : {}),
  });

/* -------------------------------- dispatch -------------------------------- */

/**
 * ⚠ There are TWO pool routes and only one of them is ours:
 *
 *   GET /dispatch/pool        roleGuard('driver','admin')  ← this app
 *   GET /admin/dispatch/pool  roleGuard('admin')           ← operations console only
 *
 * They serve identical data. This file used to call the /admin one, which answered
 * "Role 'driver' is not permitted to access this resource" and left the Requests screen
 * permanently empty — a chauffeur could never see work to claim.
 */
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
  return api.get<PoolEntry[] | { items: PoolEntry[] }>("/dispatch/pool");
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

export type OperatorType = "independent" | "company";

export interface DocumentRequirement {
  type: string;
  label: string;
  description: string;
  multiple?: boolean;
  expires?: boolean;
  imageOnly?: boolean;
}

export interface DriverDocumentFile {
  _id: string;
  type: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  expiresAt?: string;
  status: "submitted" | "approved" | "rejected";
  uploadedAt: string;
}

export interface BusinessDetails {
  legalName?: string;
  entityType?: string;
  registrationStatus?: string;
  ubiNumber?: string;
}

/** GET /drivers/me/documents — see viaro-backend src/modules/driver/driver.documents.ts. */
export interface MyDocuments {
  operatorType: OperatorType | null;
  complete: boolean;
  missing: string[];
  insuranceNamedParty: string;
  business: BusinessDetails;
  requirements: Record<OperatorType, DocumentRequirement[]>;
  files: DriverDocumentFile[];
}

export const getMyDocuments = () => api.get<MyDocuments>("/drivers/me/documents");

export const setDocumentProfile = (operatorType: OperatorType, business?: BusinessDetails) =>
  api.patch<MyDocuments>("/drivers/me/documents/profile", {
    operatorType,
    ...(business ? { business } : {}),
  });

/** Sends the file itself; the backend stores it (GridFS) against the requirement. */
export const uploadDocument = (type: string, file: File, expiresAt?: string) =>
  api.upload<MyDocuments>("/drivers/me/documents", file, {
    type,
    fileName: file.name,
    expiresAt,
  });

export const deleteDocument = (id: string) => api.delete<MyDocuments>(`/drivers/me/documents/${id}`);

export const openDocument = (id: string) => api.blob(`/drivers/documents/${id}/file`);

/* ------------------------------- monthly report ------------------------------ */

export interface MonthlyReport {
  timezone: string;
  totals: { completed: number; earnings: number; withdrawn: number };
  months: {
    month: string;
    label: string;
    completed: number;
    cancelled: number;
    earnings: number;
    withdrawn: number;
    withdrawalFees: number;
    ratingsReceived: number;
    averageRating: number | null;
    rides: {
      tripId: string;
      completedAt: string | null;
      pickup: string | null;
      drop: string | null;
      vehicleClass: string | null;
      earned: number;
      rating: number | null;
    }[];
  }[];
}

export const getMonthlyReport = (months = 12) =>
  api.get<MonthlyReport>("/reports/monthly", { query: { months } });

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

/* --------------------------------- flight ---------------------------------- */

/**
 * `roleGuard('driver','admin')` — a customer cannot call this, which is why the
 * passenger app shows no arrival board and this one does.
 */
export interface FlightDetails {
  flightNumber: string;
  status: "scheduled" | "active" | "landed" | "cancelled" | "unknown";
  scheduledArrival: string;
  actualArrival: string | null;
  arrivalAirport?: string | null;
  provider: string;
  /** True when the response is generated, not a real lookup. */
  placeholder: boolean;
}

export const getFlight = (flightNumber: string) =>
  api.get<FlightDetails>(`/flight/${encodeURIComponent(flightNumber)}`);

/* ---------------------------- vehicle catalogue --------------------------- */

/**
 * Turns the `vehicleClass` key stored on a booking into something readable.
 *
 * Operations owns this list in the admin console, so it cannot be a constant here — a
 * class added there has to show its real name in the pool, not a raw key like
 * "suv-luxury".
 */
export interface VehicleClassInfo {
  _id: string;
  value: string;
  label: string;
  seats: number;
  bags: number;
}

export const listVehicleClasses = () => api.get<VehicleClassInfo[]>("/vehicle-classes");

/* ---------------------------------- chat ----------------------------------- */

export interface ChatMessage {
  _id: string;
  tripId: string;
  senderId: string | { _id: string; name: string; role?: string };
  senderRole: string;
  message: string;
  createdAt: string;
}

export const getChatHistory = (tripId: string) =>
  api.get<ChatMessage[]>(`/trips/${tripId}/chat/history`);

/** Customer and the assigned chauffeur may post; the passenger's screen updates live. */
export const sendChatMessage = (tripId: string, message: string) =>
  api.post<ChatMessage>(`/trips/${tripId}/chat/messages`, { message });
