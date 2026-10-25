import { describe, expect, it } from 'vitest';
import { applyAdjustments } from '../src/modules/pricing/pricing.adjustments';

describe('applyAdjustments', () => {
  it('changes nothing when there is no tip, discount or tax', () => {
    expect(applyAdjustments({ subtotal: 140 })).toEqual({
      gratuityPct: 0,
      gratuity: 0,
      discount: 0,
      taxPct: 0,
      tax: 0,
      total: 140,
    });
  });

  it('adds the tip as a percentage of the trip price', () => {
    const r = applyAdjustments({ subtotal: 140, gratuityPct: 15 });
    expect(r.gratuity).toBe(21);
    expect(r.total).toBe(161);
  });

  it('takes tax on the price plus tip', () => {
    const r = applyAdjustments({ subtotal: 140, gratuityPct: 10, taxPct: 8.5 });
    expect(r.gratuity).toBe(14);
    expect(r.tax).toBe(13.09); // 154 × 8.5%
    expect(r.total).toBe(167.09);
  });

  it('takes the discount off before tax, so a discount lowers the tax too', () => {
    const r = applyAdjustments({ subtotal: 140, taxPct: 10, discount: { kind: 'welcome', amount: 40 } });
    expect(r.discount).toBe(40);
    expect(r.discountKind).toBe('welcome');
    expect(r.tax).toBe(10); // (140 − 40) × 10%, not 140 × 10%
    expect(r.total).toBe(110);
  });

  it('never discounts below zero', () => {
    const r = applyAdjustments({ subtotal: 50, taxPct: 10, discount: { kind: 'loyalty', amount: 500 } });
    expect(r.discount).toBe(50);
    expect(r.tax).toBe(0);
    expect(r.total).toBe(0);
  });

  it('discounts the tip as well as the price when the discount is large', () => {
    const r = applyAdjustments({ subtotal: 100, gratuityPct: 20, discount: { kind: 'welcome', amount: 110 } });
    expect(r.discount).toBe(110); // price 100 + tip 20 = 120 available
    expect(r.total).toBe(10);
  });

  it('keeps a tip within the allowed range and ignores nonsense', () => {
    expect(applyAdjustments({ subtotal: 100, gratuityPct: 500 }).gratuityPct).toBe(30);
    expect(applyAdjustments({ subtotal: 100, gratuityPct: -5 }).gratuity).toBe(0);
    expect(applyAdjustments({ subtotal: 100, taxPct: -9 }).tax).toBe(0);
    expect(applyAdjustments({ subtotal: 100, discount: { kind: 'welcome', amount: -20 } }).discount).toBe(0);
  });

  it('rounds to the cent at every step, so the lines always add up to the total', () => {
    for (const subtotal of [33.33, 99.99, 140.01, 187.5]) {
      for (const gratuityPct of [0, 10, 15, 20]) {
        for (const taxPct of [0, 6.5, 8.875, 10.25]) {
          const r = applyAdjustments({ subtotal, gratuityPct, taxPct, discount: { kind: 'loyalty', amount: 7.77 } });
          const sum = Math.round((subtotal + r.gratuity - r.discount + r.tax) * 100) / 100;
          expect(sum).toBe(r.total);
        }
      }
    }
  });

  it('records no discount kind when no discount applied', () => {
    expect('discountKind' in applyAdjustments({ subtotal: 100, discount: null })).toBe(false);
    expect('discountKind' in applyAdjustments({ subtotal: 100, discount: { kind: 'welcome', amount: 0 } })).toBe(false);
  });
});
