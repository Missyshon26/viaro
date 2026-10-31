"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveChanges } from "@/lib/live/useLiveChanges";
import Link from "next/link";
import { ConsolePage, emptyActionClass } from "@/components/ui/DataTable";
import {
  Avatar,
  LoadError,
  NextSteps,
  NotAvailable,
  SectionCard,
  StatCard,
  StatCardSkeleton,
  StatusBadge,
  count,
  compactMoney,
  money,
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
  IconBuilding,
  IconCalendar,
  IconCheck,
  IconDispatch,
  IconIdCard,
  IconMoney,
  IconPenalty,
  IconRoute,
  IconStar,
  IconUsers,
} from "@/components/ui/Icons";
import {
  getCancellations,
  getDashboardSummary,
  getSubscriptionRevenue,
  getTripsCompleted,
  type CancellationsReport,
  type DashboardSummary,
  type RosterDriver,
  type SubscriptionRevenue,
  type TripsCompletedReport,
} from "@/lib/api/admin";

/**
 * Platform overview.
 *
 * Every figure on this page is derived from a live endpoint — nothing is seeded or
 * estimated. Where the API cannot answer a question the section says so rather than
 * inventing a plausible number; see the companies panel at the bottom.
 *
 * The counts by role come from `/admin/dashboard/users`, which returns a paginated
 * list rather than a summary, so the page walks the pages and tallies client-side. The
 * walk stops at ten pages; when it does, the UI says the tally is partial rather than
 * quietly under-reporting.
 */

const iso = (d: Date) => d.toISOString().slice(0, 10);
const since = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return iso(d);
};

const driverName = (driver: RosterDriver) =>
  driver.userId && typeof driver.userId === "object" ? driver.userId.name : "Driver";

export default function AdminDashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [revenue, setRevenue] = useState<SubscriptionRevenue | null>(null);
  const [cancels, setCancels] = useState<CancellationsReport | null>(null);
  const [completed, setCompleted] = useState<TripsCompletedReport | null>(null);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [range, setRange] = useState<RangeKey>("30d");
  const [ranged, setRanged] = useState<TripsCompletedReport | null>(null);
  const [rangeLoading, setRangeLoading] = useState(true);

  /*
   * Live: a booking, trip, user, chauffeur or payment changing anywhere refreshes the tiles
   * a moment later, without blanking them (the load below only ever replaces data).
   * "reconnected" is skipped because the first load has just happened.
   */
  const liveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLiveChanges(["booking", "trip", "dispatch", "user", "driver", "wallet"], (event) => {
    if (event.action === "reconnected") return;
    clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(() => setRetry((n) => n + 1), 800);
  });
  useEffect(() => () => clearTimeout(liveTimer.current), []);

  /* ---------------------------- one-off page load --------------------------- */

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Each tile has its own source; one failure must not blank the dashboard, and each
      // fills the moment its own answer lands rather than waiting for the slowest.
      let failed = false;
      const settle = <T,>(request: Promise<T>, apply: (value: T) => void) =>
        request.then(
          (value) => {
            if (!cancelled) apply(value);
          },
          () => {
            failed = true;
          },
        );
      await Promise.all([
        settle(getDashboardSummary(), setSummary),
        settle(getSubscriptionRevenue(), setRevenue),
        settle(getCancellations(), setCancels),
        settle(getTripsCompleted(), setCompleted),
      ]);
      if (!cancelled && failed) setError("Some dashboard data could not be loaded.");
    })();

    return () => {
      cancelled = true;
    };
  }, [retry]);

  /* ------------------------- refetch when range changes --------------------- */

  useEffect(() => {
    let cancelled = false;
    setRangeLoading(true);

    const days = RANGES.find((r) => r.key === range)?.days ?? 30;
    // The range filter is served by the API, not sliced from a cached list — the
    // report endpoint takes `from`, so the numbers stay right beyond the page limit.
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
  }, [range, retry]);

  /* -------------------------------- derived -------------------------------- */

  const byRole = summary?.users ?? { customer: 0, driver: 0, company: 0, admin: 0 };
  const bookingStatus = summary?.bookings.stages ?? { awaiting: 0, assigned: 0, in_progress: 0, completed: 0, cancelled: 0 };
  const driverStatus = summary?.drivers ?? { total: 0, available: 0, busy: 0, offline: 0, penalised: 0, top: [] as RosterDriver[] };
  const topDrivers = driverStatus.top;
  const bookings = summary ? { total: summary.bookings.total } : null;
  const awaiting = summary ? summary.bookings.stages.awaiting : null;

  const days = RANGES.find((r) => r.key === range)?.days ?? 30;
  const tripSeries = useMemo(
    () => bucketByDay((ranged?.rows ?? []).map((r) => ({ at: r.completedAt, value: 1 })), days),
    [ranged, days],
  );
  const revenueSeries = useMemo(
    () =>
      bucketByDay(
        (ranged?.rows ?? []).map((r) => ({ at: r.completedAt, value: r.fareAmount ?? 0 })),
        days,
      ),
    [ranged, days],
  );

  const rangedFare = ranged?.totalFare ?? 0;
  const rangedCount = ranged?.count ?? 0;
  const avgTrip = rangedCount > 0 ? rangedFare / rangedCount : 0;

  const activeTrips = bookingStatus.in_progress + bookingStatus.assigned;
  const loadingCore = summary === null;

  const subscriptionSeries = useMemo(
    () =>
      (revenue?.months ?? []).map((m) => ({
        label: new Date(m.year, m.month - 1).toLocaleDateString("en-US", { month: "short" }),
        value: m.revenue,
      })),
    [revenue],
  );

  if (error) return <ConsolePage title="Platform operations"><LoadError onRetry={() => { setError(null); setSummary(null); setRetry((value) => value + 1); }} /></ConsolePage>;

  return (
    <ConsolePage
      title="Platform operations"
      description="Bookings, users, revenue and the state of dispatch — across every company on the platform."
      action={<Link href="/trips" className="inline-flex min-h-11 items-center justify-center rounded-field bg-primary px-5 text-action font-bold text-primary-fg hover:brightness-110">Open trip operations <span aria-hidden className="ml-3">→</span></Link>}
    >
      {error ? (
        <p className="mb-4 rounded-field border border-danger/30 bg-danger/5 px-4 py-3 text-note font-bold text-danger">
          {error}
        </p>
      ) : null}

      {!loadingCore && <NextSteps items={[
        { title: `${awaiting ?? 0} trips awaiting a driver`, description: "Review the requests and assign an available driver.", href: "/trips?stage=awaiting", urgent: (awaiting ?? 0) > 0 },
        { title: "Review driver accounts", description: "Check documents, account status and eligibility.", href: "/drivers" },
        { title: "Resolve support requests", description: "Follow up on passenger and driver cases.", href: "/support" },
      ]} />}

      {/* --------------------------------- KPIs --------------------------------- */}
      <div className="metric-grid grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loadingCore ? (
          Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard
              tone="feature"
              label="Total trips"
              value={count(bookings?.total)}
              hint="Bookings created, all time"
              icon={<IconRoute size={18} />}
              href="/trips"
            />
            <StatCard
              tone="feature"
              label="Trip revenue"
              value={compactMoney(completed?.totalFare ?? 0)}
              hint={`${count(completed?.count ?? 0)} settled trips`}
              icon={<IconMoney size={18} />}
              href="/trips?stage=completed"
            />
            <StatCard
              label="Active trips"
              value={count(activeTrips)}
              hint="Assigned or in progress"
              icon={<IconDispatch size={18} />}
              href="/trips?stage=active"
            />
            <StatCard
              label="Waiting for a driver"
              value={count(awaiting)}
              hint="No driver assigned yet"
              icon={<IconCalendar size={18} />}
              href="/trips?stage=awaiting"
            />
          </>
        )}
      </div>

      <div className="mt-4 metric-grid grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loadingCore ? (
          Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard
              label="Companies"
              value={count(byRole.company)}
              hint="Fleet operators"
              icon={<IconBuilding size={18} />}
              href="/users?role=company"
            />
            <StatCard
              label="Drivers"
              value={count(summary ? driverStatus.total : byRole.driver)}
              hint={`${driverStatus.available} online now`}
              icon={<IconIdCard size={18} />}
              href="/drivers"
            />
            <StatCard
              label="Customers"
              value={count(byRole.customer)}
              hint="Passenger accounts"
              icon={<IconUsers size={18} />}
              href="/users?role=customer"
            />
            <StatCard
              label="Cancellations"
              value={count(cancels?.counts.cancellations)}
              hint={`${cancels?.counts.penalties ?? 0} penalties recorded`}
              icon={<IconPenalty size={18} />}
              href="/trips?stage=cancelled"
            />
          </>
        )}
      </div>


      {/* ------------------------------- analytics ------------------------------ */}
      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Trips completed"
          subtitle={`${count(rangedCount)} in the last ${
            RANGES.find((r) => r.key === range)?.label
          }`}
          action={<RangeTabs value={range} onChange={setRange as never} />}
          loading={rangeLoading}
          error={!rangeLoading && !ranged}
          onRetry={() => setRetry((value) => value + 1)}
        >
          <AreaChart data={tripSeries} emptyAction={<Link href="/trips" className={emptyActionClass}>View trips</Link>} />
        </ChartCard>

        <ChartCard
          title="Trip revenue"
          subtitle={
            <>
              {compactMoney(rangedFare)} collected ·{" "}
              <span className="font-bold text-fg">{money(avgTrip)}</span> average trip
            </>
          }
          action={<RangeTabs value={range} onChange={setRange as never} />}
          loading={rangeLoading}
          error={!rangeLoading && !ranged}
          onRetry={() => setRetry((value) => value + 1)}
        >
          <BarChart data={revenueSeries} kind="money" color="var(--chart-2)" emptyAction={<Link href="/revenue" className={emptyActionClass}>View revenue</Link>} />
        </ChartCard>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <ChartCard
          title="Trip status"
          subtitle="Where every booking currently stands"
          loading={loadingCore}
        >
          <DonutChart
            total={
              bookingStatus.completed +
              bookingStatus.awaiting +
              activeTrips +
              bookingStatus.cancelled
            }
            totalLabel="Trips"
            slices={[
              {
                label: "Completed",
                value: bookingStatus.completed,
                color: "var(--chart-good)",
                href: "/trips?stage=completed",
              },
              { label: "Active", value: activeTrips, color: "var(--chart-2)", href: "/trips?stage=active" },
              { label: "Awaiting a driver", value: bookingStatus.awaiting, color: "var(--chart-warn)", href: "/trips?stage=awaiting" },
              {
                label: "Cancelled",
                value: bookingStatus.cancelled,
                color: "var(--chart-bad)",
                href: "/trips?stage=cancelled",
              },
            ]}
          />
        </ChartCard>

        <ChartCard
          title="Driver availability"
          subtitle={`${driverStatus.total} on the platform`}
          loading={summary === null}
        >
          <div className="space-y-4">
            <ProgressBar
              label="Online"
              value={driverStatus.available}
              max={driverStatus.total || 1}
              display={String(driverStatus.available)}
              tone="good"
            />
            <ProgressBar
              label="On a trip"
              value={driverStatus.busy}
              max={driverStatus.total || 1}
              display={String(driverStatus.busy)}
              tone="warn"
            />
            <ProgressBar
              label="Offline"
              value={driverStatus.offline}
              max={driverStatus.total || 1}
              display={String(driverStatus.offline)}
            />
            <Link
              href="/drivers"
              className="mt-1 inline-block text-note font-bold text-accent hover:underline"
            >
              Manage drivers →
            </Link>
          </div>
        </ChartCard>

        <ChartCard
          title="Subscription revenue"
          subtitle={`${revenue?.totalActive ?? 0} active plans · ${compactMoney(
            revenue?.totalRevenue ?? 0,
          )} all time`}
          loading={revenue === null}
        >
          {subscriptionSeries.length > 0 ? (
            <BarChart data={subscriptionSeries} kind="money" color="var(--chart-3)" height={180} emptyAction={<Link href="/revenue" className={emptyActionClass}>View revenue</Link>} />
          ) : (
            <p className="py-10 text-center text-note text-fg-muted">
              No subscription revenue recorded yet.
            </p>
          )}
        </ChartCard>
      </div>

      {/* ------------------------------ leaderboards ---------------------------- */}
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <SectionCard
          title="Top-rated drivers"
          subtitle="Ranked by passenger rating, rated trips only"
          action={
            <Link href="/drivers" className="text-note font-bold text-accent hover:underline">
              All drivers
            </Link>
          }
          bodyClassName="px-5 pb-5"
        >
          {summary === null ? (
            <p className="py-6 text-note text-fg-muted">Loading…</p>
          ) : topDrivers.length === 0 ? (
            <div className="py-6">
              <p className="text-note text-fg-muted">
                No driver has been rated yet — ratings appear once passengers score a
                completed trip.
              </p>
              <Link href="/drivers" className={`${emptyActionClass} mt-3`}>View drivers</Link>
            </div>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {topDrivers.map((driver) => (
                <li key={driver._id} className="flex items-center gap-3 py-3">
                  <Avatar name={driverName(driver)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-meta font-bold text-fg">
                      {driverName(driver)}
                    </p>
                    <p className="truncate text-label text-fg-muted">
                      {driver.vehicleClass} · {driver.ratingCount} ratings
                    </p>
                  </div>
                  <StatusBadge status={driver.status} />
                  <span className="flex shrink-0 items-center gap-1 text-meta font-bold text-fg">
                    <IconStar size={13} className="text-chart-warn" />
                    {driver.rating.toFixed(1)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Companies"
          subtitle="Per-operator performance"
          bodyClassName="px-5 pb-5"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-field border border-border bg-surface p-4">
              <p className="text-label font-bold uppercase tracking-wider text-fg-muted">
                Registered operators
              </p>
              <p className="mt-2 text-[1.5rem] font-bold tracking-tight text-fg">
                {count(byRole.company)}
              </p>
            </div>
            <div className="rounded-field border border-border bg-surface p-4">
              <p className="text-label font-bold uppercase tracking-wider text-fg-muted">
                Penalised drivers
              </p>
              <p className="mt-2 text-[1.5rem] font-bold tracking-tight text-fg">
                {count(driverStatus.penalised)}
              </p>
            </div>
          </div>

          <div className="mt-3">
            <NotAvailable
              title="Company performance is unavailable"
              reason="Company-level reporting is not available yet. Use the revenue and driver reports to review platform performance."
            />
          </div>
        </SectionCard>
      </div>

      {/* -------------------------------- shortcuts ----------------------------- */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <QuickLink
          href="/pricing"
          icon={<IconCheck size={18} />}
          title="City pricing"
          body="A city without a rule cannot be quoted at all — booking there fails outright."
        />
        <QuickLink
          href="/trips?stage=awaiting"
          icon={<IconDispatch size={18} />}
          title="Trips awaiting a driver"
          body="Bookings nobody has been assigned to yet — open one and assign a driver."
        />
        <QuickLink
          href="/support"
          icon={<IconPenalty size={18} />}
          title="Support queue"
          body="Disputes and appeals. Only an admin can move a case between states."
        />
      </div>
    </ConsolePage>
  );
}

function QuickLink({
  href,
  icon,
  title,
  body,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-card border border-border bg-surface-raised p-5 shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-[var(--shadow-raised)]"
    >
      <span
        aria-hidden
        className="inline-flex h-9 w-9 items-center justify-center rounded-field bg-accent-soft text-accent-strong"
      >
        {icon}
      </span>
      <p className="mt-3 text-action font-bold text-fg">{title}</p>
      <p className="mt-1.5 text-note leading-relaxed text-fg-muted">{body}</p>
    </Link>
  );
}
