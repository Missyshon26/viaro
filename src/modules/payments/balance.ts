import { round2 } from '../../utils/money';

/**
 * What a booking has been paid and what is still owed, across every card payment against it:
 * the first payment, and any further one taken for an upgrade. Pure arithmetic, so the rules
 * for "how much can still be refunded" and "how much is still to collect" live in one place.
 */

interface PaidLike {
  amount: number;
  refundedAmount?: number;
  intentId: string;
}

export interface BalanceInput {
  estimatedFare?: number | null;
  payment?: PaidLike | null;
  extraPayments?: PaidLike[] | null;
}

const refundedOf = (p: PaidLike) => p.refundedAmount ?? 0;

/** Everything charged to cards for this booking, before refunds. */
export function amountPaid(b: BalanceInput): number {
  return round2((b.payment?.amount ?? 0) + (b.extraPayments ?? []).reduce((sum, p) => sum + p.amount, 0));
}

/** Everything refunded to cards for this booking. */
export function amountRefunded(b: BalanceInput): number {
  return round2((b.payment ? refundedOf(b.payment) : 0) + (b.extraPayments ?? []).reduce((sum, p) => sum + refundedOf(p), 0));
}

/**
 * The fare less what the client has paid net of refunds: above zero the client owes the
 * difference (an upgrade), below zero they have overpaid it (a downgrade), zero is settled.
 * Only a booking that has been paid by card has a balance; an unpaid one is simply owed its fare.
 */
export function balanceOf(b: BalanceInput): number {
  if (!b.payment) return 0;
  return round2((b.estimatedFare ?? 0) - (amountPaid(b) - amountRefunded(b)));
}

export interface RefundSource {
  /** 'original' is the booking's first payment; 'extra' is extraPayments[index]. */
  kind: 'original' | 'extra';
  index: number;
  intentId: string;
  remaining: number;
}

/** Where a refund can come from, the first payment before any upgrade payment. */
export function refundSources(b: BalanceInput): RefundSource[] {
  const out: RefundSource[] = [];
  if (b.payment) out.push({ kind: 'original', index: 0, intentId: b.payment.intentId, remaining: round2(b.payment.amount - refundedOf(b.payment)) });
  (b.extraPayments ?? []).forEach((p, index) =>
    out.push({ kind: 'extra', index, intentId: p.intentId, remaining: round2(p.amount - refundedOf(p)) }),
  );
  return out.filter((s) => s.remaining > 0);
}

export const refundable = (b: BalanceInput): number => round2(refundSources(b).reduce((sum, s) => sum + s.remaining, 0));

/**
 * Spreads a refund over the payments that can give it, the first payment first. Each part is
 * never more than its payment has left, so Stripe is never asked for more than it took.
 * Throws when the amount is more than is left in total.
 */
export function splitRefund(sources: RefundSource[], amount: number): { source: RefundSource; amount: number }[] {
  let left = round2(amount);
  const parts: { source: RefundSource; amount: number }[] = [];
  for (const source of sources) {
    if (left <= 0) break;
    const take = round2(Math.min(left, source.remaining));
    if (take > 0) parts.push({ source, amount: take });
    left = round2(left - take);
  }
  if (left > 0) throw new RangeError(`Cannot refund $${amount}: only $${round2(amount - left)} is left to refund`);
  return parts;
}
