import { Types } from 'mongoose';
import { Company } from '../models/Company';
import { Driver } from '../models/Driver';
import { ApiError } from '../utils/ApiError';

/**
 * Company roster scoping, in one place.
 *
 * A company's authority is exactly the set of drivers on its own roster
 * (`Company.driverIds`) — that is the single source of truth, and admin.service.ts
 * already scoped the driver-list and driver-edit endpoints against it correctly.
 *
 * Every other company-facing read was re-deriving that scope by hand or, worse, not
 * deriving it at all: `listTripsForUser` had branches for driver and customer but none
 * for company, so a company token fell through to an unfiltered query and read every
 * trip on the platform. The live-tracking socket had the same hole.
 *
 * A rule enforced in three hand-written copies is a rule that gets forgotten on the
 * fourth endpoint, so the lookup lives here and every company-scoped query calls it.
 */

/** The driver _ids on this company's roster. Throws if the caller has no company profile. */
export async function companyDriverIds(companyUserId: string): Promise<Types.ObjectId[]> {
  const company = await Company.findOne({ userId: companyUserId }).select('driverIds').lean();
  if (!company) throw ApiError.notFound('Company profile not found');
  return (company.driverIds ?? []) as Types.ObjectId[];
}

/**
 * Whether a given driver sits on this company's roster.
 *
 * Used by the per-resource checks (a single trip, a tracking room) where loading the
 * whole roster to test one membership would be wasteful.
 */
export async function companyOwnsDriver(
  companyUserId: string,
  driverId: Types.ObjectId | string | null | undefined,
): Promise<boolean> {
  if (!driverId) return false;
  if (!Types.ObjectId.isValid(String(driverId))) return false;
  return Boolean(
    await Company.exists({ userId: companyUserId, driverIds: new Types.ObjectId(String(driverId)) }),
  );
}

/**
 * Whether this driver is already claimed by some company.
 *
 * Onboarding an existing driver must not silently move them between rosters: their payout
 * terms are set by whoever owns them, so a second company claiming them would take over
 * their pay. Returns the owning company's id when there is one.
 */
export async function driverRosterOwner(
  driverId: Types.ObjectId | string,
): Promise<Types.ObjectId | null> {
  const owner = await Company.findOne({ driverIds: driverId }).select('_id').lean();
  return owner ? (owner._id as Types.ObjectId) : null;
}

/** Resolves the Driver._id for a driver user, or throws. */
export async function driverIdForUser(userId: string): Promise<Types.ObjectId> {
  const driver = await Driver.findOne({ userId }).select('_id').lean();
  if (!driver) throw ApiError.notFound('Driver profile not found');
  return driver._id as Types.ObjectId;
}
