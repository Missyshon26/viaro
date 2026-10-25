import { Schema, model, Types, type HydratedDocument } from 'mongoose';

export const SUBSCRIPTION_STATUSES = ['active', 'cancelled', 'expired'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface ISubscription {
  userId: Types.ObjectId;
  plan: string;
  status: SubscriptionStatus;
  /** Monthly price — drives the admin subscription-revenue report (spec §4.11). */
  price: number;
  startDate: Date;
  renewalDate: Date;
  /** Gateway reference for the charge that activated this subscription. */
  paymentReference?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SubscriptionDocument = HydratedDocument<ISubscription>;

const subscriptionSchema = new Schema<ISubscription>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    plan: { type: String, required: true, trim: true },
    status: { type: String, enum: SUBSCRIPTION_STATUSES, default: 'active', index: true },
    price: { type: Number, required: true, min: 0 },
    startDate: { type: Date, required: true },
    renewalDate: { type: Date, required: true },
    paymentReference: { type: String, default: null },
  },
  { timestamps: true },
);

// A customer may hold only one active subscription at a time.
subscriptionSchema.index(
  { userId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
);

export const Subscription = model<ISubscription>('Subscription', subscriptionSchema);
