"use client";

import { useEffect, useState } from "react";
import { Card, Kicker } from "@/components/ui/Surfaces";
import { ConsolePage, DataTable, money, type Column } from "@/components/ui/DataTable";
import {
  getSubscriptionRevenue,
  getEarningsPayout,
  type SubscriptionRevenue,
  type EarningsPayoutReport,
} from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";

type MonthRow = SubscriptionRevenue["months"][number];
type PayoutRow = EarningsPayoutReport["rows"][number];

/**
 * Two revenue sources: subscriptions, and the revenue split recorded against wallets.
 * For an admin the payout report aggregates every wallet, not just one.
 */
export default function RevenuePage() {
  const [subs, setSubs] = useState<SubscriptionRevenue | null>(null);
  const [split, setSplit] = useState<EarningsPayoutReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, p] = await Promise.allSettled([getSubscriptionRevenue(), getEarningsPayout()]);
      if (cancelled) return;
      if (s.status === "fulfilled") setSubs(s.value);
      if (p.status === "fulfilled") setSplit(p.value);
      if (s.status === "rejected") {
        setError(s.reason instanceof ApiError ? s.reason.message : "Could not load revenue");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const monthColumns: Column<MonthRow>[] = [
    {
      key: "month",
      header: "Month",
      cell: (m) => new Date(m.year, m.month - 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    },
    { key: "active", header: "Active subscriptions", cell: (m) => m.activeSubscriptions },
    { key: "revenue", header: "Revenue", align: "right", cell: (m) => money(m.revenue) },
  ];

  const splitColumns: Column<PayoutRow>[] = [
    { key: "reason", header: "Movement", cell: (r) => r.reason ?? r.type },
    { key: "date", header: "Date", cell: (r) => r.at },
    { key: "amount", header: "Amount", align: "right", cell: (r) => money(r.amount) },
  ];

  return (
    <ConsolePage title="Revenue" description="Subscriptions and the platform revenue split.">
      {error ? <p className="mb-4 text-note font-bold text-danger">{error}</p> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <Kicker>Subscription revenue</Kicker>
          <p className="mt-3 text-[1.75rem] font-bold tracking-tight text-fg">
            {subs ? money(subs.totalRevenue) : "—"}
          </p>
        </Card>
        <Card className="p-5">
          <Kicker>Active subscriptions</Kicker>
          <p className="mt-3 text-[1.75rem] font-bold tracking-tight text-fg">
            {subs?.totalActive ?? "—"}
          </p>
        </Card>
        <Card className="p-5">
          <Kicker>Split recorded</Kicker>
          <p className="mt-3 text-[1.75rem] font-bold tracking-tight text-fg">
            {split ? money(split.grandTotal ?? 0) : "—"}
          </p>
          <p className="mt-1.5 text-note text-fg-muted">{split?.count ?? 0} movements</p>
        </Card>
      </div>

      <div className="mt-6">
        <Kicker>By month</Kicker>
        <div className="mt-3">
          <DataTable
            rows={subs?.months ?? null}
            columns={monthColumns}
            rowKey={(m) => `${m.year}-${m.month}`}
            minWidth="34rem"
            empty={{ title: "No subscription revenue yet" }}
          />
        </div>
      </div>

      <div className="mt-6">
        <Kicker>Revenue split</Kicker>
        <div className="mt-3">
          <DataTable
            rows={split?.rows ?? null}
            columns={splitColumns}
            rowKey={(r) => r.transactionId}
            minWidth="34rem"
            empty={{ title: "Nothing recorded", description: "The split is written when a trip settles." }}
          />
        </div>
      </div>
    </ConsolePage>
  );
}
