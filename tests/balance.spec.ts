import { describe, expect, it } from 'vitest';
import { amountPaid, balanceOf, refundable, refundSources, splitRefund } from '../src/modules/payments/balance';

const paid = (amount: number, refundedAmount = 0, intentId = 'pi_1') => ({ amount, refundedAmount, intentId });

describe('what a booking has been paid and what is owed', () => {
  it('has no balance until it has been paid by card', () => {
    expect(balanceOf({ estimatedFare: 200 })).toBe(0);
  });

  it('is settled when the fare equals what was paid', () => {
    expect(balanceOf({ estimatedFare: 100, payment: paid(100) })).toBe(0);
  });

  it('is owed the difference after an upgrade, and nothing once the difference is paid', () => {
    expect(balanceOf({ estimatedFare: 160, payment: paid(100) })).toBe(60);
    expect(balanceOf({ estimatedFare: 160, payment: paid(100), extraPayments: [paid(60, 0, 'pi_2')] })).toBe(0);
  });

  it('is overpaid after a downgrade, and settled once that is refunded', () => {
    expect(balanceOf({ estimatedFare: 70, payment: paid(100) })).toBe(-30);
    expect(balanceOf({ estimatedFare: 70, payment: paid(100, 30) })).toBe(0);
  });

  it('adds cents without floating point drift', () => {
    expect(balanceOf({ estimatedFare: 0.3, payment: paid(0.1), extraPayments: [paid(0.2, 0, 'pi_2')] })).toBe(0);
    expect(amountPaid({ payment: paid(0.1), extraPayments: [paid(0.2, 0, 'pi_2')] })).toBe(0.3);
  });
});

describe('where a refund can come from', () => {
  const booking = { payment: paid(100, 40), extraPayments: [paid(60, 0, 'pi_2'), paid(20, 20, 'pi_3')] };

  it('lists payments with something left, the first payment first', () => {
    expect(refundSources(booking).map((s) => [s.kind, s.intentId, s.remaining])).toEqual([
      ['original', 'pi_1', 60],
      ['extra', 'pi_2', 60],
    ]);
    expect(refundable(booking)).toBe(120);
  });

  it('spreads a refund across payments without exceeding any of them', () => {
    const parts = splitRefund(refundSources(booking), 90);
    expect(parts.map((p) => [p.source.intentId, p.amount])).toEqual([
      ['pi_1', 60],
      ['pi_2', 30],
    ]);
  });

  it('stays on the first payment when it can cover the refund', () => {
    expect(splitRefund(refundSources(booking), 25).map((p) => [p.source.intentId, p.amount])).toEqual([['pi_1', 25]]);
  });

  it('refuses more than is left in total', () => {
    expect(() => splitRefund(refundSources(booking), 120.01)).toThrow(RangeError);
  });
});
