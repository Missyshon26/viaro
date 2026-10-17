import { describe, expect, it, vi } from 'vitest';

/**
 * The rate card (pre-deployment checklist §2), pinned against the real calculator.
 *
 * Mongo is mocked out: a Seattle rule at the seeded $129 / ×1.18, no subscription, and an
 * empty vehicle collection — so every class prices from the shipped defaults in
 * config/vehicles.ts, which is exactly what a fresh deploy seeds.
 */
vi.mock('../src/models/PricingRule', () => ({
  PricingRule: {
    findOne: () => ({ lean: async () => ({ city: 'seattle', baseFare: 129, peakMultiplier: 1.18 }) }),
  },
}));
vi.mock('../src/models/Subscription', () => ({
  Subscription: { findOne: () => ({ lean: async () => null }) },
}));
vi.mock('../src/modules/vehicle/vehicle.repository', () => ({
  findByValue: async () => null,
  findAll: async () => [],
}));

// vi.mock calls are hoisted above this import, so the calculator sees the mocks.
import { calculateFare, isPrimetime } from '../src/modules/pricing/pricing.service';

const quote = (vehicleClass: string, time: string, tripType: 'point2point' | 'hourly' = 'point2point', hours?: number) =>
  calculateFare({ city: 'Seattle', tripType, vehicleClass, requestedAt: `2026-11-03T${time}:00`, hours });

describe('flat transfer rates', () => {
  it.each([
    ['sedan', 140],
    ['mpv', 172],
    ['sedan-first', 183],
    ['suv-first', 215],
    ['minibus', 323],
  ])('%s is $%i at 2pm', async (cls, price) => {
    const fare = await quote(cls, '14:00');
    expect(fare.pricingModel).toBe('flat');
    expect(fare.fare).toBe(price);
  });

  it('ignores the peak window on a flat rate', async () => {
    const fare = await quote('sedan', '08:00');
    expect(fare.isPeak).toBe(true);
    expect(fare.peakApplied).toBe(false);
    expect(fare.fare).toBe(140);
  });
});

describe('primetime surcharge', () => {
  it('adds $20 to an 11pm Sedan: $160', async () => {
    const fare = await quote('sedan', '23:00');
    expect(fare.primetime).toBe(true);
    expect(fare.primetimeSurcharge).toBe(20);
    expect(fare.classFare).toBe(140);
    expect(fare.fare).toBe(160);
  });

  it.each([
    ['21:59', false],
    ['22:00', true],
    ['00:30', true],
    ['06:59', true],
    ['07:00', false],
  ])('pickup at %s → primetime %s', (time, expected) => {
    expect(isPrimetime(`2026-11-03T${time}:00`)).toBe(expected);
  });
});

describe('hourly rates', () => {
  it('First Class Sedan is $172/hr', async () => {
    expect((await quote('sedan-first', '14:00', 'hourly', 3)).fare).toBe(516);
  });

  it('First Class SUV is $194/hr', async () => {
    expect((await quote('suv-first', '14:00', 'hourly', 2)).fare).toBe(388);
  });

  it('NEMT is $99/hr with a $297 minimum', async () => {
    const short = await quote('nemt', '14:00', 'hourly', 2);
    expect(short.fare).toBe(297);
    expect(short.minimumFare).toBe(297);
    expect((await quote('nemt', '14:00', 'hourly', 4)).fare).toBe(396);
  });
});

describe('classes without a fixed rate', () => {
  it('still price by city base × class multiplier', async () => {
    const fare = await quote('suv', '14:00');
    expect(fare.pricingModel).toBe('multiplier');
    expect(fare.fare).toBe(180.6);
  });
});

describe('route prices', () => {
  const SEA = 'Seattle-Tacoma International Airport (SEA), 17801 International Blvd, SeaTac, WA';
  const transfer = (vehicleClass: string, pickupAddress: string, dropAddress: string) =>
    calculateFare({
      city: 'Seattle',
      tripType: 'point2point',
      vehicleClass,
      requestedAt: '2026-11-03T14:00:00',
      pickupAddress,
      dropAddress,
    });

  it('Tacoma → Sea-Tac is $159 Sedan / $199 MPV', async () => {
    const sedan = await transfer('sedan', '1119 Pacific Ave, Tacoma, WA 98402', SEA);
    expect(sedan.pricingModel).toBe('route');
    expect(sedan.fare).toBe(159);
    expect((await transfer('mpv', '1119 Pacific Ave, Tacoma, WA 98402', SEA)).fare).toBe(199);
  });

  it('works in the other direction', async () => {
    expect((await transfer('sedan', SEA, 'Tacoma Dome, Tacoma, WA')).fare).toBe(159);
  });

  it('is not triggered by "Tacoma" in the airport name alone', async () => {
    const fare = await transfer('sedan', '400 Broad St, Seattle, WA 98109', SEA);
    expect(fare.pricingModel).toBe('flat');
    expect(fare.fare).toBe(140);
  });

  it('leaves classes the route does not price at their normal rate', async () => {
    expect((await transfer('sedan-first', 'Tacoma, WA', SEA)).fare).toBe(183);
  });
});

describe('Meet and Greet', () => {
  it('adds exactly $25', async () => {
    const fare = await calculateFare({
      city: 'Seattle',
      tripType: 'point2point',
      vehicleClass: 'sedan',
      requestedAt: '2026-11-03T14:00:00',
      meetAndGreet: true,
    });
    expect(fare.meetAndGreetFee).toBe(25);
    expect(fare.fare).toBe(165);
  });

  it('stacks with primetime: 11pm Sedan + Meet and Greet = $185', async () => {
    const fare = await calculateFare({
      city: 'Seattle',
      tripType: 'point2point',
      vehicleClass: 'sedan',
      requestedAt: '2026-11-03T23:00:00',
      meetAndGreet: true,
    });
    expect(fare.fare).toBe(185);
  });
});
