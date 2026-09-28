import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageShell, Panel, EmptyState, SectionTitle, formatDate } from "@/components/app/shell";
import { RemoveFavoriteButton } from "@/components/app/trip-forms";
import { AddFavoriteButton } from "@/components/app/favorite-forms";
import { StatusBadge } from "@/components/app/status-badge";
import { apiOptional } from "@/lib/api/client";
import { listMyRides } from "@/lib/api/bookings";
import { VEHICLE_CLASSES } from "@/lib/constants";
import type { Driver } from "@/lib/api/types";

export const metadata: Metadata = {
  title: "Favourite chauffeurs | Viaro",
  robots: { index: false, follow: false },
};

const vehicleLabel = (value?: string) =>
  VEHICLE_CLASSES.find((v) => v.value === value)?.label ?? value ?? "Chauffeur";

const AVAILABILITY: Record<string, { label: string; tone: "success" | "warning" | "neutral" }> = {
  available: { label: "Available", tone: "success" },
  busy: { label: "On a trip", tone: "warning" },
  offline: { label: "Off duty", tone: "neutral" },
};

/**
 * Favourites are chosen from experience: the chauffeurs who have actually driven this
 * passenger. There is no search by name and no driver-id field — the list below is built
 * from their own completed trips, and the API refuses anyone else.
 */
export default async function FavoritesPage() {
  const [favorites, rides] = await Promise.all([
    apiOptional<Driver[]>("/users/me/favorites").then((list) => list ?? []),
    listMyRides(1, 100).catch(() => null),
  ]);

  const favoriteIds = new Set(favorites.map((driver) => driver._id));

  // Every chauffeur who completed a trip for them, most recent first, once each.
  const ridden = new Map<string, { name: string | null; trips: number; last: string }>();
  for (const ride of rides?.items ?? []) {
    const trip = ride.trip;
    if (!trip || trip.status !== "completed") continue;
    const seen = ridden.get(trip.driverId);
    if (seen) {
      seen.trips += 1;
    } else {
      ridden.set(trip.driverId, {
        name: trip.driverName,
        trips: 1,
        last: trip.completedAt ?? ride.scheduledAt,
      });
    }
  }
  const candidates = [...ridden.entries()].filter(([id]) => !favoriteIds.has(id));

  return (
    <PageShell
      title="Favourite chauffeurs"
      description="When one of your favourites is free, dispatch offers them your booking first."
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
        <Panel className="p-0">
          <div className="px-6 pt-6">
            <SectionTitle>Your favourites</SectionTitle>
          </div>
          {favorites.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No favourites yet"
                description="After a trip, save the chauffeur from your trip history and ask for them next time."
                action={
                  <Button asChild variant="outline">
                    <Link href="/trips?filter=completed">See your completed trips</Link>
                  </Button>
                }
              />
            </div>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {favorites.map((driver) => {
                const name = typeof driver.userId === "object" ? driver.userId.name : "Chauffeur";
                const availability = AVAILABILITY[driver.status] ?? AVAILABILITY.offline;
                return (
                  <li key={driver._id} className="flex flex-wrap items-center gap-4 px-6 py-5">
                    <Initials name={name} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-cloud">{name}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {vehicleLabel(driver.vehicleClass)}
                        {typeof driver.rating === "number" && driver.rating > 0
                          ? ` · ${driver.rating.toFixed(1)} ★`
                          : ""}
                      </p>
                    </div>
                    <StatusBadge tone={availability.tone}>{availability.label}</StatusBadge>
                    <RemoveFavoriteButton driverId={driver._id} />
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel>
          <SectionTitle>Chauffeurs you&rsquo;ve ridden with</SectionTitle>
          {candidates.length === 0 ? (
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              {ridden.size === 0
                ? "Once a trip is completed, the chauffeur who drove you appears here so you can save them."
                : "Everyone who has driven you is already in your favourites."}
            </p>
          ) : (
            <ul className="mt-4 space-y-4">
              {candidates.map(([driverId, info]) => (
                <li key={driverId} className="flex flex-wrap items-center gap-3">
                  <Initials name={info.name} small />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-cloud">{info.name ?? "Chauffeur"}</p>
                    <p className="text-xs text-muted-foreground">
                      {info.trips} trip{info.trips === 1 ? "" : "s"} · last {formatDate(info.last)}
                    </p>
                  </div>
                  <AddFavoriteButton driverId={driverId} name={info.name} size="sm" />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </PageShell>
  );
}

function Initials({ name, small }: { name?: string | null; small?: boolean }) {
  const letters =
    (name ?? "")
      .split(" ")
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full bg-midnight/30 font-medium text-azure ${
        small ? "h-9 w-9 text-xs" : "h-11 w-11 text-sm"
      }`}
    >
      {letters}
    </span>
  );
}
