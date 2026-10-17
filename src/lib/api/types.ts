/**
 * Shapes returned by the viaro-backend API.
 * Kept in one file so a backend change has a single place to land.
 */

export type UserRole = "customer" | "driver" | "admin" | "company";
export type UserStatus = "active" | "pending_documents" | "suspended";

/** Every endpoint answers with this envelope. */
export interface ApiEnvelope<T> {
  success: true;
  data: T;
  message?: string;
}

export interface ApiErrorBody {
  success: false;
  message: string;
  details?: unknown;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface User {
  _id: string;
  role: UserRole;
  name: string;
  email: string;
  phone: string;
  status: UserStatus;
  walletId?: string;
  favorites?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Driver {
  _id: string;
  userId: string | User;
  vehicleClass: string;
  status: "available" | "busy" | "offline";
  rating: number;
  ratingCount: number;
  penaltyCount: number;
  documents: string[];
  payout?: { mode: "percentage" | "flat"; value: number; setBy?: "admin" | "company" };
}

export interface AuthResult {
  user: User;
  role: UserRole;
  accessToken: string;
  refreshToken: string;
}

export type TripType = "point2point" | "airport" | "hourly";
export type BookingStatus = "pending" | "dispatched" | "assigned" | "cancelled";

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
  }[];  tripType: TripType;
  status: BookingStatus;
  /** Present only once status is 'cancelled'. */
  cancellation?: BookingCancellation;
  /**
   * Wallet credit the passenger asked to put towards this ride, chosen at booking.
   * Not yet spent — it is applied when a chauffeur is assigned and a Trip exists.
   */
  walletCreditRequested?: number;
  scheduledAt: string;
  scheduledAtLocal?: string;
  city?: string;
  estimatedFare?: number;
  flightDetails?: { flightNumber: string; scheduledArrival?: string };
  favoriteDriverId?: string;
  hours?: number;
  meetAndGreet?: boolean;
  carSeats?: number;
  /** Meet and Greet, car seats, cruise meeting point. */
  serviceNotes?: string[];
}

export interface FareBreakdown {
  city: string;
  tripType: TripType;
  baseFare: number;
  peakMultiplier: number;
  isPeak: boolean;
  subscriber: boolean;
  hours?: number;
  fare: number;
}

export type TripStatus = "accepted" | "started" | "completed" | "cancelled";

export interface Trip {
  _id: string;
  bookingId: string;
  driverId: string;
  status: TripStatus;
  /** Absent for drivers — the API strips it (spec §8 rule 2). */
  fareAmount?: number;
  creditApplied?: number;
  penaltyApplied: boolean;
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
  /** Phone is masked to "Contact via app" for customers. */
  driver?: { driverId: string; name: string | null; phone: string | null; vehicleClass: string; rating: number };
  customer?: { customerId: string; name: string; phone: string };
  scheduledAtLocal?: string;
}

export type TransactionType = "credit" | "debit" | "refund" | "withdrawal";

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

export interface Notification {
  _id: string;
  type: string;
  payload: Record<string, unknown> & { message?: string };
  read: boolean;
  createdAt: string;
}

export interface Subscription {
  _id: string;
  plan: string;
  price: number;
  status: "active" | "cancelled" | "expired";
  startDate: string;
  renewalDate: string;
}

export interface ChatMessage {
  _id: string;
  tripId: string;
  senderId: string | { _id: string; name: string; role: UserRole };
  senderRole: UserRole;
  message: string;
  createdAt: string;
}
