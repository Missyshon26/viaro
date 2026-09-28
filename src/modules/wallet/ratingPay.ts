/**
 * Pay follows service: the better a chauffeur is rated, the larger their cut.
 *
 * Operations asked that "the more stars a driver has, the better pay they get; the fewer
 * stars, meaning worse service, the lower their percentage". The adjustment is applied
 * when a completed trip is settled (wallet.service resolveDriverPayout), on top of the
 * rate their owner set:
 *
 *   percentage payout   the points are added to the percentage   (70% → 75% / 65% / 60%)
 *   flat payout         the flat amount is scaled by the same %  ($30 → $31.50 / $28.50)
 *
 * A chauffeur with fewer than RATING_PAY_MIN_RATINGS ratings pays at the standard rate:
 * one bad first review should not cut a new chauffeur's pay, nor one good one raise it.
 *
 * Tiers are checked top-down; the first whose `min` the rating meets applies.
 *
 * These are business rules, so they live here in code rather than in .env — change the
 * values below (and redeploy) to change how pay follows rating.
 */

/** Turn rating-based pay off entirely (everyone paid the rate their owner set). */
export const RATING_PAY_ENABLED = true;

/** Ratings a chauffeur needs before their tier starts to apply. */
export const RATING_PAY_MIN_RATINGS = 5;

export interface RatingPayTier {
  key: 'excellent' | 'standard' | 'below' | 'poor';
  label: string;
  /** Lowest average rating (inclusive) for this tier. */
  min: number;
  /** Percentage points added to (or taken from) the driver's share. */
  adjustmentPct: number;
}

export const RATING_PAY_TIERS: RatingPayTier[] = [
  { key: 'excellent', label: 'Excellent (4.8★ and above)', min: 4.8, adjustmentPct: 5 },
  { key: 'standard', label: 'Standard (4.5★ – 4.79★)', min: 4.5, adjustmentPct: 0 },
  { key: 'below', label: 'Below standard (4.0★ – 4.49★)', min: 4.0, adjustmentPct: -5 },
  { key: 'poor', label: 'Poor (below 4.0★)', min: 0, adjustmentPct: -10 },
];

export interface RatingPayResult {
  tier: RatingPayTier['key'] | 'new';
  label: string;
  adjustmentPct: number;
  rating: number;
  ratingCount: number;
  /** Ratings still needed before the tier applies. */
  ratingsToQualify: number;
}

export function ratingAdjustment(rating = 0, ratingCount = 0): RatingPayResult {
  const minRatings = RATING_PAY_MIN_RATINGS;
  if (!RATING_PAY_ENABLED || ratingCount < minRatings) {
    return {
      tier: 'new',
      label: RATING_PAY_ENABLED ? `New — standard rate until ${minRatings} ratings` : 'Standard rate',
      adjustmentPct: 0,
      rating,
      ratingCount,
      ratingsToQualify: RATING_PAY_ENABLED ? Math.max(0, minRatings - ratingCount) : 0,
    };
  }
  const tier = RATING_PAY_TIERS.find((t) => rating >= t.min) ?? RATING_PAY_TIERS[RATING_PAY_TIERS.length - 1];
  return {
    tier: tier.key,
    label: tier.label,
    adjustmentPct: tier.adjustmentPct,
    rating,
    ratingCount,
    ratingsToQualify: 0,
  };
}

/** Applies the adjustment to an owner-set rate. Percentages are clamped to 0–100. */
export function adjustRate(mode: 'percentage' | 'flat', value: number, adjustmentPct: number): number {
  if (mode === 'percentage') return Math.min(100, Math.max(0, value + adjustmentPct));
  return Math.max(0, Math.round(value * (1 + adjustmentPct / 100) * 100) / 100);
}
