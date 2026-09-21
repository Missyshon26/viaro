"use client";

import { useEffect, useState } from "react";

/**
 * The journey banner above the booking wizard: route, when, how far, how long, and a map.
 *
 * Split deliberately into what we know and what we do not:
 *
 *   KNOWN NOW      the two addresses, the date and time, and whether the pickup falls in
 *                  a peak window — the last one comes from the fare quote, so it is the
 *                  API's answer rather than this file's guess.
 *   NEEDS A KEY    distance, journey time and the map itself.
 *
 * The unknowns render as "—" and a labelled placeholder rather than plausible numbers.
 * A quote screen showing "15.0 miles · 17 min" that nobody calculated is a number a
 * customer would reasonably believe, and would then hold us to.
 *
 * Fill NEXT_PUBLIC_MAP_* and NEXT_PUBLIC_DIRECTIONS_* in .env.local and both halves
 * light up with no other change.
 */

const MAP_PROVIDER = process.env.NEXT_PUBLIC_MAP_PROVIDER ?? "";
const MAP_KEY = process.env.NEXT_PUBLIC_MAP_API_KEY ?? "";
// Only the flag is public. The Directions key lives server-side in /api/directions.
const DIRECTIONS_PROVIDER = process.env.NEXT_PUBLIC_DIRECTIONS_PROVIDER ?? "";

interface Route {
  distanceText: string;
  durationText: string;
}

export function RoutePreview({
  pickup,
  drop,
  date,
  time,
  isPeak,
}: {
  pickup: string;
  drop: string;
  /** yyyy-mm-dd, as the form holds it. */
  date: string;
  /** HH:mm, Pacific. */
  time: string;
  /** From the fare quote. Undefined before the journey has been priced. */
  isPeak?: boolean;
}) {
  const [route, setRoute] = useState<Route | null>(null);

  useEffect(() => {
    // Nothing to call until a directions provider exists; leave the figures unknown.
    if (!DIRECTIONS_PROVIDER || !pickup || !drop) {
      setRoute(null);
      return;
    }

    let cancelled = false;
    fetchRoute(pickup, drop)
      .then((result) => {
        if (!cancelled) setRoute(result);
      })
      .catch(() => {
        // A failed lookup is the same as no lookup: show nothing rather than a guess.
        if (!cancelled) setRoute(null);
      });

    return () => {
      cancelled = true;
    };
  }, [pickup, drop]);

  const when = formatWhen(date, time);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-secondary/40">
      {/* ------------------------------- summary ------------------------------- */}
      <div className="px-5 py-4">
        <h2 className="text-base font-semibold leading-snug text-foreground">
          <span>{pickup || "Pickup"}</span>
          <span aria-hidden className="mx-2 text-muted-foreground">
            →
          </span>
          <span>{drop || "Drop-off"}</span>
        </h2>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{when.date}</span>
          <Divider />
          <span>{when.time} PT</span>
          <Divider />
          <span title={route ? undefined : "Needs a directions provider"}>
            {route ? route.durationText : "— min"}
          </span>
          <Divider />
          <span title={route ? undefined : "Needs a directions provider"}>
            {route ? route.distanceText : "— miles"}
          </span>
          {isPeak !== undefined ? (
            <>
              <Divider />
              <span
                className={
                  isPeak ? "font-medium text-amber-400" : "font-medium text-muted-foreground"
                }
              >
                {isPeak ? "Peak time" : "Off peak"}
              </span>
            </>
          ) : null}
        </div>
      </div>

      {/* --------------------------------- map --------------------------------- */}
      <div className="relative aspect-[21/9] w-full border-t border-border bg-black sm:aspect-[24/7]">
        {MAP_PROVIDER && MAP_KEY && pickup && drop ? (
          <iframe
            title={`Route from ${pickup} to ${drop}`}
            src={mapEmbedUrl(pickup, drop)}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="absolute inset-0 h-full w-full border-0"
          />
        ) : (
          <MapPlaceholder pickup={pickup} drop={drop} />
        )}
      </div>
    </section>
  );
}

function Divider() {
  return (
    <span aria-hidden className="text-border">
      |
    </span>
  );
}

/**
 * Stand-in for the map.
 *
 * Draws the shape of the answer — two points and a path — without pretending to know the
 * geography. It is obviously a diagram, which is the point: a fake map with real-looking
 * roads would be worse than none.
 */
function MapPlaceholder({ pickup, drop }: { pickup: string; drop: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.06),transparent_70%)] px-6 text-center">
      <svg
        viewBox="0 0 220 60"
        className="h-14 w-auto max-w-full text-muted-foreground/50"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden
      >
        <path d="M28 30h40c14 0 14 -16 28 -16h28c14 0 14 32 28 32h32" strokeDasharray="5 5" />
        <circle cx="20" cy="30" r="7" className="fill-current/10" />
        <text x="20" y="34" textAnchor="middle" className="fill-current text-[10px] font-bold" stroke="none">
          A
        </text>
        <circle cx="196" cy="46" r="7" className="fill-current/10" />
        <text x="196" y="50" textAnchor="middle" className="fill-current text-[10px] font-bold" stroke="none">
          B
        </text>
      </svg>

      <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
        {pickup && drop
          ? "The route map appears here once a map provider is configured."
          : "Enter a pickup and drop-off to preview the route."}
      </p>
    </div>
  );
}

/* ---------------------------------- helpers -------------------------------- */

function formatWhen(date: string, time: string) {
  if (!date) return { date: "—", time: time || "—" };
  const parsed = new Date(`${date}T${time || "00:00"}:00`);
  if (Number.isNaN(parsed.getTime())) return { date, time: time || "—" };

  return {
    date: parsed.toLocaleDateString("en-US", {
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
    }),
    time: parsed.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
  };
}

/** Google's Embed API and Mapbox's static image take different shapes. */
function mapEmbedUrl(pickup: string, drop: string) {
  const origin = encodeURIComponent(pickup);
  const destination = encodeURIComponent(drop);

  if (MAP_PROVIDER === "mapbox") {
    // Mapbox has no directions *embed*; the static endpoint needs coordinates rather
    // than addresses, so this is the documented place to swap in a geocoded pair.
    return `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/auto/1000x300?access_token=${MAP_KEY}`;
  }

  return `https://www.google.com/maps/embed/v1/directions?key=${MAP_KEY}&origin=${origin}&destination=${destination}&mode=driving`;
}

/**
 * Distance and journey time, via our own Route Handler.
 *
 * Both providers need a server-side call — their browser CORS rules block a direct
 * fetch, and the key would be exposed anyway — so /api/directions holds the credential
 * and this only ever talks to our own origin. The handler returns null rather than an
 * estimate on every failure path, which keeps the banner honest.
 */
async function fetchRoute(pickup: string, drop: string): Promise<Route | null> {
  const query = new URLSearchParams({ origin: pickup, destination: drop });
  const response = await fetch(`/api/directions?${query}`, { cache: "no-store" });

  if (!response.ok) return null;

  const body = (await response.json()) as { route: Route | null };
  return body.route;
}
