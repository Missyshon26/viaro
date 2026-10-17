/**
 * Shapes returned by viaro-backend, traced from its mongoose models and zod
 * validators — not guessed. Ids arrive as strings over JSON; dates as ISO strings.
 */

/* ---------------------------------- enums --------------------------------- */

export const ROLES = ["customer", "driver", "admin", "company"] as const;
export type UserRole = (typeof ROLES)[number];

export const USER_STATUSES = ["active", "pending_documents", "suspended"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const TRIP_TYPES = ["point2point", "airport", "hourly"] as const;
export type TripType = (typeof TRIP_TYPES)[number];

export const BOOKING_STATUSES = ["pending", "dispatched", "assigned", "cancelled"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const TRIP_STATUSES = ["accepted", "started", "completed", "cancelled"] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export const DRIVER_STATUSES = ["available", "busy", "offline"] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export const TRANSACTION_TYPES = ["credit", "debit", "refund", "withdrawal"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const SUBSCRIPTION_STATUSES = ["active", "cancelled", "expired"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const TICKET_CATEGORIES = [
  "trip_dispute",
  "penalty_appeal",
  "payment",
  "account",
  "other",
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_STATUSES = ["open", "pending", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/* -------------------------------- envelopes ------------------------------- */

export interface ApiEnvelope<T> {
  success: true;
  data: T;
  message?: string;
}

export interface ApiErrorBody {
  success: false;
  message: string;
  /** Zod issues arrive as [{ path, message }] on a 400. */
  details?: { path: string; message: string }[] | unknown;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/* --------------------------------- domain --------------------------------- */

export interface User {
  _id: string;
  role: UserRole;
  name: string;
  email: string;
  phone: string;
  status: UserStatus;
  phoneVerified: boolean;
  favorites?: string[];
  walletId?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResult {
  user: User;
  role: UserRole;
  accessToken: string;
  refreshToken: string;
}

export interface GeoPoint {
  lat: number;
  lng: number;
  address: string;
}

/**
 * Who ended a booking, why, and when.
 *
 * On the Booking rather than only the Trip because a booking can be cancelled before a
 * trip exists at all — a pending or dispatched one has no Trip document. This is the
 * single field to read no matter which of the four paths ended it.
 */
export interface BookingCancellation {
  reason?: string;
  by: "customer" | "driver" | "admin";
  byUserId?: string;
  /** Snapshotted at cancellation time, so a later rename or scrub cannot blank it. */
  byName?: string;
  at: string;
}

export interface Booking {
  _id: string;
  customerId: string | User;
  pickup: GeoPoint;
  drop: GeoPoint;
  vehicleClass: string;
  passengers?: number;
  /** Customer-initiated changes since the booking was made, oldest first. */
  amendments?: {
    field: "pickup" | "drop" | "vehicleClass" | "scheduledAt";
    from: string;
    to: string;
    by: "customer" | "admin";
    at: string;
  }[];
  tripType: TripType;
  status: BookingStatus;
  /** Present only once status is 'cancelled'. */
  cancellation?: BookingCancellation;
  /**
   * Wallet credit the passenger asked to put towards this ride, chosen at booking.
   * Not yet spent — it is applied when a chauffeur is assigned and a Trip exists.
   */
  walletCreditRequested?: number;
  scheduledAt: string;
  /** Pre-formatted in America/Los_Angeles by the API on list endpoints. */
  scheduledAtLocal?: string;
  city?: string;
  estimatedFare?: number;
  flightDetails?: { flightNumber: string; scheduledArrival?: string };
  favoriteDriverId?: string;
  /** Hourly charters only. */
  hours?: number;
  meetAndGreet?: boolean;
  carSeats?: number;
  cruisePort?: CruisePort;
  cruiseShip?: string;
  /** What the chauffeur is told: Meet and Greet, car seats, cruise meeting point. */
  serviceNotes?: string[];
  createdAt: string;
  updatedAt: string;
}

export type CruisePort = "pier66" | "pier91";

export interface Trip {
  _id: string;
  bookingId: string;
  driverId: string;
  status: TripStatus;
  /** Absent for drivers — the API strips it (spec §8 rule 2). */
  fareAmount?: number;
  creditApplied?: number;
  penaltyApplied: boolean;
  /** Whether this trip already carries a rating. Set by the API, not inferred. */
  rated?: boolean;
  ratingScore?: number | null;
  settled?: boolean;
  timestamps: {
    requested?: string;
    assigned?: string;
    accepted?: string;
    started?: string;
    completed?: string;
  };
  cancellation?: {
    reason?: string;
    refundPct?: number;
    refundedAt?: string;
    /** "admin" is an operator ending the trip from the console. */
    cancelledBy?: "customer" | "driver" | "admin";
    /** The individual, not just the role. Name is snapshotted at cancellation time. */
    cancelledByUserId?: string;
    cancelledByName?: string;
  };
  lastLocation?: { lat: number; lng: number; updatedAt: string };
  booking?: Booking;
  /** Phone is masked to "Contact via app" for customers (spec §8 rule 4). */
  driver?: {
    driverId: string;
    name: string | null;
    phone: string | null;
    vehicleClass: string;
    rating: number;
  };
  customer?: { customerId: string; name: string; phone: string };
  scheduledAtLocal?: string;
}

export interface Driver {
  _id: string;
  userId: string | { _id: string; name: string };
  vehicleClass: string;
  status: DriverStatus;
  rating: number;
  ratingCount: number;
  penaltyCount: number;
  documents: string[];
  payout?: { mode: "percentage" | "flat"; value: number; setBy?: "admin" | "company" };
}

export interface FareBreakdown {
  city: string;
  tripType: TripType;
  baseFare: number;
  peakMultiplier: number;
  isPeak: boolean;
  subscriber: boolean;
  hours?: number;
  /** Echoed back when the quote was priced for a specific class. */
  vehicleClass?: string;
  /** Class uplift the API applied. 1 when the class is unknown or absent. */
  vehicleMultiplier: number;
  /** flat = fixed transfer price · hourly = fixed rate × hours · multiplier = base × uplifts. */
  pricingModel?: "flat" | "hourly" | "multiplier" | "route";
  /** e.g. "Tacoma ↔ Sea-Tac", when a route price applied. */
  route?: string;
  /** Whether the peak multiplier was charged (never on a fixed rate). */
  peakApplied?: boolean;
  /** Fare before surcharges, after any minimum fare. */
  classFare?: number;
  /** Present when the class's minimum fare lifted the price. */
  minimumFare?: number;
  /** Pickup between 10pm and 7am. */
  primetime?: boolean;
  primetimeSurcharge?: number;
  /** Meet and Greet add-on; 0 when not requested. */
  meetAndGreetFee?: number;
  /** What is charged: classFare + primetimeSurcharge + meetAndGreetFee. */
  fare: number;
}

export interface Transaction {
  _id: string;
  type: TransactionType;
  amount: number;
  feeApplied: number;
  reason?: string | null;
  meta?: Record<string, unknown>;
  createdAt: string;
}

export interface Wallet {
  walletId: string;
  ownerType: "customer" | "driver" | "company" | "platform";
  balance: number;
  transactions: Paginated<Transaction>;
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

export interface Subscription {
  _id: string;
  plan: string;
  price: number;
  status: SubscriptionStatus;
  startDate: string;
  renewalDate: string;
}

export interface NotificationItem {
  _id: string;
  type: string;
  payload: Record<string, unknown> & { message?: string };
  read: boolean;
  createdAt: string;
}

export interface TicketMessage {
  senderId: string | { _id: string; name: string };
  senderRole: UserRole;
  message: string;
  createdAt: string;
}

export interface SupportTicket {
  _id: string;
  userId: string | User;
  category: TicketCategory;
  subject: string;
  status: TicketStatus;
  tripId?: string;
  messages: TicketMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface Receipt {
  bookingId: string;
  tripId: string | null;
  fare: number;
  creditApplied: number;
  amountDue: number;
  tripType: TripType;
  date: string;
  status: string;
  refund: { refundPct: number; refundedAt?: string } | null;
}

export interface PricingRule {
  _id: string;
  city: string;
  baseFare: number;
  peakMultiplier: number;
}
