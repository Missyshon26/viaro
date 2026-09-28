"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ConsolePage, formatDateTime } from "@/components/ui/DataTable";
import {
  Avatar,
  NotAvailable,
  SectionCard,
  StatCard,
  StatCardSkeleton,
  StatusBadge,
  compactMoney,
  count,
  money,
  reference,
} from "@/components/ui/Dashboard";
import {
  AreaChart,
  BarChart,
  ChartCard,
  DonutChart,
  ProgressBar,
  RANGES,
  RangeTabs,
  bucketByDay,
  type RangeKey,
} from "@/components/ui/Charts";
import {
  IconCar,
  IconCheck,
  IconMoney,
  IconPenalty,
  IconRoute,
  IconStar,
} from "@/components/ui/Icons";
import {
  fetchAllPages,
  getCancellations,
  getEarningsPayout,
  getTripsCompleted,
  listDrivers,
  listPenalties,
  type CancellationsReport,
  type EarningsPayoutReport,
  type PenaltiesReport,
  type RosterDriver,
  type TripsCompletedReport,
} from "@/lib/api/admin";

/**
 * Fleet operations.
 *
 * ⚠ SCOPE. Two different scopes meet on this page and they do not agree:
 *
 *   GET /admin/drivers   IS company-scoped — admin.service.listDrivers() filters by
 *                        company.driverIds.
 *   GET /reports/*       IS NOT. reports.service.buildScope() returns an unrestricted
 *                        scope for 'admin' AND 'company' alike (spec §8 rule 7), so a
 *                        company is handed every operator's trips, cancellations and
 *                        revenue-split rows.
 *
 * So every report row here is narrowed to `rosterIds` before it is counted. Without
 * that, a fleet operator would be reading platform-wide numbers labelled as their own —
 * wrong, and a disclosure of other operators' volumes. The right long-term fix is in
 * buildScope(), which already carries a note to that effect; this is the client-side
 * half and it does not make the endpoint itself safe.
 *
 * Per-chauffeur performance is assembled here rather than fetched: the completed-trips
 * and cancellations reports both carry `driverId`, so grouping the roster's rows gives
 * real trips, revenue and completion rates without a new endpoint.
 */

const iso = (d: Date) => d.toISOString().slice(0, 10);
const since = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return iso(d);
};
const todayRange = () => ({ from: iso(new Date()) });

const driverName = (driver?: RosterDriver) =>
  driver?.userId && typeof driver.userId === "object" ? driver.userId.name : "Chauffeur";

interface Performance {
  driverId: string;
  driver?: RosterDriver;
  trips: number;
  revenue: number;
  cancelled: number;
}

export default function CompanyDashboard() {
  const [drivers, setDrivers] = useState<RosterDriver[] | null>(null);
  const [penalties, setPenalties] = useState<PenaltiesReport | null>(null);
  const [payout, setPayout] = useState<EarningsPayoutReport | null>(null);
  const [trips, setTrips] = useState<TripsCompletedReport | null>(null);
  const [today, setToday] = useState<TripsCompletedReport | null>(null);
  const [cancels, setCancels] = useState<CancellationsReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [range, setRange] = useState<RangeKey>("30d");
  const [ranged, setRanged] = useState<TripsCompletedReport | null>(null);
  const [rangeLoading, setRangeLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [d, p, e, t, td, c] = await Promise.allSettled([
        fetchAllPages((page, limit) => listDrivers(page, limit)),
        listPenalties(),
        getEarningsPayout(),
        getTripsCompleted(),
        getTripsCompleted(todayRange()),
        getCancellations(),
      ]);
      if (cancelled) return;

      if (d.status === "fulfilled") setDrivers(d.value.items);
      if (p.status === "fulfilled") setPenalties(p.value);
      if (e.status === "fulfilled") setPayout(e.value);
      if (t.status === "fulfilled") setTrips(t.value);
      if (td.status === "fulfilled") setToday(td.value);
      if (c.status === "fulfilled") setCancels(c.value);
      if (d.status === "rejected") setError("Some dashboard data could not be loaded.");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setRangeLoading(true);
    const days = RANGES.find((r) => r.key === range)?.days ?? 30;

    getTripsCompleted({ from: since(days) })
      .then((report) => {
        if (!cancelled) setRanged(report);
      })
      .catch(() => {
        if (!cancelled) setRanged(null);
      })
      .finally(() => {
        if (!cancelled) setRangeLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [range]);

  /* -------------------------------- derived -------------------------------- */

  /** The company's own drivers. Everything below is filtered through this. */
  const rosterIds = useMemo(
    () => new Set((drivers ?? []).map((d) => d._id)),
    [drivers],
  );
  const mine = useCallback(
    (row: { driverId: string }) => rosterIds.has(row.driverId),
    [rosterIds],
  );

  const status = useMemo(() => {
    const tally = { available: 0, busy: 0, offline: 0 };
    for (const driver of drivers ?? []) {
      if (driver.status in tally) tally[driver.status] += 1;
    }
    return tally;
  }, [drivers]);

  const performance = useMemo<Performance[]>(() => {
    if (!trips) return [];
    const byId = new Map<string, Performance>();
    const roster = new Map((drivers ?? []).map((d) => [d._id, d]));

    for (const row of trips.rows.filter(mine)) {
      const entry = byId.get(row.driverId) ?? {
        driverId: row.driverId,
        driver: roster.get(row.driverId),
        trips: 0,
        revenue: 0,
        cancelled: 0,
      };
      entry.trips += 1;
      entry.revenue += row.fareAmount ?? 0;
      byId.set(row.driverId, entry);
    }

    for (const row of (cancels?.cancellations ?? []).filter(mine)) {
      const entry = byId.get(row.driverId) ?? {
        driverId: row.driverId,
        driver: roster.get(row.driverId),
        trips: 0,
        revenue: 0,
        cancelled: 0,
      };
      entry.cancelled += 1;
      byId.set(row.driverId, entry);
    }

    return [...byId.values()].sort((a, b) => b.trips - a.trips || b.revenue - a.revenue);
  }, [trips, cancels, drivers, mine]);

  const days = RANGES.find((r) => r.key === range)?.days ?? 30;
  const tripSeries = useMemo(
    () =>
      bucketByDay(
        (ranged?.rows ?? []).filter(mine).map((r) => ({ at: r.completedAt, value: 1 })),
        days,
      ),
    [ranged, days, mine],
  );
  const revenueSeries = useMemo(
    () =>
      bucketByDay(
        (ranged?.rows ?? [])
          .filter(mine)
          .map((r) => ({ at: r.completedAt, value: r.fareAmount ?? 0 })),
        days,
      ),
    [ranged, days, mine],
  );

  const recent = useMemo(
    () =>
      [...(trips?.rows ?? [])]
        .filter(mine)
        .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
        .slice(0, 6),
    [trips, mine],
  );

  // Counted from the roster's own rows, NOT from the report's `count`/`totalFare`,
  // which are platform-wide totals.
  const myTripRows = useMemo(() => (trips?.rows ?? []).filter(mine), [trips, mine]);
  const completedCount = myTripRows.length;
  const totalFare = myTripRows.reduce((sum, r) => sum + (r.fareAmount ?? 0), 0);
  const cancelledCount = (cancels?.cancellations ?? []).filter(mine).length;
  const totalHandled = completedCount + cancelledCount;

  const todayRows = useMemo(() => (today?.rows ?? []).filter(mine), [today, mine]);
  const todayFare = todayRows.reduce((sum, r) => sum + (r.fareAmount ?? 0), 0);

  const rangedRows = useMemo(() => (ranged?.rows ?? []).filter(mine), [ranged, mine]);
  const rangedFare = rangedRows.reduce((sum, r) => sum + (r.fareAmount ?? 0), 0);

  /**
   * For a company the earnings report answers with `scope: 'all'` — `totals` keyed by
   * revenue-split reason and a `grandTotal`. It carries no `balance`/`totalCredited`;
   * those belong to the driver branch only, so reading them here would always show $0.
   */
  const companyShare = payout?.totals?.revenue_split_company ?? 0;

  const loading = drivers === null && trips === null;

  return (
    <ConsolePage
      title="Fleet operations"
      description="Your roster, what it earned and where it is losing money."
    >
      <p className="mb-4 rounded-field border border-border bg-surface px-4 py-3 text-label leading-relaxed text-fg-muted">
        The reporting endpoints return platform-wide rows to a company account, so every
        figure below is narrowed to your own {drivers?.length ?? 0} chauffeurs before it
        is counted.
      </p>
      {error ? (
        <p className="mb-4 rounded-field border border-danger/30 bg-danger/5 px-4 py-3 text-note font-bold text-danger">
          {error}
        </p>
      ) : null}

      {/* --------------------------------- KPIs --------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard
              tone="feature"
              label="Trip revenue"
              value={compactMoney(totalFare)}
              hint={`${count(completedCount)} completed trips`}
              icon={<IconMoney size={18} />}
              href="/revenue"
            />
            <StatCard
              tone="feature"
              label="Your revenue share"
              value={compactMoney(companyShare)}
              hint="60% of fares, credited on settlement"
              icon={<IconCheck size={18} />}
              href="/revenue"
            />
            <StatCard
              label="Completed today"
              value={count(todayRows.length)}
              hint={compactMoney(todayFare) + " today"}
              icon={<IconRoute size={18} />}
              href="/trips"
            />
            <StatCard
              label="Chauffeurs online"
              value={count(status.available)}
              hint={`${status.busy} on a trip · ${status.offline} offline`}
              icon={<IconCar size={18} />}
              href="/drivers"
            />
          </>
        )}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard
              label="Total chauffeurs"
              value={count(drivers?.length ?? 0)}
              hint="On your roster"
              icon={<IconCar size={18} />}
              href="/drivers"
            />
            <StatCard
              label="Completed trips"
              value={count(completedCount)}
              hint="All time"
              icon={<IconCheck size={18} />}
              href="/trips"
            />
            <StatCard
              label="Cancelled trips"
              value={count(cancelledCount)}
              hint={
                totalHandled > 0
                  ? `${Math.round((completedCount / totalHandled) * 100)}% completion rate`
                  : "No trips yet"
              }
              icon={<IconRoute size={18} />}
              href="/cancellations"
            />
            <StatCard
              label="Penalties"
              value={count(penalties?.totalEvents ?? 0)}
              hint={`${penalties?.totalDrivers ?? 0} chauffeurs affected`}
              icon={<IconPenalty size={18} />}
              href="/penalties"
            />
          </>
        )}
      </div>

      {/* ------------------------------- analytics ------------------------------ */}
      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Trips completed"
          subtitle={`${count(rangedRows.length)} in the last ${
            RANGES.find((r) => r.key === range)?.label
          }`}
          action={<RangeTabs value={range} onChange={setRange as never} />}
          loading={rangeLoading}
        >
          <AreaChart data={tripSeries} />
        </ChartCard>

        <ChartCard
          title="Revenue"
          subtitle={
            <>
              {compactMoney(rangedFare)} in this period ·{" "}
              <span className="font-bold text-fg">
                {money(rangedRows.length > 0 ? rangedFare / rangedRows.length : 0)}
              </span>{" "}
              average trip
            </>
          }
          action={<RangeTabs value={range} onChange={setRange as never} />}
          loading={rangeLoading}
        >
          <BarChart data={revenueSeries} kind="money" color="var(--chart-2)" />
        </ChartCard>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <ChartCard title="Trip outcomes" subtitle="Completed against cancelled" loading={loading}>
          <DonutChart
            total={totalHandled}
            totalLabel="Trips"
            slices={[
              { label: "Completed", value: completedCount, color: "var(--chart-good)" },
              { label: "Cancelled", value: cancelledCount, color: "var(--chart-bad)" },
            ]}
          />
        </ChartCard>

        <ChartCard
          title="Roster availability"
          subtitle={`${drivers?.length ?? 0} chauffeurs`}
          loading={drivers === null}
        >
          <div className="space-y-4">
            <ProgressBar
              label="Online"
              value={status.available}
              max={drivers?.length || 1}
              display={String(status.available)}
              tone="good"
            />
            <ProgressBar
              label="On a trip"
              value={status.busy}
              max={drivers?.length || 1}
              display={String(status.busy)}
              tone="warn"
            />
            <ProgressBar
              label="Offline"
              value={status.offline}
              max={drivers?.length || 1}
              display={String(status.offline)}
            />
            <Link
              href="/drivers"
              className="mt-1 inline-block text-note font-bold text-accent hover:underline"
            >
              Manage the roster →
            </Link>
          </div>
        </ChartCard>

        <ChartCard
          title="Scheduled work"
          subtitle="Trips still to come"
          loading={false}
        >
          <NotAvailable
            title="Upcoming trips are not exposed to a company"
            reason="The company-scoped endpoints report on trips that already happened — completed, cancelled and penalised. Nothing lists a company's future bookings: the dispatch pool is admin-only and a booking carries no company. A scheduled-trips route would fill this panel."
          />
        </ChartCard>
      </div>

      {/* --------------------------- driver performance ------------------------- */}
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <SectionCard
          title="Chauffeur performance"
          subtitle="Completed trips, revenue and completion rate, all time"
          action={
            <Link href="/drivers" className="text-note font-bold text-accent hover:underline">
              All chauffeurs
            </Link>
          }
          bodyClassName=""
        >
          {trips === null ? (
            <p className="px-5 pb-6 text-note text-fg-muted">Loading…</p>
          ) : performance.length === 0 ? (
            <p className="px-5 pb-6 text-note leading-relaxed text-fg-muted">
              No completed or cancelled trips yet. Performance appears here as soon as your
              chauffeurs finish their first jobs.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left" style={{ minWidth: "40rem" }}>
                <thead>
                  <tr className="border-y border-border-subtle bg-surface/60 text-label font-bold uppercase tracking-wider text-fg-muted">
                    <th className="px-5 py-3">Chauffeur</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3 text-right">Trips</th>
                    <th className="px-5 py-3 text-right">Cancelled</th>
                    <th className="px-5 py-3 text-right">Completion</th>
                    <th className="px-5 py-3 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle text-meta">
                  {performance.slice(0, 8).map((row) => {
                    const handled = row.trips + row.cancelled;
                    const rate = handled > 0 ? Math.round((row.trips / handled) * 100) : 0;
                    return (
                      <tr key={row.driverId} className="transition-colors hover:bg-surface/70">
                        <td className="px-5 py-3.5">
                          <span className="flex min-w-0 items-center gap-2.5">
                            <Avatar name={driverName(row.driver)} />
                            <span className="min-w-0">
                              <span className="block truncate font-bold text-fg">
                                {driverName(row.driver)}
                              </span>
                              <span className="block truncate text-label text-fg-muted">
                                {row.driver?.vehicleClass ?? "—"}
                                {row.driver && row.driver.ratingCount > 0
                                  ? ` · ${row.driver.rating.toFixed(1)}★`
                                  : ""}
                              </span>
                            </span>
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <StatusBadge status={row.driver?.status ?? "offline"} />
                        </td>
                        <td className="px-5 py-3.5 text-right font-bold text-fg">
                          {row.trips}
                        </td>
                        <td className="px-5 py-3.5 text-right text-fg-body">
                          {row.cancelled}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <span
                            className={`font-bold ${
                              rate >= 90
                                ? "text-chart-good"
                                : rate >= 70
                                  ? "text-chart-warn"
                                  : "text-chart-bad"
                            }`}
                          >
                            {rate}%
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right font-bold text-fg">
                          {money(row.revenue)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Recent trips"
          subtitle="Most recently completed"
          action={
            <Link href="/trips" className="text-note font-bold text-accent hover:underline">
              All trips
            </Link>
          }
          bodyClassName="px-5 pb-5"
        >
          {trips === null ? (
            <p className="py-6 text-note text-fg-muted">Loading…</p>
          ) : recent.length === 0 ? (
            <p className="py-6 text-note text-fg-muted">No completed trips yet.</p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {recent.map((row) => (
                <li key={row.tripId} className="flex items-center gap-3 py-3">
                  <span
                    aria-hidden
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-field bg-accent-soft text-accent-strong"
                  >
                    <IconRoute size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-meta font-bold text-fg">
                      {reference(row.tripId)}
                    </p>
                    <p className="truncate text-label text-fg-muted">
                      {formatDateTime(row.completedAt)}
                    </p>
                  </div>
                  <span className="shrink-0 text-meta font-bold text-fg">
                    {money(row.fareAmount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* -------------------------------- penalties ----------------------------- */}
      {penalties && penalties.drivers.length > 0 ? (
        <SectionCard
          className="mt-4"
          title="Chauffeurs carrying penalties"
          subtitle="A penalty delays that chauffeur's ride alerts by two minutes"
          action={
            <Link href="/penalties" className="text-note font-bold text-accent hover:underline">
              Full report
            </Link>
          }
          bodyClassName="px-5 pb-5"
        >
          <ul className="divide-y divide-border-subtle">
            {penalties.drivers.slice(0, 5).map((row) => (
              <li key={row.driverId} className="flex items-center gap-3 py-3">
                <Avatar name={row.user.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-meta font-bold text-fg">{row.user.name}</p>
                  <p className="truncate text-label text-fg-muted">{row.vehicleClass}</p>
                </div>
                <StatusBadge status={row.status} />
                <span className="flex shrink-0 items-center gap-1 text-meta font-bold text-chart-bad">
                  <IconStar size={13} />
                  {row.penaltyCount}
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
    </ConsolePage>
  );
}
