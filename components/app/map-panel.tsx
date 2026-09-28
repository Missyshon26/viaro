import { cn } from "@/lib/utils";

/**
 * The map surface for live tracking.
 *
 * With a reported position it shows a dark, brand-styled map centred on the chauffeur
 * (drawn by /api/route-map?point=lat,lng, the same Static Maps route as the booking
 * preview). Without one — or if the map image cannot be drawn — it falls back to a
 * labelled panel. It used to show passengers a developer note about env variables.
 */
export function MapPanel({
  lat,
  lng,
  updatedAt,
  label,
  className,
}: {
  lat?: number;
  lng?: number;
  updatedAt?: string;
  label?: string;
  className?: string;
}) {
  const hasPosition = typeof lat === "number" && typeof lng === "number";
  const src = hasPosition
    ? `/api/route-map?point=${lat.toFixed(5)},${lng.toFixed(5)}&w=640&h=420`
    : null;

  return (
    <div
      className={cn(
        "relative flex min-h-[320px] items-center justify-center overflow-hidden rounded-xl border border-border bg-card/40",
        className,
      )}
    >
      {/* A faint grid, so without an image the panel still reads as a map surface. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)",
          backgroundSize: "36px 36px",
        }}
      />

      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- a same-origin API image
        <img
          src={src}
          alt={`Map showing ${label ?? "your chauffeur"}'s position`}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}

      <div
        className={cn(
          "relative z-10 px-6 text-center",
          src && "self-end mb-4 rounded-lg bg-background/85 px-4 py-2.5 backdrop-blur",
        )}
      >
        {hasPosition ? (
          <>
            <p className="text-sm font-medium text-foreground">{label ?? "Your chauffeur"}</p>
            {updatedAt ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Position updated{" "}
                {new Date(updatedAt).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No position reported yet. The map updates once the chauffeur is moving.
          </p>
        )}
      </div>
    </div>
  );
}
