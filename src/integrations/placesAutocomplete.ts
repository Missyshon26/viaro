import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Address suggestions for the admin trip forms, from Google Places, with the server key.
 *
 * The key never leaves the server, and the route that calls this is admin-only, so the billable
 * quota cannot be spent by anyone else. Failures answer "no suggestions" rather than an error:
 * the field is still a plain text box and the operator can type the address.
 */
export interface PlaceSuggestion {
  description: string;
  placeId: string;
}

const MAX_SUGGESTIONS = 5;

export async function autocompletePlaces(input: string): Promise<PlaceSuggestion[]> {
  const key = env.GOOGLE_MAPS_SERVER_KEY;
  const text = input.trim();
  // Below three characters the predictions are noise, and each call is billable.
  if (!key || text.length < 3) return [];

  const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
  url.searchParams.set('input', text);
  url.searchParams.set('key', key);
  url.searchParams.set('types', 'geocode|establishment');
  url.searchParams.set('components', 'country:us|country:ca');

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const body = (await res.json()) as {
      status?: string;
      predictions?: { description?: string; place_id?: string }[];
    };
    if (body.status !== 'OK') {
      if (body.status && body.status !== 'ZERO_RESULTS') logger.warn(`[places] google ${body.status}`);
      return [];
    }
    return (body.predictions ?? [])
      .flatMap((p) => (p.description && p.place_id ? [{ description: p.description, placeId: p.place_id }] : []))
      .slice(0, MAX_SUGGESTIONS);
  } catch (err) {
    logger.warn('[places] autocomplete failed', err);
    return [];
  }
}
