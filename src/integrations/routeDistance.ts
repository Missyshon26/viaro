import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * How far a journey is, worked out HERE rather than taken from the request.
 *
 * A fare that depends on distance must not depend on a distance the customer's browser reports:
 * anyone could send 1 mile. So the server asks Google's Directions service itself, with a
 * server key (GOOGLE_MAPS_SERVER_KEY), for the route from pickup through any stops to drop-off.
 *
 * Returns null when it cannot say (no key, Google unreachable, address not found). The caller
 * decides what that means for the price; this never guesses a distance.
 *
 * Answers are kept for a while: pricing a journey asks the same question once per vehicle
 * class, and a customer going back and forth over the steps asks it again.
 */
const METERS_PER_MILE = 1609.344;
const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 500;

const cache = new Map<string, { miles: number | null; expires: number }>();

export const isRouteDistanceEnabled = (): boolean => Boolean(env.GOOGLE_MAPS_SERVER_KEY);

const tidy = (s: string): string => s.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);

export async function routeMiles(
  origin: string,
  destination: string,
  stops: readonly string[] = [],
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  const key = env.GOOGLE_MAPS_SERVER_KEY;
  const from = tidy(origin);
  const to = tidy(destination);
  const via = stops.map(tidy).filter((s) => s.length >= 3).slice(0, 5);
  if (!key || from.length < 3 || to.length < 3) return null;

  const cacheKey = JSON.stringify([from.toLowerCase(), to.toLowerCase(), via.map((s) => s.toLowerCase())]);
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.miles;

  const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
  url.searchParams.set('origin', from);
  url.searchParams.set('destination', to);
  if (via.length) url.searchParams.set('waypoints', via.join('|'));
  url.searchParams.set('mode', 'driving');
  url.searchParams.set('key', key);

  let miles: number | null = null;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const body = (await res.json()) as { status?: string; routes?: { legs?: { distance?: { value?: number } }[] }[] };
      if (body.status === 'OK') {
        const legs = body.routes?.[0]?.legs ?? [];
        const meters = legs.reduce((sum, leg) => sum + (leg.distance?.value ?? NaN), 0);
        if (legs.length > 0 && Number.isFinite(meters)) miles = meters / METERS_PER_MILE;
      } else if (body.status !== 'ZERO_RESULTS' && body.status !== 'NOT_FOUND') {
        logger.warn(`Directions answered ${body.status ?? 'with no status'}`);
      }
    }
  } catch (err) {
    logger.warn('Directions lookup failed', err);
    // A lookup that FAILED (as opposed to finding no route) is not remembered: the next
    // request should try again rather than inherit a gap for half an hour.
    return null;
  }

  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(cacheKey, { miles, expires: Date.now() + TTL_MS });
  return miles;
}

/** For tests: forget everything remembered. */
export const clearRouteDistanceCache = (): void => cache.clear();
