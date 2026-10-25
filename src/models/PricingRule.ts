import { Schema, model, type HydratedDocument } from 'mongoose';

export interface IPricingRule {
  city: string;
  baseFare: number;
  peakMultiplier: number;
  createdAt: Date;
  updatedAt: Date;
}

export type PricingRuleDocument = HydratedDocument<IPricingRule>;

const pricingRuleSchema = new Schema<IPricingRule>(
  {
    // Stored lowercase so lookups are case-insensitive without a collation index.
    city: { type: String, required: true, unique: true, lowercase: true, trim: true },
    baseFare: { type: Number, required: true, min: 0 },
    peakMultiplier: { type: Number, required: true, min: 1 },
  },
  { timestamps: true },
);

export const PricingRule = model<IPricingRule>('PricingRule', pricingRuleSchema);
