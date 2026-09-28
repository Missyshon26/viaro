"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownUp, ChevronLeft, ChevronRight, Heart, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, Panel, money, formatDateTime, shortAddress } from "@/components/app/shell";
import { RideStatusBadge } from "@/components/app/status-badge";
import { RATE_TRIP_EVENT } from "@/components/app/rating-prompt";
import { addFavoriteAction } from "@/lib/actions/trip";
import { rideStatus, type RideStatusKey } from "@/lib/ride-status";
import type { RideListItem } from "@/lib/api/bookings";

/**
 * The passenger's journeys: filtered, sorted and paged.
 *
 * Status comes from the booking AND its trip (lib/ride-status.ts). The list used to show
 * only the booking's internal state — "Offered to chauffeurs", or a "Finished" guessed
 * from the clock — because the endpoint returned no trip. It now does.
 */
type Ride = RideListItem;

type Filter = "all" | "upcoming" | "completed" | "cancelled";
type Sort = "newest" | "oldest" | "fare";

const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  upcoming: "Upcoming",
  completed: "Completed",
  cancelled: "Cancelled",
};

const SORT_LABEL: Record<Sort, string> = {
  newest: "Pickup: newest first",
  oldest: "Pickup: oldest first",
  fare: "Fare: highest first",
};

const PAGE_SIZE = 10;

const reference = (id: string) => `VRO-${id.slice(-6).toUpperCase()}`;

const statusOf = (ride: Ride): RideStatusKey =>
  rideStatus({
    bookingStatus: ride.status,
    tripStatus: ride.trip?.status,
    refundPct: ride.trip?.refundPct,
  });

function bucketOf(status: RideStatusKey): Exclude<Filter, "all"> {
  if (status === "completed") return "completed";
  if (status === "cancelled" || status === "refunded") return "cancelled";
  return "upcoming";
}

export function TripFilters({
  rides,
  favoriteDriverIds = [],
  initialFilter,
}: {
  rides: Ride[];
  favoriteDriverIds?: string[];
  /** From ?filter=, e.g. the Chauffeurs page linking to completed trips. */
  initialFilter?: string;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>(
    initialFilter && initialFilter in FILTER_LABEL ? (initialFilter as Filter) : "all",
  );
  const [sort, setSort] = useState<Sort>("newest");
  const [page, setPage] = useState(1);

  const withStatus = useMemo(
    () => rides.map((ride) => ({ ride, status: statusOf(ride) })),
    [rides],
  );

  const counts = useMemo(() => {
    const tally: Record<string, number> = { all: withStatus.length };
    for (const { status } of withStatus) {
      const bucket = bucketOf(status);
      tally[bucket] = (tally[bucket] ?? 0) + 1;
    }
    return tally;
  }, [withStatus]);

  const sorted = useMemo(() => {
    const list = filter === "all" ? withStatus : withStatus.filter((r) => bucketOf(r.status) === filter);
    const time = (r: Ride) => new Date(r.scheduledAt).getTime();
    return [...list].sort((a, b) =>
      sort === "fare"
        ? (b.ride.estimatedFare ?? 0) - (a.ride.estimatedFare ?? 0)
        : sort === "oldest"
          ? time(a.ride) - time(b.ride)
          : time(b.ride) - time(a.ride),
    );
  }, [withStatus, filter, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = sorted.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  if (rides.length === 0) {
    return (
      <EmptyState
        title="No trips yet"
        description="Book your first ride and it will appear here, with live tracking and your receipt."
        action={
          <Button asChild size="lg">
            <Link href="/book">Book your first ride</Link>
          </Button>
        }
      />
    );
  }

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {(Object.keys(FILTER_LABEL) as Filter[]).map((key) => {
          const count = counts[key] ?? 0;
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                setFilter(key);
                setPage(1);
              }}
              aria-pressed={filter === key}
              className={`inline-flex h-9 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors ${
                filter === key
                  ? "border-azure bg-azure/10 text-cloud"
                  : "border-border text-muted-foreground hover:text-cloud"
              }`}
            >
              {FILTER_LABEL[key]}
              <span className="text-xs text-muted-foreground">{count}</span>
            </button>
          );
        })}

        <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowDownUp className="h-4 w-4" aria-hidden />
          <span className="sr-only">Sort trips</span>
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as Sort);
              setPage(1);
            }}
            className="h-9 rounded-full border border-border bg-background px-3 text-sm text-cloud focus:border-azure focus:outline-none"
          >
            {(Object.keys(SORT_LABEL) as Sort[]).map((key) => (
              <option key={key} value={key}>
                {SORT_LABEL[key]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={`No ${FILTER_LABEL[filter].toLowerCase()} trips`}
          description="Try another filter, or book a new ride."
          action={
            <Button asChild variant="outline">
              <Link href="/book">Book a ride</Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* Cards on a phone. */}
          <ul className="space-y-3 md:hidden">
            {visible.map(({ ride, status }) => (
              <li key={ride._id} className="rounded-xl border border-border bg-card/60">
                <Link href={`/trips/${ride._id}`} className="block p-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-cloud">{formatDateTime(ride.scheduledAt)}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{reference(ride._id)}</p>
                    </div>
                    <RideStatusBadge status={status} />
                  </div>
                  <Route ride={ride} className="mt-3" />
                  <p className="mt-3 text-right text-sm font-semibold text-cloud">
                    {money(ride.estimatedFare)}
                  </p>
                </Link>
                <RowActions ride={ride} status={status} favorite={favoriteDriverIds.includes(ride.trip?.driverId ?? "")} onDone={() => router.refresh()} className="border-t border-border px-4 py-3" />
              </li>
            ))}
          </ul>

          {/* Table from md up — every row opens the trip. */}
          <Panel className="hidden p-0 md:block">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="w-[26%] px-5 py-3 font-medium">Pickup</th>
                  <th className="px-5 py-3 font-medium">Route</th>
                  <th className="w-[18%] px-5 py-3 font-medium">Status</th>
                  <th className="w-[11%] px-5 py-3 text-right font-medium">Fare</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map(({ ride, status }) => (
                  <tr
                    key={ride._id}
                    onClick={(event) => {
                      // Buttons inside the row keep their own behaviour.
                      if ((event.target as HTMLElement).closest("button,a")) return;
                      router.push(`/trips/${ride._id}`);
                    }}
                    className="group cursor-pointer align-top transition-colors hover:bg-white/[0.03]"
                  >
                    <td className="px-5 py-4">
                      <Link
                        href={`/trips/${ride._id}`}
                        className="font-medium text-cloud group-hover:text-azure"
                      >
                        {formatDateTime(ride.scheduledAt)}
                      </Link>
                      <p className="mt-0.5 text-xs text-muted-foreground">{reference(ride._id)}</p>
                    </td>
                    <td className="px-5 py-4">
                      <Route ride={ride} />
                      <RowActions ride={ride} status={status} favorite={favoriteDriverIds.includes(ride.trip?.driverId ?? "")} onDone={() => router.refresh()} className="mt-2" />
                    </td>
                    <td className="px-5 py-4">
                      <RideStatusBadge status={status} />
                    </td>
                    <td className="px-5 py-4 text-right font-semibold text-cloud">
                      {money(ride.estimatedFare)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          {pages > 1 ? (
            <nav aria-label="Trip pages" className="mt-5 flex items-center justify-between gap-4 text-sm">
              <p className="text-muted-foreground">
                {(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, sorted.length)} of{" "}
                {sorted.length}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(current - 1)}
                  disabled={current === 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-1 text-muted-foreground">
                  Page {current} of {pages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(current + 1)}
                  disabled={current === pages}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}

/** The route as two short place names; the full addresses are in the tooltip and the trip. */
function Route({ ride, className = "" }: { ride: Ride; className?: string }) {
  return (
    <p
      className={`flex min-w-0 items-center gap-2 text-sm text-muted-foreground ${className}`}
      title={`${ride.pickup.address} → ${ride.drop.address}`}
    >
      <span className="truncate text-cloud/90">{shortAddress(ride.pickup.address)}</span>
      <span aria-hidden className="shrink-0 text-azure">→</span>
      <span className="truncate">{shortAddress(ride.drop.address)}</span>
    </p>
  );
}

/**
 * After a completed trip: rate the chauffeur, and save them as a favourite — straight
 * from the history, instead of pasting a 24-character driver id on another page.
 */
function RowActions({
  ride,
  status,
  favorite,
  onDone,
  className = "",
}: {
  ride: Ride;
  status: RideStatusKey;
  favorite: boolean;
  onDone: () => void;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [justSaved, setSaved] = useState(false);
  const saved = favorite || justSaved;
  const trip = ride.trip;
  if (status !== "completed" || !trip) return null;

  const name = trip.driverName?.split(" ")[0] ?? "your chauffeur";

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {!trip.rated ? (
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent(RATE_TRIP_EVENT, { detail: trip.tripId }))}
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-azure/40 px-3 text-xs font-medium text-azure transition-colors hover:bg-azure/10"
        >
          <Star className="h-3.5 w-3.5" />
          Rate {name}
        </button>
      ) : null}
      <button
        type="button"
        disabled={pending || saved}
        onClick={() =>
          start(async () => {
            const result = await addFavoriteAction(trip.driverId);
            if (result?.error) {
              toast.error(result.error);
              return;
            }
            setSaved(true);
            toast.success(`${trip.driverName ?? "Chauffeur"} added to your favourites`);
            onDone();
          })
        }
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-azure/50 hover:text-cloud disabled:opacity-60"
      >
        <Heart className={`h-3.5 w-3.5 ${saved ? "fill-azure text-azure" : ""}`} />
        {saved ? "In favourites" : pending ? "Saving…" : "Add to favourites"}
      </button>
    </div>
  );
}
