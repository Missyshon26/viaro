import { ApiError } from '../../utils/ApiError';
import { checklist, expiredDocuments } from './driver.documents';
import {
  adjustRate,
  ratingAdjustment,
  RATING_PAY_ENABLED,
  RATING_PAY_MIN_RATINGS,
  RATING_PAY_TIERS,
} from '../wallet/ratingPay';
import { getPayoutDefaults } from '../admin/settings.service';
import { logger } from '../../utils/logger';
import * as dispatchService from '../dispatch/dispatch.service';
import * as repo from './driver.repository';
import type { ApplyInput, SetStatusInput } from './driver.validation';

/**
 * Driver module — business rules only.
 *
 * No Mongoose in this file: every read and write goes through driver.repository.
 * That keeps the rules below readable as rules, and makes them testable with a fake
 * repository instead of a live database.
 */
async function requireOwnDriver(userId: string) {
  const driver = await repo.findByUserId(userId);
  if (!driver) throw ApiError.notFound('Driver profile not found');
  return driver;
}

/**
 * The Online/Offline toggle on the driver Dashboard (desktop 14) and Drive screen
 * (driver 07).
 *
 * Going online is what puts a driver into the Redis GEO set dispatch searches, so this
 * is the switch that makes them reachable at all.
 */
export async function setOwnStatus(userId: string, input: SetStatusInput) {
  const driver = await requireOwnDriver(userId);

  // A driver mid-trip must not vanish from the customer's view.
  if (driver.status === 'busy') {
    throw ApiError.conflict('Finish or cancel your current trip before changing status');
  }

  const account = await repo.findUserStatus(userId);
  if (input.status === 'available' && account?.status === 'pending_documents') {
    throw ApiError.forbidden('Upload your documents before going online');
  }

  // "Dispatch stops the day a document lapses" — an expired licence, COI or inspection
  // keeps a chauffeur offline until the renewal is uploaded (driver.documents.ts).
  if (input.status === 'available') {
    const lapsed = expiredDocuments(driver);
    if (lapsed.length > 0) {
      throw ApiError.forbidden(
        `Upload a current ${lapsed.join(', ')} before going online — the one on file has expired`,
      );
    }
  }

  const updated = await repo.updateStatus(driver._id, input.status);

  if (input.status === 'available' && input.lat !== undefined && input.lng !== undefined) {
    await dispatchService.upsertDriverLocation(String(driver._id), input.lat, input.lng);
  } else if (input.status === 'offline') {
    await dispatchService.removeDriverLocation(String(driver._id));
  }

  logger.info(`Driver ${String(driver._id)} is now ${input.status}`);
  return updated;
}

export async function getOwnProfile(userId: string) {
  const driver = await requireOwnDriver(userId);

  const [activeTrips, completedTrips] = await Promise.all([
    repo.countTripsByStatus(driver._id, ['accepted', 'started']),
    repo.countTripsByStatus(driver._id, ['completed']),
  ]);

  // What they are paid per trip right now, and how their rating moves it.
  const defaults = await getPayoutDefaults();
  const mode = driver.payout?.mode ?? defaults.mode;
  const baseValue = driver.payout?.value ?? defaults.value;
  const rating = ratingAdjustment(driver.rating, driver.ratingCount);
  const pay = {
    mode,
    baseValue,
    effectiveValue: adjustRate(mode, baseValue, rating.adjustmentPct),
    ...rating,
    minRatings: RATING_PAY_MIN_RATINGS,
    enabled: RATING_PAY_ENABLED,
    tiers: RATING_PAY_TIERS,
  };

  return { driver, stats: { activeTrips, completedTrips }, pay };
}

/**
 * Driver application (driver screens 02 Apply / 04 Verification pending).
 *
 * Registering as a driver already creates the profile; this lets an existing account
 * apply, or an applicant resubmit after a rejection, and holds the account until
 * documents are on file.
 */
export async function apply(userId: string, input: ApplyInput) {
  const account = await repo.findUserStatus(userId);
  if (!account) throw ApiError.notFound('User not found');
  if (account.role !== 'driver') {
    throw ApiError.forbidden('Only driver accounts can submit an application');
  }

  const existing = await repo.findByUserId(userId);
  const driverId = existing
    ? existing._id
    : (await repo.create({ userId, vehicleClass: input.vehicleClass }))._id;

  const driver = await repo.updateApplication(driverId, {
    vehicleClass: input.vehicleClass,
    documents: input.documents,
  });

  /*
   * Documents are reviewed before the driver can take work. A chauffeur who has chosen
   * independent/company must have the whole checklist on file (driver.documents.ts);
   * one from before typed documents existed keeps the old "anything on file" rule so
   * their account is not locked by a vehicle-class change.
   */
  const accountStatus =
    driver && (driver.operatorType ? checklist(driver).complete : driver.documents.length > 0)
      ? 'active'
      : 'pending_documents';
  await repo.setUserStatus(userId, accountStatus);

  return {
    driver,
    applicationStatus: accountStatus === 'active' ? 'approved' : 'awaiting_documents',
  };
}
