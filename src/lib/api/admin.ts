import { api } from "./client";
import type { Booking, Driver, Paginated, Trip, User } from "./types";

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

  // The first page said how many there are, so the rest can be asked for together (a few at a
  // time, to be kind to the API) instead of one after another: every page costs a full round trip.
  const remaining = Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i + 2);
  const CONCURRENCY = 5;
  for (let i = 0; i < remaining.length; i += CONCURRENCY) {
    const batch = await Promise.all(remaining.slice(i, i + CONCURRENCY).map((page) => read(page, PAGE_LIMIT)));
    for (const next of batch) {
      if (Array.isArray(next)) items.push(...next);
      else items.push(...(next.items ?? []));
    }
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
  events: { bookingId: string; reason: string; at?: string }[];
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

/** One page of the pipeline: bookings with their trip and customer, filtered and counted by the API. */
export interface JourneyFilters {
  stage?: string;
  q?: string;
  from?: string;
  to?: string;
  vehicle?: string;
  service?: string;
  city?: string;
  payment?: string;
  customerId?: string;
}
export type JourneysPage = Paginated<Booking & { trip?: Trip }> & { counts: Record<string, number> };

export const getJourneys = (page: number, limit: number, filters: JourneyFilters, signal?: AbortSignal) => {
  const query: Record<string, string | number> = { page, limit };
  for (const [key, value] of Object.entries(filters)) if (value) query[key] = value;
  return api.get<JourneysPage>("/admin/dashboard/journeys", { query, signal });
};

/** Headline counts, worked out by the API so the dashboard never downloads whole collections. */
export interface DashboardSummary {
  bookings: {
    total: number;
    stages: { awaiting: number; assigned: number; in_progress: number; completed: number; cancelled: number };
  };
  users: { customer: number; driver: number; company: number; admin: number };
  drivers: { total: number; available: number; busy: number; offline: number; penalised: number; top: RosterDriver[] };
  /** All-time settled trips and their fare, counted by the server. */
  completed: { count: number; totalFare: number };
  /** Cancelled (or penalised) trips and penalty events, counted by the server. */
  cancellations: { count: number; penalties: number };
}
export const getDashboardSummary = () => api.get<DashboardSummary>("/admin/dashboard/summary");

/** The ids behind the sidebar badges: one small request in place of four list downloads. */
export const getNavBadges = () => api.get<Record<string, string[]>>("/admin/nav-badges");

export const getUsersDashboard = (page = 1, limit = 20, filters: { role?: string; q?: string } = {}) =>
  api.get<Paginated<User>>("/admin/dashboard/users", { query: { page, limit, ...filters } });

/** One account by id. */
export const getUserDashboard = (id: string) => api.get<User>(`/admin/dashboard/users/${id}`);

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

export interface AssignedBooking extends Omit<Booking, "customerId"> {
  customerId: string | { _id: string; name: string; phone: string };
  scheduledAtLocal?: string;
}

/**
 * UML «Assign Driver to Booking» — the Admin actor's association on the DISPATCH
 * cluster, and admin-only because no other actor is drawn against it.
 *
 * A booking is not offered to drivers: it waits until an operator assigns one here. The API
 * refuses a booking that is already assigned or cancelled, and a driver who is not `available`.
 */
export const assignDriverToBooking = (bookingId: string, driverId: string) =>
  api.post<{ booking: AssignedBooking; tripId: string }>(
    `/admin/dispatch/${bookingId}/assign`,
    { driverId },
  );

/* --------------------------------- reports --------------------------------- */

export interface ReportRange {
  from?: string;
  to?: string;
  /** "true": leave out chauffeur names, for charts that only need dates and fares. */
  slim?: "true";
}

export interface TripsCompletedReport {
  scope: string;
  count: number;
  totalFare?: number;
  rows: {
    tripId: string;
    bookingId: string;
    driverId: string;
    driverName?: string;
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
    bookingId?: string;
    driverId: string;
    driverName?: string;
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
  format: "csv" | "pdf" | "xlsx",
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
  estimatedArrival?: string | null;
  actualArrival: string | null;
  /** The time to plan around: actual, else forecast, else schedule. */
  expectedArrival?: string | null;
  /** Minutes late (negative = early), when the provider says. */
  delayMinutes?: number | null;
  arrivalAirport: string | null;
  provider: string;
  placeholder?: boolean;
  verified?: boolean;
  /** Why there is no real data: no provider set up, no record for that day yet, or the lookup failed. */
  unavailableReason?: "not-configured" | "not-found" | "error";
}

/** `date` (yyyy-mm-dd, Pacific) asks for THAT day's flight; the number is reused daily. */
export const getFlight = (flightNumber: string, date?: string) =>
  api.get<FlightDetails>(`/flight/${encodeURIComponent(flightNumber)}`, {
    query: date ? { date } : undefined,
  });

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
export const ADMIN_TRIP_STATUSES = ['confirmed', 'enroute', 'arrived', 'started', 'completed', 'cancelled'] as const;
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
  /** Sales tax added to every fare (on the price plus tip, after any discount). */
  taxPct: number;
  /** Automatic fuel surcharge on every trip price. 0 = none. */
  fuelSurchargePct: number;
  /** Dollars off a customer's first trip. 0 = none. */
  welcomeDiscount: number;
  /** Dollars off every Nth trip after the first. 0 = none. */
  loyaltyDiscount: number;
  loyaltyEveryNth: number;
  updatedAt: string | null;
}

export const updatePlatformSettings = (
  input: Partial<
    Pick<
      PlatformSettings,
      | "driverPayout"
      | "companyRevenuePct"
      | "withdrawalFeePct"
      | "supportInboxEmail"
      | "taxPct"
      | "fuelSurchargePct"
      | "welcomeDiscount"
      | "loyaltyDiscount"
      | "loyaltyEveryNth"
    >
  >,
) => api.patch<PlatformSettings>("/admin/settings", input);

export const getPlatformSettings = () => api.get<PlatformSettings>("/admin/settings");

export const updatePayoutDefaults = (input: { mode: "percentage" | "flat"; value: number }) =>
  api.patch<PlatformSettings>("/admin/settings/payout", input);

/* ------------------------------- agreement -------------------------------- */

/** A passenger's rental agreement status, with the signature image when there is one. */
export interface UserAgreement {
  currentVersion: string;
  signed: boolean;
  version: string | null;
  signedAt: string | null;
  /** Operations' verdict on the signature. Signing again clears it. */
  review: { status: "approved" | "rejected"; at: string; byName?: string } | null;
  signature?: string;
}

export const getUserAgreement = (userId: string) =>
  api.get<UserAgreement>(`/admin/users/${userId}/agreement`);

/** Approve or reject a client's signed agreement; the client is emailed the verdict. */
export const reviewUserAgreement = (userId: string, decision: "approve" | "reject") =>
  api.post<UserAgreement>(`/admin/users/${userId}/agreement/review`, { decision });

/* ------------------------------- trip steps ------------------------------- */

/**
 * The passenger never appeared. Closes the trip as a charged no-show (the chauffeur is paid
 * and freed) and emails the passenger, with a copy to operations.
 */
export const markNoShow = (tripId: string) =>
  api.post<{ _id: string; status: string; noShow?: boolean }>(`/trips/${tripId}/no-show`);

/**
 * Undoes a no-show marked by mistake: the trip returns to accepted and the chauffeur's pay
 * and the business's shares are taken back. The passenger is told in the app, not by email.
 */
export const revertNoShow = (tripId: string) =>
  api.post<{ _id: string; status: string }>(`/trips/${tripId}/no-show/revert`);

/* -------------------------------- the calendar -------------------------------- */

/** Whether the shared operations calendar is set up, and whether we can reach it. */
export const getCalendarStatus = () =>
  api.get<{ enabled: boolean; ok?: boolean; name?: string; error?: string }>("/admin/calendar/status");

/** Puts this booking on the calendar now (or brings it up to date). Returns the event link. */
export const syncBookingToCalendar = (bookingId: string) =>
  api.post<{ action: "created" | "updated" | "removed" | "unchanged" | "skipped"; link?: string; reason?: string }>(
    `/admin/bookings/${bookingId}/calendar-sync`,
  );

/**
 * Emails the client their invoice (PDF attached). With `withPaymentLink` an unpaid trip also
 * gets a Pay Now link; without it, the PDF goes alone.
 */
export const emailInvoice = (bookingId: string, withPaymentLink: boolean) =>
  api.post<{ sentTo: string; paymentLinkIncluded?: boolean }>(`/admin/bookings/${bookingId}/email-invoice`, { withPaymentLink });

/* ------------------------------- reject a request ------------------------------- */

/**
 * Turns down a booking request nobody has accepted yet. The customer is emailed the reason;
 * a card payment is refunded in full. `refundError` is set when the booking was rejected but
 * the refund failed — the operator finishes it with Refund.
 */
/** Accepts a new request: the customer is told their trip is confirmed. Assigning a driver comes after. */
export const confirmBookingRequest = (bookingId: string) =>
  api.post<{ booking: { _id: string; confirmedAt?: string } }>(`/admin/bookings/${bookingId}/confirm`);

export const rejectBookingRequest = (bookingId: string, reason: string) =>
  api.post<{ refunded: number; refundError?: string }>(`/admin/bookings/${bookingId}/reject`, { reason });

/* --------------------------------- refunds --------------------------------- */

/**
 * Refunds all or part of what the client paid by card, back to the card. Refunding does not
 * cancel the trip. `requestId` (one per dialog) makes a repeated request refund only once.
 */
export const refundBooking = (bookingId: string, input: { amount: number; requestId: string; note?: string }) =>
  api.post<{ refunded: number; payment: { amount: number; refundedAmount: number; status: string } }>(
    `/admin/bookings/${bookingId}/refund`,
    input,
  );

/* ------------------------------ payment links ------------------------------ */

/**
 * Emails the client a Stripe-hosted page to pay this booking by card. The booking turns to
 * paid by itself when the payment arrives. `emailed` is false when the email could not be
 * sent — the link is still valid, so the operator can copy it and send it another way.
 */
export const sendPaymentLink = (bookingId: string) =>
  api.post<{ url: string; amount: number; expiresAt: string; emailed: boolean; sentTo: string }>(
    `/admin/bookings/${bookingId}/payment-link`,
  );

/* ---------------------------- trips for clients ---------------------------- */

/** The body of both calls below — build it with tripPayload() in lib/newTrip.ts. */
export type AdminTripBody = ReturnType<typeof import("@/lib/newTrip").tripPayload>;

export type AdminJourneyBody = ReturnType<typeof import("@/lib/newTrip").journeyPayload>;

/** The price of the trip for that client, with the booking rules checked; nothing is saved. */
export const quoteTripForClient = (body: AdminTripBody) =>
  api.post<{
    fare: number;
    baseFare: number;
    isPeak: boolean;
    peakMultiplier: number;
    subtotal: number;
    fuelSurchargePct?: number;
    fuelSurcharge?: number;
    gratuityPct: number;
    gratuity: number;
    discountKind?: "welcome" | "loyalty" | "manual";
    discount: number;
    taxPct: number;
    tax: number;
  }>("/admin/bookings/quote", body);

/** Every leg's price and the total for a round trip or multi-city journey; nothing is saved. */
export const quoteJourneyForClient = (body: AdminJourneyBody) =>
  api.post<{ fares: number[]; total: number }>("/admin/bookings/journey/quote", body);

/**
 * Books every leg. `error` is set when only the first legs could be saved — those bookings
 * exist and are returned, so the operator can add the rest as separate trips.
 */
export const createJourneyForClient = (body: AdminJourneyBody) =>
  api.post<{ bookings: { _id: string; estimatedFare: number }[]; error?: string }>("/admin/bookings/journey", body);

/** Books the trip for the client. It is unpaid until the fare is collected. */
export const createTripForClient = (body: AdminTripBody) =>
  api.post<{ booking: { _id: string; estimatedFare: number } }>("/admin/bookings", body);

/** What an operator can change on a booking. Send only what moved: each change is recorded. */
export interface BookingChanges {
  pickup?: { lat: number; lng: number; address: string };
  drop?: { lat: number; lng: number; address: string };
  stops?: { lat: number; lng: number; address: string }[];
  vehicleClass?: string;
  /** Pacific wall time, yyyy-mm-ddThh:mm:ss. */
  scheduledAt?: string;
  passengers?: number;
  checkedBags?: number;
  carryOnBags?: number;
  flightNumber?: string;
  occasion?: string | null;
  occasionDetails?: string | null;
  passengerName?: string | null;
  passengerPhone?: string | null;
  description?: string | null;
  /** Email the client about the change. Defaults to yes. */
  notifyCustomer?: boolean;
}

export const updateBookingDetails = (bookingId: string, changes: BookingChanges) =>
  api.patch<Booking>(`/admin/bookings/${bookingId}`, changes);
