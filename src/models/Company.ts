import { Schema, model, Types, type HydratedDocument } from 'mongoose';

export interface ICompany {
  userId: Types.ObjectId;
  driverIds: Types.ObjectId[];
  /** Spec §8: company takes 60% of trip revenue, admin/platform the remaining 40%. */
  revenueSharePct: number;
  createdAt: Date;
  updatedAt: Date;
}

export type CompanyDocument = HydratedDocument<ICompany>;

const companySchema = new Schema<ICompany>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    driverIds: [{ type: Schema.Types.ObjectId, ref: 'Driver', index: true }],
    revenueSharePct: { type: Number, default: 60, min: 0, max: 100 },
  },
  { timestamps: true },
);

export const Company = model<ICompany>('Company', companySchema);
