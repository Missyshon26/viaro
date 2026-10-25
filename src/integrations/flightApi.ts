import { DateTime } from 'luxon';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { APP_TIMEZONE, now, toDate } from '../config/timezone';

/**
 * Flight data client (spec §4.8).
 *
 * Two real providers are implemented and selected by FLIGHT_API_PROVIDER:
 *   aviationstack | flightaware
 * With no provider (or no key) configured it falls back to `mock`, so the whole system
 * still runs end to end locally. Adding a third provider means adding one adapter below
 * and nothing else.
 *
 * What callers can rely on, whichever provider answered:
 *   - every Date is a real instant (see parseLocalClock for the one provider that is not);
 *   - `placeholder` is true ONLY for generated data, and such a result must never be
 *     shown to a customer as a verified time;
 *   - when a date is asked for, the record returned is for THAT day's flight. A flight
 *     number is reused every day, so "the first record" is some other day's flight.
 */
export interface FlightDetails {
  flightNumber: string;
  status: 'scheduled' | 'active' | 'landed' | 'cancelled' | 'unknown';
  /** The airline's published arrival time. */
  scheduledArrival: Date;
  /** The provider's current forecast, when it differs from the schedule. */
  estimatedArrival: Date | null;
  actualArrival: Date | null;
  /** Minutes late (negative = early) as the provider reports it, when it does. */
  delayMinutes: number | null;
  /** Arrival airport IATA code, when the provider reports it. */
  arrivalAirport?: string | null;
  provider: string;
  /** True when this is generated data, not a real lookup. */
  placeholder: boolean;
}

/** When the plane is really expected down: what happened, else the forecast, else the schedule. */
export function expectedArrival(flight: FlightDetails): Date {
  return flight.actualArrival ?? flight.estimatedArrival ?? flight.scheduledArrival;
}

const REQUEST_TIMEOUT_MS = 10_000;

export interface FlightLookupOptions {
  /** yyyy-mm-dd, the day the flight lands (airport-local, which for Seattle is Pacific). */
  date?: string;
  /** Give up sooner than the default — for callers that must not hold a booking up. */
  timeoutMs?: number;
}

export async function fetchFlightDetails(
  flightNumber: string,
  options: FlightLookupOptions = {},
): Promise<FlightDetails> {
  const flight = flightNumber.toUpperCase().replace(/[\s-]+/g, '');
  const provider = (env.FLIGHT_API_PROVIDER || '').toLowerCase();

  if (!provider || !env.FLIGHT_API_KEY) return mockFlight(flight, provider || 'mock');

  try {
    switch (provider) {
      case 'aviationstack':
        return await fromAviationStack(flight, options);
      case 'flightaware':
        return await fromFlightAware(flight, options);
      default:
        logger.warn(`Unknown FLIGHT_API_PROVIDER '${provider}' — falling back to mock data`);
        return mockFlight(flight, provider);
    }
  } catch (err) {
    // A flight lookup must never break a booking or a driver's trip view.
    logger.error(`Flight lookup failed for ${flight} via ${provider}`, err);
    return mockFlight(flight, provider);
  }
}

/* ------------------------------- aviationstack ---------------------------- */

export interface AviationStackRecord {
  flight_status?: string;
  arrival?: {
    scheduled?: string;
    estimated?: string;
    actual?: string;
    iata?: string;
    timezone?: string;
    delay?: number | null;
  };
  flight?: { iata?: string };
}

interface AviationStackResponse {
  data?: AviationStackRecord[];
}

/**
 * Reads an AviationStack timestamp.
 *
 * AviationStack writes the AIRPORT'S LOCAL CLOCK into the timestamp and tags it
 * "+00:00" regardless of the real offset: a 8:50 PM Seattle arrival comes back as
 * "…T20:50:00+00:00". Taking that at face value shifts every time by the airport's UTC
 * offset (seven or eight hours for Seattle) — which is exactly what made the live
 * system's delay sync write an evening arrival into a trip as 1:50 PM, and why that sync
 * had to be switched off. So the clock digits are read as local time in the arrival
 * airport's own zone, and the bogus offset is ignored.
 *
 * `zone` is the record's `arrival.timezone`; without one we fall back to the app's zone
 * (Pacific), which is right for the Seattle-area arrivals this product serves.
 */
export function parseLocalClock(value: string | null | undefined, zone?: string | null): Date | null {
  if (!value) return null;
  const digits = value.slice(0, 19);
  const parsed = DateTime.fromISO(digits, { zone: zone || APP_TIMEZONE });
  return parsed.isValid ? parsed.toJSDate() : null;
}

/** The airport-local calendar date (yyyy-mm-dd) a record is scheduled to land on. */
function localDateOf(value: string | undefined): string | null {
  const day = value?.slice(0, 10);
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/**
 * Chooses the record for the requested day. With no date it is the first record, as
 * before; with one, only that day's flight will do — returning a different day's flight
 * would show a customer someone else's arrival time.
 */
export function pickAviationRecord(
  records: AviationStackRecord[] | undefined,
  date?: string,
): AviationStackRecord | undefined {
  if (!records?.length) return undefined;
  if (!date) return records[0];
  return records.find((r) => localDateOf(r.arrival?.scheduled) === date);
}

async function fromAviationStack(flightNumber: string, options: FlightLookupOptions): Promise<FlightDetails> {
  const url = new URL('https://api.aviationstack.com/v1/flights');
  url.searchParams.set('access_key', env.FLIGHT_API_KEY as string);
  url.searchParams.set('flight_iata', flightNumber);
  // Several days of the same flight number come back; the date is picked out below.
  url.searchParams.set('limit', options.date ? '25' : '1');

  const body = (await getJson(url.toString(), {}, options.timeoutMs)) as AviationStackResponse;
  const record = pickAviationRecord(body.data, options.date);

  if (!record) throw new Error(`No aviationstack record for ${flightNumber}${options.date ? ` on ${options.date}` : ''}`);

  const zone = record.arrival?.timezone;
  return {
    flightNumber,
    status: normaliseStatus(record.flight_status),
    scheduledArrival: parseLocalClock(record.arrival?.scheduled, zone) ?? toDate(now().plus({ minutes: 90 })),
    estimatedArrival: parseLocalClock(record.arrival?.estimated, zone),
    actualArrival: parseLocalClock(record.arrival?.actual, zone),
    delayMinutes: typeof record.arrival?.delay === 'number' ? record.arrival.delay : null,
    arrivalAirport: record.arrival?.iata ?? null,
    provider: 'aviationstack',
    placeholder: false,
  };
}

/* -------------------------------- flightaware ----------------------------- */

export interface FlightAwareRecord {
  status?: string;
  scheduled_in?: string;
  estimated_in?: string;
  actual_in?: string;
  arrival_delay?: number | null;
  destination?: { code_iata?: string };
}

interface FlightAwareResponse {
  flights?: FlightAwareRecord[];
}

/** FlightAware sends real instants (…Z), so the day is judged in the app's own zone. */
export function pickFlightAwareRecord(
  records: FlightAwareRecord[] | undefined,
  date?: string,
): FlightAwareRecord | undefined {
  if (!records?.length) return undefined;
  if (!date) return records[0];
  return records.find((r) => {
    if (!r.scheduled_in) return false;
    const day = DateTime.fromISO(r.scheduled_in).setZone(APP_TIMEZONE).toISODate();
    return day === date;
  });
}

async function fromFlightAware(flightNumber: string, options: FlightLookupOptions): Promise<FlightDetails> {
  const url = `https://aeroapi.flightaware.com/aeroapi/flights/${encodeURIComponent(flightNumber)}`;

  const body = (await getJson(
    url,
    { 'x-apikey': env.FLIGHT_API_KEY as string },
    options.timeoutMs,
  )) as FlightAwareResponse;

  const record = pickFlightAwareRecord(body.flights, options.date);
  if (!record) throw new Error(`No flightaware record for ${flightNumber}${options.date ? ` on ${options.date}` : ''}`);

  return {
    flightNumber,
    status: normaliseStatus(record.status),
    scheduledArrival: parseDate(record.scheduled_in) ?? parseDate(record.estimated_in) ?? toDate(now().plus({ minutes: 90 })),
    estimatedArrival: parseDate(record.estimated_in),
    actualArrival: parseDate(record.actual_in),
    // FlightAware reports arrival delay in seconds.
    delayMinutes: typeof record.arrival_delay === 'number' ? Math.round(record.arrival_delay / 60) : null,
    arrivalAirport: record.destination?.code_iata ?? null,
    provider: 'flightaware',
    placeholder: false,
  };
}

/* ---------------------------------- shared -------------------------------- */

async function getJson(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export function normaliseStatus(raw?: string): FlightDetails['status'] {
  const value = (raw ?? '').toLowerCase();
  if (value.includes('cancel')) return 'cancelled';
  if (value.includes('land') || value.includes('arrived')) return 'landed';
  if (value.includes('active') || value.includes('en route') || value.includes('airborne')) return 'active';
  if (value.includes('schedul')) return 'scheduled';
  return 'unknown';
}

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value); // FlightAware timestamps are absolute (ISO/UTC), not wall time
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Deterministic stand-in used until a provider and key are configured. */
function mockFlight(flightNumber: string, provider: string): FlightDetails {
  logger.info('flightApi: returning mock data — no provider/key configured', { flightNumber, provider });

  return {
    flightNumber,
    status: 'scheduled',
    scheduledArrival: toDate(now().plus({ minutes: 90 })),
    estimatedArrival: null,
    actualArrival: null,
    delayMinutes: null,
    arrivalAirport: null,
    provider: provider || 'mock',
    placeholder: true,
  };
}
