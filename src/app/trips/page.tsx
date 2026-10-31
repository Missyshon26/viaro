"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ConsolePage,
  DataTable,
  emptyActionClass,
  formatDateTime,
  money,
  type Column,
} from "@/components/ui/DataTable";
import {
  PersonCell,
  StatusBadge,
  reference,
  type BadgeTone,
} from "@/components/ui/Dashboard";
import { errorText } from "@/lib/api/client";
import {
  collectPayment,
  getJourneys,
  listPricingRules,
  getBookingsDashboard,
  publishToPool,
} from "@/lib/api/admin";
import { listVehicleClasses } from "@/lib/api/vehicles";
import { DatePicker } from "@/components/ui/DatePicker";
import { AddTripModal } from "@/components/trips/AddTripModal";
import { FilterSelect } from "@/components/ui/FilterSelect";
import { SlidersHorizontal, RotateCcw } from "lucide-react";
import { emptyFilters, pickupDay, type TripFilters } from "@/lib/trips/filters";
import { vehicleLabel, TRIP_TYPE_LABEL } from "@/lib/vehicles";
import { bookedBy } from "@/lib/trips/origin";
import { IconPlane } from "@/components/ui/Icons";
import { buttonClass } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { AssignDriver } from "@/components/ops/AssignDriver";
import { TripStatusControl } from "@/components/ops/TripStatusControl";
import type { Booking, Trip } from "@/lib/api/types";
import { stageOf, isOverdue, type TripStage as Stage } from "@/lib/trips/stage";
import { useLiveChanges } from "@/lib/live/useLiveChanges";

/**
 * The operations pipeline — one screen for what used to be Bookings, Dispatch and Trips.
 *
 * Those were three views of the same job at different moments, and splitting them made
 * an operator hop between screens to follow a single journey. The merge is possible
 * because the two records are joinable, and it is *necessary* because neither alone
 * tells the whole story:
 *
 *   - A Booking never reaches 'completed'. Its statuses stop at pending, dispatched,
 *     assigned and cancelled, so a finished journey still reads 'assigned' forever.
 *   - A Trip only exists once a chauffeur is on the job, so everything still waiting in
 *     the pool has no trip at all.
 *
 * The stage below is therefore derived from BOTH. No endpoint joins them — GET /trips/:id
 * takes a trip id and nothing maps a booking to its trip — hence two full reads and a
 * client-side join on bookingId.
 */

const PAGE_SIZE = 20;

type Row = Booking & {
  customerId: string | { _id: string; name: string; email?: string };
  scheduledAtLocal?: string;
  trip?: Trip;
};


const STAGE: Record<Stage, { label: string; tone: BadgeTone }> = {
  awaiting: { label: "Awaiting dispatch", tone: "warn" },
  pool: { label: "In the pool", tone: "info" },
  assigned: { label: "Driver assigned", tone: "info" },
  in_progress: { label: "In progress", tone: "info" },
  completed: { label: "Completed", tone: "good" },
  cancelled: { label: "Cancelled", tone: "bad" },
};

/** How each actor reads in the console, rather than the raw enum. */
const CANCELLER_ROLE: Record<string, string> = {
  customer: "passenger",
  driver: "driver",
  admin: "operations",
};

const ORDER: Stage[] = [
  "awaiting",
  "pool",
  "assigned",
  "in_progress",
  "completed",
  "cancelled",
];

/**
 * Past its pickup time and still not finished.
 *
 * Deliberately a flag rather than a seventh stage: "overdue" and "driver assigned"
 * are both true at once and operations needs both — the stage says what to do next, the
 * flag says how urgent it is. Collapsing them into one column would lose the first.
 */
/** Every stage the page can be opened on: a real one, 'overdue', or a group the dashboard links to. */
type StageFilter = Stage | "all" | "overdue" | "active" | "pending";
const STAGE_FILTERS = ["awaiting", "pool", "assigned", "in_progress", "completed", "cancelled", "overdue", "active", "pending"];

/**
 * The dashboard's cards and chart segments open this page already filtered, as /trips?stage=pool.
 * The view is remounted when the address changes, so following a different link (or the plain
 * "Trips" link in the sidebar) always starts from what that link says rather than from whatever
 * was last chosen on the page.
 */
export default function TripsPage() {
  return (
    <Suspense fallback={null}>
      <TripsFromAddress />
    </Suspense>
  );
}

function TripsFromAddress() {
  const params = useSearchParams();
  const asked = params.get("stage") ?? "";
  const stage = (STAGE_FILTERS.includes(asked) ? asked : "all") as StageFilter;
  return <TripsView key={stage} initialStage={stage} />;
}

function TripsView({ initialStage }: { initialStage: StageFilter }) {
  /** The current page, as the API returned it. Filtering, search and paging all happen there. */
  const [data, setData] = useState<{ items: Row[]; total: number; counts: Record<string, number> } | null>(null);
  const rows = data?.items ?? null;
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [vehicleOptions, setVehicleOptions] = useState<{ value: string; label: string }[]>([]);
  const [cityOptions, setCityOptions] = useState<string[]>([]);
  const [filter, setFilter] = useState<StageFilter>(initialStage);
  const [filters, setFilters] = useState<TripFilters>({ ...emptyFilters });
  const [datePreset, setDatePreset] = useState("all");
  const [addingTrip, setAddingTrip] = useState(false);
  const [createdTrip, setCreatedTrip] = useState<string | null>(null);
  const [moreFilters, setMoreFilters] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // The fare an operator is about to collect, held here until they confirm it.
  const [collecting, setCollecting] = useState<{ tripId: string; fare?: number; customer: string } | null>(null);
  /** The row whose stage badge was clicked, if any. */
  const [moving, setMoving] = useState<Row | null>(null);

  /*
   * The page number belongs to one combination of filters: change any of them and it is page 1
   * again. Keeping the key beside the number does that without an effect that resets it.
   */
  const fetchKey = JSON.stringify([filter, filters, search]);
  const [pageState, setPageState] = useState({ key: fetchKey, page: 1 });
  const page = pageState.key === fetchKey ? pageState.page : 1;
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    setLoading(true);
    try {
      const result = await getJourneys(page, PAGE_SIZE, {
        stage: filter === "all" ? undefined : filter,
        q: search.trim(),
        ...filters,
      });
      // A newer request was sent while this one was away: its answer is the one to show.
      if (ticket !== latest.current) return;
      setData({ items: result.items as Row[], total: result.total, counts: result.counts });
      setError(null);
    } catch (err) {
      if (ticket !== latest.current) return;
      setError(errorText(err, "Could not load the pipeline"));
      setData((current) => current ?? { items: [], total: 0, counts: {} });
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [page, filter, filters, search]);

  useEffect(() => {
    void load();
  }, [load]);

  // Typing in the search box asks the API once the typing pauses, not on every key.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchText), 350);
    return () => clearTimeout(timer);
  }, [searchText]);

  // The vehicle and city filters list what exists, not just what happens to be on this page.
  useEffect(() => {
    let live = true;
    listVehicleClasses(true)
      .then((list) => live && setVehicleOptions(list.map((v) => ({ value: v.value, label: v.label }))))
      .catch(() => undefined);
    listPricingRules()
      .then((rules) => live && setCityOptions(rules.map((r) => r.city)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  // Someone else assigning, publishing or moving a trip changes this list under the operator looking at it.
  useLiveChanges(["booking", "trip", "dispatch"], () => void load());

  async function publish(bookingId: string) {
    setBusy(bookingId);
    setError(null);
    try {
      const result = await publishToPool(bookingId);
      await load();
      // Publishing with nobody in range succeeds and does nothing visible, so say so
      // rather than letting the operator think the broadcast reached someone.
      if (result.driversInRange === 0) {
        setError("Published, but no driver is online within range right now.");
      }
    } catch (err) {
      setError(errorText(err, "Could not publish that booking"));
    } finally {
      setBusy(null);
    }
  }

  async function collect(tripId: string) {
    setBusy(tripId);
    setError(null);
    try {
      await collectPayment(tripId);
      await load();
      setCollecting(null);
    } catch (err) {
      // Idempotent server-side: a second press answers 409 rather than double-charging.
      setError(errorText(err, "Could not collect that fare"));
      setCollecting(null);
    } finally {
      setBusy(null);
    }
  }

  const counts = data?.counts ?? { all: 0, overdue: 0 };

  const activeCount = Object.values(filters).filter(Boolean).length + Number(filter !== "all") + Number(Boolean(search.trim()));
  const invalidDates = Boolean(filters.from && filters.to && filters.from > filters.to);
  function resetFilters() { setFilter("all"); setFilters({ ...emptyFilters }); setDatePreset("all"); setSearchText(""); setSearch(""); }
  function updateFilter(key: keyof TripFilters, value: string) { setFilters((old) => ({ ...old, [key]: value })); }
  function setPeriod(value: string) {
    setDatePreset(value);
    if (value === "custom") return;
    const today = pickupDay(new Date().toISOString());
    const end = new Date(`${today}T12:00:00Z`);
    end.setUTCDate(end.getUTCDate() + (value === "tomorrow" ? 1 : value === "week" ? 6 : 0));
    const to = end.toISOString().slice(0, 10);
    setFilters((old) => ({ ...old, from: value === "all" ? "" : value === "tomorrow" ? to : today, to: value === "all" ? "" : to }));
  }

  // typeof null is "object": a customer whose account was deleted is populated as null.
  const customerOf = (r: Row) =>
    r.customerId && typeof r.customerId === "object" ? r.customerId : null;
  const customerName = (r: Row) =>
    customerOf(r)?.name ?? (r.customerId ? "—" : "Deleted user");

  const columns: Column<Row>[] = [
    {
      key: "customer",
      header: "Customer",
      cell: (r) => (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <PersonCell name={customerName(r)} meta={customerOf(r)?.email} />
            {r.isGuest ? <StatusBadge tone="info">Guest</StatusBadge> : null}
          </div>
          <Link
            href={`/trips/${r._id}`}
            className="mt-1.5 inline-block font-mono text-label font-semibold text-fg-muted hover:text-accent"
          >
            {reference(r._id)}
          </Link>
          {/* Who made it: an operator, the passenger on the website, or the old system. */}
          <span className="ml-2 text-label text-fg-muted">· {bookedBy(r).label}</span>
        </div>
      ),
    },
    {
      key: "route",
      header: "Route",
      cell: (r) => (
        <span className="block min-w-0 max-w-[22rem]">
          <span className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1.5">
            <span aria-hidden className="mt-1.5 h-2 w-2 rounded-full border-2 border-accent" />
            <span className="line-clamp-2 text-meta text-fg">{r.pickup.address}</span>
            <span aria-hidden className="mt-1.5 h-2 w-2 rounded-full bg-accent" />
            <span className="line-clamp-2 text-meta text-fg-body">{r.drop.address}</span>
          </span>
          {/* An airport run lives or dies on the flight, so it belongs on the row
              rather than only in the search index. */}
          {r.flightDetails?.flightNumber ? (
            <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-label font-bold text-accent-strong">
              <IconPlane size={11} />
              {r.flightDetails.flightNumber}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "when",
      header: "Pickup",
      cell: (r) => (
        <span className="whitespace-nowrap font-medium text-fg">
          {r.scheduledAtLocal ?? formatDateTime(r.scheduledAt)}
        </span>
      ),
    },
    {
      key: "vehicle",
      header: "Vehicle",
      cell: (r) => <span className="text-fg-body">{vehicleLabel(r.vehicleClass)}</span>,
    },
    {
      key: "stage",
      header: "Stage",
      cell: (r) => {
        const stage = STAGE[stageOf(r)];
        const movable = r.trip && (r.trip.status === "accepted" || r.trip.status === "started");

        return (
          <span className="flex flex-wrap items-center gap-1.5">
            {/*
              The stage is where the eye already is when someone asks "why is this still
              assigned?", so it is also where the answer gets acted on. A trip with no
              trip yet has nothing to move — it needs Publish or Assign instead — so the
              badge stays inert there rather than offering a control that would 404.
            */}
            {movable ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setMoving(r);
                }}
                title="Change this trip's status"
                className="rounded-full transition-opacity hover:opacity-75"
              >
                <StatusBadge tone={stage.tone}>{stage.label} ▾</StatusBadge>
              </button>
            ) : (
              <StatusBadge tone={stage.tone}>{stage.label}</StatusBadge>
            )}
            {isOverdue(r) ? <StatusBadge tone="bad">Overdue</StatusBadge> : null}
            {r.amendments && r.amendments.length > 0 ? (
              <StatusBadge tone="warn">Changed</StatusBadge>
            ) : null}
            {/*
              "Cancelled" alone prompts the same question every time — by whom? The
              answer is one word and it is already loaded, so it goes on the row rather
              than costing a click. The note, if there is one, is on the detail page.
            */}
            {r.cancellation ? (
              <span
                className="text-[11px] text-muted"
                title={r.cancellation.reason ?? "No reason given"}
              >
                by {r.cancellation.byName ?? CANCELLER_ROLE[r.cancellation.by]}
                {r.cancellation.reason ? " · note" : ""}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "fare",
      header: "Fare",
      align: "right",
      cell: (r) => (
        <span className="font-bold text-fg">
          {money(r.trip?.fareAmount ?? r.estimatedFare)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (r) => {
        const stage = stageOf(r);
        // Both actions used to have a screen each. They are contextual now: an operator
        // only ever sees the one this particular journey can actually take.
        if (stage === "awaiting" || stage === "pool") {
          return (
            <span className="flex justify-end gap-2">
              <button
                type="button"
                disabled={busy === r._id}
                onClick={() => publish(r._id)}
                title="Re-broadcast this booking to nearby drivers"
                className="h-8 rounded-field border border-border bg-surface-raised px-3 text-label font-bold text-fg-body transition-colors hover:border-accent hover:text-fg disabled:opacity-50"
              >
                {busy === r._id ? "Publishing…" : stage === "awaiting" ? "Publish" : "Re-publish"}
              </button>
              <AssignDriver
                bookingId={r._id}
                reference={reference(r._id)}
                onAssigned={() => void load()}
              />
            </span>
          );
        }
        // A live trip gets its lifecycle controls right here, so an operator never
        // leaves the pipeline to move one along.
        if ((stage === "assigned" || stage === "in_progress") && r.trip) {
          return (
            <TripStatusControl
              compact
              tripId={r.trip._id}
              currentStatus={r.trip.status}
              onChanged={() => void load()}
            />
          );
        }
        if (stage === "completed" && r.trip && !r.trip.settled) {
          const tripId = r.trip._id;
          return (
            <button
              type="button"
              disabled={busy === tripId}
              onClick={() => setCollecting({ tripId, fare: r.trip?.fareAmount, customer: customerName(r) })}
              className="h-8 rounded-field border border-border bg-surface-raised px-3 text-label font-bold text-fg-body transition-colors hover:border-accent hover:text-fg disabled:opacity-50"
            >
              {busy === tripId ? "Collecting…" : "Collect fare"}
            </button>
          );
        }
        return null;
      },
    },
  ];

  return (
    <ConsolePage
      title="Trips"
      description="Every trip on the platform, from request through dispatch to settlement."
      action={
        <button type="button" onClick={() => setAddingTrip(true)} className={buttonClass("accent")}>
          Add a trip
        </button>
      }
    >
      {addingTrip && <AddTripModal onClose={() => setAddingTrip(false)} onCreated={(id) => { setAddingTrip(false); setCreatedTrip(id); void load(); }} />}
      {createdTrip && <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-field border border-success/30 bg-success/5 px-4 py-3 text-note"><span className="flex-1 text-fg">Trip saved. Review its details and dispatch status.</span><Link href={`/trips/${createdTrip}`} className="font-bold text-accent">View trip →</Link><button type="button" onClick={() => setCreatedTrip(null)} className="min-h-9 px-2 text-fg-muted">Dismiss</button></div>}
      {error ? (
        <p className="mb-4 rounded-field border border-danger/30 bg-danger/5 px-4 py-3 text-note font-bold text-danger">
          {error}
        </p>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[{ label: "Total trips", value: counts.all }, { label: "Awaiting dispatch", value: (counts.awaiting ?? 0) + (counts.pool ?? 0) }, { label: "On the road", value: counts.in_progress ?? 0 }, { label: "Overdue pickups", value: counts.overdue ?? 0 }].map((item) => (
          <div key={item.label} className="rounded-card border border-border bg-surface p-4">
            <p className="text-label font-medium text-fg-muted">{item.label}</p>
            <p className={`mt-2 text-metric font-bold tabular-nums ${item.label === "Overdue pickups" && item.value ? "text-danger" : "text-fg"}`}>{data ? item.value : "—"}</p>
          </div>
        ))}
      </div>
      <section aria-label="Trip filters" className="mb-4">
        <div className="grid items-center gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <FilterSelect label="Pickup period" value={datePreset} onChange={setPeriod} options={[{ value: "all", label: "All dates" }, { value: "today", label: "Today" }, { value: "tomorrow", label: "Tomorrow" }, { value: "week", label: "Next 7 days" }, { value: "custom", label: "Custom range" }]} />
          <FilterSelect label="Trip stage" value={filter} onChange={(value) => setFilter(value as typeof filter)} options={[{ value: "all", label: "All stages" }, { value: "overdue", label: `Overdue (${counts.overdue})` }, { value: "active", label: `Active: assigned or in progress (${(counts.assigned ?? 0) + (counts.in_progress ?? 0)})` }, { value: "pending", label: `Pending: awaiting or in the pool (${(counts.awaiting ?? 0) + (counts.pool ?? 0)})` }, ...ORDER.map((stage) => ({ value: stage, label: `${STAGE[stage].label} (${counts[stage] ?? 0})` }))]} />
          <FilterSelect label="Vehicle class" value={filters.vehicle} onChange={(value) => updateFilter("vehicle", value)} options={[{ value: "", label: "All vehicles" }, ...vehicleOptions]} />
          <div className="flex items-center gap-2">
          <button type="button" aria-expanded={moreFilters} aria-controls="additional-trip-filters" onClick={() => setMoreFilters((open) => !open)} className={`inline-flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-field border px-4 text-meta font-medium transition-colors ${moreFilters ? "border-accent bg-accent-soft text-accent-strong" : "border-border bg-surface-raised text-fg-body hover:bg-surface"}`}>
            <SlidersHorizontal size={15} />More filters
            {[filters.service, filters.city, filters.payment].filter(Boolean).length > 0 && <span className="rounded-full bg-accent-soft px-1.5 text-label text-accent-strong">{[filters.service, filters.city, filters.payment].filter(Boolean).length}</span>}
          </button>
          {activeCount > 0 || datePreset !== "all" ? <button type="button" onClick={resetFilters} className="inline-flex h-9 items-center justify-center gap-1.5 justify-self-start px-2 text-meta text-fg-muted hover:text-accent"><RotateCcw size={14} />Clear</button> : null}
          </div>
        </div>
        {datePreset === "custom" && <div className="mt-3 grid items-end gap-3 rounded-field border border-border bg-surface p-3 sm:grid-cols-[1fr_1fr_auto]">
            <div className="grid gap-1.5"><span className="text-label font-medium text-fg-muted">From date</span><DatePicker label="From date" invalid={invalidDates} value={filters.from} max={filters.to || undefined} onChange={(value) => { updateFilter("from", value); setDatePreset("custom"); }} /></div>
            <div className="grid gap-1.5"><span className="text-label font-medium text-fg-muted">To date</span><DatePicker label="To date" invalid={invalidDates} value={filters.to} min={filters.from || undefined} onChange={(value) => { updateFilter("to", value); setDatePreset("custom"); }} /></div>
            <p className="pb-3 text-label text-fg-muted">Pickup dates · Pacific time</p>
          </div>}
        <div id="additional-trip-filters" hidden={!moreFilters}>
          <div className="mt-3 grid gap-3 rounded-field border border-border bg-surface p-3 sm:grid-cols-3">
          <FilterSelect showLabel label="Service type" value={filters.service} onChange={(value) => updateFilter("service", value)} options={[{ value: "", label: "All services" }, ...Object.entries(TRIP_TYPE_LABEL).map(([value, label]) => ({ value, label }))]} />
          <FilterSelect showLabel label="City" value={filters.city} onChange={(value) => updateFilter("city", value)} options={[{ value: "", label: "All cities" }, ...cityOptions.map((value) => ({ value, label: value.replace(/\b\w/g, (m) => m.toUpperCase()) }))]} />
          <FilterSelect showLabel label="Payment status" value={filters.payment} onChange={(value) => updateFilter("payment", value)} options={[{ value: "", label: "All payments" }, { value: "unpaid", label: "No card payment recorded" }, { value: "paid", label: "Paid" }, { value: "partially_refunded", label: "Partially refunded" }, { value: "refunded", label: "Refunded" }]} />
          </div>
        </div>
        {invalidDates && <p role="alert" className="mt-2 text-note text-danger">Choose an end date on or after the start date.</p>}
      </section>

      {moving?.trip ? (
        <TripStatusControl
          autoOpen
          tripId={moving.trip._id}
          currentStatus={moving.trip.status}
          onClose={() => setMoving(null)}
          onChanged={async () => {
            setMoving(null);
            await load();
          }}
        />
      ) : null}

      <div aria-busy={loading} className={loading && data ? "opacity-60 transition-opacity" : "transition-opacity"}>
      <DataTable
        rows={rows}
        loading={loading && !data}
        columns={columns}
        rowKey={(r) => r._id}
        minWidth="72rem"
        pageSize={PAGE_SIZE}
        remote={{
          query: searchText,
          onQuery: setSearchText,
          page,
          total: counts && data ? data.total : 0,
          onPage: (next) => setPageState({ key: fetchKey, page: next }),
        }}
        searchable={() => []}
        searchPlaceholder="Search reference, customer, address…"
        rowHref={(r) => `/trips/${r._id}`}
        empty={{
          title: activeCount ? "No trips match these filters" : "No trips yet",
          action: activeCount ? (
            <button type="button" className={emptyActionClass} onClick={resetFilters}>Clear all filters</button>
          ) : (
            <button type="button" className={emptyActionClass} onClick={() => setAddingTrip(true)}>Add a trip</button>
          ),
          description: activeCount ? "Try a wider date range or reset the filters." : "Bookings appear here as customers make them.",
        }}
      />
      </div>

      {/* Collecting charges the customer's card, so it is confirmed first and names the amount. */}
      <ConfirmDialog
        open={collecting !== null}
        title="Collect this fare?"
        confirmLabel={collecting?.fare !== undefined ? `Charge ${money(collecting.fare)}` : "Collect fare"}
        pendingLabel="Collecting…"
        pending={collecting !== null && busy === collecting.tripId}
        onConfirm={() => collecting && void collect(collecting.tripId)}
        onCancel={() => setCollecting(null)}
      >
        <p>
          {collecting?.fare !== undefined ? <strong>{money(collecting.fare)}</strong> : "The fare"} will be charged to{" "}
          {collecting?.customer ?? "the customer"}&apos;s card now.
        </p>
        <p>It cannot be undone from here, and pressing it twice will not charge twice.</p>
      </ConfirmDialog>
    </ConsolePage>
  );
}
