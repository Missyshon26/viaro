import type { Metadata } from "next";
import { Check, Minus } from "lucide-react";
import { PageShell, Panel, SectionTitle, money, formatDate } from "@/components/app/shell";
import { StatusBadge } from "@/components/app/status-badge";
import {
  SubscribeButton,
  CancelSubscriptionButton,
} from "@/components/app/subscription-buttons";
import { apiOptional } from "@/lib/api/client";
import { listMyRides } from "@/lib/api/bookings";
import { MONTHLY_PLAN } from "@/lib/constants";
import type { Subscription } from "@/lib/api/types";

export const metadata: Metadata = {
  title: "Monthly plan | Viaro",
  robots: { index: false, follow: false },
};

/**
 * Peak windows, 07:00–08:59 and 17:00–18:59 Pacific — the same as PEAK_WINDOWS in
 * viaro-backend/src/modules/pricing/pricing.service.ts. Used only to estimate savings
 * from the passenger's own history; the real surcharge is always decided by the API.
 */
const PEAK_HOURS = [7, 8, 17, 18];
/** The configured multiplier for the Seattle-area cities (seed: DESIGN_PEAK_MULTIPLIER). */
const PEAK_MULTIPLIER = 1.18;
const LOOKBACK_DAYS = 90;

const pacificHour = (iso: string) =>
  Number(
    new Date(iso).toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      hourCycle: "h23",
    }),
  );

const COMPARISON: { feature: string; plan: string | boolean; payg: string | boolean }[] = [
  { feature: "Monthly fee", plan: `${money(MONTHLY_PLAN.price)} / month`, payg: "None" },
  { feature: "Peak-hour surcharge (7–9 AM, 5–7 PM)", plan: "Waived", payg: `×${PEAK_MULTIPLIER} on the fare` },
  { feature: "Priority dispatch when cars are scarce", plan: true, payg: false },
  { feature: "Your favourite chauffeur offered first", plan: true, payg: true },
  { feature: "Free cancellation outside the window", plan: true, payg: true },
  { feature: "Cancel any time", plan: true, payg: "—" },
];

export default async function SubscriptionPage() {
  /** GET /subscriptions/me 404s when there has never been one, so this may be null. */
  const [subscription, rides] = await Promise.all([
    apiOptional<Subscription | null>("/subscriptions/me"),
    listMyRides(1, 100).catch(() => null),
  ]);
  const status = subscription?.status;
  const active = status === "active";

  // Personal numbers from their own recent rides. `Date.now()` is safe here: this is a
  // Server Component, evaluated once per request on the server, never re-run on the client.
  // eslint-disable-next-line react-hooks/purity
  const since = Date.now() - LOOKBACK_DAYS * 86_400_000;
  const recent = (rides?.items ?? []).filter(
    (ride) => ride.status !== "cancelled" && new Date(ride.scheduledAt).getTime() >= since,
  );
  const peakRides = recent.filter((ride) => PEAK_HOURS.includes(pacificHour(ride.scheduledAt)));
  // A peak fare is base × multiplier; the surcharge part is what the plan removes.
  // For a subscriber the fares are already un-surcharged, so the saving is base × (m − 1).
  const surcharge = peakRides.reduce((sum, ride) => {
    const fare = ride.estimatedFare ?? 0;
    return sum + (active ? fare * (PEAK_MULTIPLIER - 1) : fare - fare / PEAK_MULTIPLIER);
  }, 0);
  const monthlySurcharge = (surcharge / LOOKBACK_DAYS) * 30;
  const worthIt = monthlySurcharge >= MONTHLY_PLAN.price;

  const ctaLabel = status === "cancelled" || status === "expired" ? "Reactivate plan" : "Subscribe";

  return (
    <PageShell title="Monthly plan" description="One monthly price, and no peak-hour surcharge on any ride.">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-6">
          <Panel>
            <div className="flex flex-wrap items-center gap-3">
              <SectionTitle>Your plan</SectionTitle>
              <span className="ml-auto">
                {active ? (
                  <StatusBadge tone="success">Active</StatusBadge>
                ) : status === "cancelled" ? (
                  <StatusBadge tone="danger">Cancelled</StatusBadge>
                ) : status === "expired" ? (
                  <StatusBadge tone="warning">Expired</StatusBadge>
                ) : (
                  <StatusBadge tone="neutral">Pay per ride</StatusBadge>
                )}
              </span>
            </div>

            <p className="mt-5 font-sans text-3xl font-semibold text-cloud">
              {money(MONTHLY_PLAN.price)}
              <span className="ml-2 text-base font-normal text-muted-foreground">per month</span>
            </p>

            {subscription && (active || status === "cancelled") ? (
              <dl className="mt-6 grid gap-4 border-t border-border pt-5 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-wider text-muted-foreground">Started</dt>
                  <dd className="mt-1 text-cloud">{formatDate(subscription.startDate)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                    {active ? "Renews" : "Ended"}
                  </dt>
                  <dd className="mt-1 text-cloud">{formatDate(subscription.renewalDate)}</dd>
                </div>
              </dl>
            ) : null}

            {status === "expired" && subscription ? (
              <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
                Your plan lapsed on {formatDate(subscription.renewalDate)}, so peak pricing applies
                again. Reactivating takes effect immediately.
              </p>
            ) : null}

            <div className="mt-6">
              {active ? <CancelSubscriptionButton /> : <SubscribeButton label={ctaLabel} />}
            </div>
          </Panel>

          <Panel className="p-0">
            <div className="px-6 pt-6">
              <SectionTitle>With the plan vs. without</SectionTitle>
            </div>
            <div className="mt-4 overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="border-y border-border text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-6 py-3 font-medium">&nbsp;</th>
                    <th className="px-4 py-3 text-center font-medium text-azure">Monthly plan</th>
                    <th className="px-4 py-3 text-center font-medium">Pay per ride</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {COMPARISON.map((row) => (
                    <tr key={row.feature}>
                      <td className="px-6 py-3.5 text-cloud">{row.feature}</td>
                      <Cell value={row.plan} highlight />
                      <Cell value={row.payg} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <div className="space-y-6 lg:sticky lg:top-24">
          <Panel>
            <SectionTitle>{active ? "What the plan saved you" : "What it would save you"}</SectionTitle>
            <p className="mt-2 text-xs text-muted-foreground">Your last {LOOKBACK_DAYS} days</p>

            <dl className="mt-5 grid grid-cols-2 gap-4">
              <Metric label="Rides" value={String(recent.length)} />
              <Metric label="At peak hours" value={String(peakRides.length)} />
              <Metric
                label={active ? "Surcharge avoided" : "Surcharge paid"}
                value={money(Math.round(surcharge * 100) / 100)}
                accent
              />
              <Metric label="Per month, roughly" value={money(Math.round(monthlySurcharge * 100) / 100)} />
            </dl>

            <p className="mt-5 border-t border-border pt-4 text-sm leading-relaxed text-muted-foreground">
              {recent.length === 0
                ? "Take a few rides and we'll show what the plan would save you, based on when you actually travel."
                : active
                  ? peakRides.length > 0
                    ? `Without the plan, your ${peakRides.length} peak-hour ride${peakRides.length === 1 ? "" : "s"} would have cost about ${money(Math.round(surcharge * 100) / 100)} more.`
                    : "None of your recent rides were at peak hours — priority dispatch is the main benefit for you."
                  : worthIt
                    ? `At your pace the surcharge alone comes to about ${money(Math.round(monthlySurcharge * 100) / 100)} a month — more than the ${money(MONTHLY_PLAN.price)} plan.`
                    : `At your pace the surcharge is about ${money(Math.round(monthlySurcharge * 100) / 100)} a month. The plan pays for itself at around ${money(MONTHLY_PLAN.price)} of surcharges.`}
            </p>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              An estimate from your booked fares. The exact surcharge is shown on every quote.
            </p>
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}

function Cell({ value, highlight }: { value: string | boolean; highlight?: boolean }) {
  return (
    <td className={`px-4 py-3.5 text-center ${highlight ? "bg-midnight/10" : ""}`}>
      {value === true ? (
        <Check className="mx-auto h-4 w-4 text-azure" aria-label="Included" />
      ) : value === false ? (
        <Minus className="mx-auto h-4 w-4 text-muted-foreground" aria-label="Not included" />
      ) : (
        <span className={highlight ? "text-cloud" : "text-muted-foreground"}>{value}</span>
      )}
    </td>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-background/60 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-1 text-xl font-semibold ${accent ? "text-azure" : "text-cloud"}`}>{value}</dd>
    </div>
  );
}
