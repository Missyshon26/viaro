import { PlatformSettings } from '../../models/PlatformSettings';
import type { DriverPayoutMode } from '../../models/Driver';

/**
 * Business settings edited from the admin console (Settings panel on Drivers).
 *
 * These used to be .env values — DRIVER_PAYOUT_MODE/VALUE, COMPANY_REVENUE_PCT,
 * ADMIN_REVENUE_PCT, WITHDRAWAL_FEE_PCT, SUPPORT_INBOX_EMAIL — so every change meant
 * editing the server and restarting. They live in the database now. DEFAULT_SETTINGS are
 * the values used for anything an admin has not saved yet.
 */
export const DEFAULT_SETTINGS: Settings = {
  driverPayout: { mode: 'percentage', value: 70 },
  companyRevenuePct: 60,
  withdrawalFeePct: 10,
  supportInboxEmail: 'reservations@viaro.io',
};

/** Kept for existing callers: the default payout when a chauffeur has none. */
export const INITIAL_PAYOUT = DEFAULT_SETTINGS.driverPayout;

export interface PayoutDefaults {
  mode: DriverPayoutMode;
  value: number;
}

export interface Settings {
  driverPayout: PayoutDefaults;
  /** A company's default share of each fare; the platform keeps 100 minus this. */
  companyRevenuePct: number;
  /** Charged on withdrawals to a bank only — never on refunds or ride credit. */
  withdrawalFeePct: number;
  /** Receives quote requests, contact messages and support-case alerts. */
  supportInboxEmail: string;
}

/**
 * Settlement and withdrawals read these on every request; a short in-process cache
 * avoids the round trip without letting an edit go unnoticed for long (saving clears it).
 */
const CACHE_MS = 30_000;
let cache: { at: number; value: Settings; updatedAt: Date | null } | null = null;

async function load() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;
  const doc = await PlatformSettings.findOne({ key: 'platform' }).lean();
  const value: Settings = {
    driverPayout: {
      mode: doc?.driverPayoutMode ?? DEFAULT_SETTINGS.driverPayout.mode,
      value: doc?.driverPayoutValue ?? DEFAULT_SETTINGS.driverPayout.value,
    },
    companyRevenuePct: doc?.companyRevenuePct ?? DEFAULT_SETTINGS.companyRevenuePct,
    withdrawalFeePct: doc?.withdrawalFeePct ?? DEFAULT_SETTINGS.withdrawalFeePct,
    supportInboxEmail: doc?.supportInboxEmail || DEFAULT_SETTINGS.supportInboxEmail,
  };
  cache = { at: Date.now(), value, updatedAt: doc?.updatedAt ?? null };
  return cache;
}

export async function getSettingsValues(): Promise<Settings> {
  return (await load()).value;
}

export async function getPayoutDefaults(): Promise<PayoutDefaults> {
  return (await load()).value.driverPayout;
}

/** For the admin console. */
export async function getSettings() {
  const { value, updatedAt } = await load();
  return {
    ...value,
    // Derived, shown next to the company share so the split is never ambiguous.
    platformRevenuePct: 100 - value.companyRevenuePct,
    updatedAt,
  };
}

/** Only what the public site needs — no business terms. */
export async function getPublicSettings() {
  const { value } = await load();
  return { supportInboxEmail: value.supportInboxEmail };
}

export interface SettingsUpdate {
  driverPayout?: PayoutDefaults;
  companyRevenuePct?: number;
  withdrawalFeePct?: number;
  supportInboxEmail?: string;
}

export async function updateSettings(adminId: string, input: SettingsUpdate) {
  const $set: Record<string, unknown> = { updatedBy: adminId };
  if (input.driverPayout) {
    $set.driverPayoutMode = input.driverPayout.mode;
    $set.driverPayoutValue = input.driverPayout.value;
  }
  if (input.companyRevenuePct !== undefined) $set.companyRevenuePct = input.companyRevenuePct;
  if (input.withdrawalFeePct !== undefined) $set.withdrawalFeePct = input.withdrawalFeePct;
  if (input.supportInboxEmail !== undefined) $set.supportInboxEmail = input.supportInboxEmail;

  await PlatformSettings.findOneAndUpdate(
    { key: 'platform' },
    { $set, $setOnInsert: { key: 'platform' } },
    { upsert: true, new: true },
  );
  cache = null;
  return getSettings();
}

/** Back-compat wrapper for the payout-only route. */
export async function updatePayoutDefaults(adminId: string, input: PayoutDefaults) {
  return updateSettings(adminId, { driverPayout: input });
}
