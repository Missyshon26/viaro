"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, Kicker } from "@/components/ui/Surfaces";
import { ConsolePage, DataTable, formatDateTime, type Column } from "@/components/ui/DataTable";
import {
  getCancellations,
  listDrivers,
  type CancellationsReport,
  type RosterDriver,
} from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";

type CancelRow = CancellationsReport["cancellations"][number];

const WHO: Record<string, string> = {
  customer: "Passenger",
  driver: "Chauffeur",
  admin: "Viaro operations",
};

/**
 * Trip cancellations on the roster — separate from penalties, which are a chauffeur's
 * own conduct. Each row names the chauffeur on the trip and who cancelled it.
 */
export default function CancellationsPage() {
  const [report, setReport] = useState<CancellationsReport | null>(null);
  const [drivers, setDrivers] = useState<RosterDriver[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [c, d] = await Promise.allSettled([getCancellations(), listDrivers(1, 100)]);
      if (cancelled) return;
      if (c.status === "fulfilled") setReport(c.value);
      else setError(c.reason instanceof ApiError ? c.reason.message : "Could not load cancellations");
      if (d.status === "fulfilled") setDrivers(Array.isArray(d.value) ? d.value : d.value.items);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const nameOf = useMemo(() => {
    const map = new Map(
      drivers.map((d) => [d._id, typeof d.userId === "object" ? d.userId.name : "Chauffeur"]),
    );
    return (id: string) => map.get(id) ?? "Chauffeur";
  }, [drivers]);

  const rows = report?.cancellations ?? null;
  const byDriver = (rows ?? []).filter((r) => r.cancelledBy === "driver").length;

  const columns: Column<CancelRow>[] = [
    {
      key: "trip",
      header: "Trip",
      cell: (r) => <span className="font-bold">{r.tripId.slice(-6).toUpperCase()}</span>,
    },
    {
      key: "chauffeur",
      header: "Chauffeur",
      cell: (r) => nameOf(r.driverId),
      sortValue: (r) => nameOf(r.driverId),
    },
    {
      key: "by",
      header: "Cancelled by",
      cell: (r) => (r.cancelledBy ? (WHO[r.cancelledBy] ?? r.cancelledBy) : "—"),
      sortValue: (r) => r.cancelledBy ?? "",
    },
    { key: "reason", header: "Reason", cell: (r) => r.reason ?? "—", secondary: true },
    { key: "refunded", header: "Refunded", cell: (r) => formatDateTime(r.refundedAt), secondary: true },
    { key: "pct", header: "Refund", align: "right", cell: (r) => `${r.refundPct}%`, sortValue: (r) => r.refundPct },
  ];

  return (
    <ConsolePage
      title="Cancellations"
      description="Trips on your roster that were cancelled, and by whom."
      action={
        <Link href="/penalties" className="text-note font-bold text-accent hover:underline">
          Penalties →
        </Link>
      }
    >
      {error ? <p className="mb-4 text-note font-bold text-danger">{error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <Kicker>Cancellations</Kicker>
          <p className="mt-3 text-[1.75rem] font-bold tracking-tight text-fg">{report?.counts.cancellations ?? "—"}</p>
        </Card>
        <Card className="p-5">
          <Kicker>Cancelled by a chauffeur</Kicker>
          <p className="mt-3 text-[1.75rem] font-bold tracking-tight text-fg">{report ? byDriver : "—"}</p>
        </Card>
      </div>

      <div className="mt-6">
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.tripId}
          minWidth="46rem"
          searchable={(r) => [r.tripId, r.tripId.slice(-6), nameOf(r.driverId), r.reason, r.cancelledBy ? WHO[r.cancelledBy] : null]}
          searchPlaceholder="Search trip, chauffeur or reason…"
          empty={{ title: "No cancellations" }}
        />
      </div>
    </ConsolePage>
  );
}
