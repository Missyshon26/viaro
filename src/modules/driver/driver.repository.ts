import { Types } from 'mongoose';
import { Driver, type DriverStatus, type IDriver } from '../../models/Driver';
import { Trip, type TripStatus } from '../../models/Trip';
import { User } from '../../models/User';

/**
 * Data access for the driver module — Controller → Service → **Repository**.
 *
 * Rules for this layer, applied consistently across modules:
 *   1. This is the ONLY file in the module that touches Mongoose.
 *   2. It returns plain objects, never hydrated documents, so callers cannot `.save()`
 *      their way around it and business rules stay in the service.
 *   3. It contains no business logic — no throwing ApiError, no policy decisions.
 *      "Not found" is expressed as `null` and interpreted by the service.
 */
export type DriverRecord = IDriver & { _id: Types.ObjectId };

export async function findByUserId(userId: string): Promise<DriverRecord | null> {
  return Driver.findOne({ userId }).lean<DriverRecord>();
}

export async function findById(driverId: string | Types.ObjectId): Promise<DriverRecord | null> {
  return Driver.findById(driverId).lean<DriverRecord>();
}

export async function create(input: {
  userId: string;
  vehicleClass: string;
}): Promise<DriverRecord> {
  const created = await Driver.create({
    userId: input.userId,
    vehicleClass: input.vehicleClass,
    status: 'offline',
  });
  return created.toObject() as DriverRecord;
}

export async function updateStatus(
  driverId: Types.ObjectId | string,
  status: DriverStatus,
): Promise<DriverRecord | null> {
  return Driver.findByIdAndUpdate(driverId, { $set: { status } }, { new: true }).lean<DriverRecord>();
}

/** Vehicle class and documents move together when a driver (re)applies. */
export async function updateApplication(
  driverId: Types.ObjectId | string,
  input: { vehicleClass: string; documents?: string[] },
): Promise<DriverRecord | null> {
  const update: Record<string, unknown> = {
    $set: { vehicleClass: input.vehicleClass, status: 'offline' as DriverStatus },
  };
  // $addToSet keeps a resubmission from duplicating documents already on file.
  if (input.documents?.length) update.$addToSet = { documents: { $each: input.documents } };

  return Driver.findByIdAndUpdate(driverId, update, { new: true }).lean<DriverRecord>();
}

export async function countTripsByStatus(
  driverId: Types.ObjectId,
  statuses: TripStatus[],
): Promise<number> {
  return Trip.countDocuments({ driverId, status: { $in: statuses } });
}

/* --------------------------------------------------------------------------
 * Cross-collection reads.
 *
 * The driver module needs a little of the User record (account hold state) to decide
 * whether a driver may go online. Kept here rather than reaching for the User model
 * inside the service, so rule 1 above still holds. When users gets its own repository
 * these two delegate to it.
 * -------------------------------------------------------------------------- */

export async function findUserStatus(
  userId: string,
): Promise<{ role: string; status: string } | null> {
  return User.findById(userId).select('role status').lean<{ role: string; status: string }>();
}

export async function setUserStatus(userId: string, status: string): Promise<void> {
  await User.updateOne({ _id: userId }, { $set: { status } });
}
