import { Schema, model, Types, type HydratedDocument } from 'mongoose';

export interface IRating {
  tripId: Types.ObjectId;
  customerId: Types.ObjectId;
  driverId: Types.ObjectId;
  score: number;
  comment?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type RatingDocument = HydratedDocument<IRating>;

const ratingSchema = new Schema<IRating>(
  {
    // One rating per trip — a second POST /trips/:id/rate is rejected by this index.
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', required: true, unique: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true, index: true },
    score: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true },
);

export const Rating = model<IRating>('Rating', ratingSchema);
