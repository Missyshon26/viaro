import { describe, expect, it } from 'vitest';
import { applyAdjustments } from '../src/modules/pricing/pricing.adjustments';

describe('applyAdjustments', () => {
  it('changes nothing when there is no tip, discount or tax', () => {
    expect(applyAdjustments({ subtotal: 140 })).toEqual({
      fuelSurchargePct: 0,
      fuelSurcharge: 0,
      gratuityPct: 0,
      gratuity: 0,
      discount: 0,
      taxPct: 0,
      tax: 0,
      total: 140,
    });
  });

  it('adds the fuel surcharge as a percentage of the trip price, rounded up to a whole dollar', () => {
    const r = applyAdjustments({ subtotal: 129, fuelPct: 8 });
    expect(r.fuelSurchargePct).toBe(8);
    expect(r.fuelSurcharge).toBe(11); // 10.32 → 11, as old ABL's Math.ceil did
    expect(r.total).toBe(140);
  });

  it('puts the fuel surcharge inside the taxable amount, beside the tip, before the discount', () => {
    const r = applyAdjustments({ subtotal: 100, fuelPct: 8, gratuityPct: 10, taxPct: 10, discount: { kind: 'welcome', amount: 18 } });
    // 100 + 8 + 10 = 118, less 18 = 100, tax 10
    expect(r.fuelSurcharge).toBe(8);
    expect(r.gratuity).toBe(10);
    expect(r.tax).toBe(10);
    expect(r.total).toBe(110);
  });

  it('adds the tip as a percentage of the trip price', () => {
    const r = applyAdjustments({ subtotal: 140, gratuityPct: 15 });
    expect(r.gratuity).toBe(21);
    expect(r.total).toBe(161);
  });

  it('takes tax on the price plus tip', () => {
    const r = applyAdjustments({ subtotal: 140, gratuityPct: 10, taxPct: 8.5 });
    expect(r.gratuity).toBe(14);
    expect(r.tax).toBe(14); // 154 × 8.5% = 13.09, up to the next whole dollar
    expect(r.total).toBe(168);
  });

  it('rounds every line up to a whole dollar, so a total never has cents', () => {
    const r = applyAdjustments({ subtotal: 133, gratuityPct: 15, taxPct: 10.1, fuelPct: 3 });
    expect(Number.isInteger(r.fuelSurcharge)).toBe(true);
    expect(Number.isInteger(r.gratuity)).toBe(true);
    expect(Number.isInteger(r.tax)).toBe(true);
    expect(Number.isInteger(r.total)).toBe(true);
    expect(r.total).toBe(133 + r.fuelSurcharge + r.gratuity + r.tax);
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

  describe('manual (operator) discount', () => {
    it('takes a percentage off trip price + fuel + tip, before tax', () => {
      const r = applyAdjustments({ subtotal: 200, manualDiscount: { type: 'percent', value: 10 }, taxPct: 10 });
      expect(r.discountKind).toBe('manual');
      expect(r.discount).toBe(20);
      expect(r.tax).toBe(18); // 10% of 180
      expect(r.total).toBe(198);
    });

    it('takes a flat amount off', () => {
      const r = applyAdjustments({ subtotal: 200, manualDiscount: { type: 'flat', value: 35 } });
      expect(r.discount).toBe(35);
      expect(r.total).toBe(165);
    });

    it('never goes below zero, even at 100% or a flat amount above the fare', () => {
      expect(applyAdjustments({ subtotal: 90, manualDiscount: { type: 'percent', value: 100 } }).total).toBe(0);
      expect(applyAdjustments({ subtotal: 90, manualDiscount: { type: 'flat', value: 500 } }).total).toBe(0);
    });

    it('replaces the automatic discount instead of stacking with it', () => {
      const r = applyAdjustments({
        subtotal: 100,
        discount: { kind: 'welcome', amount: 25 },
        manualDiscount: { type: 'flat', value: 10 },
      });
      expect(r.discountKind).toBe('manual');
      expect(r.discount).toBe(10);
    });

    it('a zero manual discount leaves the automatic one in place', () => {
      const r = applyAdjustments({ subtotal: 100, discount: { kind: 'welcome', amount: 25 }, manualDiscount: { type: 'percent', value: 0 } });
      expect(r.discountKind).toBe('welcome');
      expect(r.discount).toBe(25);
    });
  });
});
