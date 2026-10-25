import { Schema, model, Types, type HydratedDocument } from 'mongoose';

export const TRIP_STATUSES = ['accepted', 'started', 'completed', 'cancelled'] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export interface ITrip {
  bookingId: Types.ObjectId;
  driverId: Types.ObjectId;
  status: TripStatus;
  fareAmount: number;
  /**
   * The part of `fareAmount` that is sales tax. The customer owes it, but it is not ours to
   * share out: settlement splits `fareAmount - taxAmount` between owner, platform and driver.
   */
  taxAmount?: number;
  /** The passenger never appeared. The trip is closed and still charged. */
  noShow?: boolean;
  timestamps: {
    requested?: Date;
    assigned?: Date;
    accepted?: Date;
    /** Operations confirmed the trip. Stage only: status stays 'accepted'. */
    confirmed?: Date;
    /** The chauffeur is on the way to the pickup. Stage only: status stays 'accepted'. */
    enroute?: Date;
    /** The chauffeur is at the pickup. Stage only: status stays 'accepted'. */
    arrived?: Date;
    started?: Date;
    completed?: Date;
  };
  penaltyApplied: boolean;
  cancellation?: {
    reason?: string;
    refundPct?: number;
    refundedAt?: Date;
    /**
     * 'admin' is here because ops can end a trip from the console. Without it an
     * operator-cancelled trip was indistinguishable from one the passenger dropped.
     */
    cancelledBy?: 'customer' | 'driver' | 'admin';
    /** The individual, not just the role. Name is a snapshot — see IBookingCancellation. */
    cancelledByUserId?: Types.ObjectId;
    cancelledByName?: string;
  };
  /**
   * Latest driver position. Design choice: stored on the Trip rather than in a separate
   * collection — one document write per ping, and it gives a REST fallback for clients
   * that miss socket frames. The high-frequency fan-out still happens over the socket;
   * this is only the last-known snapshot.
   */
  lastLocation?: { lat: number; lng: number; updatedAt: Date };
  /** Wallet credit applied by the customer toward this trip (spec §4.7 use-credit). */
  creditApplied: number;
  settled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type TripDocument = HydratedDocument<ITrip>;

const tripSchema = new Schema<ITrip>(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true, index: true },
    status: { type: String, enum: TRIP_STATUSES, required: true, index: true },
    fareAmount: { type: Number, required: true, min: 0 },
    taxAmount: { type: Number, min: 0 },
    noShow: { type: Boolean },
    timestamps: {
      requested: { type: Date },
      assigned: { type: Date },
      accepted: { type: Date },
      confirmed: { type: Date },
      enroute: { type: Date },
      arrived: { type: Date },
      started: { type: Date },
      completed: { type: Date },
    },
    penaltyApplied: { type: Boolean, default: false, index: true },
    cancellation: {
      reason: { type: String, trim: true, maxlength: 300 },
      refundPct: { type: Number, min: 0, max: 100 },
      refundedAt: { type: Date },
      cancelledBy: { type: String, enum: ['customer', 'driver', 'admin'] },
      cancelledByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
      cancelledByName: { type: String, trim: true },
    },
    lastLocation: {
      lat: { type: Number },
      lng: { type: Number },
      updatedAt: { type: Date },
    },
    creditApplied: { type: Number, default: 0, min: 0 },
    // Guards against double-crediting wallets if /complete is retried.
    settled: { type: Boolean, default: false },
  },
  { timestamps: true },
);

tripSchema.index({ status: 1, 'timestamps.completed': -1 });

export const Trip = model<ITrip>('Trip', tripSchema);
