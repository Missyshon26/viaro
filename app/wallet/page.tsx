import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageShell, Panel, SectionTitle, EmptyState, money, formatDate } from "@/components/app/shell";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getMyWallet } from "@/lib/api/wallet";
import type { Transaction, TransactionType } from "@/lib/api/types";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Wallet | Viaro",
  robots: { index: false, follow: false },
};

/**
 * What a movement is, in words. The API's `reason` is a code ("ride_credit",
 * "trip_cancellation_refund") and was printed as-is next to the type.
 */
const REASON_LABEL: Record<string, string> = {
  ride_credit: "Credit applied to a ride",
  ride_credit_released: "Ride credit returned",
  trip_cancellation_refund: "Refund for a cancelled trip",
  trip_payment: "Ride payment",
  withdrawal_fee: "Withdrawal fee",
  withdrawal_fee_reversed: "Withdrawal fee returned",
  withdrawal_reversed: "Withdrawal returned",
  driver_withdrawal: "Bank withdrawal",
};

const TYPE_LABEL: Record<TransactionType, string> = {
  credit: "Credit added",
  debit: "Ride charge",
  refund: "Refund",
  withdrawal: "Bank withdrawal",
};

const incoming = (type: TransactionType) => type === "credit" || type === "refund";

function describe(row: Transaction) {
  if (row.reason && REASON_LABEL[row.reason]) return REASON_LABEL[row.reason];
  if (row.reason) {
    // An unknown code still reads as words rather than snake_case.
    const words = row.reason.replace(/[_-]+/g, " ").trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  return TYPE_LABEL[row.type];
}

export default async function WalletPage() {
  const user = await getCurrentUser();
  // Not "render nothing": a session that expired between middleware and here
  // would otherwise show a header and footer with a blank page between them.
  if (!user) redirect("/login?next=/wallet");

  const wallet = await getMyWallet(1, 50);
  const rows = wallet.transactions?.items ?? [];
  const empty = wallet.balance <= 0;

  return (
    <PageShell title="Wallet" description="Refunds and ride credit, spent on your next journey at no cost.">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
        <Panel className="p-0">
          <div className="px-6 pt-6">
            <SectionTitle>Activity</SectionTitle>
          </div>
          {rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No activity yet"
                description="Refunds from cancelled trips and credit you use on rides will appear here."
              />
            </div>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {rows.map((row) => {
                const isIn = incoming(row.type);
                const Icon = isIn ? ArrowDownLeft : ArrowUpRight;
                return (
                  <li key={row._id} className="flex items-center gap-4 px-6 py-4">
                    <span
                      aria-hidden
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                        isIn ? "bg-emerald-500/10 text-emerald-300" : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-cloud">{describe(row)}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {TYPE_LABEL[row.type]} · {formatDate(row.createdAt)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-semibold ${isIn ? "text-emerald-300" : "text-cloud"}`}>
                        {isIn ? "+" : "−"}
                        {money(Math.abs(row.amount))}
                      </p>
                      {row.feeApplied > 0 ? (
                        <p className="text-xs text-muted-foreground">fee {money(row.feeApplied)}</p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <div className="space-y-6 lg:sticky lg:top-24">
          <Panel>
            <SectionTitle>Available credit</SectionTitle>
            <p className="mt-3 font-sans text-4xl font-semibold tracking-tight text-cloud">
              {money(wallet.balance)}
            </p>

            {empty ? (
              <>
                <Button className="mt-5 w-full" disabled>
                  Spend on a ride
                </Button>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  Nothing to spend yet. Credit arrives here when a trip is refunded.
                </p>
              </>
            ) : (
              <>
                <Button asChild className="mt-5 w-full">
                  <Link href="/book">Spend on a ride</Link>
                </Button>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  Choose how much to use at the last step of booking. It comes off when your
                  chauffeur is assigned.
                </p>
              </>
            )}
          </Panel>

          <Panel>
            <SectionTitle>How credit works</SectionTitle>
            <ul className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
              <li>
                <span className="text-cloud">Where it comes from.</span> Cancel outside the free
                window and 90% of any fare already charged is refunded here.
              </li>
              <li>
                <span className="text-cloud">Spending it.</span> Free — no fee, any amount, on any
                ride.
              </li>
              <li>
                <span className="text-cloud">Withdrawing to a bank.</span> Not available on passenger
                accounts: credit can only be spent on rides. (Chauffeur payouts, which can be
                withdrawn, carry a 10% processing fee.)
              </li>
            </ul>
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}
