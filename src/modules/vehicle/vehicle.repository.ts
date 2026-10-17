import { Types } from 'mongoose';
import { VehicleClass, type IVehicleClass } from '../../models/VehicleClass';

/**
 * Data access for the vehicle-class module — Controller → Service → **Repository**.
 *
 *   1. This is the ONLY file in the module that touches Mongoose.
 *   2. It returns plain objects, never hydrated documents.
 *   3. It contains no business logic — "not found" is `null`, for the service to read.
 */
export type VehicleClassRecord = IVehicleClass & { _id: Types.ObjectId };

const ORDER = { sortOrder: 1, seats: 1 } as const;

export async function findAll(includeInactive = false): Promise<VehicleClassRecord[]> {
  const filter = includeInactive ? {} : { active: true };
  return VehicleClass.find(filter).sort(ORDER).lean<VehicleClassRecord[]>();
}

export async function findById(id: string): Promise<VehicleClassRecord | null> {
  return VehicleClass.findById(id).lean<VehicleClassRecord>();
}

export async function findByValue(value: string): Promise<VehicleClassRecord | null> {
  return VehicleClass.findOne({ value: value.toLowerCase() }).lean<VehicleClassRecord>();
}

export async function create(input: Partial<IVehicleClass>): Promise<VehicleClassRecord> {
  const created = await VehicleClass.create(input);
  return created.toObject() as VehicleClassRecord;
}

export async function update(
  id: string,
  input: Partial<IVehicleClass>,
): Promise<VehicleClassRecord | null> {
  return VehicleClass.findByIdAndUpdate(id, { $set: input }, { new: true })
    .lean<VehicleClassRecord>();
}

export async function remove(id: string): Promise<VehicleClassRecord | null> {
  return VehicleClass.findByIdAndDelete(id).lean<VehicleClassRecord>();
}

export async function count(): Promise<number> {
  return VehicleClass.countDocuments();
}

/** Used by the seed: create only what is missing, never overwrite operations' edits. */
export async function createIfAbsent(input: Partial<IVehicleClass>): Promise<boolean> {
  const result = await VehicleClass.updateOne(
    { value: input.value },
    { $setOnInsert: input },
    { upsert: true },
  );
  return result.upsertedCount > 0;
}

/** Used by the seed: set one field on an existing class only if it was never set. */
export async function setIfAbsent(
  value: string,
  field: 'flatRate' | 'hourlyRate' | 'minimumFare',
  rate: number,
): Promise<boolean> {
  const result = await VehicleClass.updateOne(
    { value, [field]: { $exists: false } },
    { $set: { [field]: rate } },
  );
  return result.modifiedCount > 0;
}
