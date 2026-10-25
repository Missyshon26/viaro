import { ApiError } from '../../utils/ApiError';
import { format, hoursUntil, now, toDate } from '../../config/timezone';
import type { BookingDocument, GeoPoint, IBookingAmendment } from '../../models/Booking';

/**
 * Changing a booking after it was made.
 *
 * One module because the rule has to be identical on both routes a customer can reach:
 * `PATCH /bookings/:id` before a chauffeur is involved, and `PATCH /trips/:id/location`
 * and `/vehicle-class` after. Two copies of a deadline is two deadlines.
 */

/**
 * How close to pickup a customer may still change something.
 *
 * Three hours is the operational cost of a change: a chauffeur may already be planning
 * around this job, and a vehicle class change can mean a different car and a different
 * driver entirely. It is deliberately shorter than the 24 h free-cancellation window —
 * amending is cheaper than cancelling, so it stays open longer.
 */
export const CHANGE_CUTOFF_HOURS = 3;

/** Human-readable form of each field, so every console renders the trail identically. */
const describe = {
  pickup: (value: GeoPoint) => value.address,
  drop: (value: GeoPoint) => value.address,
  vehicleClass: (value: string) => value,
  scheduledAt: (value: Date) => format(value),
};

export function assertChangeable(booking: BookingDocument): void {
  if (booking.status === 'cancelled') {
    throw ApiError.conflict('This booking has been cancelled and can no longer be changed');
  }

  const remaining = hoursUntil(booking.scheduledAt);

  if (remaining < CHANGE_CUTOFF_HOURS) {
    // Deliberately explicit about the deadline and about the way out. A bare refusal
    // leaves a customer with a wrong pickup address and nothing to do about it.
    throw new ApiError(
      409,
      `Changes close ${CHANGE_CUTOFF_HOURS} hours before pickup. Please call us and we will sort it out.`,
      {
        code: 'CHANGE_WINDOW_CLOSED',
        cutoffHours: CHANGE_CUTOFF_HOURS,
        hoursUntilPickup: Math.max(0, Math.round(remaining * 10) / 10),
      },
    );
  }
}

/**
 * Applies a change and records what it replaced.
 *
 * Recording is the point: the current value alone cannot tell a chauffeur that they are
 * driving to an address the passenger moved an hour ago. Nothing is appended when the
 * value is unchanged, so re-submitting a form does not fill the trail with noise.
 */
export function applyAmendment<K extends keyof typeof describe>(
  booking: BookingDocument,
  field: K,
  /** A Date for scheduledAt, or the ISO string a client sends — both are accepted. */
  next: K extends 'scheduledAt' ? Date | string : Parameters<(typeof describe)[K]>[0],
  by: IBookingAmendment['by'],
): boolean {
  const current = booking[field] as Parameters<(typeof describe)[K]>[0];

  const fromText = current === undefined ? '—' : (describe[field] as (v: unknown) => string)(current);
  const toText = (describe[field] as (v: unknown) => string)(
    field === 'scheduledAt' ? toDate(next as string | Date) : next,
  );
  if (fromText === toText) return false;

  // scheduledAt arrives as an ISO string from the client; everything else is stored as
  // handed in.
  (booking as unknown as Record<string, unknown>)[field] =
    field === 'scheduledAt' ? toDate(next as string | Date) : next;

  booking.amendments.push({
    field,
    from: fromText,
    to: toText,
    by,
    at: toDate(now()),
  });

  return true;
}

/**
 * Records a change that is not a single property swap — stops, the flight, the occasion,
 * the luggage, the passenger. `applyAmendment` assigns the new value itself; these fields
 * are made of several booking properties, so the caller assigns them and this only adds
 * the trail entry. Nothing is appended when the text did not change, so re-saving a form
 * unchanged leaves no noise.
 */
export function recordChange(
  booking: BookingDocument,
  field: Exclude<IBookingAmendment['field'], 'pickup' | 'drop' | 'vehicleClass' | 'scheduledAt'>,
  from: string,
  to: string,
  by: IBookingAmendment['by'],
): boolean {
  if (from === to) return false;
  booking.amendments.push({ field, from, to, by, at: toDate(now()) });
  return true;
}
