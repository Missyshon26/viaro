/**
 * Address suggestions for the pickup and drop-off fields (homepage widget and /book).
 *
 * Server-side rather than the browser SDK for one reason: the Places key would
 * otherwise be inlined into the bundle. Only the Embed key has to be public (an
 * iframe src cannot hide it); this one does not, so it stays here.
 *
 * Google Places first. If it is not configured, or refuses (a key restricted to another
 * referrer, lapsed billing, the Places API not enabled), fall back to Photon — the
 * OpenStreetMap geocoder built for type-ahead, which needs no key. Suggestions were
 * otherwise silently absent whenever Google said no, and the fields looked broken.
 *
 * Returns descriptions only. The form posts the address text it already posted
 * before autocomplete existed, so nothing downstream had to change.
 */
export const runtime = "nodejs";

const KEY = process.env.DIRECTIONS_API_KEY ?? "";
// Maps, directions and places are always Google; the key being set is the switch.

const MAX_SUGGESTIONS = 5;

export interface PlaceSuggestion {
  description: string;
  placeId: string;
}

export async function GET(request: Request): Promise<Response> {
  const input = new URL(request.url).searchParams.get("input")?.trim() ?? "";

  // Below three characters the predictions are noise, and each call is billable.
  if (input.length < 3) {
    return Response.json({ suggestions: [] });
  }

  const google = KEY ? await fromGoogle(input, request.signal) : null;
  const suggestions = google ?? (await fromPhoton(input, request.signal)) ?? [];

  return Response.json({ suggestions });
}

/** null means "Google could not answer" (as opposed to "no matches"), so try the fallback. */
async function fromGoogle(input: string, signal: AbortSignal): Promise<PlaceSuggestion[] | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
  url.searchParams.set("input", input);
  url.searchParams.set("key", KEY);
  // A chauffeur booking is an address or a named venue, never a whole city.
  url.searchParams.set("types", "geocode|establishment");
  url.searchParams.set("components", "country:us|country:ca");

  try {
    const upstream = await fetch(url, { cache: "no-store", signal });
    if (!upstream.ok) return null;

    const body = (await upstream.json()) as {
      status?: string;
      predictions?: { description?: string; place_id?: string }[];
    };

    // Google reports its own failures in the body with HTTP 200 — REQUEST_DENIED for a
    // key that lacks the Places API, OVER_QUERY_LIMIT when billing lapses.
    if (body.status === "ZERO_RESULTS") return [];
    if (body.status !== "OK") {
      console.warn(`[places] google ${body.status ?? "unknown status"} — falling back to Photon`);
      return null;
    }

    return (body.predictions ?? [])
      .flatMap((p) =>
        p.description && p.place_id ? [{ description: p.description, placeId: p.place_id }] : [],
      )
      .slice(0, MAX_SUGGESTIONS);
  } catch {
    return null;
  }
}

interface PhotonFeature {
  properties: {
    osm_id?: number;
    osm_type?: string;
    name?: string;
    housenumber?: string;
    street?: string;
    city?: string;
    district?: string;
    state?: string;
    postcode?: string;
    countrycode?: string;
  };
}

async function fromPhoton(input: string, signal: AbortSignal): Promise<PlaceSuggestion[] | null> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", input);
  url.searchParams.set("limit", "10");
  url.searchParams.set("lang", "en");
  // Bias toward the Seattle service area without excluding the rest of North America.
  url.searchParams.set("lat", "47.6062");
  url.searchParams.set("lon", "-122.3321");

  try {
    const upstream = await fetch(url, {
      cache: "no-store",
      signal,
      headers: { "User-Agent": "viaro-frontend/1.0 (reservations@viaro.io)" },
    });
    if (!upstream.ok) return null;

    const body = (await upstream.json()) as { features?: PhotonFeature[] };
    const seen = new Set<string>();

    return (body.features ?? [])
      .filter((f) => f.properties.countrycode === "US" || f.properties.countrycode === "CA")
      .flatMap((f) => {
        const p = f.properties;
        const street = [p.housenumber, p.street].filter(Boolean).join(" ");
        const parts = [
          p.name && p.name !== street ? p.name : null,
          street || null,
          p.city ?? p.district ?? null,
          [p.state, p.postcode].filter(Boolean).join(" ") || null,
          p.countrycode === "CA" ? "Canada" : "USA",
        ].filter(Boolean);
        const description = parts.join(", ");
        if (seen.has(description) || parts.length < 3) return [];
        seen.add(description);
        return [{ description, placeId: `osm:${p.osm_type ?? ""}${p.osm_id ?? description}` }];
      })
      .slice(0, MAX_SUGGESTIONS);
  } catch {
    return null;
  }
}
