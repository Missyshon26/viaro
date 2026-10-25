/**
 * Money helpers.
 *
 * Amounts are stored as decimal numbers (spec §6 models them as `number`). Every
 * computed amount — fares, splits, fees, refunds — must pass through `round2` so
 * floating-point drift never reaches a wallet balance or a receipt.
 */

/** Round to 2 decimal places, half-up, without the 1.005 → 1.00 float artefact. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** `percent` is a whole number: pct(100, 60) === 60. */
export function pct(amount: number, percent: number): number {
  return round2((amount * percent) / 100);
}
