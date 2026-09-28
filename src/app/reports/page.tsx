"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Kicker } from "@/components/ui/Surfaces";
import { Button } from "@/components/ui/Button";
import { ConsolePage, DataTable, money, formatDateTime, type Column } from "@/components/ui/DataTable";
import {
  getTripsCompleted,
  getEarningsPayout,
  getCancellations,
  requestExport,
  getExportStatus,
  type TripsCompletedReport,
  type EarningsPayoutReport,
  type CancellationsReport,
  type ReportRange,
} from "@/lib/api/admin";
import { ApiError, downloadFile, errorText } from "@/lib/api/client";
import { useDriverNames } from "@/lib/roster/useDriverNames";

type ReportType = "trips-completed" | "earnings-payout" | "cancellations-penalties";

/**
 * Cancellations and penalties are separate tabs — a penalty is a chauffeur's own
 * conduct, a cancellation is what happened to a trip. They share one backend report
 * (and export), so both tabs fetch and export `cancellations-penalties`.
 */
type Tab = "trips-completed" | "earnings-payout" | "cancellations" | "penalties";

const TABS: { value: Tab; label: string }[] = [
  { value: "trips-completed", label: "Trips completed" },
  { value: "earnings-payout", label: "Earnings and payout" },
  { value: "cancellations", label: "Cancellations" },
  { value: "penalties", label: "Penalties" },
];

const reportFor = (tab: Tab): ReportType =>
  tab === "cancellations" || tab === "penalties" ? "cancellations-penalties" : tab;

const inputClass =
  "rounded-field border border-border bg-surface-raised px-3 py-2 text-note text-fg outline-none";

/** All three reports, one date range, plus the async CSV/PDF export. */
export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>("trips-completed");
  const [range, setRange] = useState<ReportRange>({});
  const [trips, setTrips] = useState<TripsCompletedReport | null>(null);
  const [earnings, setEarnings] = useState<EarningsPayoutReport | null>(null);
  const [cancels, setCancels] = useState<CancellationsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Real chauffeur names rather than six characters of an ObjectId.
  const { nameFor } = useDriverNames();

  const load = useCallback(async () => {
    setError(null);
    try {
      if (tab === "trips-completed") setTrips(await getTripsCompleted(range));
      if (tab === "earnings-payout") setEarnings(await getEarningsPayout(range));
      if (reportFor(tab) === "cancellations-penalties") setCancels(await getCancellations(range));
    } catch (err) {
      setError(errorText(err, "Could not run that report"));
    }
  }, [tab, range]);

  useEffect(() => {
    void load();
  }, [load]);

  const tripColumns: Column<TripsCompletedReport["rows"][number]>[] = [
    { key: "trip", header: "Trip", cell: (r) => r.tripId.slice(-6).toUpperCase() },
    { key: "booking", header: "Booking", cell: (r) => r.bookingId.slice(-6).toUpperCase(), secondary: true },
    { key: "driver", header: "Driver", cell: (r) => nameFor(r.driverId), secondary: true },
    { key: "completed", header: "Completed", cell: (r) => formatDateTime(r.completedAt) },
    { key: "fare", header: "Fare", align: "right", cell: (r) => money(r.fareAmount) },
  ];

  const earningColumns: Column<EarningsPayoutReport["rows"][number]>[] = [
    { key: "reason", header: "Movement", cell: (r) => r.reason ?? r.type },
    { key: "type", header: "Type", cell: (r) => r.type, secondary: true },
    { key: "date", header: "Date", cell: (r) => r.at },
    { key: "fee", header: "Fee", align: "right", cell: (r) => money(r.feeApplied), secondary: true },
    { key: "amount", header: "Amount", align: "right", cell: (r) => money(r.amount) },
  ];

  const penaltyColumns: Column<CancellationsReport["penalties"][number]>[] = [
    { key: "driver", header: "Chauffeur", cell: (r) => <span className="font-bold">{nameFor(r.driverId)}</span>, sortValue: (r) => nameFor(r.driverId) },
    { key: "when", header: "When", cell: (r) => formatDateTime(r.at), sortValue: (r) => r.at },
    { key: "reason", header: "Reason", cell: (r) => r.reason.replace(/_/g, " ") },
    { key: "booking", header: "Booking", cell: (r) => r.bookingId.slice(-6).toUpperCase(), secondary: true },
    { key: "delay", header: "Alert delay", align: "right", cell: (r) => `+${r.alertDelayMinutes} min` },
  ];

  const cancelColumns: Column<CancellationsReport["cancellations"][number]>[] = [
    { key: "trip", header: "Trip", cell: (r) => r.tripId.slice(-6).toUpperCase() },
    { key: "driver", header: "Chauffeur", cell: (r) => nameFor(r.driverId) },
    { key: "by", header: "Cancelled by", cell: (r) => r.cancelledBy ?? "—" },
    { key: "reason", header: "Reason", cell: (r) => r.reason ?? "—", secondary: true },
    { key: "refund", header: "Refund", align: "right", cell: (r) => `${r.refundPct}%` },
  ];

  return (
    <ConsolePage
      title="Reports"
      description="Scoped to your fleet. The same three reports the platform admin sees, for your drivers."
      /*
       * Keyed by report type on purpose: without it the component kept its state across a
       * tab change, so a finished export still offered "Download the file" on the new tab
       * — pointing at the PREVIOUS tab's job. Remounting per type discards the stale job.
       */
      action={<ExportButton key={tab} type={reportFor(tab)} range={range} />}
    >
      {error ? <p className="mb-4 text-note font-bold text-danger">{error}</p> : null}

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-wrap gap-1 rounded-field bg-accent-soft p-1">
          {TABS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setTab(item.value)}
              aria-pressed={tab === item.value}
              className={`rounded-[0.5rem] px-3 py-1.5 text-label font-bold transition-colors ${
                tab === item.value
                  ? "bg-surface-raised text-fg"
                  : "text-accent-strong hover:text-fg"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <label className="text-label font-bold text-fg-muted">
          From
          <input
            type="date"
            value={range.from ?? ""}
            onChange={(event) =>
              setRange((prev) => ({ ...prev, from: event.target.value || undefined }))
            }
            className={`${inputClass} ml-2`}
          />
        </label>
        <label className="text-label font-bold text-fg-muted">
          To
          <input
            type="date"
            value={range.to ?? ""}
            onChange={(event) =>
              setRange((prev) => ({ ...prev, to: event.target.value || undefined }))
            }
            className={`${inputClass} ml-2`}
          />
        </label>
        {range.from || range.to ? (
          <Button variant="secondary" block={false} onClick={() => setRange({})}>
            Clear
          </Button>
        ) : null}
      </div>

      <div className="mt-6">
        {tab === "trips-completed" ? (
          <>
            <Summary
              items={[
                ["Trips", String(trips?.count ?? 0)],
                ["Total fare", money(trips?.totalFare)],
              ]}
            />
            <DataTable
              rows={trips?.rows ?? null}
              columns={tripColumns}
              rowKey={(r) => r.tripId}
              minWidth="46rem"
              empty={{ title: "No completed trips in that range" }}
            />
          </>
        ) : null}

        {tab === "earnings-payout" ? (
          <>
            <Summary
              items={[
                ["Movements", String(earnings?.count ?? 0)],
                ["Grand total", money(earnings?.grandTotal)],
              ]}
            />
            <DataTable
              rows={earnings?.rows ?? null}
              columns={earningColumns}
              rowKey={(r) => r.transactionId}
              minWidth="46rem"
              empty={{ title: "Nothing recorded in that range" }}
            />
          </>
        ) : null}

        {tab === "cancellations" ? (
          <>
            <Summary items={[["Cancellations", String(cancels?.counts.cancellations ?? 0)]]} />
            <DataTable
              rows={cancels?.cancellations ?? null}
              columns={cancelColumns}
              rowKey={(r) => r.tripId}
              minWidth="42rem"
              empty={{ title: "No cancellations in that range" }}
            />
          </>
        ) : null}

        {tab === "penalties" ? (
          <>
            <Summary items={[["Penalties", String(cancels?.counts.penalties ?? 0)]]} />
            <DataTable
              rows={cancels?.penalties ?? null}
              columns={penaltyColumns}
              rowKey={(r) => r.penaltyId}
              minWidth="42rem"
              searchable={(r) => [nameFor(r.driverId), r.reason, r.bookingId]}
              searchPlaceholder="Search chauffeur or reason…"
              empty={{ title: "No penalties in that range" }}
            />
          </>
        ) : null}
      </div>
    </ConsolePage>
  );
}

function Summary({ items }: { items: [string, string][] }) {
  return (
    <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map(([label, value]) => (
        <Card key={label} className="p-5">
          <Kicker>{label}</Kicker>
          <p className="mt-2 text-[1.5rem] font-bold tracking-tight text-fg">{value}</p>
        </Card>
      ))}
    </div>
  );
}

/**
 * Exports are background jobs: the request answers 202 with a job id, and the status
 * endpoint is polled until the file is ready.
 *
 * The download goes through `downloadFile`, which attaches the bearer token and hands the
 * browser a blob. It used to be a plain anchor straight at the API — which a navigation
 * cannot authenticate, so it left the console and rendered the backend's raw
 * "Missing Authorization bearer token" JSON.
 */
function ExportButton({ type, range }: { type: ReportType; range: ReportRange }) {
  const [state, setState] = useState<{
    status?: string;
    error?: string;
    jobId?: string;
    ready?: boolean;
    format?: "csv" | "pdf";
  }>({});
  const [pending, setPending] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const run = async (format: "csv" | "pdf") => {
    setPending(true);
    setState({ status: "Queued…" });
    try {
      const { jobId } = await requestExport(type, format, range);
      setState({ status: "Generating…", jobId, format });

      // Poll for a short while; a long job keeps the id so it can be fetched later.
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const job = await getExportStatus(jobId);
        if (job.state === "completed") {
          setState({ status: "Ready", jobId, ready: true, format });
          return;
        }
        if (job.state === "failed") {
          setState({ error: "The export failed to generate.", jobId, format });
          return;
        }
      }
      setState({ status: "Still generating — check back shortly.", jobId, format });
    } catch (err) {
      setState({ error: err instanceof ApiError ? errorText(err) : "Could not export" });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <Button variant="secondary" block={false} disabled={pending} onClick={() => run("csv")}>
          Export CSV
        </Button>
        <Button variant="secondary" block={false} disabled={pending} onClick={() => run("pdf")}>
          Export PDF
        </Button>
      </div>
      {state.error ? <p className="text-label text-danger">{state.error}</p> : null}
      {state.status && !state.ready ? (
        <p className="text-label text-fg-muted">{state.status}</p>
      ) : null}
      {state.ready && state.jobId ? (
        <button
          type="button"
          disabled={downloading}
          onClick={async () => {
            setDownloading(true);
            try {
              await downloadFile(
                `/reports/exports/${state.jobId}/download`,
                `viaro-${type}-${state.jobId}.${state.format ?? "csv"}`,
              );
            } catch (err) {
              setState((prev) => ({
                ...prev,
                error: err instanceof ApiError ? errorText(err) : "Could not download the file",
              }));
            } finally {
              setDownloading(false);
            }
          }}
          className="text-note font-bold text-accent hover:underline disabled:opacity-60"
        >
          {downloading ? "Downloading…" : "Download the file"}
        </button>
      ) : null}
    </div>
  );
}
