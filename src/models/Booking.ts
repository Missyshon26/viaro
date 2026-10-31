import { Schema, model, Types, type HydratedDocument } from 'mongoose';
import { CRUISE_PORT_KEYS, MAX_CAR_SEATS, MAX_JOURNEY_LEGS, type CruisePort } from '../config/services';

export const TRIP_TYPES = ['point2point', 'airport', 'hourly'] as const;
export type TripType = (typeof TRIP_TYPES)[number];

export const BOOKING_STATUSES = ['pending', 'dispatched', 'assigned', 'cancelled'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export interface GeoPoint {
  lat: number;
  lng: number;
  address: string;
}

/**
 * One customer-initiated change to a booking after it was made.
 *
 * Stored on the booking rather than derived, because "the pickup moved" is information
 * a chauffeur and an operator both need AFTER the fact — the current value alone cannot
 * tell anyone that a driver is heading to an address the passenger has since changed.
 *
 * `from`/`to` are display strings, not typed values: every console renders this the same
 * way and none of them should have to know that a pickup is a GeoPoint and a vehicle
 * class is a key.
 */
/** What a change can be to. The first four move the job; the rest change what to expect. */
export const AMENDMENT_FIELDS = [
  'pickup',
  'drop',
  'vehicleClass',
  'scheduledAt',
  'stops',
  'flight',
  'occasion',
  'luggage',
  'passenger',
] as const;
export type AmendmentField = (typeof AMENDMENT_FIELDS)[number];

export interface IBookingAmendment {
  field: AmendmentField;
  from: string;
  to: string;
  /** Who made it. Customers change their own booking; ops can too, on request. */
  by: 'customer' | 'admin';
  at: Date;
}

/**
 * Who cancelled, why, and when.
 *
 * Kept on the Booking rather than only on the Trip because a booking can be cancelled
 * before a trip exists at all — a pending or dispatched one has no Trip document to
 * write to. Operations needs one place to read regardless of which of the four paths
 * ended the booking, so the trip-side cancellations mirror themselves here too.
 *
 * `byName` is a snapshot, not a join. The audit trail has to keep reading correctly
 * after an account is renamed or soft-deleted (deletion scrubs PII from the User but
 * keeps financial rows), and `byUserId` is still there for anyone who needs the live
 * record.
 */
export interface IBookingCancellation {
  /** Free text the canceller gave. Optional — nobody is forced to explain themselves. */
  reason?: string;
  by: 'customer' | 'driver' | 'admin';
  byUserId?: Types.ObjectId;
  byName?: string;
  /** Operations turned the request down (as opposed to cancelling a ride that was wanted). */
  rejected?: boolean;
  at: Date;
}

/**
 * The card payment taken at booking (Stripe). Absent on bookings made before payments
 * were switched on, which are still charged after the trip (wallet.collectPayment).
 *
 * A round trip is ONE payment covering both legs: each leg's booking carries the same
 * `intentId` with its own share in `amount`, and refunds are tracked per leg.
 */
export interface IBookingPayment {
  provider: 'stripe';
  intentId: string;
  /** 0 = the first (or only) leg; 1 = the return of a round trip, or the next city. */
  leg: number;
  /** This booking's share of the payment, in dollars. */
  amount: number;
  currency: string;
  status: 'paid' | 'partially_refunded' | 'refunded';
  brand?: string;
  last4?: string;
  /** Total refunded to the card against this booking, in dollars. */
  refundedAmount: number;
  /** Stripe refund ids already counted, so webhook replays never double-count. */
  refundIds: string[];
  paidAt: Date;
}

/**
 * A "pay this online" link an operator sent for a booking made on the customer's behalf.
 * The money arriving fills `payment` (via the Stripe webhook); this only records what was
 * sent. A new link replaces the old one — the old one is expired at Stripe first, so two
 * live links can never both be paid.
 */
export interface IBookingPaymentLink {
  sessionId: string;
  url: string;
  /** Dollars the link asks for — the booking's fare when it was sent. */
  amount: number;
  sentAt: Date;
  expiresAt: Date;
  sentBy: Types.ObjectId;
  /** Whether the email actually went out (the operator can still copy the link). */
  emailed: boolean;
}

/**
 * What was last written to the shared calendar for this booking. `hash` is of the event as
 * written, so a sync that would write the same thing again is skipped; `removed` is set when
 * the event was taken off the calendar because the booking was cancelled.
 */
export interface IBookingCalendar {
  eventId: string;
  hash: string;
  syncedAt: Date;
  link?: string;
  removed?: boolean;
}

/**
 * Where a booking sits in a multi-leg journey that was paid for together (a round trip, or
 * a multi-city itinerary). Informational: every leg is still its own booking, cancelled,
 * amended and refunded on its own. Set by checkout, never by a client.
 */
export interface IBookingJourney {
  /** 0-based position, in pickup order. */
  index: number;
  /** How many legs the journey has. */
  count: number;
}

/**
 * What the fare was made of when it was quoted, kept so an invoice can itemise it years
 * later. Re-pricing a booking from today's rates would print a different bill than the one
 * the customer agreed to, so the lines are stored, not recomputed.
 */
export interface IFareBreakdown {
  classFare: number;
  primetimeSurcharge: number;
  meetAndGreetFee: number;
  stopCount: number;
  stopFee: number;
  /** Per-mile pricing on a flat transfer: miles driven, miles the flat rate covered, miles beyond, rate, charge. */
  distanceMiles?: number;
  includedMiles?: number;
  extraMiles?: number;
  perMileRate?: number;
  distanceFee?: number;
  /** flat · hourly · multiplier · route · package — how classFare was worked out. */
  pricingModel?: string;
  /** The package's name, when pricingModel is 'package'. */
  packageName?: string;
  /** e.g. "Tacoma ↔ Sea-Tac", when a route price applied. */
  route?: string;
  hours?: number;
  /**
   * The rest of the bill: tip, discount and tax on top of the trip price. All optional
   * because bookings made before these existed have none — they are billed as booked, and
   * re-pricing one keeps it free of tip and tax rather than adding them after the fact.
   */
  subtotal?: number;
  fuelSurchargePct?: number;
  fuelSurcharge?: number;
  gratuityPct?: number;
  gratuity?: number;
  /** 'welcome' (first trip) or 'loyalty' (every Nth trip), when a discount applied. */
  discountKind?: 'welcome' | 'loyalty';
  discount?: number;
  taxPct?: number;
  tax?: number;
}

/**
 * Where a booking came from when it was carried over from the old system. One old trip with
 * several legs becomes one booking per leg, all pointing at the same `tripId`. Kept so the
 * old trip number can still be found, and so the import can be run twice without duplicating
 * anything. Absent on every booking made in this app.
 */
export interface IBookingLegacy {
  tripId: Types.ObjectId;
  /** The old trip number customers were given, e.g. "ABL-1234". */
  tripNo?: string;
  legIndex: number;
  legCount: number;
  /** The old leg status as it was, before it was mapped onto this app's statuses. */
  status?: string;
  rideType?: string;
  /** Old payment fields. A payment that did not go through Stripe has no `payment` here. */
  paymentStatus?: string;
  paymentMethod?: string;
  bookingSource?: string;
  /** The old record was an unfinished stage long after its pickup; it was closed on import. */
  closedOnImport?: boolean;
  importedAt: Date;
}

export interface IBooking {
  customerId: Types.ObjectId;
  pickup: GeoPoint;
  drop: GeoPoint;
  vehicleClass: string;
  /**
   * How many people are travelling. Optional because bookings predate the field.
   * Distinct from the vehicle class's seat count: the class is what was booked, this is
   * what the party actually is, and operations needs both to spot a mismatch.
   */
  passengers?: number;
  tripType: TripType;
  /**
   * Set when this is a package booking (a point-to-point booking whose price is the package's
   * fixed price for the chosen vehicle). `packageName` is kept as booked, so renaming or
   * deleting the package later never changes what an old booking says.
   */
  packageId?: Types.ObjectId;
  packageName?: string;
  flightDetails?: { flightNumber: string; scheduledArrival?: Date };
  /** Hours booked, hourly charters only — kept so a re-price uses the real duration. */
  hours?: number;
  /** Meet and Greet add-on (config/services.ts MEET_AND_GREET_FEE). */
  meetAndGreet?: boolean;
  /** Child car seats requested. Free. */
  carSeats?: number;
  /** The same seats by age (infant 0-1, toddler 1-3, booster 3-6). `carSeats` is their total. */
  carSeatTypes?: { infant: number; toddler: number; booster: number };
  /** In the customer's words: what they need that the other fields do not cover. */
  description?: string;
  /** Set when the pickup is a cruise terminal. */
  cruisePort?: CruisePort;
  cruiseShip?: string;
  /**
   * Booked by an account created through "Continue as guest". Set by the server from the
   * customer's own record at creation — never taken from the request — and kept on the
   * booking so the tag survives the account later being claimed with a password.
   */
  isGuest?: boolean;
  /**
   * Who made the booking. `admin` = an operator booked it for the customer from the console
   * (unpaid until the fare is collected); anything else, including every booking that
   * predates the field, was made by the customer. `createdBy` is that operator.
   */
  source?: 'customer' | 'admin';
  createdBy?: Types.ObjectId;
  paymentLink?: IBookingPaymentLink;
  /** Present only on bookings carried over from the old system. */
  legacy?: IBookingLegacy;
  /** Where this booking stands on the operations calendar (modules/calendar). */
  calendar?: IBookingCalendar;
  /** Set on every leg of a journey paid for as one (round trip, multi-city). */
  journey?: IBookingJourney;
  /** Intermediate stops between pickup and drop-off, in order. Transfers only. */
  stops?: GeoPoint[];
  /** The agreement revision the customer had signed when they booked, for the record. */
  agreementVersion?: string;
  agreementSignedAt?: Date;
  /** What the trip is for (config/services.ts TRIP_OCCASIONS), and detail for "Other". */
  occasion?: string;
  occasionDetails?: string;
  /** Luggage, counted so dispatch can check it against the vehicle's capacity. */
  carryOnBags?: number;
  checkedBags?: number;
  /** Set when the booker is not the passenger: who to look for and how to reach them. */
  passengerName?: string;
  passengerPhone?: string;
  /**
   * What the chauffeur and dispatcher need to know — Meet and Greet, car seats, cruise
   * meeting point. Derived by buildServiceNotes() and refreshed on every change.
   */
  serviceNotes?: string[];
  /** Card payment taken at booking — see IBookingPayment. */
  payment?: IBookingPayment;
  favoriteDriverId?: Types.ObjectId;
  status: BookingStatus;
  /** Every change made after the booking was created, oldest first. */
  amendments: IBookingAmendment[];
  /** Set when status becomes 'cancelled'. Absent on every other status. */
  cancellation?: IBookingCancellation;
  /**
   * Wallet credit the passenger asked to put towards this ride, chosen at booking.
   *
   * An intention, not a movement: credit is spent against a Trip, and no Trip exists
   * until a chauffeur accepts. Recording the choice here means the money is only taken
   * when there is something to take it against — so a booking that is cancelled, or
   * never claimed, never touches the balance and needs no refund to unwind.
   *
   * Clamped at the moment it is applied, because the balance and the fare can both have
   * moved since: the passenger may have spent the credit elsewhere in the meantime.
   */
  walletCreditRequested?: number;
  /** Stored as UTC; always interpreted/displayed in America/Los_Angeles (spec §8 rule 1). */
  scheduledAt: Date;
  /**
   * The pickup time this booking was ORIGINALLY made for.
   *
   * The cancellation fee is a function of how much notice the operator gets, and it read
   * `scheduledAt` — which a customer can move. Pushing the pickup a week out therefore
   * reset the fee clock, so a late cancellation could be made free by rescheduling first.
   * Set once at creation and never amended, so the policy always measures notice against
   * the commitment that was actually made.
   */
  originalScheduledAt?: Date;
  city?: string;
  estimatedFare?: number;
  /** The make-up of `estimatedFare`. Absent on bookings made before it was recorded. */
  fareBreakdown?: IFareBreakdown;
  createdAt: Date;
  updatedAt: Date;
}

export type BookingDocument = HydratedDocument<IBooking>;

const geoPointSchema = new Schema<GeoPoint>(
  {
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },
    address: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const amendmentSchema = new Schema<IBookingAmendment>(
  {
    field: {
      type: String,
      enum: AMENDMENT_FIELDS,
      required: true,
    },
    from: { type: String, required: true },
    to: { type: String, required: true },
    by: { type: String, enum: ['customer', 'admin'], required: true },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const cancellationSchema = new Schema<IBookingCancellation>(
  {
    reason: { type: String, trim: true, maxlength: 300 },
    by: { type: String, enum: ['customer', 'driver', 'admin'], required: true },
    byUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String, trim: true },
    rejected: { type: Boolean },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const bookingSchema = new Schema<IBooking>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    pickup: { type: geoPointSchema, required: true },
    drop: { type: geoPointSchema, required: true },
    vehicleClass: { type: String, required: true, trim: true },
    passengers: { type: Number, min: 1, max: 60 },
    amendments: { type: [amendmentSchema], default: [] },
    cancellation: { type: cancellationSchema, default: undefined },
    walletCreditRequested: { type: Number, min: 0 },
    tripType: { type: String, enum: TRIP_TYPES, required: true, index: true },
    packageId: { type: Schema.Types.ObjectId, ref: 'Package', index: true },
    packageName: { type: String, trim: true, maxlength: 120 },
    flightDetails: {
      type: new Schema(
        {
          flightNumber: { type: String, required: true, trim: true, uppercase: true },
          scheduledArrival: { type: Date },
        },
        { _id: false },
      ),
      required: false,
    },
    hours: { type: Number, min: 1, max: 24 },
    meetAndGreet: { type: Boolean, default: false },
    carSeats: { type: Number, min: 0, max: MAX_CAR_SEATS, default: 0 },
    carSeatTypes: {
      type: new Schema(
        {
          infant: { type: Number, min: 0, max: MAX_CAR_SEATS, default: 0 },
          toddler: { type: Number, min: 0, max: MAX_CAR_SEATS, default: 0 },
          booster: { type: Number, min: 0, max: MAX_CAR_SEATS, default: 0 },
        },
        { _id: false },
      ),
      default: undefined,
    },
    description: { type: String, trim: true, maxlength: 500 },
    cruisePort: { type: String, enum: CRUISE_PORT_KEYS },
    cruiseShip: { type: String, trim: true, maxlength: 80 },
    isGuest: { type: Boolean, default: false },
    legacy: {
      type: new Schema<IBookingLegacy>(
        {
          tripId: { type: Schema.Types.ObjectId, required: true },
          tripNo: { type: String },
          legIndex: { type: Number, required: true, min: 0 },
          legCount: { type: Number, required: true, min: 1 },
          status: { type: String },
          rideType: { type: String },
          paymentStatus: { type: String },
          paymentMethod: { type: String },
          bookingSource: { type: String },
          closedOnImport: { type: Boolean },
          importedAt: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: undefined,
    },
    source: { type: String, enum: ['customer', 'admin'] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    calendar: {
      type: new Schema<IBookingCalendar>(
        {
          eventId: { type: String, required: true },
          hash: { type: String, required: true },
          syncedAt: { type: Date, required: true },
          link: { type: String },
          removed: { type: Boolean },
        },
        { _id: false },
      ),
      default: undefined,
    },
    paymentLink: {
      type: new Schema<IBookingPaymentLink>(
        {
          sessionId: { type: String, required: true },
          url: { type: String, required: true },
          amount: { type: Number, required: true, min: 0 },
          sentAt: { type: Date, required: true },
          expiresAt: { type: Date, required: true },
          sentBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          emailed: { type: Boolean, default: false },
        },
        { _id: false },
      ),
      default: undefined,
    },
    journey: {
      type: new Schema<IBookingJourney>(
        {
          index: { type: Number, required: true, min: 0, max: MAX_JOURNEY_LEGS - 1 },
          count: { type: Number, required: true, min: 2, max: MAX_JOURNEY_LEGS },
        },
        { _id: false },
      ),
      default: undefined,
    },
    stops: { type: [geoPointSchema], default: undefined },
    agreementVersion: { type: String },
    agreementSignedAt: { type: Date },
    occasion: { type: String, trim: true, maxlength: 60 },
    occasionDetails: { type: String, trim: true, maxlength: 200 },
    carryOnBags: { type: Number, min: 0, max: 60 },
    checkedBags: { type: Number, min: 0, max: 60 },
    passengerName: { type: String, trim: true, maxlength: 120 },
    passengerPhone: { type: String, trim: true, maxlength: 30 },
    serviceNotes: { type: [String], default: [] },
    payment: {
      type: new Schema<IBookingPayment>(
        {
          provider: { type: String, enum: ['stripe'], required: true },
          intentId: { type: String, required: true },
          leg: { type: Number, required: true, min: 0, max: MAX_JOURNEY_LEGS - 1 },
          amount: { type: Number, required: true, min: 0 },
          currency: { type: String, required: true },
          status: { type: String, enum: ['paid', 'partially_refunded', 'refunded'], required: true },
          brand: { type: String },
          last4: { type: String },
          refundedAmount: { type: Number, default: 0, min: 0 },
          refundIds: { type: [String], default: [] },
          paidAt: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: undefined,
    },
    favoriteDriverId: { type: Schema.Types.ObjectId, ref: 'Driver' },
    status: { type: String, enum: BOOKING_STATUSES, default: 'pending', index: true },
    scheduledAt: { type: Date, required: true, index: true },
    originalScheduledAt: { type: Date },
    city: { type: String, lowercase: true, trim: true },
    estimatedFare: { type: Number, min: 0 },
    fareBreakdown: {
      type: new Schema<IFareBreakdown>(
        {
          classFare: { type: Number, required: true, min: 0 },
          primetimeSurcharge: { type: Number, required: true, min: 0 },
          meetAndGreetFee: { type: Number, required: true, min: 0 },
          stopCount: { type: Number, required: true, min: 0 },
          stopFee: { type: Number, required: true, min: 0 },
          distanceMiles: { type: Number, min: 0 },
          includedMiles: { type: Number, min: 0 },
          extraMiles: { type: Number, min: 0 },
          perMileRate: { type: Number, min: 0 },
          distanceFee: { type: Number, min: 0 },
          pricingModel: { type: String },
          packageName: { type: String },
          route: { type: String },
          hours: { type: Number },
          subtotal: { type: Number, min: 0 },
          fuelSurchargePct: { type: Number, min: 0 },
          fuelSurcharge: { type: Number, min: 0 },
          gratuityPct: { type: Number, min: 0 },
          gratuity: { type: Number, min: 0 },
          discountKind: { type: String, enum: ['welcome', 'loyalty'] },
          discount: { type: Number, min: 0 },
          taxPct: { type: Number, min: 0 },
          tax: { type: Number, min: 0 },
        },
        { _id: false },
      ),
      default: undefined,
    },
  },
  { timestamps: true },
);

/**
 * One booking per paid leg. Two checkout completions racing for the same payment (a
 * double click, or the browser and the webhook at once) cannot both create it.
 */
bookingSchema.index(
  { 'payment.intentId': 1, 'payment.leg': 1 },
  { unique: true, partialFilterExpression: { 'payment.intentId': { $exists: true } } },
);

/** One booking per old trip leg: re-running the import can never create a leg twice. */
bookingSchema.index(
  { 'legacy.tripId': 1, 'legacy.legIndex': 1 },
  { unique: true, partialFilterExpression: { 'legacy.tripId': { $exists: true } } },
);

/**
 * The admin lists read newest-first, a page at a time. Without this every page re-sorted the
 * whole collection in memory, which at a few thousand bookings made each page take seconds.
 */
bookingSchema.index({ createdAt: -1 });

export const Booking = model<IBooking>('Booking', bookingSchema);
