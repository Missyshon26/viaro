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
 * The map is drawn by /api/route-map and the figures come from /api/directions; both
 * need DIRECTIONS_API_KEY with the Directions and Static Maps APIs enabled.
 */

// The Directions key lives server-side: /api/directions answers null when it is unset,
// so no public flag is needed to decide whether to ask.

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
    if (!pickup || !drop) {
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
  const [mapFailed, setMapFailed] = useState(false);
  const mapSrc =
    pickup && drop
      ? `/api/route-map?${new URLSearchParams({ origin: pickup, destination: drop, w: "640", h: "240" })}`
      : null;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- new route, new attempt
    setMapFailed(false);
  }, [mapSrc]);

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      {/*
        A dark, brand-coloured static map (see /api/route-map) instead of Google's
        embedded directions widget — the white Google UI and its side panel inside a
        thin strip is what read as "tacky" next to the rest of the page.
      */}
      <div className="relative aspect-[16/9] w-full bg-ink sm:aspect-[8/3]">
        {mapSrc && !mapFailed ? (
          // eslint-disable-next-line @next/next/no-img-element -- a same-origin API image, not a static asset
          <img
            src={mapSrc}
            alt={`Route from ${pickup} to ${drop}`}
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => setMapFailed(true)}
            onLoad={(event) => {
              // 204 from the API (no key, API disabled) loads as a zero-size image.
              if (event.currentTarget.naturalWidth === 0) setMapFailed(true);
            }}
          />
        ) : (
          <MapPlaceholder pickup={pickup} drop={drop} />
        )}
      </div>

      <div className="px-5 pb-5 pt-4">
        <ol className="relative space-y-3 rounded-xl border border-border bg-background/95 p-4 pl-10 backdrop-blur">
          <span aria-hidden className="absolute bottom-7 left-[1.4rem] top-7 w-px bg-border" />
          <li className="relative">
            <span aria-hidden className="absolute -left-[1.4rem] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-azure text-[9px] font-bold text-ink">A</span>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Pickup</p>
            <p className="truncate text-sm font-medium text-cloud" title={pickup}>{pickup || "—"}</p>
          </li>
          <li className="relative">
            <span aria-hidden className="absolute -left-[1.4rem] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-cloud text-[9px] font-bold text-ink">B</span>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Drop-off</p>
            <p className="truncate text-sm font-medium text-cloud" title={drop}>{drop || "—"}</p>
          </li>
        </ol>

        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Date" value={when.date} />
          <Stat label="Pickup time" value={`${when.time} PT`} />
          <Stat
            label="Journey"
            value={route ? route.durationText : "—"}
            title={route ? undefined : "Needs a directions provider"}
          />
          <Stat
            label="Distance"
            value={route ? route.distanceText : "—"}
            title={route ? undefined : "Needs a directions provider"}
          />
        </dl>
        {isPeak !== undefined ? (
          <p className={`mt-3 text-xs ${isPeak ? "text-azure" : "text-muted-foreground"}`}>
            {isPeak ? "Peak-hour pickup — the plan waives the surcharge." : "Off-peak pickup."}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/60 px-3 py-2" title={title}>
      <dt className="text-[0.7rem] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium text-cloud">{value}</dd>
    </div>
  );
}

/**
 * Stand-in for the map when none can be drawn.
 *
 * Draws the shape of the answer — two points and a path — without pretending to know the
 * geography. It is obviously a diagram, which is the point: a fake map with real-looking
 * roads would be worse than none.
 */
function MapPlaceholder({ pickup, drop }: { pickup: string; drop: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_50%_0%,rgba(96,150,186,0.12),transparent_70%)] px-6 text-center">
      <svg
        viewBox="0 0 220 60"
        className="h-14 w-auto max-w-full text-azure/60"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden
      >
        <path d="M28 30h40c14 0 14 -16 28 -16h28c14 0 14 32 28 32h32" strokeDasharray="5 5" />
        <circle cx="20" cy="30" r="6" className="fill-current" />
        <circle cx="196" cy="46" r="6" />
      </svg>
      <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
        {pickup && drop ? "Route map unavailable right now." : "Enter a pickup and drop-off to preview the route."}
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
      weekday: "short",
      month: "short",
      day: "numeric",
    }),
    time: parsed.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
  };
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
