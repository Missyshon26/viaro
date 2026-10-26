"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DatePicker } from "@/components/ui/DatePicker";
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
import { downloadFile, errorText } from "@/lib/api/client";

type ReportType = "trips-completed" | "earnings-payout" | "cancellations-penalties";

const TABS: { value: ReportType; label: string }[] = [
  { value: "trips-completed", label: "Trips completed" },
  { value: "earnings-payout", label: "Earnings and payout" },
  { value: "cancellations-penalties", label: "Cancellations and penalties" },
];

/** All three reports, one date range, plus the async CSV/PDF export. */
export default function ReportsPage() {
  const [tab, setTab] = useState<ReportType>("trips-completed");
  const [pageSize, setPageSize] = useState(20);
  const [range, setRange] = useState<ReportRange>({});
  const [trips, setTrips] = useState<TripsCompletedReport | null>(null);
  const [earnings, setEarnings] = useState<EarningsPayoutReport | null>(null);
  const [cancels, setCancels] = useState<CancellationsReport | null>(null);
  const latestRequest = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const request = ++latestRequest.current;
    setLoading(true);
    setError(null);
    try {
      if (tab === "trips-completed") { const result = await getTripsCompleted(range); if (request === latestRequest.current) setTrips(result); }
      if (tab === "earnings-payout") { const result = await getEarningsPayout(range); if (request === latestRequest.current) setEarnings(result); }
      if (tab === "cancellations-penalties") { const result = await getCancellations(range); if (request === latestRequest.current) setCancels(result); }
    } catch (err) {
      if (request === latestRequest.current) setError(errorText(err, "Could not run that report"));
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }, [tab, range]);

  useEffect(() => {
    void load();
    return () => { latestRequest.current += 1; };
  }, [load]);

  const tripColumns: Column<TripsCompletedReport["rows"][number]>[] = [
    { key: "trip", header: "Trip", cell: (r) => r.tripId.slice(-6).toUpperCase() },
    { key: "booking", header: "Booking", cell: (r) => r.bookingId.slice(-6).toUpperCase(), secondary: true },
    { key: "driver", header: "Driver", cell: (r) => r.driverId.slice(-6).toUpperCase(), secondary: true },
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

  const cancelColumns: Column<CancellationsReport["cancellations"][number]>[] = [
    { key: "trip", header: "Trip", cell: (r) => r.tripId.slice(-6).toUpperCase() },
    { key: "by", header: "Cancelled by", cell: (r) => r.cancelledBy ?? "—" },
    { key: "reason", header: "Reason", cell: (r) => r.reason ?? "—", secondary: true },
    { key: "refund", header: "Refund", align: "right", cell: (r) => `${r.refundPct}%` },
  ];

  return (
    <ConsolePage
      title="Reports"
      description="Scoped to the whole platform for an admin. Drivers see only their own."
      /*
       * Keyed by report type: without it a finished export kept offering "Download the
       * file" after a tab change, pointing at the previous tab's job.
       */
      action={<ExportButton key={tab} type={tab} range={range} />}
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

        <div className="flex items-center gap-2"><span className="text-label font-medium text-fg-muted">From</span><DatePicker label="From date" value={range.from ?? ""} max={range.to} onChange={(value) => setRange((prev) => ({ ...prev, from: value || undefined }))} /></div>
        <div className="flex items-center gap-2"><span className="text-label font-medium text-fg-muted">To</span><DatePicker label="To date" value={range.to ?? ""} min={range.from} onChange={(value) => setRange((prev) => ({ ...prev, to: value || undefined }))} /></div>
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
              key={`${tab}:${range.from ?? ""}:${range.to ?? ""}`}
              loading={loading}
              pageSize={pageSize}
              onPageSizeChange={setPageSize}
              rows={error ? [] : trips?.rows ?? null}
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
              key={`${tab}:${range.from ?? ""}:${range.to ?? ""}`}
              loading={loading}
              pageSize={pageSize}
              onPageSizeChange={setPageSize}
              rows={error ? [] : earnings?.rows ?? null}
              columns={earningColumns}
              rowKey={(r) => r.transactionId}
              minWidth="46rem"
              empty={{ title: "Nothing recorded in that range" }}
            />
          </>
        ) : null}

        {tab === "cancellations-penalties" ? (
          <>
            <Summary
              items={[
                ["Cancellations", String(cancels?.counts.cancellations ?? 0)],
                ["Penalties", String(cancels?.counts.penalties ?? 0)],
              ]}
            />
            <DataTable
              key={`${tab}:${range.from ?? ""}:${range.to ?? ""}`}
              loading={loading}
              pageSize={pageSize}
              onPageSizeChange={setPageSize}
              rows={error ? [] : cancels?.cancellations ?? null}
              columns={cancelColumns}
              rowKey={(r) => r.tripId}
              minWidth="42rem"
              empty={{ title: "No cancellations in that range" }}
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
 * endpoint is polled until the file is ready. The download itself is a plain link to
 * the API, so the browser handles the file rather than the app buffering it.
 */
function ExportButton({ type, range }: { type: ReportType; range: ReportRange }) {
  const [state, setState] = useState<{
    status?: string;
    error?: string;
    jobId?: string;
    ready?: boolean;
    format?: "csv" | "pdf" | "xlsx";
  }>({});
  const [pending, setPending] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const run = async (format: "csv" | "pdf" | "xlsx") => {
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
      setState({ error: errorText(err, "Could not export") });
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
        <Button variant="secondary" block={false} disabled={pending} onClick={() => run("xlsx")}>
          Export Excel
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
                `abl-${type}-${state.jobId}.${state.format ?? "csv"}`,
              );
            } catch (err) {
              setState((prev) => ({
                ...prev,
                error: errorText(err, "Could not download the file"),
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
