"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Kicker, WarnBox } from "@/components/ui/Surfaces";
import { Button } from "@/components/ui/Button";
import {
  getEarningsPayout,
  getTripsCompleted,
  getCancellations,
  getMyWallet,
  getMyDriver,
  getMonthlyReport,
  withdraw,
  todayRange,
  weekRange,
  type EarningsPayoutReport,
  type TripsCompletedReport,
  type CancellationsReport,
  type WalletPage,
  type MonthlyReport as MonthlyReportData,
  type PayTier,
} from "@/lib/api/driver";
import { MonthlyReport } from "@/components/earnings/MonthlyReport";
import { PayTierCard } from "@/components/earnings/PayTierCard";
import { ApiError } from "@/lib/api/client";

/** Figma desktop "18 · Earnings", palette B (frame 57:5517, 1280×842). */

const money = (amount: number) =>
  amount.toLocaleString("en-US", { style: "currency", currency: "USD" });

const MOVEMENT: Record<string, string> = {
  credit: "Trip payout",
  debit: "Adjustment",
  refund: "Refund",
  withdrawal: "Bank withdrawal",
};

/** The API's reason codes, in words. Unknown codes are shown de-snake-cased. */
const REASON: Record<string, string> = {
  driver_earnings: "",
  driver_withdrawal: "",
  withdrawal_fee: "Withdrawal fee",
  withdrawal_reversed: "Withdrawal returned",
  withdrawal_fee_reversed: "Fee returned",
  driver_payout_paid: "",
};
const reasonText = (reason?: string | null) =>
  !reason ? "" : reason in REASON ? REASON[reason] : reason.replace(/_/g, " ");

export default function EarningsPage() {
  const [week, setWeek] = useState<EarningsPayoutReport | null>(null);
  const [today, setToday] = useState<EarningsPayoutReport | null>(null);
  const [allTime, setAllTime] = useState<EarningsPayoutReport | null>(null);
  const [trips, setTrips] = useState<TripsCompletedReport | null>(null);
  const [penalties, setPenalties] = useState<CancellationsReport | null>(null);
  const [wallet, setWallet] = useState<WalletPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [monthly, setMonthly] = useState<MonthlyReportData | null>(null);
  const [pay, setPay] = useState<PayTier | null>(null);

  /**
   * Extracted from the effect so a successful withdrawal can re-run it.
   *
   * A withdrawal genuinely moved the money, but nothing on this screen re-fetched: the
   * balance, the lifetime-credited figure and the payout table all kept showing
   * pre-withdrawal numbers until a manual reload. The support and document-upload forms
   * on this app already take an `onDone` reload callback; the withdrawal form did not.
   */
  const load = useCallback(async (isCurrent: () => boolean = () => true) => {
    const [w, t, a, tc, cp, wl, mr, pr] = await Promise.allSettled([
      getEarningsPayout(weekRange()),
      getEarningsPayout(todayRange()),
      getEarningsPayout(),
      getTripsCompleted(weekRange()),
      getCancellations(),
      getMyWallet(1, 30),
      getMonthlyReport(12),
      getMyDriver(),
    ]);
    if (!isCurrent()) return;

    if (w.status === "fulfilled") setWeek(w.value);
    if (t.status === "fulfilled") setToday(t.value);
    if (a.status === "fulfilled") setAllTime(a.value);
    if (tc.status === "fulfilled") setTrips(tc.value);
    if (cp.status === "fulfilled") setPenalties(cp.value);
    if (wl.status === "fulfilled") setWallet(wl.value);
    if (mr.status === "fulfilled") setMonthly(mr.value);
    if (pr.status === "fulfilled") setPay(pr.value.pay ?? null);
    setError(a.status === "rejected" ? "Could not load your earnings." : null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  const weekCount = trips?.count ?? 0;
  const weekTotal = week?.totalCredited ?? 0;

  return (
    <div className="mx-auto max-w-[1050px]">
      <h1 className="text-[1.5rem] font-bold tracking-tight text-fg">Earnings</h1>
      <p className="mt-2 text-note text-fg-muted">
        What you were paid, and what is waiting in your wallet.
      </p>

      {error ? <p className="mt-4 text-note font-bold text-danger">{error}</p> : null}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <Kicker>Today</Kicker>
          <p className="mt-2 text-[1.75rem] font-bold tracking-tight text-fg">
            {money(today?.totalCredited ?? 0)}
          </p>
        </Card>
        <Card className="p-5">
          <Kicker>This week</Kicker>
          <p className="mt-2 text-[1.75rem] font-bold tracking-tight text-fg">
            {money(weekTotal)}
          </p>
          <p className="mt-1.5 text-note text-fg-muted">
            {weekCount} trips · avg {money(weekCount ? weekTotal / weekCount : 0)}
          </p>
        </Card>
        <Card className="p-5">
          <Kicker>All time credited</Kicker>
          <p className="mt-2 text-[1.75rem] font-bold tracking-tight text-fg">
            {money(allTime?.totalCredited ?? 0)}
          </p>
          <p className="mt-1.5 text-note text-fg-muted">
            {money(allTime?.totalWithdrawn ?? 0)} withdrawn
          </p>
        </Card>
      </div>

      <div className="mt-4">
        <MonthlyReport key={monthly ? "loaded" : "loading"} report={monthly} />
      </div>

      {/*
        * `grid-cols-[minmax(0,1fr)]` below lg is load-bearing, not cosmetic.
        *
        * Without an explicit single-column track the implicit one is `auto`, whose
        * min-width resolves to the content's intrinsic width — and the payout table
        * inside carries `min-w-[30rem]`. That blew the whole page out to 498px on a 375px
        * viewport (a driver with no payouts saw no overflow, which is what pinned it to
        * this table). `minmax(0,...)` lets the track shrink so only the table's own
        * overflow-x-auto wrapper scrolls.
        */}
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
        <Card className="p-0">
          <div className="px-6 pt-6">
            <Kicker>Payout history</Kicker>
          </div>
          {(allTime?.rows.length ?? 0) === 0 ? (
            <p className="p-6 text-note text-fg-muted">
              Nothing yet. Payouts land here after each completed trip.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[30rem] text-left">
                <thead className="border-b border-border-subtle text-label font-bold text-fg-muted">
                  <tr>
                    <th className="px-6 py-3">Movement</th>
                    <th className="px-6 py-3">Date</th>
                    <th className="px-6 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle text-meta">
                  {allTime?.rows.map((row) => (
                    <tr key={row.transactionId}>
                      <td className="px-6 py-3 text-fg">
                        {MOVEMENT[row.type] ?? row.type}
                        {reasonText(row.reason) ? (
                          <span className="ml-2 text-fg-muted">{reasonText(row.reason)}</span>
                        ) : null}
                      </td>
                      <td className="px-6 py-3 text-fg-muted">
                        {/* Already formatted in America/Los_Angeles by the API. It used
                            to read row.createdAt, which does not exist on this payload —
                            new Date(undefined) printed "Invalid Date" in every row. */}
                        {row.at}
                      </td>
                      <td className="px-6 py-3 text-right font-bold text-fg">
                        {row.type === "withdrawal" ? "-" : "+"} {money(Math.abs(row.amount))}
                        {row.feeApplied > 0 ? (
                          <span className="ml-2 text-note font-normal text-fg-muted">
                            fee {money(row.feeApplied)}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          {pay ? <PayTierCard pay={pay} /> : null}

          <Card className="p-5 text-center">
            <Kicker>Wallet balance</Kicker>
            <p className="mt-3 text-[2.25rem] font-bold leading-none tracking-tight text-fg">
              {money(wallet?.balance ?? week?.balance ?? 0)}
            </p>
            <div className="mt-5">
              <WithdrawForm balance={wallet?.balance ?? 0} onDone={() => void load()} />
            </div>
          </Card>

          <WarnBox title="Withdrawing costs 10%">
            The fee applies only on withdrawal. Nothing is deducted when a payout lands.
          </WarnBox>

          <Card className="p-5">
            <Kicker>Cancellations and penalties</Kicker>
            <dl className="mt-4 space-y-2 text-meta">
              <div className="flex justify-between">
                <dt className="text-fg-body">Cancellations</dt>
                <dd className="font-bold text-fg">
                  {penalties?.counts.cancellations ?? 0}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-fg-body">Penalties</dt>
                <dd className="font-bold text-fg">{penalties?.counts.penalties ?? 0}</dd>
              </div>
            </dl>
            <p className="mt-4 text-note leading-relaxed text-fg-muted">
              A penalty delays your ride alerts by two minutes. Admin and your company can
              both see them.
            </p>
          </Card>

          {/* Spec section 8 rule 2: fare amounts never reach a driver. */}
          <p className="text-note leading-relaxed text-fg-muted">
            These figures are your payouts, not what the passenger paid — trip fares are
            never shown to chauffeurs.
          </p>
        </div>
      </div>
    </div>
  );
}

function WithdrawForm({ balance, onDone }: { balance: number; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<{ error?: string; done?: boolean }>({});

  const value = Number(amount);
  const valid = value > 0 && value <= balance;

  if (state.done) {
    return <p className="text-note font-bold text-success">Withdrawal requested.</p>;
  }

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        try {
          await withdraw(value);
          setState({ done: true });
          // The balance, lifetime total and payout history all just changed.
          onDone();
        } catch (err) {
          setState({
            error: err instanceof ApiError ? err.message : "Could not withdraw",
          });
        } finally {
          setPending(false);
        }
      }}
      className="space-y-3"
    >
      {state.error ? <p className="text-label text-danger">{state.error}</p> : null}
      <input
        type="number"
        step="0.01"
        min={0.01}
        max={balance || undefined}
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        placeholder="Amount"
        className="w-full rounded-field border border-border bg-surface-raised px-3 py-2 text-body text-fg outline-none"
      />
      <Button type="submit" variant="accent" disabled={pending || !valid}>
        {pending ? "Requesting…" : "Withdraw to bank"}
      </Button>
    </form>
  );
}
