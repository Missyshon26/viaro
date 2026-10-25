import { Types } from 'mongoose';
import { VehicleClass, type IVehicleClass, type IVehicleImage } from '../../models/VehicleClass';

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


/* --------------------------------- photos ---------------------------------- */

/** The most photos one class can carry (the schema's own ceiling). */
export const MAX_IMAGES = 10;

/**
 * Adds a photo — atomically, and only if there is still room.
 *
 * The room check is part of the update's filter (`images.9` must not exist), not a read
 * followed by a write, so two uploads racing for the last slot cannot both get it. Returns
 * null when the class does not exist OR is already full; the caller tells the two apart.
 */
export async function pushImage(id: string, image: IVehicleImage): Promise<VehicleClassRecord | null> {
  return VehicleClass.findOneAndUpdate(
    { _id: id, [`images.${MAX_IMAGES - 1}`]: { $exists: false } },
    { $push: { images: image } },
    { new: true },
  ).lean<VehicleClassRecord>();
}

/** Removes the photo with this stored key. Returns the class as it was BEFORE, or null if no such photo. */
export async function pullImage(id: string, key: string): Promise<VehicleClassRecord | null> {
  return VehicleClass.findOneAndUpdate(
    { _id: id, 'images.key': key },
    { $pull: { images: { key } } },
    { new: false },
  ).lean<VehicleClassRecord>();
}

/** Changes the words on one photo. Null if the class or the photo is not there. */
export async function setImageText(
  id: string,
  key: string,
  text: { alt?: string; caption?: string },
): Promise<VehicleClassRecord | null> {
  const set: Record<string, string> = {};
  if (text.alt !== undefined) set['images.$.alt'] = text.alt;
  if (text.caption !== undefined) set['images.$.caption'] = text.caption;
  return VehicleClass.findOneAndUpdate({ _id: id, 'images.key': key }, { $set: set }, { new: true }).lean<VehicleClassRecord>();
}

/** Replaces the whole photo list (used to put one first, and to tidy a hand-edited list). */
export async function setImages(id: string, images: IVehicleImage[]): Promise<VehicleClassRecord | null> {
  return VehicleClass.findByIdAndUpdate(id, { $set: { images } }, { new: true }).lean<VehicleClassRecord>();
}
