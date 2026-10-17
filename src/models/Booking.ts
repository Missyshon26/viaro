import { Schema, model, Types, type HydratedDocument } from 'mongoose';
import { CRUISE_PORT_KEYS, MAX_CAR_SEATS, type CruisePort } from '../config/services';

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
export interface IBookingAmendment {
  field: 'pickup' | 'drop' | 'vehicleClass' | 'scheduledAt';
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
  at: Date;
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
  flightDetails?: { flightNumber: string; scheduledArrival?: Date };
  /** Hours booked, hourly charters only — kept so a re-price uses the real duration. */
  hours?: number;
  /** Meet and Greet add-on (config/services.ts MEET_AND_GREET_FEE). */
  meetAndGreet?: boolean;
  /** Child car seats requested. Free. */
  carSeats?: number;
  /** Set when the pickup is a cruise terminal. */
  cruisePort?: CruisePort;
  cruiseShip?: string;
  /**
   * What the chauffeur and dispatcher need to know — Meet and Greet, car seats, cruise
   * meeting point. Derived by buildServiceNotes() and refreshed on every change.
   */
  serviceNotes?: string[];
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
      enum: ['pickup', 'drop', 'vehicleClass', 'scheduledAt'],
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
    cruisePort: { type: String, enum: CRUISE_PORT_KEYS },
    cruiseShip: { type: String, trim: true, maxlength: 80 },
    serviceNotes: { type: [String], default: [] },
    favoriteDriverId: { type: Schema.Types.ObjectId, ref: 'Driver' },
    status: { type: String, enum: BOOKING_STATUSES, default: 'pending', index: true },
    scheduledAt: { type: Date, required: true, index: true },
    originalScheduledAt: { type: Date },
    city: { type: String, lowercase: true, trim: true },
    estimatedFare: { type: Number, min: 0 },
  },
  { timestamps: true },
);

export const Booking = model<IBooking>('Booking', bookingSchema);
