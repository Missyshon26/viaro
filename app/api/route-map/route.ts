/**
 * A route map image for the booking wizard, in the brand's colours.
 *
 * Replaces the Google Maps Embed iframe, which rendered Google's own light UI — the
 * directions side panel, "View larger map", a white basemap — squeezed into a thin strip
 * of an otherwise black page. This asks Directions for the route, then draws it with the
 * Static Maps API: a dark basemap, the path in Azure Drive, pickup and drop-off pins.
 *
 * Server-side for the same reason as /api/directions: the key stays out of the bundle.
 * Any failure returns 204 and the client falls back to its placeholder.
 */
export const runtime = "nodejs";

const KEY = process.env.DIRECTIONS_API_KEY ?? "";
// Maps, directions and places are always Google; the key being set is the switch.

/** Brand palette: Executive Black land, near-black water, muted roads, no POI clutter. */
const STYLE = [
  "element:geometry|color:0x0e0f10",
  "element:labels.text.fill|color:0x8a9590",
  "element:labels.text.stroke|color:0x060606",
  "element:labels.icon|visibility:off",
  "feature:road.highway|element:labels.icon|visibility:off",
  "feature:poi|visibility:off",
  "feature:transit|visibility:off",
  "feature:administrative|element:geometry|visibility:off",
  "feature:road|element:geometry|color:0x1f2224",
  "feature:road|element:labels|visibility:simplified",
  "feature:road.highway|element:geometry|color:0x2b3033",
  "feature:road.arterial|element:labels|visibility:off",
  "feature:water|element:geometry|color:0x060606",
  "feature:landscape.natural|element:geometry|color:0x0b0c0d",
];

const noImage = () => new Response(null, { status: 204 });

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const origin = params.get("origin")?.trim() ?? "";
  // `point=lat,lng` draws one position (live tracking) instead of a route.
  const point = params.get("point")?.trim() ?? "";
  const destination = params.get("destination")?.trim() ?? "";
  // Requested pixel size, clamped to what Static Maps allows (640 × scale 2).
  const width = Math.min(Math.max(Number(params.get("w")) || 640, 200), 640);
  const height = Math.min(Math.max(Number(params.get("h")) || 280, 120), 640);

  if (!KEY) return noImage();

  if (/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(point)) {
    const map = new URL("https://maps.googleapis.com/maps/api/staticmap");
    map.searchParams.set("size", `${width}x${height}`);
    map.searchParams.set("scale", "2");
    map.searchParams.set("zoom", "14");
    map.searchParams.set("center", point);
    for (const rule of STYLE) map.searchParams.append("style", rule);
    map.searchParams.append("markers", `size:mid|color:0x6096ba|${point}`);
    map.searchParams.set("key", KEY);
    return proxyImage(map, request.signal);
  }
  if (!origin || !destination) return noImage();

  // 1. The route's shape.
  let polyline: string | undefined;
  try {
    const directions = new URL("https://maps.googleapis.com/maps/api/directions/json");
    directions.searchParams.set("origin", origin);
    directions.searchParams.set("destination", destination);
    directions.searchParams.set("mode", "driving");
    directions.searchParams.set("key", KEY);
    const res = await fetch(directions, { signal: request.signal, next: { revalidate: 3600 } });
    const body = (await res.json()) as {
      status?: string;
      routes?: { overview_polyline?: { points?: string } }[];
    };
    if (body.status !== "OK") return noImage();
    polyline = body.routes?.[0]?.overview_polyline?.points;
  } catch {
    return noImage();
  }
  if (!polyline) return noImage();

  // 2. The picture.
  const map = new URL("https://maps.googleapis.com/maps/api/staticmap");
  map.searchParams.set("size", `${width}x${height}`);
  map.searchParams.set("scale", "2");
  map.searchParams.set("maptype", "roadmap");
  for (const rule of STYLE) map.searchParams.append("style", rule);
  map.searchParams.set("path", `color:0x6096baff|weight:5|enc:${polyline}`);
  map.searchParams.append("markers", `size:mid|color:0x6096ba|label:A|${origin}`);
  map.searchParams.append("markers", `size:mid|color:0xe1efe6|label:B|${destination}`);
  map.searchParams.set("key", KEY);

  return proxyImage(map, request.signal);
}

/** Fetches a Static Maps image and streams it back, or 204 on any failure. */
async function proxyImage(map: URL, signal: AbortSignal): Promise<Response> {
  try {
    const image = await fetch(map, { signal, next: { revalidate: 3600 } });
    const type = image.headers.get("content-type") ?? "";
    // Google answers errors (API not enabled, bad key) with a 403 image or text.
    if (!image.ok || !type.startsWith("image/")) {
      console.warn(`[route-map] static map unavailable (${image.status})`);
      return noImage();
    }
    return new Response(image.body, {
      headers: { "Content-Type": type, "Cache-Control": "private, max-age=300" },
    });
  } catch {
    return noImage();
  }
}
