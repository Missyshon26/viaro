"use client";

import { useEffect, useState } from "react";
import { Card, Kicker, WarnBox } from "@/components/ui/Surfaces";
import { ConsolePage, DataTable, money, type Column } from "@/components/ui/DataTable";
import { getEarningsPayout, type EarningsPayoutReport } from "@/lib/api/admin";
import { errorText } from "@/lib/api/client";

type Row = EarningsPayoutReport["rows"][number];

/** The company's share of each settled trip, as written to its wallet. */
export default function CompanyRevenuePage() {
  const [report, setReport] = useState<EarningsPayoutReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getEarningsPayout()
      .then((r) => { if (!cancelled) setReport(r); })
      .catch((err) => {
        if (cancelled) return;
        setError(errorText(err, "Could not load revenue"));
      });
    return () => { cancelled = true; };
  }, []);

  const columns: Column<Row>[] = [
    { key: "reason", header: "Movement", cell: (r) => r.reason ?? r.type },
    { key: "type", header: "Type", cell: (r) => r.type, secondary: true },
    { key: "date", header: "Date", cell: (r) => r.at },
    { key: "amount", header: "Amount", align: "right", cell: (r) => money(r.amount) },
  ];

  const totals = report?.totals ?? {};

  return (
    <ConsolePage title="Revenue" description="Your share of every settled trip.">
      {error ? <p className="mb-4 text-note font-bold text-danger">{error}</p> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <Kicker>Total</Kicker>
          <p className="mt-3 text-[1.75rem] font-bold tracking-tight text-fg">
            {money(report?.grandTotal ?? report?.totalCredited ?? 0)}
          </p>
        </Card>
        {Object.entries(totals).slice(0, 2).map(([reason, value]) => (
          <Card key={reason} className="p-5">
            <Kicker>{reason.replace(/_/g, " ")}</Kicker>
            <p className="mt-3 text-[1.75rem] font-bold tracking-tight text-fg">
              {money(value)}
            </p>
          </Card>
        ))}
      </div>

      <div className="mt-6">
        <DataTable
          rows={report?.rows ?? null}
          columns={columns}
          rowKey={(r) => r.transactionId}
          minWidth="40rem"
          searchable={(r) => [r.reason, r.reason?.replace(/_/g, " "), r.type, r.at, money(r.amount), r.transactionId]}
          searchPlaceholder="Search movement, type, date or amount…"
          empty={{ title: "Nothing recorded", description: "The split is written when a trip settles." }}
        />
      </div>

      <div className="mt-4">
        <WarnBox title="How the split works">
          Each completed trip is divided between the company and the platform, and the
          chauffeur is paid from the owner&rsquo;s share on the terms set for them.
        </WarnBox>
      </div>
    </ConsolePage>
  );
}
