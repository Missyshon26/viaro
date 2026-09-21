/**
 * Distance and journey time for the booking wizard's route banner.
 *
 * The banner deliberately shows "—" rather than a plausible guess, so this handler
 * returns null on every failure path instead of substituting an estimate. A mileage
 * on a quote screen is a number a customer would reasonably believe.
 *
 * Server-side because Google blocks a browser fetch to Directions by CORS, and
 * because the key should not be in the bundle.
 */
export const runtime = "nodejs";

const KEY = process.env.DIRECTIONS_API_KEY ?? "";
const PROVIDER = process.env.DIRECTIONS_PROVIDER ?? "";

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const origin = params.get("origin")?.trim() ?? "";
  const destination = params.get("destination")?.trim() ?? "";

  if (!PROVIDER || !KEY || !origin || !destination) {
    return Response.json({ route: null });
  }

  const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
  url.searchParams.set("origin", origin);
  url.searchParams.set("destination", destination);
  url.searchParams.set("mode", "driving");
  url.searchParams.set("units", "imperial");
  url.searchParams.set("key", KEY);

  let upstream: Response;
  try {
    upstream = await fetch(url, { cache: "no-store", signal: request.signal });
  } catch {
    return Response.json({ route: null });
  }

  if (!upstream.ok) {
    return Response.json({ route: null });
  }

  const body = (await upstream.json()) as {
    status?: string;
    routes?: { legs?: { distance?: { text?: string }; duration?: { text?: string } }[] }[];
  };

  // As with Places, Google signals failure in the body rather than the status code.
  if (body.status !== "OK") {
    if (body.status !== "ZERO_RESULTS") {
      console.warn(`[directions] ${body.status ?? "unknown status"}`);
    }
    return Response.json({ route: null });
  }

  const leg = body.routes?.[0]?.legs?.[0];
  if (!leg?.distance?.text || !leg.duration?.text) {
    return Response.json({ route: null });
  }

  return Response.json({
    route: { distanceText: leg.distance.text, durationText: leg.duration.text },
  });
}
