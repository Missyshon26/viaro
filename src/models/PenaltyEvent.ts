import { Schema, model, Types, type HydratedDocument } from 'mongoose';

/**
 * Spec §8 rule 5: when a driver does not respond to a ride alert within the 2-minute
 * window, a penalty is recorded and must be visible on the Admin and Company dashboards.
 *
 * This lives in its own collection because the penalty fires while the booking is still
 * unclaimed — no Trip exists yet, so there is nowhere on Trip to record it. It stores the
 * booking/driver pairing that was offered and ignored, which is exactly what the reports
 * step needs to query.
 */
export interface IPenaltyEvent {
  bookingId: Types.ObjectId;
  driverId: Types.ObjectId;
  reason: string;
  /** Minutes the driver's next ride alerts are delayed by, per spec §8 rule 5. */
  alertDelayMinutes: number;
  createdAt: Date;
  updatedAt: Date;
}

export type PenaltyEventDocument = HydratedDocument<IPenaltyEvent>;

const penaltyEventSchema = new Schema<IPenaltyEvent>(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true, index: true },
    reason: { type: String, required: true },
    alertDelayMinutes: { type: Number, default: 2 },
  },
  { timestamps: true },
);

// One penalty per driver per booking, however many times the job is retried.
penaltyEventSchema.index({ bookingId: 1, driverId: 1 }, { unique: true });

export const PenaltyEvent = model<IPenaltyEvent>('PenaltyEvent', penaltyEventSchema);
