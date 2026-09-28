import type { Metadata } from "next";
import { PageShell } from "@/components/app/shell";
import { TripFilters } from "@/components/app/trip-filters";
import { listMyRides } from "@/lib/api/bookings";
import { apiOptional } from "@/lib/api/client";
import type { Driver } from "@/lib/api/types";
import { LiveRefresh } from "@/components/app/live-refresh";

export const metadata: Metadata = {
  title: "My trips | Viaro",
  robots: { index: false, follow: false },
};

/**
 * `/users/me/rides` lists BOOKINGS, newest first, each with a summary of its Trip once a
 * chauffeur has taken it. That is the right record for a passenger's history: it covers
 * journeys no chauffeur has taken yet, which a trip-based list would omit entirely.
 *
 * Up to 100 (the API's page ceiling) are fetched on the server with the httpOnly token;
 * filtering, sorting and paging happen in TripFilters.
 */
export default async function TripsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams;
  const [rides, favorites] = await Promise.all([
    listMyRides(1, 100),
    apiOptional<Driver[]>("/users/me/favorites"),
  ]);

  return (
    <PageShell title="My trips" description="Every journey you have booked with us.">
      <TripFilters
        rides={rides.items}
        favoriteDriverIds={(favorites ?? []).map((driver) => driver._id)}
        initialFilter={filter}
      />
      {/* A chauffeur accepting, or a status change, updates this list in place. */}
      <LiveRefresh topics={["booking", "trip", "dispatch"]} />
    </PageShell>
  );
}
