import { Schema, model, Types, type HydratedDocument } from 'mongoose';
import { DRIVER_PAYOUT_MODES, type DriverPayoutMode } from './Driver';

/**
 * Business settings operations change from the admin console, stored once (a single
 * document, key 'platform') rather than in .env — changing them needs no redeploy.
 *
 *   driverPayout*       what a chauffeur with no rate of their own earns per trip; a
 *                       rate set on the chauffeur (Driver.payout) always wins
 *   companyRevenuePct   a fleet company's share of each fare by default (the platform
 *                       keeps the rest); a company's own Company.revenueSharePct wins
 *   withdrawalFeePct    fee on a chauffeur/company withdrawal to a bank
 *   supportInboxEmail   where quote requests, contact messages and support cases go
 *   taxPct              sales tax added to every fare (on the fare plus gratuity, after any discount)
 *   welcomeDiscount     dollars off a customer's very first trip
 *   loyaltyDiscount     dollars off every Nth trip after that (see loyaltyEveryNth)
 *   loyaltyEveryNth     which trips earn the loyalty discount: every 4th, 8th, 12th… by default
 *
 * Every field is optional in storage: an unset one falls back to the value in
 * modules/admin/settings.service.ts (DEFAULT_SETTINGS).
 */
export interface IPlatformSettings {
  key: 'platform';
  driverPayoutMode?: DriverPayoutMode;
  driverPayoutValue?: number;
  companyRevenuePct?: number;
  withdrawalFeePct?: number;
  supportInboxEmail?: string;
  taxPct?: number;
  welcomeDiscount?: number;
  loyaltyDiscount?: number;
  loyaltyEveryNth?: number;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type PlatformSettingsDocument = HydratedDocument<IPlatformSettings>;

const platformSettingsSchema = new Schema<IPlatformSettings>(
  {
    key: { type: String, enum: ['platform'], default: 'platform', unique: true },
    driverPayoutMode: { type: String, enum: DRIVER_PAYOUT_MODES },
    driverPayoutValue: { type: Number, min: 0 },
    companyRevenuePct: { type: Number, min: 0, max: 100 },
    withdrawalFeePct: { type: Number, min: 0, max: 100 },
    supportInboxEmail: { type: String, trim: true, lowercase: true },
    taxPct: { type: Number, min: 0, max: 30 },
    welcomeDiscount: { type: Number, min: 0, max: 1000 },
    loyaltyDiscount: { type: Number, min: 0, max: 1000 },
    loyaltyEveryNth: { type: Number, min: 2, max: 50 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const PlatformSettings = model<IPlatformSettings>('PlatformSettings', platformSettingsSchema);
