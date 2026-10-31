import { z } from 'zod';
import { EventType } from '../../models/EventType';
import { Package } from '../../models/Package';
import { ApiError } from '../../utils/ApiError';

export const eventTypeBodySchema = z.object({ name: z.string().trim().min(2, 'Enter a name').max(60) });
export const eventTypeIdSchema = z.object({ id: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id') });

const keyOf = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
const tidy = (name: string) => name.trim().replace(/\s+/g, ' ');

const present = (e: { _id: unknown; name: string }) => ({ _id: String(e._id), name: e.name });

export async function list() {
  const all = await EventType.find().sort({ key: 1 }).lean();
  return all.map(present);
}

export async function create(name: string) {
  const clean = tidy(name);
  if (await EventType.exists({ key: keyOf(clean) })) throw ApiError.conflict(`"${clean}" is already in the list`);
  try {
    return present(await EventType.create({ name: clean, key: keyOf(clean) }));
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw ApiError.conflict(`"${clean}" is already in the list`);
    throw err;
  }
}

/** Renaming also renames it on every package that uses it, so no package is left with a stale name. */
export async function rename(id: string, name: string) {
  const clean = tidy(name);
  const before = await EventType.findById(id).lean();
  if (!before) throw ApiError.notFound('Event type not found');
  if (await EventType.exists({ key: keyOf(clean), _id: { $ne: id } })) throw ApiError.conflict(`"${clean}" is already in the list`);

  let updated;
  try {
    updated = await EventType.findByIdAndUpdate(id, { $set: { name: clean, key: keyOf(clean) } }, { returnDocument: 'after' }).lean();
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw ApiError.conflict(`"${clean}" is already in the list`);
    throw err;
  }
  if (!updated) throw ApiError.notFound('Event type not found');

  if (before.name !== clean) {
    await Package.updateMany({ eventTypes: before.name }, { $set: { 'eventTypes.$[e]': clean } }, { arrayFilters: [{ e: before.name }] });
  }
  return present(updated);
}

/** Deleting also takes the name off every package that used it. */
export async function remove(id: string) {
  const gone = await EventType.findByIdAndDelete(id).lean();
  if (!gone) throw ApiError.notFound('Event type not found');
  await Package.updateMany({ eventTypes: gone.name }, { $pull: { eventTypes: gone.name } });
  return { _id: String(gone._id) };
}
