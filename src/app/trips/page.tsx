"use client";

import { useEffect, useState } from "react";
import { ConsolePage, DataTable, money, formatDateTime, type Column } from "@/components/ui/DataTable";
import { getTripsCompleted, type TripsCompletedReport } from "@/lib/api/admin";
import { errorText } from "@/lib/api/client";
import { useDriverNames } from "@/lib/roster/useDriverNames";

type Row = TripsCompletedReport["rows"][number];

/**
 * Completed trips for the fleet. A company sees fare amounts — only drivers have them
 * stripped (spec section 8 rule 2).
 */
export default function CompanyTripsPage() {
  const [report, setReport] = useState<TripsCompletedReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Real chauffeur names rather than six characters of an ObjectId.
  const { nameFor } = useDriverNames();

  useEffect(() => {
    let cancelled = false;
    getTripsCompleted()
      .then((r) => { if (!cancelled) setReport(r); })
      .catch((err) => {
        if (cancelled) return;
        setError(errorText(err, "Could not load trips"));
        setReport({ scope: "all", count: 0, rows: [] });
      });
    return () => { cancelled = true; };
  }, []);

  const columns: Column<Row>[] = [
    { key: "trip", header: "Trip", cell: (r) => <span className="font-bold">{r.tripId.slice(-6).toUpperCase()}</span> },
    { key: "booking", header: "Booking", cell: (r) => r.bookingId.slice(-6).toUpperCase(), secondary: true },
    { key: "driver", header: "Driver", cell: (r) => nameFor(r.driverId) },
    { key: "completed", header: "Completed", cell: (r) => formatDateTime(r.completedAt) },
    { key: "fare", header: "Fare", align: "right", cell: (r) => money(r.fareAmount) },
  ];

  return (
    <ConsolePage
      title="Trips"
      description={`${report?.count ?? 0} completed · ${money(report?.totalFare)} in fares.`}
    >
      {error ? <p className="mb-4 text-note font-bold text-danger">{error}</p> : null}
      <DataTable
        rows={report?.rows ?? null}
        columns={columns}
        rowKey={(r) => r.tripId}
        minWidth="46rem"
        searchable={(r) => [
          r.tripId,
          r.tripId.slice(-6),
          r.bookingId,
          r.bookingId.slice(-6),
          nameFor(r.driverId),
          formatDateTime(r.completedAt),
          money(r.fareAmount),
        ]}
        searchPlaceholder="Search trip, booking, driver or date…"
        empty={{ title: "No completed trips", description: "Trips appear once your chauffeurs finish them." }}
      />
    </ConsolePage>
  );
}
