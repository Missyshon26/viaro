import { api } from "./client";
import type { Booking, Driver, Paginated, User } from "./types";

/**
 * Admin + company management endpoints.
 *
 * Every shape here was traced against the running API — several are not what the model
 * suggests. Notably the two "dashboard" routes return paginated *lists*, not summary
 * objects, so the headline count is `total`.
 *
 * Note also that these all sit under `/admin` but the guards vary: `POST /admin/drivers`
 * is company-ONLY (an admin cannot create a driver), while the dashboards are
 * admin-only. The path prefix does not imply the role.
 */

/* ------------------------------- paging helper ----------------------------- */

/**
 * The list endpoints cap `limit` at 100 (paginationSchema), so a dashboard that wants
 * to tally a whole collection has to walk the pages. This walks them, stopping at
 * `maxPages` so a large deployment degrades into "the first N" rather than firing an
 * unbounded number of requests at the API.
 *
 * Returns what it managed to read plus the reported total, so the UI can say when it is
 * showing a partial tally instead of quietly under-reporting.
 */
export const PAGE_LIMIT = 100;

export async function fetchAllPages<T>(
  read: (page: number, limit: number) => Promise<Paginated<T> | T[]>,
  maxPages = 10,
): Promise<{ items: T[]; total: number; complete: boolean }> {
  const first = await read(1, PAGE_LIMIT);
  if (Array.isArray(first)) {
    return { items: first, total: first.length, complete: true };
  }

  const items = [...(first.items ?? [])];
  const totalPages = first.totalPages ?? 1;
  const pages = Math.min(totalPages, maxPages);

  for (let page = 2; page <= pages; page += 1) {
    const next = await read(page, PAGE_LIMIT);
    if (Array.isArray(next)) items.push(...next);
    else items.push(...(next.items ?? []));
  }

  return { items, total: first.total ?? items.length, complete: pages >= totalPages };
}

/* -------------------------------- drivers ---------------------------------- */

export interface RosterDriver extends Omit<Driver, "userId"> {
  userId: string | { _id: string; name: string; email?: string; phone?: string };
  /**
   * Admin responses only. A driver on a company's roster has their terms set in that
   * company's console — `PATCH /admin/drivers/:id` answers 403 to an admin for them.
   */
  managedBy?: "company" | "platform";
}

export const listDrivers = (page = 1, limit = 100) =>
  api.get<Paginated<RosterDriver> | RosterDriver[]>("/admin/drivers", {
    query: { page, limit },
  });

/** Company-only. */
export const createDriver = (input: {
  name: string;
  email: string;
  phone: string;
  password: string;
  vehicleClass: string;
}) => api.post<RosterDriver>("/admin/drivers", input);

export const updateDriver = (
  id: string,
  input: {
    vehicleClass?: string;
    status?: string;
    payout?: { mode: "percentage" | "flat"; value: number };
  },
) => api.patch<RosterDriver>(`/admin/drivers/${id}`, input);

export interface PenaltyDriver {
  driverId: string;
  user: { _id: string; name: string; email: string; phone: string };
  vehicleClass: string;
  status: string;
  penaltyCount: number;
  events: { bookingId: string; reason: string; alertDelayMinutes: number; at?: string }[];
}

export interface PenaltiesReport {
  drivers: PenaltyDriver[];
  totalDrivers: number;
  totalEvents: number;
}

export const listPenalties = () => api.get<PenaltiesReport>("/admin/drivers/penalties");

/* ------------------------------- dashboards -------------------------------- */

/** Both answer with a paginated list — `total` is the headline number. */
export const getBookingsDashboard = (page = 1, limit = 20) =>
  api.get<Paginated<Booking>>("/admin/dashboard/bookings", { query: { page, limit } });

export const getUsersDashboard = (page = 1, limit = 20) =>
  api.get<Paginated<User>>("/admin/dashboard/users", { query: { page, limit } });

export interface SubscriptionRevenue {
  months: { year: number; month: number; activeSubscriptions: number; revenue: number }[];
  totalActive: number;
  totalRevenue: number;
}

export const getSubscriptionRevenue = () =>
  api.get<SubscriptionRevenue>("/admin/revenue/subscriptions");

/* ------------------------------- city pricing ------------------------------ */

export interface PricingRule {
  _id: string;
  city: string;
  baseFare: number;
  peakMultiplier: number;
}

export const listPricingRules = () => api.get<PricingRule[]>("/admin/pricing/city");

export const createPricingRule = (input: {
  city: string;
  baseFare: number;
  peakMultiplier: number;
}) => api.post<PricingRule>("/admin/pricing/city", input);

export const updatePricingRule = (
  id: string,
  input: { city?: string; baseFare?: number; peakMultiplier?: number },
) => api.patch<PricingRule>(`/admin/pricing/city/${id}`, input);

export const deletePricingRule = (id: string) =>
  api.delete<{ deleted: boolean }>(`/admin/pricing/city/${id}`);

/* --------------------------------- dispatch -------------------------------- */

export interface PoolBooking extends Omit<Booking, "customerId"> {
  customerId: string | { _id: string; name: string; phone: string };
  scheduledAtLocal?: string;
}

export const getDispatchPool = () =>
  api.get<Paginated<PoolBooking> | PoolBooking[]>("/admin/dispatch/pool");

/**
 * UML «Assign Driver to Booking» — the Admin actor's association on the DISPATCH
 * cluster, and admin-only because no other actor is drawn against it.
 *
 * Dispatch is otherwise automatic: a booking is broadcast to nearby chauffeurs the
 * moment it is created. This is the manual override. The API refuses a booking that is
 * already assigned or cancelled, and a chauffeur who is not `available`.
 */
export const assignDriverToBooking = (bookingId: string, driverId: string) =>
  api.post<{ booking: PoolBooking; tripId: string }>(
    `/admin/dispatch/${bookingId}/assign`,
    { driverId },
  );

/* --------------------------------- reports --------------------------------- */

export interface ReportRange {
  from?: string;
  to?: string;
}

export interface TripsCompletedReport {
  scope: string;
  count: number;
  totalFare?: number;
  rows: {
    tripId: string;
    bookingId: string;
    driverId: string;
    fareAmount?: number;
    completedAt: string | null;
  }[];
}

export const getTripsCompleted = (range: ReportRange = {}) =>
  api.get<TripsCompletedReport>("/reports/trips-completed", { query: { ...range } });

export interface EarningsPayoutReport {
  scope: string;
  count: number;
  totals?: Record<string, number>;
  grandTotal?: number;
  balance?: number;
  totalCredited?: number;
  totalWithdrawn?: number;
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

export const getEarningsPayout = (range: ReportRange = {}) =>
  api.get<EarningsPayoutReport>("/reports/earnings-payout", { query: { ...range } });

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

export const getCancellations = (range: ReportRange = {}) =>
  api.get<CancellationsReport>("/reports/cancellations-penalties", { query: { ...range } });

/**
 * Exports run as background jobs: the request returns 202 with a job id, then the
 * status endpoint is polled until the file is ready.
 */
export const requestExport = (
  type: "trips-completed" | "earnings-payout" | "cancellations-penalties",
  format: "csv" | "pdf",
  range: ReportRange = {},
) => api.get<{ jobId: string }>("/reports", { query: { type, format, ...range } });

export const getExportStatus = (jobId: string) =>
  api.get<{ state: string; file?: string }>(`/reports/exports/${jobId}`);

/* --------------------------------- support --------------------------------- */

export interface Ticket {
  _id: string;
  userId: string | { _id: string; name: string; role: string; email?: string; phone?: string };
  /** Who opened the case: "customer" (a passenger) or "driver" (a chauffeur). */
  requesterRole?: string;
  category: string;
  subject: string;
  status: string;
  messages: { senderRole: string; message: string; createdAt: string }[];
  createdAt: string;
}

export type TicketSource = "customer" | "driver";

/** The admin queue: one page plus how many cases each source has under the same status. */
export type TicketQueue = Paginated<Ticket> & {
  counts?: { all: number; customer: number; driver: number };
};

/** Both filters run on the server so they cover the whole queue, not just the page loaded. */
export const listTickets = (filters: { source?: TicketSource; status?: string } = {}) =>
  api.get<TicketQueue>("/support/tickets", { query: { limit: 100, ...filters } });
export const getTicket = (id: string) => api.get<Ticket>(`/support/tickets/${id}`);
export const replyToTicket = (id: string, message: string) =>
  api.post<Ticket>(`/support/tickets/${id}/messages`, { message });
/** Admin-only: moving a ticket's state. */
export const setTicketStatus = (id: string, status: string) =>
  api.patch<Ticket>(`/support/tickets/${id}`, { status });

/**
 * UML «Publish Booking to Public Pool» — the manual retry.
 *
 * Publishing is normally automatic: creating a booking broadcasts it to nearby
 * chauffeurs straight away. This re-runs that broadcast for a booking the automatic
 * pass missed or that nobody claimed. Answers with how many chauffeurs were in range,
 * because "published to nobody" is a materially different outcome.
 */
export const publishToPool = (bookingId: string) =>
  api.post<{ bookingId: string; driversInRange: number }>(
    `/admin/dispatch/${bookingId}/publish`,
  );

/* ---------------------------------- flight --------------------------------- */

/**
 * Live arrival for an airport pickup. `GET /flight/:flightNumber` is driver + admin
 * only — a passenger never sees it, which is why this board exists in the consoles.
 *
 * `placeholder: true` means no flight provider is configured and the times are
 * generated, not real. The UI must say so rather than presenting invented times as
 * tracking.
 */
export interface FlightDetails {
  flightNumber: string;
  status: string;
  scheduledArrival: string | null;
  actualArrival: string | null;
  arrivalAirport: string | null;
  provider: string;
  placeholder?: boolean;
}

export const getFlight = (flightNumber: string) =>
  api.get<FlightDetails>(`/flight/${encodeURIComponent(flightNumber)}`);

/* ------------------------------- trip status ------------------------------- */

/**
 * PATCH /trips/:id/status — the operations override, admin-only.
 *
 * It is not a field write: the API runs the same side effects as the chauffeur's own
 * actions, so completing settles the fare (60/40 split and driver payout) and either
 * terminal state frees the chauffeur back to available. A cancellation here does NOT
 * penalise the driver — that penalty is for abandoning an accepted ride, not for an
 * office decision.
 */
export const ADMIN_TRIP_STATUSES = ['started', 'completed', 'cancelled'] as const;
export type AdminTripStatus = (typeof ADMIN_TRIP_STATUSES)[number];

export const setTripStatus = (tripId: string, status: AdminTripStatus, reason?: string) =>
  api.patch<{ _id: string; status: string; settled?: boolean }>(`/trips/${tripId}/status`, {
    status,
    ...(reason ? { reason } : {}),
  });

/* ---------------------------------- money ---------------------------------- */

/**
 * Takes wallet credit back off a trip and returns it to the passenger's balance.
 *
 * Operations can do this on a passenger's behalf; the API still refuses once the fare
 * has been charged, because by then the trip was invoiced at the discounted figure.
 */
export const releaseTripCredit = (tripId: string) =>
  api.post<{ released: number; creditApplied: number; outstandingFare: number }>(
    "/wallet/release-credit",
    { tripId },
  );

/** Admin + company: collects the fare for a completed trip through the gateway. */
export const collectPayment = (tripId: string) =>
  // /payments/collect, not /wallet/collect — the route is registered on the payments
  // router. The wrong path 404'd, so this button never once collected a fare.
  api.post<unknown>("/payments/collect", { tripId });

/* ---------------------------------- dates ---------------------------------- */

const iso = (date: Date) => date.toISOString().slice(0, 10);

export const monthRange = (): ReportRange => {
  const now = new Date();
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)) };
};

/* -------------------------------- settings --------------------------------- */

/**
 * Default chauffeur payout — what a chauffeur with no rate of their own earns per trip.
 * Edited here instead of the server's .env (backend: modules/admin/settings.service.ts).
 */
export interface PlatformSettings {
  driverPayout: { mode: "percentage" | "flat"; value: number };
  /** A fleet company's default share of each fare. */
  companyRevenuePct: number;
  /** 100 − companyRevenuePct; derived by the API. */
  platformRevenuePct: number;
  /** Charged on bank withdrawals only. */
  withdrawalFeePct: number;
  /** Receives quote requests, contact messages and support-case alerts. */
  supportInboxEmail: string;
  updatedAt: string | null;
}

export const updatePlatformSettings = (
  input: Partial<Pick<PlatformSettings, "driverPayout" | "companyRevenuePct" | "withdrawalFeePct" | "supportInboxEmail">>,
) => api.patch<PlatformSettings>("/admin/settings", input);

export const getPlatformSettings = () => api.get<PlatformSettings>("/admin/settings");

export const updatePayoutDefaults = (input: { mode: "percentage" | "flat"; value: number }) =>
  api.patch<PlatformSettings>("/admin/settings/payout", input);
