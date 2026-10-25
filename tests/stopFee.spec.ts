import { describe, expect, it, vi } from 'vitest';

/**
 * Stop charging against the real calculator. Seattle at $129 / ×1.18, no subscription,
 * and a catalogue where the sedan charges $15 a stop and the MPV charges nothing.
 */
// Operations have not set any tax or discount: the rate card is the price.
vi.mock('../src/modules/admin/settings.service', () => ({
  getSettingsValues: async () => ({ taxPct: 0, welcomeDiscount: 0, loyaltyDiscount: 0, loyaltyEveryNth: 4 }),
}));
vi.mock('../src/models/PricingRule', () => ({
  PricingRule: {
    findOne: () => ({ lean: async () => ({ city: 'seattle', baseFare: 129, peakMultiplier: 1.18 }) }),
  },
}));
vi.mock('../src/models/Subscription', () => ({
  Subscription: { findOne: () => ({ lean: async () => null }) },
}));
vi.mock('../src/modules/vehicle/vehicle.repository', () => {
  const classes: Record<string, Record<string, unknown>> = {
    sedan: { value: 'sedan', label: 'Sedan', multiplier: 1, usage: 'all', flatRate: 140, stopFee: 15, active: true },
    mpv: { value: 'mpv', label: 'MPV', multiplier: 1.23, usage: 'all', flatRate: 172, active: true },
  };
  return { findByValue: async (v: string) => classes[v] ?? null, findAll: async () => Object.values(classes) };
});

import { calculateFare } from '../src/modules/pricing/pricing.service';

const quote = (vehicleClass: string, extra: Record<string, unknown> = {}) =>
  calculateFare({
    city: 'Seattle',
    tripType: 'point2point',
    vehicleClass,
    requestedAt: '2026-11-03T14:00:00',
    ...extra,
  });

describe('per-stop charge', () => {
  it('adds the class stop fee for each stop', async () => {
    const fare = await quote('sedan', { stopCount: 3 });
    expect(fare.stopCount).toBe(3);
    expect(fare.stopFee).toBe(45);
    expect(fare.fare).toBe(185);
  });

  it('is free for a class with no stop fee', async () => {
    const fare = await quote('mpv', { stopCount: 2 });
    expect(fare.stopFee).toBe(0);
    expect(fare.fare).toBe(172);
  });

  it('changes nothing when there are no stops', async () => {
    const fare = await quote('sedan');
    expect(fare).toMatchObject({ stopCount: 0, stopFee: 0, fare: 140 });
  });

  it('is never charged on an hourly charter', async () => {
    const fare = await calculateFare({
      city: 'Seattle',
      tripType: 'hourly',
      vehicleClass: 'sedan',
      hours: 3,
      stopCount: 2,
      requestedAt: '2026-11-03T14:00:00',
    });
    expect(fare.stopCount).toBe(0);
    expect(fare.stopFee).toBe(0);
  });

  it('stacks with Meet and Greet', async () => {
    const fare = await quote('sedan', { stopCount: 1, meetAndGreet: true });
    expect(fare.fare).toBe(140 + 25 + 15);
  });
});
