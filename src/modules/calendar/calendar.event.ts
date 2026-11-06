import crypto from 'node:crypto';
import { DateTime } from 'luxon';
import { APP_TIMEZONE, format, toAppTime } from '../../config/timezone';
import type { IBooking } from '../../models/Booking';
import type { CalendarEventBody } from '../../integrations/googleCalendar';

/**
 * What a booking looks like on the operations calendar. Pure: no database, no Google, so
 * every choice here is testable on its own.
 *
 * The calendar's job is to answer "what is happening, when, and is it covered?" at a
 * glance. So:
 *   - the title says the car, the customer and the kind of trip;
 *   - the colour says whether a chauffeur has it: Google's default blue until one is assigned, green after;
 *   - the place is the pickup address, so it opens in a map;
 *   - the notes carry everything dispatch needs without opening the console.
 */

/** Google Calendar colour ids: 7 = peacock, Google's default blue (needs a chauffeur), 10 = basil (covered). */
export const COLOR_UNASSIGNED = '7';
export const COLOR_ASSIGNED = '10';

/** How long an event spans when the booking does not say. Hourly charters use their hours. */
export const MINUTES_BY_TRIP_TYPE = { point2point: 60, airport: 90 } as const;

/** A reminder a day ahead and an hour ahead, so a trip with no chauffeur is noticed in time. */
export const REMINDER_MINUTES = [24 * 60, 60] as const;

const TRIP_TYPE_LABEL: Record<string, string> = {
  point2point: 'Point to point',
  airport: 'Airport transfer',
  hourly: 'Hourly charter',
};

/** Google's limits are 1,024 for a title and 8,192 for the notes; stay well inside both. */
const MAX_SUMMARY = 200;
const MAX_DESCRIPTION = 7000;

export interface CalendarEventInput {
  booking: Pick<
    IBooking,
    | 'pickup'
    | 'drop'
    | 'stops'
    | 'scheduledAt'
    | 'tripType'
    | 'hours'
    | 'passengers'
    | 'flightDetails'
    | 'meetAndGreet'
    | 'carSeats'
    | 'occasion'
    | 'occasionDetails'
    | 'carryOnBags'
    | 'checkedBags'
    | 'passengerName'
    | 'passengerPhone'
    | 'serviceNotes'
    | 'estimatedFare'
    | 'payment'
    | 'journey'
    | 'cruisePort'
    | 'cruiseShip'
  >;
  /** "ABL-AB12CD". */
  ref: string;
  vehicleLabel: string;
  customer: { name?: string; phone?: string; email?: string } | null;
  chauffeur?: { name: string; phone?: string } | null;
  /** The console's trip page, when the console's address is configured. */
  consoleUrl?: string;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function eventEnd(booking: Pick<IBooking, 'scheduledAt' | 'tripType' | 'hours'>): DateTime {
  const start = toAppTime(booking.scheduledAt);
  const minutes =
    booking.tripType === 'hourly' ? Math.max(1, booking.hours ?? 1) * 60 : MINUTES_BY_TRIP_TYPE[booking.tripType];
  return start.plus({ minutes });
}

export function buildCalendarEvent(input: CalendarEventInput): CalendarEventBody {
  const { booking: b, ref, vehicleLabel, customer, chauffeur } = input;
  const start = toAppTime(b.scheduledAt);
  const end = eventEnd(b);

  const leg = b.journey ? ` · Leg ${b.journey.index + 1}/${b.journey.count}` : '';
  const summary = clip(
    `${vehicleLabel} · ${customer?.name || 'Customer'} · ${TRIP_TYPE_LABEL[b.tripType] ?? b.tripType}${leg}`,
    MAX_SUMMARY,
  );

  const bags =
    b.checkedBags || b.carryOnBags ? `${b.checkedBags ?? 0} checked, ${b.carryOnBags ?? 0} carry-on` : undefined;
  const extras = [
    b.meetAndGreet ? 'Meet and greet' : null,
    b.carSeats ? `${b.carSeats} child car seat${b.carSeats > 1 ? 's' : ''}` : null,
  ].filter(Boolean);

  const lines: (string | null)[] = [
    `Booking ${ref}${b.journey ? ` · leg ${b.journey.index + 1} of ${b.journey.count}` : ''}`,
    '',
    `Pickup: ${format(b.scheduledAt)}`,
    `From: ${b.pickup?.address ?? ''}`,
    ...(b.stops?.length ? b.stops.map((s, i) => `Stop ${i + 1}: ${s.address}`) : []),
    `To: ${b.drop?.address ?? ''}`,
    b.tripType === 'hourly' && b.hours ? `Hours booked: ${b.hours}` : null,
    b.flightDetails?.flightNumber ? `Flight: ${b.flightDetails.flightNumber}` : null,
    b.cruisePort ? `Cruise: ${b.cruisePort}${b.cruiseShip ? ` · ${b.cruiseShip}` : ''}` : null,
    '',
    `Customer: ${[customer?.name, customer?.phone, customer?.email].filter(Boolean).join(' · ') || '—'}`,
    b.passengerName || b.passengerPhone ? `Passenger: ${[b.passengerName, b.passengerPhone].filter(Boolean).join(' · ')}` : null,
    b.passengers ? `Party of ${b.passengers}` : null,
    bags ? `Bags: ${bags}` : null,
    b.occasion ? `Occasion: ${b.occasion}${b.occasionDetails ? ` (${b.occasionDetails})` : ''}` : null,
    extras.length ? `Extras: ${extras.join(', ')}` : null,
    ...(b.serviceNotes?.length ? ['', ...b.serviceNotes] : []),
    '',
    // Whether it is paid, never how much: the calendar is shared and the amount is not for it.
    typeof b.estimatedFare === 'number' ? `Payment: ${b.payment ? 'PAID' : 'not yet paid'}` : null,
    chauffeur
      ? `Chauffeur: ${[chauffeur.name, chauffeur.phone].filter(Boolean).join(' · ')}`
      : 'Chauffeur: NOT ASSIGNED YET',
    input.consoleUrl ? `\nOpen in the console: ${input.consoleUrl}` : null,
  ];

  return {
    summary,
    location: clip(b.pickup?.address ?? '', 500) || undefined,
    description: clip(lines.filter((l): l is string => l !== null).join('\n'), MAX_DESCRIPTION),
    start: { dateTime: start.toISO({ suppressMilliseconds: true }) as string, timeZone: APP_TIMEZONE },
    end: { dateTime: end.toISO({ suppressMilliseconds: true }) as string, timeZone: APP_TIMEZONE },
    colorId: chauffeur ? COLOR_ASSIGNED : COLOR_UNASSIGNED,
    reminders: { useDefault: false, overrides: REMINDER_MINUTES.map((minutes) => ({ method: 'popup' as const, minutes })) },
    status: 'confirmed',
  };
}

/**
 * Google's event ids are lowercase letters a–v and digits, 5 to 1,024 long. A booking id is
 * 24 hex characters, so "abl" + that is always valid, and — the point — always the same for
 * the same booking. Choosing the id ourselves means creating an event twice cannot make two:
 * the second try is refused as already existing, and we change that one instead.
 */
export const eventIdFor = (bookingId: string) => `abl${String(bookingId).toLowerCase()}`;

/** A fingerprint of the event as written, so an unchanged booking is not written again. */
export function eventHash(body: CalendarEventBody): string {
  const { summary, location, description, start, end, colorId } = body;
  return crypto.createHash('sha256').update(JSON.stringify({ summary, location, description, start, end, colorId })).digest('hex');
}
