import { Schema, model, Types, type HydratedDocument } from 'mongoose';

/**
 * Customer screen 12 "Payment" — saved cards.
 *
 * ⚠ Card numbers are NEVER stored here. Only the gateway's token and the display
 * details it hands back (brand, last four, expiry). Storing a PAN would drag this
 * service into PCI-DSS scope; tokenising at the gateway keeps it out.
 */
export interface IPaymentMethod {
  userId: Types.ObjectId;
  /** Gateway token, e.g. a Stripe payment_method id. */
  gatewayToken: string;
  provider: string;
  brand?: string;
  last4?: string;
  expMonth?: number;
  expYear?: number;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type PaymentMethodDocument = HydratedDocument<IPaymentMethod>;

const paymentMethodSchema = new Schema<IPaymentMethod>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    gatewayToken: { type: String, required: true },
    provider: { type: String, required: true },
    brand: { type: String },
    last4: { type: String, maxlength: 4 },
    expMonth: { type: Number, min: 1, max: 12 },
    expYear: { type: Number, min: 2024 },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// The same card cannot be saved twice for one user.
paymentMethodSchema.index({ userId: 1, gatewayToken: 1 }, { unique: true });

export const PaymentMethod = model<IPaymentMethod>('PaymentMethod', paymentMethodSchema);
