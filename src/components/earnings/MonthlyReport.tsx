"use client";

import { useState } from "react";
import { Card, Kicker } from "@/components/ui/Surfaces";
import { Button } from "@/components/ui/Button";
import type { MonthlyReport as Report } from "@/lib/api/driver";

const money = (amount: number) =>
  amount.toLocaleString("en-US", { style: "currency", currency: "USD" });

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-US", {
        timeZone: "America/Los_Angeles",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

const place = (address: string | null) => (address ? address.split(",")[0] : "—");

/**
 * Rides and pay per calendar month (Pacific), newest first — each month opens to the
 * rides in it. "Download CSV" exports every ride in the range for the chauffeur's own
 * records or their accountant. Pay is what they were actually credited, rating
 * adjustment included; passenger fares are never shown to chauffeurs.
 */
export function MonthlyReport({ report }: { report: Report | null }) {
  const [open, setOpen] = useState<string | null>(report?.months[0]?.month ?? null);

  if (!report) {
    return (
      <Card className="p-6">
        <Kicker>Monthly report</Kicker>
        <p className="mt-3 text-note text-fg-muted">Loading…</p>
      </Card>
    );
  }

  const months = report.months;

  function downloadCsv() {
    const rows = [
      ["Month", "Completed at (PT)", "Pickup", "Drop-off", "Vehicle", "Earned (USD)", "Rating"],
      ...months.flatMap((m) =>
        m.rides.map((r) => [
          m.label,
          when(r.completedAt),
          r.pickup ?? "",
          r.drop ?? "",
          r.vehicleClass ?? "",
          r.earned.toFixed(2),
          r.rating === null ? "" : String(r.rating),
        ]),
      ),
      [],
      ["Month", "Rides", "Cancelled by you", "Earned (USD)", "Withdrawn (USD)", "Average rating"],
      ...months.map((m) => [
        m.label,
        String(m.completed),
        String(m.cancelled),
        m.earnings.toFixed(2),
        m.withdrawn.toFixed(2),
        m.averageRating === null ? "" : m.averageRating.toFixed(2),
      ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `viaro-monthly-report-${months[months.length - 1]?.month}-to-${months[0]?.month}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center gap-3 px-6 pt-6">
        <div>
          <Kicker>Monthly report</Kicker>
          <p className="mt-1 text-note text-fg-muted">
            Last {months.length} months · {report.totals.completed} rides ·{" "}
            {money(report.totals.earnings)} earned
          </p>
        </div>
        <span className="ml-auto">
          <Button type="button" variant="secondary" onClick={downloadCsv}>
            Download CSV
          </Button>
        </span>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left">
          <thead className="border-b border-border-subtle text-label font-bold text-fg-muted">
            <tr>
              <th className="px-6 py-3">Month</th>
              <th className="px-4 py-3 text-right">Rides</th>
              <th className="px-4 py-3 text-right">Avg rating</th>
              <th className="px-4 py-3 text-right">Withdrawn</th>
              <th className="px-6 py-3 text-right">Earned</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle text-meta">
            {months.map((m) => {
              const expanded = open === m.month;
              return (
                <MonthRows
                  key={m.month}
                  month={m}
                  expanded={expanded}
                  onToggle={() => setOpen(expanded ? null : m.month)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function MonthRows({
  month,
  expanded,
  onToggle,
}: {
  month: Report["months"][number];
  expanded: boolean;
  onToggle: () => void;
}) {
  const empty = month.completed === 0 && month.earnings === 0 && month.withdrawn === 0;
  return (
    <>
      <tr
        onClick={empty ? undefined : onToggle}
        className={empty ? "text-fg-muted" : "cursor-pointer hover:bg-surface"}
      >
        <td className="px-6 py-3 font-bold text-fg">
          {!empty ? (
            <span aria-hidden className={`mr-2 inline-block transition-transform ${expanded ? "rotate-90" : ""}`}>
              ›
            </span>
          ) : null}
          {month.label}
          {month.cancelled > 0 ? (
            <span className="ml-2 text-note font-normal text-danger">{month.cancelled} cancelled</span>
          ) : null}
        </td>
        <td className="px-4 py-3 text-right">{month.completed}</td>
        <td className="px-4 py-3 text-right">
          {month.averageRating === null ? "—" : `${month.averageRating.toFixed(2)} ★`}
        </td>
        <td className="px-4 py-3 text-right">{month.withdrawn ? money(month.withdrawn) : "—"}</td>
        <td className="px-6 py-3 text-right font-bold text-fg">{money(month.earnings)}</td>
      </tr>
      {expanded && month.rides.length > 0 ? (
        <tr>
          <td colSpan={5} className="bg-surface px-6 py-3">
            <ul className="divide-y divide-border-subtle">
              {month.rides.map((ride) => (
                <li key={ride.tripId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-note">
                  <span className="w-32 shrink-0 text-fg-muted">{when(ride.completedAt)}</span>
                  <span className="min-w-0 flex-1 truncate text-fg" title={`${ride.pickup ?? ""} → ${ride.drop ?? ""}`}>
                    {place(ride.pickup)} → {place(ride.drop)}
                  </span>
                  <span className="w-14 text-right text-fg-muted">{ride.rating === null ? "" : `${ride.rating} ★`}</span>
                  <span className="w-20 text-right font-bold text-fg">{money(ride.earned)}</span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      ) : null}
    </>
  );
}
