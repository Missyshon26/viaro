import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env';
import {
  expectedArrival,
  fetchFlightDetails,
  normaliseStatus,
  parseLocalClock,
  pickAviationRecord,
  pickFlightAwareRecord,
  type AviationStackRecord,
} from '../src/integrations/flightApi';

describe('parseLocalClock — AviationStack local-clock timestamps', () => {
  it('reads the digits as the airport\'s own local time, ignoring the fake +00:00', () => {
    // 8:50 PM in Seattle on 26 Oct 2026 (PDT, UTC-7) is 03:50 UTC the next day.
    const date = parseLocalClock('2026-10-26T20:50:00+00:00', 'America/Los_Angeles');
    expect(date?.toISOString()).toBe('2026-10-27T03:50:00.000Z');
  });

  it('follows daylight saving: the same clock reading in winter is eight hours behind UTC', () => {
    const date = parseLocalClock('2026-12-01T20:50:00+00:00', 'America/Los_Angeles');
    expect(date?.toISOString()).toBe('2026-12-02T04:50:00.000Z');
  });

  it('uses the arrival airport\'s zone, not Pacific, when the record names one', () => {
    const date = parseLocalClock('2026-10-26T20:50:00+00:00', 'America/New_York');
    expect(date?.toISOString()).toBe('2026-10-27T00:50:00.000Z');
  });

  it('falls back to Pacific when there is no zone', () => {
    expect(parseLocalClock('2026-10-26T20:50:00+00:00')?.toISOString()).toBe('2026-10-27T03:50:00.000Z');
  });

  it.each([[undefined], [null], [''], ['not a date']])('returns null for %s', (value) => {
    expect(parseLocalClock(value as string | null | undefined, 'America/Los_Angeles')).toBeNull();
  });
});

const record = (day: string, extra: Partial<AviationStackRecord['arrival']> = {}): AviationStackRecord => ({
  flight_status: 'scheduled',
  arrival: { scheduled: `${day}T20:50:00+00:00`, timezone: 'America/Los_Angeles', iata: 'SEA', ...extra },
});

describe('picking the right day\'s flight', () => {
  const records = [record('2026-10-25'), record('2026-10-26'), record('2026-10-27')];

  it('takes the first record when no date is asked for', () => {
    expect(pickAviationRecord(records)).toBe(records[0]);
  });

  it('takes the record for the requested day', () => {
    expect(pickAviationRecord(records, '2026-10-26')).toBe(records[1]);
  });

  it('returns nothing rather than a different day\'s flight', () => {
    expect(pickAviationRecord(records, '2026-11-02')).toBeUndefined();
    expect(pickAviationRecord([], '2026-10-26')).toBeUndefined();
    expect(pickAviationRecord(undefined)).toBeUndefined();
  });

  it('judges FlightAware days in Pacific time, not UTC', () => {
    // 03:50Z on the 27th is 8:50 PM on the 26th in Seattle.
    const list = [{ scheduled_in: '2026-10-27T03:50:00Z' }, { scheduled_in: '2026-10-28T03:50:00Z' }];
    expect(pickFlightAwareRecord(list, '2026-10-26')).toBe(list[0]);
    expect(pickFlightAwareRecord(list, '2026-10-27')).toBe(list[1]);
    expect(pickFlightAwareRecord(list, '2026-10-30')).toBeUndefined();
  });
});

describe('normaliseStatus', () => {
  it.each([
    ['landed', 'landed'],
    ['Arrived', 'landed'],
    ['active', 'active'],
    ['En Route', 'active'],
    ['scheduled', 'scheduled'],
    ['cancelled', 'cancelled'],
    ['canceled', 'cancelled'],
    ['', 'unknown'],
    ['diverted', 'unknown'],
  ])('%s -> %s', (raw, expected) => {
    expect(normaliseStatus(raw)).toBe(expected);
  });
});

describe('fetchFlightDetails', () => {
  const original = { provider: env.FLIGHT_API_PROVIDER, key: env.FLIGHT_API_KEY };
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    env.FLIGHT_API_PROVIDER = original.provider;
    env.FLIGHT_API_KEY = original.key;
  });

  const respond = (body: unknown) =>
    fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: 'OK', json: async () => body });

  it('is clearly marked as a placeholder when no provider is configured', async () => {
    env.FLIGHT_API_PROVIDER = undefined;
    env.FLIGHT_API_KEY = undefined;
    const flight = await fetchFlightDetails('as 123');
    expect(flight).toMatchObject({ flightNumber: 'AS123', placeholder: true, provider: 'mock' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads AviationStack times as local, picks the requested day and exposes the delay', async () => {
    env.FLIGHT_API_PROVIDER = 'aviationstack';
    env.FLIGHT_API_KEY = 'key';
    respond({
      data: [
        record('2026-10-25'),
        record('2026-10-26', { estimated: '2026-10-26T21:20:00+00:00', delay: 30 }),
      ],
    });

    const flight = await fetchFlightDetails('AS 123', { date: '2026-10-26' });

    expect(flight.placeholder).toBe(false);
    expect(flight.scheduledArrival.toISOString()).toBe('2026-10-27T03:50:00.000Z');
    expect(flight.estimatedArrival?.toISOString()).toBe('2026-10-27T04:20:00.000Z');
    expect(flight.delayMinutes).toBe(30);
    expect(flight.arrivalAirport).toBe('SEA');
    expect(expectedArrival(flight).toISOString()).toBe('2026-10-27T04:20:00.000Z');

    const requested = new URL(fetchMock.mock.calls[0][0] as string);
    expect(requested.searchParams.get('flight_iata')).toBe('AS123');
    expect(requested.searchParams.get('limit')).toBe('25');
  });

  it('falls back to the placeholder — not another day\'s flight — when the day is missing', async () => {
    env.FLIGHT_API_PROVIDER = 'aviationstack';
    env.FLIGHT_API_KEY = 'key';
    respond({ data: [record('2026-10-25')] });

    const flight = await fetchFlightDetails('AS123', { date: '2026-10-26' });
    expect(flight.placeholder).toBe(true);
  });

  it('falls back to the placeholder when the provider errors', async () => {
    env.FLIGHT_API_PROVIDER = 'aviationstack';
    env.FLIGHT_API_KEY = 'key';
    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error', json: async () => ({}) });
    expect((await fetchFlightDetails('AS123')).placeholder).toBe(true);
  });

  it('reads FlightAware instants, forecast and delay (seconds)', async () => {
    env.FLIGHT_API_PROVIDER = 'flightaware';
    env.FLIGHT_API_KEY = 'key';
    respond({
      flights: [
        {
          status: 'En Route',
          scheduled_in: '2026-10-27T03:50:00Z',
          estimated_in: '2026-10-27T04:20:00Z',
          arrival_delay: 1800,
          destination: { code_iata: 'SEA' },
        },
      ],
    });

    const flight = await fetchFlightDetails('AS123', { date: '2026-10-26' });
    expect(flight).toMatchObject({ status: 'active', delayMinutes: 30, arrivalAirport: 'SEA', placeholder: false });
    expect(expectedArrival(flight).toISOString()).toBe('2026-10-27T04:20:00.000Z');
  });
});
