import { ApiError } from '../../utils/ApiError';
import type { TripType } from '../../models/Booking';
import type { VehicleUsage } from '../../models/VehicleClass';
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
export async function list(includeInactive = false) {
  return repo.findAll(includeInactive);
}

export async function getById(id: string) {
  const found = await repo.findById(id);
  if (!found) throw ApiError.notFound('Vehicle class not found');
  return found;
}

export async function create(input: CreateVehicleClassInput) {
  const existing = await repo.findByValue(input.value);
  if (existing) {
    throw ApiError.conflict(`A vehicle class with key '${input.value}' already exists`);
  }
  return repo.create(input);
}

export async function update(id: string, input: UpdateVehicleClassInput) {
  const updated = await repo.update(id, input);
  if (!updated) throw ApiError.notFound('Vehicle class not found');
  return updated;
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
  return removed;
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
  if (!value) return { multiplier: 1, fixedRate: null, minimumFare: null };

  const hourly = tripType === 'hourly';
  const stored = await repo.findByValue(value);
  if (stored) {
    return {
      multiplier: hourly && stored.hourlyMultiplier ? stored.hourlyMultiplier : stored.multiplier,
      fixedRate: (hourly ? stored.hourlyRate : stored.flatRate) ?? null,
      minimumFare: stored.minimumFare ?? null,
      label: stored.label,
    };
  }

  const fallback = DEFAULT_CLASSES.find((v) => v.value === value);
  return {
    multiplier: fallback?.multiplier ?? 1,
    fixedRate: (hourly ? fallback?.hourlyRate : fallback?.flatRate) ?? null,
    minimumFare: fallback?.minimumFare ?? null,
    label: fallback?.label,
  };
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
