/**
 * What a paid booking has been paid and what is still owed, across the first card payment and
 * any payment taken later for an upgrade. Mirrors the API's own rule so the screen and the
 * server agree. No React, no fetching, so it can be tested on its own.
 */
const cents = (dollars: number) => Math.round(dollars * 100);

interface Paid {
  amount: number;
  refundedAmount: number;
}

export interface BalanceBooking {
  estimatedFare?: number | null;
  payment?: Paid | null;
  extraPayments?: Paid[] | null;
}

const all = (b: BalanceBooking): Paid[] => [...(b.payment ? [b.payment] : []), ...(b.extraPayments ?? [])];

/** Charged to cards, before refunds. */
export const paidTotal = (b: BalanceBooking) => all(b).reduce((sum, p) => sum + cents(p.amount), 0) / 100;

/** Refunded to cards. */
export const refundedTotal = (b: BalanceBooking) => all(b).reduce((sum, p) => sum + cents(p.refundedAmount), 0) / 100;

/** Still refundable, across every payment. */
export const refundableTotal = (b: BalanceBooking) =>
  all(b).reduce((sum, p) => sum + Math.max(0, cents(p.amount) - cents(p.refundedAmount)), 0) / 100;

/**
 * Fare less what was paid net of refunds. Above zero: the client owes it (an upgrade). Below
 * zero: they overpaid (a downgrade). Zero: settled. An unpaid booking has no balance of this kind.
 */
export function balanceOf(b: BalanceBooking): number {
  if (!b.payment) return 0;
  return (cents(b.estimatedFare ?? 0) - (cents(paidTotal(b)) - cents(refundedTotal(b)))) / 100;
}
