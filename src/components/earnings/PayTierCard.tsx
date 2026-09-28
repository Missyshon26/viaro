import { Card, Kicker } from "@/components/ui/Surfaces";
import type { PayTier } from "@/lib/api/driver";

const rate = (mode: PayTier["mode"], value: number) =>
  mode === "percentage"
    ? `${value}%`
    : value.toLocaleString("en-US", { style: "currency", currency: "USD" });

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/**
 * How the chauffeur's rating moves their pay (backend: modules/wallet/ratingPay.ts).
 * Higher stars, larger share; lower stars, smaller share — shown with the tier table so
 * the rule is never a surprise on a payout.
 */
export function PayTierCard({ pay }: { pay: PayTier }) {
  const unit = pay.mode === "percentage" ? " pts" : "%";
  return (
    <Card className="p-5">
      <Kicker>Your pay rate</Kicker>
      <p className="mt-2 text-[1.75rem] font-bold leading-none tracking-tight text-fg">
        {rate(pay.mode, pay.effectiveValue)}
        <span className="ml-2 text-note font-normal text-fg-muted">
          {pay.mode === "percentage" ? "of each trip's share" : "per trip"}
        </span>
      </p>
      <p className="mt-2 text-note text-fg-muted">
        {pay.tier === "new"
          ? pay.enabled
            ? `Standard rate. Your rating starts counting after ${pay.minRatings} ratings — ${pay.ratingsToQualify} to go.`
            : "Standard rate."
          : `${pay.label}: ${pay.rating.toFixed(2)} ★ from ${pay.ratingCount} ratings · ${
              pay.adjustmentPct === 0 ? "no adjustment" : `${signed(pay.adjustmentPct)}${unit} on your base of ${rate(pay.mode, pay.baseValue)}`
            }`}
      </p>

      {pay.enabled ? (
        <table className="mt-4 w-full text-note">
          <tbody className="divide-y divide-border-subtle">
            {pay.tiers.map((tier) => {
              const current = tier.key === pay.tier;
              return (
                <tr key={tier.key} className={current ? "font-bold text-fg" : "text-fg-muted"}>
                  <td className="py-1.5">
                    {current ? "▸ " : ""}
                    {tier.label}
                  </td>
                  <td className={`py-1.5 text-right ${tier.adjustmentPct > 0 ? "text-success" : tier.adjustmentPct < 0 ? "text-danger" : ""}`}>
                    {tier.adjustmentPct === 0 ? "base rate" : `${signed(tier.adjustmentPct)}${unit}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
      <p className="mt-3 text-note leading-relaxed text-fg-muted">
        Better service, better pay: keep your rating high to earn a larger share of every trip.
      </p>
    </Card>
  );
}
