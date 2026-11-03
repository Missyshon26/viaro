/**
 * The fare as lines an operator can read: the trip price, then the tip, discount and tax
 * that were added to it, then the total charged. Built from what was stored when the booking
 * was priced, never recomputed from today's settings.
 *
 * A booking from before tip, discount and tax existed has none of those fields, and is shown
 * as a single total rather than an invented split.
 */
export interface FareLine {
  label: string;
  /** Dollars; negative for a discount. */
  amount: number;
  total?: boolean;
}

export function fareLines(
  breakdown:
    | {
        subtotal?: number;
        fuelSurchargePct?: number;
        fuelSurcharge?: number;
        gratuityPct?: number;
        gratuity?: number;
        discountKind?: "welcome" | "loyalty" | "manual";
        discount?: number;
        taxPct?: number;
        tax?: number;
      }
    | undefined,
  total: number | undefined,
): FareLine[] {
  // Nothing was added, or it predates the split: the total says everything there is to say.
  if (!breakdown || breakdown.subtotal === undefined || total === undefined) return [];
  if (!breakdown.fuelSurcharge && !breakdown.gratuity && !breakdown.discount && !breakdown.tax) return [];

  const lines: FareLine[] = [{ label: "Trip price", amount: breakdown.subtotal }];
  if (breakdown.fuelSurcharge) lines.push({ label: `Fuel surcharge (${breakdown.fuelSurchargePct}%)`, amount: breakdown.fuelSurcharge });
  if (breakdown.gratuity) lines.push({ label: `Tip (${breakdown.gratuityPct}%)`, amount: breakdown.gratuity });
  if (breakdown.discount) {
    lines.push({
      label: discountLabel(breakdown.discountKind),
      amount: -breakdown.discount,
    });
  }
  if (breakdown.tax) lines.push({ label: `Tax (${breakdown.taxPct}%)`, amount: breakdown.tax });
  lines.push({ label: "Total", amount: total, total: true });
  return lines;
}

/** What a discount line is called on screen. */
export function discountLabel(kind?: "welcome" | "loyalty" | "manual"): string {
  return kind === "welcome" ? "Welcome discount" : kind === "manual" ? "Discount" : "Loyalty discount";
}
