/**
 * Address suggestions for the booking form's pickup and drop-off fields.
 *
 * Server-side rather than the browser SDK for one reason: the Places key would
 * otherwise be inlined into the bundle. Only the Embed key has to be public (an
 * iframe src cannot hide it); this one does not, so it stays here.
 *
 * Returns descriptions only. The form posts the address text it already posted
 * before autocomplete existed, so nothing downstream had to change.
 */
export const runtime = "nodejs";

const KEY = process.env.DIRECTIONS_API_KEY ?? "";
const PROVIDER = process.env.DIRECTIONS_PROVIDER ?? "";

export interface PlaceSuggestion {
  description: string;
  placeId: string;
}

export async function GET(request: Request): Promise<Response> {
  const input = new URL(request.url).searchParams.get("input")?.trim() ?? "";

  // Below three characters the predictions are noise, and each call is billable.
  if (!PROVIDER || !KEY || input.length < 3) {
    return Response.json({ suggestions: [] });
  }

  const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
  url.searchParams.set("input", input);
  url.searchParams.set("key", KEY);
  // A chauffeur booking is an address or a named venue, never a whole city.
  url.searchParams.set("types", "geocode|establishment");
  url.searchParams.set("components", "country:us");

  let upstream: Response;
  try {
    upstream = await fetch(url, { cache: "no-store", signal: request.signal });
  } catch {
    // A failed lookup degrades to a plain text field rather than blocking the booking.
    return Response.json({ suggestions: [] });
  }

  if (!upstream.ok) {
    return Response.json({ suggestions: [] });
  }

  const body = (await upstream.json()) as {
    status?: string;
    predictions?: { description?: string; place_id?: string }[];
  };

  // Google reports its own failures in the body with HTTP 200 — REQUEST_DENIED for a
  // key that lacks the Places API, OVER_QUERY_LIMIT when billing lapses.
  if (body.status !== "OK" && body.status !== "ZERO_RESULTS") {
    console.warn(`[places] ${body.status ?? "unknown status"}`);
    return Response.json({ suggestions: [] });
  }

  const suggestions: PlaceSuggestion[] = (body.predictions ?? [])
    .flatMap((p) =>
      p.description && p.place_id
        ? [{ description: p.description, placeId: p.place_id }]
        : [],
    )
    .slice(0, 5);

  return Response.json({ suggestions });
}
