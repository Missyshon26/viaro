import { ApiError } from '../../utils/ApiError';
import type { BookingDocument, GeoPoint } from '../../models/Booking';
import { recordChange } from './booking.amendments';
import type { AdminUpdateBookingInput, UpdateBookingInput } from './booking.validation';

/**
 * The details of a booking a customer can still change after making it: stops, occasion,
 * luggage, who the passenger is, and the flight. Each one tells the chauffeur and
 * operations something ("there is a stop now", "this is a wedding", "four bags"), so each
 * is recorded in the amendment trail the same way a moved pickup is.
 *
 * Kept apart from booking.service so the rules for each field can be read — and tested —
 * without the pricing, notification and event machinery around them.
 */

const NONE = '—';

const describeStops = (stops?: GeoPoint[] | null) =>
  stops?.length ? stops.map((s) => s.address).join(' → ') : NONE;

const describeOccasion = (occasion?: string, details?: string) =>
  occasion ? `${occasion}${details ? ` (${details})` : ''}` : NONE;

// No bags and "no luggage recorded" are the same thing to a chauffeur, so a form that posts
// 0 and 0 for a booking that never had any is not a change.
const describeLuggage = (checked?: number, carryOn?: number) =>
  !checked && !carryOn ? NONE : `${checked ?? 0} checked, ${carryOn ?? 0} carry-on`;

const describePassenger = (name?: string, phone?: string) =>
  name ? `${name}${phone ? `, ${phone}` : ''}` : NONE;

export interface DetailChanges {
  /** Anything at all changed. */
  changed: boolean;
  /** The number of stops changed, so the fare must be re-quoted. */
  stopCountChanged: boolean;
}

/**
 * Applies the detail fields of an update to a booking IN MEMORY. Nothing is saved here:
 * the caller saves once, after the vehicle rules have been checked against the finished
 * state, so a refused edit leaves the stored booking untouched.
 */
export function applyDetailChanges(
  booking: BookingDocument,
  input: UpdateBookingInput & Pick<AdminUpdateBookingInput, 'passengers' | 'description'>,
  by: 'customer' | 'admin' = 'customer',
): DetailChanges {
  let changed = false;
  let stopCountChanged = false;

  /* ------------------------------- stops --------------------------------- */
  if (input.stops !== undefined) {
    if (booking.tripType === 'hourly' && input.stops.length > 0) {
      throw ApiError.badRequest('An hourly charter goes wherever the hours take it; stops apply to transfers');
    }

    const before = booking.stops ?? [];
    const from = describeStops(before);
    const to = describeStops(input.stops);

    if (from !== to) {
      // The fare depends on how many stops there are. A card payment has already been
      // taken for a specific amount, so changing the count here would leave the booking
      // saying one price and the card statement another. Re-ordering or re-addressing the
      // same number of stops costs nothing and stays open.
      if (booking.payment && before.length !== input.stops.length) {
        throw new ApiError(
          409,
          'The number of stops on a paid booking cannot be changed online, because it changes the price. Please contact us and we will sort it out.',
          { code: 'STOP_COUNT_LOCKED_BY_PAYMENT' },
        );
      }
      booking.stops = input.stops.length ? input.stops : undefined;
      stopCountChanged = before.length !== input.stops.length;
      changed = recordChange(booking, 'stops', from, to, by) || changed;
    }
  }

  /* ------------------------------- flight -------------------------------- */
  if (input.flightNumber !== undefined) {
    if (booking.tripType !== 'airport') {
      throw ApiError.badRequest('A flight can only be set on an airport booking');
    }
    const next = input.flightNumber.trim().toUpperCase();
    const current = booking.flightDetails?.flightNumber ?? '';
    if (next !== current) {
      // A different flight has a different arrival time, so the old one must not linger.
      booking.flightDetails = { flightNumber: next };
      changed = recordChange(booking, 'flight', current || NONE, next, by) || changed;
    }
  }

  /* ------------------------------ occasion ------------------------------- */
  if (input.occasion !== undefined || input.occasionDetails !== undefined) {
    const nextOccasion = input.occasion === undefined ? booking.occasion : (input.occasion ?? undefined);

    if (input.occasionDetails && nextOccasion !== 'Other') {
      throw ApiError.badRequest('Occasion details can only be given when the occasion is "Other"');
    }
    // Details belong to "Other" alone: moving to any other occasion drops them.
    const nextDetails =
      nextOccasion !== 'Other'
        ? undefined
        : input.occasionDetails === undefined
          ? booking.occasionDetails
          : (input.occasionDetails ?? undefined);

    const from = describeOccasion(booking.occasion, booking.occasionDetails);
    const to = describeOccasion(nextOccasion, nextDetails);
    if (from !== to) {
      booking.occasion = nextOccasion;
      booking.occasionDetails = nextDetails;
      changed = recordChange(booking, 'occasion', from, to, by) || changed;
    }
  }

  /* ------------------------------ luggage -------------------------------- */
  if (input.checkedBags !== undefined || input.carryOnBags !== undefined) {
    const checked = input.checkedBags ?? booking.checkedBags;
    const carryOn = input.carryOnBags ?? booking.carryOnBags;
    const from = describeLuggage(booking.checkedBags, booking.carryOnBags);
    const to = describeLuggage(checked, carryOn);
    if (from !== to) {
      booking.checkedBags = checked;
      booking.carryOnBags = carryOn;
      changed = recordChange(booking, 'luggage', from, to, by) || changed;
    }
  }

  /* ------------------------------ passenger ------------------------------ */
  if (input.passengerName !== undefined || input.passengerPhone !== undefined) {
    // `null` for the name means "I am the passenger after all": both go.
    const clearing = input.passengerName === null;
    const name = clearing ? undefined : (input.passengerName ?? booking.passengerName);
    const phone = clearing
      ? undefined
      : input.passengerPhone === undefined
        ? booking.passengerPhone
        : (input.passengerPhone ?? undefined);

    if (phone && !name) throw ApiError.badRequest("Enter the passenger's name");

    const from = describePassenger(booking.passengerName, booking.passengerPhone);
    const to = describePassenger(name, phone);
    if (from !== to) {
      booking.passengerName = name;
      booking.passengerPhone = phone;
      changed = recordChange(booking, 'passenger', from, to, by) || changed;
    }
  }

  /* ------------------------------ head count ----------------------------- */
  if (input.passengers !== undefined && input.passengers !== booking.passengers) {
    const from = String(booking.passengers ?? NONE);
    booking.passengers = input.passengers;
    changed = recordChange(booking, 'passengers', from, String(input.passengers), by) || changed;
  }

  /* -------------------------------- notes -------------------------------- */
  if (input.description !== undefined) {
    const next = input.description?.trim() || undefined;
    const current = booking.description?.trim() || undefined;
    if (next !== current) {
      booking.description = next;
      changed = recordChange(booking, 'notes', current ?? NONE, next ?? NONE, by) || changed;
    }
  }

  return { changed, stopCountChanged };
}
