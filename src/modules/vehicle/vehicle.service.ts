import { ApiError } from '../../utils/ApiError';
import type { TripType } from '../../models/Booking';
import type { IVehicleImage, VehicleUsage } from '../../models/VehicleClass';
import { IMAGE_KEY, ImageRejected, deleteImage, publicImageUrl, saveImage } from '../../utils/imageStorage';
import { logger } from '../../utils/logger';
import { VEHICLE_CLASSES as DEFAULT_CLASSES } from '../../config/vehicles';
import * as repo from './vehicle.repository';
import type { CreateVehicleClassInput, UpdateVehicleClassInput } from './vehicle.validation';

/**
 * The vehicle catalogue — business rules only, no Mongoose.
 *
 * The collection is the authority. config/vehicles.ts survives as the seed for an empty
 * database, and as the fallback multiplier when a booking names a class nobody defined.
 */
/* ------------------------------ photos: helpers ---------------------------- */

/** A stored upload's address, whether written as a path or as a full URL. */
const UPLOAD_SRC = /^(?:https?:\/\/[^/]+)?\/uploads\/vehicles\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp))$/;

/**
 * Tidies a photo list written by hand. An entry that points at one of OUR stored files gets
 * its `key` (and the path form of its address) back, so the file can still be found and
 * deleted later; anything else is just a link and owns no file.
 */
export function normaliseImages(images: Pick<IVehicleImage, 'src' | 'alt' | 'caption'>[]): IVehicleImage[] {
  return images.map(({ src, alt, caption }) => {
    const stored = UPLOAD_SRC.exec(src);
    return stored ? { src: `/uploads/vehicles/${stored[1]}`, key: stored[1], alt, caption } : { src, alt, caption };
  });
}

/** A class as the API shows it: stored photos carry a link a browser can load. */
function present<T extends { images?: IVehicleImage[] }>(record: T): T {
  if (!record.images?.length) return record;
  return { ...record, images: record.images.map((image) => ({ ...image, src: publicImageUrl(image.src) })) };
}

const storedKeys = (record: { images?: IVehicleImage[] } | null | undefined): string[] =>
  (record?.images ?? []).flatMap((i) => (i.key ? [i.key] : []));

export async function list(includeInactive = false) {
  return (await repo.findAll(includeInactive)).map(present);
}

export async function getById(id: string) {
  const found = await repo.findById(id);
  if (!found) throw ApiError.notFound('Vehicle class not found');
  return present(found);
}

export async function create(input: CreateVehicleClassInput) {
  const existing = await repo.findByValue(input.value);
  if (existing) {
    throw ApiError.conflict(`A vehicle class with key '${input.value}' already exists`);
  }
  return present(await repo.create({ ...input, ...(input.images ? { images: normaliseImages(input.images) } : {}) }));
}

export async function update(id: string, input: UpdateVehicleClassInput) {
  const before = input.images ? await repo.findById(id) : null;
  const updated = await repo.update(id, {
    ...input,
    ...(input.images ? { images: normaliseImages(input.images) } : {}),
  });
  if (!updated) throw ApiError.notFound('Vehicle class not found');

  // Replacing the photo list must not strand the files of any photo it dropped.
  if (before) {
    const kept = new Set(storedKeys(updated));
    await Promise.all(storedKeys(before).filter((k) => !kept.has(k)).map((k) => deleteImage('vehicles', k)));
  }
  return present(updated);
}

/* --------------------------------- photos ---------------------------------- */

export interface PhotoText {
  alt?: string;
  caption?: string;
}

/** Turns a rejected upload into the right HTTP answer. */
function rejection(err: unknown): never {
  if (err instanceof ImageRejected) {
    throw new ApiError(err.reason === 'too_large' ? 413 : 400, err.message, { code: `IMAGE_${err.reason.toUpperCase()}` });
  }
  throw err;
}

/**
 * Stores an uploaded photo and attaches it to a class.
 *
 * The file is written first and attached second, and if attaching fails (the class was
 * deleted meanwhile, or another upload took the last slot) the file is removed again — a
 * failed upload never leaves an orphan on disk.
 */
export async function addImage(id: string, bytes: Buffer, text: PhotoText) {
  const current = await repo.findById(id);
  if (!current) throw ApiError.notFound('Vehicle class not found');
  if ((current.images?.length ?? 0) >= repo.MAX_IMAGES) {
    throw new ApiError(409, `A class can have at most ${repo.MAX_IMAGES} photos. Remove one first.`, {
      code: 'TOO_MANY_IMAGES',
    });
  }

  let stored;
  try {
    stored = await saveImage('vehicles', bytes);
  } catch (err) {
    rejection(err);
  }

  const number = (current.images?.length ?? 0) + 1;
  const updated = await repo.pushImage(id, {
    src: stored.path,
    key: stored.key,
    alt: text.alt?.trim() || `${current.label} photo ${number}`,
    caption: text.caption?.trim() || (number === 1 ? 'Exterior' : `Photo ${number}`),
  });

  if (!updated) {
    await deleteImage('vehicles', stored.key);
    throw new ApiError(409, 'That vehicle class was removed or is already full, so the photo was not added.', {
      code: 'IMAGE_NOT_ADDED',
    });
  }
  return present(updated);
}

function assertKey(key: string) {
  if (!IMAGE_KEY.test(key)) throw ApiError.badRequest('That is not a photo of ours');
}

/** Removes one uploaded photo, and its file. */
export async function removeImage(id: string, key: string) {
  assertKey(key);
  // The database goes first: a photo that is gone from the class but whose file lingers is
  // invisible and harmless, while the reverse would leave a broken image on the booking form.
  const before = await repo.pullImage(id, key);
  if (!before) throw ApiError.notFound('Photo not found');
  await deleteImage('vehicles', key);
  return getById(id);
}

/** Edits a photo's words, and/or makes it the cover (the first photo, which the booking card shows). */
export async function updateImage(id: string, key: string, change: PhotoText & { cover?: boolean }) {
  assertKey(key);

  if (change.alt !== undefined || change.caption !== undefined) {
    const edited = await repo.setImageText(id, key, { alt: change.alt?.trim(), caption: change.caption?.trim() });
    if (!edited) throw ApiError.notFound('Photo not found');
  }

  if (change.cover) {
    const current = await repo.findById(id);
    const images = current?.images ?? [];
    const at = images.findIndex((i) => i.key === key);
    if (!current || at === -1) throw ApiError.notFound('Photo not found');
    if (at !== 0) {
      const reordered = [images[at], ...images.filter((_, i) => i !== at)];
      await repo.setImages(id, reordered);
    }
  }
  return getById(id);
}

/**
 * Deletion is real, which is why the interface should prefer `active: false`.
 *
 * A booking stores the class *key*, not a reference, so removing the row breaks no
 * booking — but those bookings lose their label and seat count, and any future quote
 * for that key silently falls back to the base rate. The service allows it because
 * operations does sometimes mistype a new class; the warning belongs in the UI.
 */
export async function remove(id: string) {
  const removed = await repo.remove(id);
  if (!removed) throw ApiError.notFound('Vehicle class not found');
  logger.warn(`Vehicle class '${removed.value}' deleted — existing bookings keep the key`);
  // Its photos go with it; otherwise their files would sit on disk forever, owned by nothing.
  await Promise.all(storedKeys(removed).map((key) => deleteImage('vehicles', key)));
  return present(removed);
}

/**
 * The fare multiplier for a class.
 *
 * Order: the collection, then the shipped defaults, then 1. Falling back to 1 rather
 * than throwing is deliberate — `vehicleClass` is a free string on the booking schema,
 * so an unknown key is a real possibility, and billing at the base rate can never
 * overcharge.
 */
export async function multiplierFor(value?: string | null, tripType?: TripType): Promise<number> {
  if (!value) return 1;

  const stored = await repo.findByValue(value);
  if (stored) {
    // Hourly charters can carry their own rate for a class (hourlyMultiplier).
    if (tripType === 'hourly' && stored.hourlyMultiplier) return stored.hourlyMultiplier;
    return stored.multiplier;
  }

  return DEFAULT_CLASSES.find((v) => v.value === value)?.multiplier ?? 1;
}

export interface ClassRates {
  /** The multiplier for this trip type — see multiplierFor(). */
  multiplier: number;
  /** Fixed price for this trip type: per trip for transfers, per hour for hourly. */
  fixedRate: number | null;
  minimumFare: number | null;
  /** Charge per intermediate stop. 0 when the class does not charge for stops. */
  stopFee: number;
  /** Per-mile pricing for a flat transfer: miles the flat rate covers, and the charge per mile after. */
  baseMiles: number | null;
  perMileRate: number | null;
  label?: string;
}

/**
 * Everything the fare calculator needs to price a class for one trip type.
 *
 * A fixed rate, when the class has one for this kind of trip, wins over the multiplier:
 * a transfer reads `flatRate`, an hourly charter reads `hourlyRate`. Same lookup order
 * as multiplierFor — collection, then shipped defaults, then nothing.
 */
export async function ratesFor(value?: string | null, tripType?: TripType): Promise<ClassRates> {
  if (!value) return { multiplier: 1, fixedRate: null, minimumFare: null, stopFee: 0, baseMiles: null, perMileRate: null };

  const hourly = tripType === 'hourly';
  const stored = await repo.findByValue(value);
  if (stored) {
    return {
      multiplier: hourly && stored.hourlyMultiplier ? stored.hourlyMultiplier : stored.multiplier,
      fixedRate: (hourly ? stored.hourlyRate : stored.flatRate) ?? null,
      minimumFare: stored.minimumFare ?? null,
      stopFee: stored.stopFee ?? 0,
      baseMiles: stored.baseMiles ?? null,
      perMileRate: stored.perMileRate ?? null,
      label: stored.label,
    };
  }

  const fallback = DEFAULT_CLASSES.find((v) => v.value === value);
  return {
    multiplier: fallback?.multiplier ?? 1,
    fixedRate: (hourly ? fallback?.hourlyRate : fallback?.flatRate) ?? null,
    minimumFare: fallback?.minimumFare ?? null,
    stopFee: 0,
    baseMiles: null,
    perMileRate: null,
    label: fallback?.label,
  };
}

export interface ClassCapacity {
  label: string;
  seats: number;
  /** How many bags the vehicle holds, checked and carry-on together. */
  bags: number;
}

/**
 * What a class can carry. Same lookup order as everything else here: the collection, then
 * the shipped defaults. Null for a key neither knows, so the caller can decide — a rule
 * that blocked every booking on an unknown class would be worse than not checking.
 */
export async function capacityFor(value?: string | null): Promise<ClassCapacity | null> {
  if (!value) return null;
  const stored = await repo.findByValue(value);
  if (stored) return { label: stored.label, seats: stored.seats, bags: stored.bags };
  const fallback = DEFAULT_CLASSES.find((v) => v.value === value.toLowerCase());
  return fallback ? { label: fallback.label, seats: fallback.seats, bags: fallback.bags } : null;
}

/** Display name for a stored class key, for emails and receipts. */
export async function labelFor(value?: string | null): Promise<string> {
  if (!value) return '—';
  const stored = await repo.findByValue(value);
  return stored?.label ?? DEFAULT_CLASSES.find((v) => v.value === value)?.label ?? value;
}

/**
 * Populate an empty catalogue from the shipped defaults.
 *
 * Idempotent and non-destructive: it inserts only keys that are missing, so it can run
 * on every boot without ever overwriting a multiplier operations has tuned.
 */
/**
 * Resolves a client-supplied class key to the canonical one, or refuses it.
 *
 * `vehicleClass` is a free string on the Booking schema and nothing used to check it, so
 * the API accepted anything: 'totally-made-up' was stored and silently billed at the
 * base rate, and 'LIMO' was billed correctly but stored uppercase, matching nothing
 * downstream — not the driver lookup that pairs a chauffeur to a job, and not the
 * catalogue the consoles read to render a name, a photo or a seat count.
 *
 * Returning the stored `value` rather than the caller's spelling is the other half of
 * the fix: one canonical key reaches the database however the client capitalised it.
 */
export async function resolveBookableClass(
  value?: string | null,
  tripType?: TripType,
): Promise<string> {
  if (!value?.trim()) {
    throw ApiError.badRequest('A vehicle class is required');
  }

  const stored = await repo.findByValue(value.trim());

  if (!stored || stored.active === false) {
    const available = await repo.findAll();
    throw new ApiError(400, `'${value}' is not a vehicle class we offer`, {
      code: 'UNKNOWN_VEHICLE_CLASS',
      available: available.map((v) => v.value),
    });
  }

  if (tripType) assertOffered(stored, tripType);

  return stored.value;
}

/** Whether a class may be booked for a trip type (VehicleClass.usage). */
export function offersTripType(usage: VehicleUsage | undefined, tripType: TripType): boolean {
  if (!usage || usage === 'all') return true;
  return usage === 'hourly' ? tripType === 'hourly' : tripType !== 'hourly';
}

function assertOffered(stored: { value: string; label: string; usage?: VehicleUsage }, tripType: TripType) {
  if (offersTripType(stored.usage, tripType)) return;
  throw new ApiError(
    400,
    stored.usage === 'hourly'
      ? `${stored.label} is only available for hourly charters`
      : `${stored.label} is not available for hourly charters`,
    { code: 'VEHICLE_CLASS_NOT_OFFERED', usage: stored.usage, tripType },
  );
}

/** For quotes: refuse a known class that is not offered for this trip type. */
export async function assertClassOffered(value: string | undefined, tripType: TripType) {
  if (!value) return;
  const stored = await repo.findByValue(value);
  if (stored) assertOffered(stored, tripType);
}

export async function seedDefaults(): Promise<number> {
  let inserted = 0;

  for (const [index, vehicle] of DEFAULT_CLASSES.entries()) {
    const created = await repo.createIfAbsent({
      value: vehicle.value,
      label: vehicle.label,
      detail: `Up to ${vehicle.seats} passengers, ${vehicle.bags} bags`,
      seats: vehicle.seats,
      bags: vehicle.bags,
      multiplier: vehicle.multiplier,
      usage: vehicle.usage ?? 'all',
      flatRate: vehicle.flatRate ?? null,
      hourlyRate: vehicle.hourlyRate ?? null,
      minimumFare: vehicle.minimumFare ?? null,
      images: [],
      active: true,
      sortOrder: index,
    });
    if (created) inserted += 1;
  }

  /*
   * Classes created before fixed rates existed have no rate fields at all. Fill those in
   * from the rate card — but only where the field is absent, so a rate operations has
   * set, or deliberately cleared to null, is never overwritten on boot.
   */
  let backfilled = 0;
  for (const vehicle of DEFAULT_CLASSES) {
    for (const field of ['flatRate', 'hourlyRate', 'minimumFare'] as const) {
      const rate = vehicle[field];
      if (rate === undefined) continue;
      if (await repo.setIfAbsent(vehicle.value, field, rate)) backfilled += 1;
    }
  }

  if (inserted > 0) logger.info(`Vehicle catalogue: seeded ${inserted} default class(es)`);
  if (backfilled > 0) logger.info(`Vehicle catalogue: filled ${backfilled} missing rate(s) from the rate card`);
  return inserted;
}
