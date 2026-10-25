import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/env', () => ({ env: { GOOGLE_MAPS_SERVER_KEY: 'server-key' } }));
import { clearRouteDistanceCache, routeMiles } from '../src/integrations/routeDistance';

const METERS_PER_MILE = 1609.344;
const answer = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as Response) as unknown as typeof fetch;
const route = (...miles: number[]) => ({
  status: 'OK',
  routes: [{ legs: miles.map((m) => ({ distance: { value: m * METERS_PER_MILE } })) }],
});

beforeEach(clearRouteDistanceCache);

describe('routeMiles', () => {
  it('measures the whole route, through its stops, in miles', async () => {
    const f = answer(route(5, 7.5, 10));
    expect(await routeMiles('A St, Seattle', 'B St, Tacoma', ['Stop 1', 'Stop 2'], f)).toBeCloseTo(22.5, 5);
    const url = new URL(String(vi.mocked(f).mock.calls[0][0]));
    expect(url.searchParams.get('waypoints')).toBe('Stop 1|Stop 2');
    expect(url.searchParams.get('key')).toBe('server-key');
    expect(url.searchParams.get('origin')).toBe('A St, Seattle');
  });

  it('remembers a measured route, so one journey priced for every class asks Google once', async () => {
    const f = answer(route(12));
    await routeMiles('A St', 'B St', [], f);
    await routeMiles('a st', ' B  St ', [], f);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('says null when there is no route, and does not guess', async () => {
    expect(await routeMiles('Nowhere', 'Else', [], answer({ status: 'ZERO_RESULTS', routes: [] }))).toBeNull();
    expect(await routeMiles('A St', 'B St', [], answer({ status: 'REQUEST_DENIED' }))).toBeNull();
    expect(await routeMiles('A St', 'B St', [], answer({}, false))).toBeNull();
    expect(await routeMiles('A St', 'B St', [], answer({ status: 'OK', routes: [{ legs: [{}] }] }))).toBeNull();
  });

  it('does not remember a lookup that FAILED, so the next one tries again', async () => {
    const down = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await routeMiles('A St', 'B St', [], down)).toBeNull();
    const up = answer(route(9));
    expect(await routeMiles('A St', 'B St', [], up)).toBeCloseTo(9, 5);
  });

  it('refuses addresses too short to look up', async () => {
    const f = answer(route(3));
    expect(await routeMiles('A', 'B St', [], f)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});
