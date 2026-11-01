import { Booking } from '../../models/Booking';
import { Counter } from '../../models/Counter';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';

/**
 * The number printed on an invoice or receipt, as on the old booking site: a plain running
 * number ("13776"), one more than the last. Old trips are numbered by the old site up to the day
 * it stops taking bookings, so this carries on from the highest of:
 *   - TRIP_NO_START, set at cutover to the old site's last trip number;
 *   - the highest old number among the bookings imported into this app.
 * Whichever is higher is the floor, re-checked on every call, so raising TRIP_NO_START later
 * moves the sequence forward and nothing ever moves it back.
 *
 * No duplicates:
 *   - the counter is one atomic update, so two bookings made at the same moment cannot get the
 *     same number (the old site read "the last number + 1" and could);
 *   - a number already carried by an imported old booking is skipped, so importing history
 *     after this app has started taking bookings cannot make two invoices share a number;
 *   - the database refuses the same number on two bookings unless they are legs of one journey
 *     (see the unique index on Booking).
 * A number can be left unused (a checkout abandoned between taking a number and saving), so the
 * sequence may have gaps, but it never repeats.
 *
 * Errors: a booking is never lost over its invoice number. Checkout refunds a card when a booking
 * cannot be saved, so this never throws; if a number cannot be had after a few tries it logs the
 * problem and returns undefined, and the booking is saved without one. Its documents then print
 * the earlier INV-/RCT- form instead (booking.documents.ts).
 */
const ATTEMPTS = 3;
/** Numbers to step over when imported old bookings already hold them. */
const MAX_SKIPS = 100;

let importedMax = 0;

async function highestImported(): Promise<number> {
  if (importedMax > 0) return importedMax; // the imported history does not change once it is in
  const rows = await Booking.aggregate<{ max: number }>([
    { $match: { 'legacy.tripNo': { $regex: /^[0-9]+$/ } } },
    { $group: { _id: null, max: { $max: { $toInt: '$legacy.tripNo' } } } },
  ]);
  importedMax = rows[0]?.max ?? 0;
  return importedMax;
}

async function takeNext(): Promise<number> {
  const floor = Math.max(env.TRIP_NO_START ?? 0, await highestImported());
  // One atomic step: raise the counter to the floor if it is behind, then add one.
  const counter = await Counter.findOneAndUpdate(
    { _id: 'tripNo' },
    [{ $set: { seq: { $add: [{ $max: [{ $ifNull: ['$seq', 0] }, floor] }, 1] } } }],
    { upsert: true, new: true, updatePipeline: true },
  ).lean();
  return counter!.seq;
}

export async function nextTripNo(): Promise<string | undefined> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      for (let skips = 0; skips <= MAX_SKIPS; skips++) {
        const n = String(await takeNext());
        // An imported old booking already holds this number: take the next one.
        if (!(await Booking.exists({ 'legacy.tripNo': n }))) return n;
      }
      logger.error(`Trip number: ${MAX_SKIPS} numbers in a row are already used by imported bookings`);
      return undefined;
    } catch (err) {
      logger.error(`Trip number: attempt ${attempt} of ${ATTEMPTS} failed`, err);
    }
  }
  return undefined;
}
