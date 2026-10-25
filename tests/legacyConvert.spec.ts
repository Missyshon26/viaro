import { describe, expect, it } from 'vitest';
import {
  allocateCents,
  hoursOf,
  mapLegState,
  normaliseOccasion,
  parseLegacyWhen,
  planCustomer,
  slugify,
  tripMoney,
  tripTypeOf,
  type LegacyTrip,
} from '../src/modules/migration/legacy.convert';

describe('parseLegacyWhen', () => {
  it('reads month-day-year as Pacific time', () => {
    // 6:30 AM PST on 1 Dec 2025 is 14:30 UTC
    expect(parseLegacyWhen('12-01-2025', '6:30 AM')?.toISOString()).toBe('2025-12-01T14:30:00.000Z');
    // summer time: 10:30 PM PDT on 4 Aug 2026 is 05:30 UTC the next day
    expect(parseLegacyWhen('08-04-2026', '10:30 PM')?.toISOString()).toBe('2026-08-05T05:30:00.000Z');
  });

  it('reads a date that can only be day-month-year', () => {
    expect(parseLegacyWhen('30-11-2025', '9:00 AM')?.toISOString()).toBe('2025-11-30T17:00:00.000Z');
  });

  it('uses the booking date to settle a date that reads either way', () => {
    const created = new Date('2025-12-05T10:00:00Z');
    // 04-12-2025 month-first = 12 Apr 2025, months before the booking existed → day-first, 4 Dec
    expect(parseLegacyWhen('04-12-2025', '9:00 AM', created)?.toISOString()).toBe('2025-12-04T17:00:00.000Z');
    // an ordinary date stays month-first
    expect(parseLegacyWhen('12-07-2025', '9:00 AM', created)?.toISOString()).toBe('2025-12-07T17:00:00.000Z');
  });

  it('keeps the day at noon when the time is unreadable, and refuses a date that is not one', () => {
    expect(parseLegacyWhen('12-01-2025', 'soon')?.toISOString()).toBe('2025-12-01T20:00:00.000Z');
    expect(parseLegacyWhen('13-13-2025', '9:00 AM')).toBeNull();
    expect(parseLegacyWhen('', '9:00 AM')).toBeNull();
  });
});

describe('allocateCents', () => {
  it('never loses or invents a cent', () => {
    for (const [total, weights] of [[10000, [1, 1, 1]], [24200, [134, 134]], [1, [3, 5]], [999, [0, 0, 0]], [12345, [7, 11, 13, 17]]] as const) {
      const parts = allocateCents(total, [...weights]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      expect(parts.every((p) => p >= 0)).toBe(true);
    }
  });
  it('splits in proportion to the weights', () => {
    expect(allocateCents(1000, [1, 3])).toEqual([250, 750]);
  });
});

const trip = (over: Partial<LegacyTrip> = {}): LegacyTrip => ({
  _id: 't1',
  grandTotal: 242,
  subTotal: 262,
  discount: '20',
  tax: 0,
  gratuityFinalAmount: 54,
  tripdata: [
    { baseRate: 99, primeTime: true, primeTimeCost: 10, meetAndGreet: true, meetAndGreetCost: 25, gratuity: '20', gratuityAmount: 27 },
    { baseRate: 99, primeTime: true, primeTimeCost: 10, meetAndGreet: false, meetAndGreetCost: 25, gratuity: '20', gratuityAmount: 27 },
  ],
  ...over,
});

describe('tripMoney', () => {
  it('splits what the customer was charged across the legs, to the cent', () => {
    const m = tripMoney(trip());
    expect(Math.round(m.reduce((s, x) => s + x.fare, 0) * 100) / 100).toBe(242);
    expect(m[0].fare).toBeGreaterThan(m[1].fare); // the leg with Meet and Greet is worth more
  });

  it('itemises each leg so its lines add back up to its fare', () => {
    for (const x of tripMoney(trip())) {
      const b = x.breakdown;
      const total = b.classFare + b.primetimeSurcharge + b.meetAndGreetFee + b.stopFee + (b.gratuity ?? 0) - (b.discount ?? 0) + (b.tax ?? 0);
      expect(Math.round(total * 100) / 100).toBe(x.fare);
    }
  });

  it('ignores a charge whose switch was off (the old data lists the price anyway)', () => {
    const m = tripMoney(trip());
    expect(m[1].breakdown.meetAndGreetFee).toBe(0);
    expect(m[0].breakdown.meetAndGreetFee).toBe(25);
  });

  it('falls back to a plain total when the old lines cannot explain the charge', () => {
    const m = tripMoney(trip({ grandTotal: 50, gratuityFinalAmount: 0, discount: 0 }));
    expect(m.reduce((s, x) => s + x.fare, 0)).toBeCloseTo(50, 2);
    for (const x of m) expect(x.breakdown.classFare).toBeGreaterThanOrEqual(0);
  });

  it('works out a total when the old one is missing', () => {
    const m = tripMoney(trip({ grandTotal: null, subTotal: null, discount: 0, gratuityFinalAmount: 0 }));
    expect(m.reduce((s, x) => s + x.fare, 0)).toBeGreaterThan(0);
  });
});

describe('mapLegState', () => {
  const now = new Date('2026-10-26T12:00:00Z');
  const past = new Date('2026-08-01T12:00:00Z');
  const soon = new Date('2026-11-05T12:00:00Z');
  const base = { hasDriver: false, now, paid: true, scheduledAt: past };

  it('cancelled stays cancelled, with a trip only if a chauffeur was on it', () => {
    expect(mapLegState({ ...base, legStatus: 'Cancelled' })).toMatchObject({ booking: 'cancelled', trip: undefined });
    expect(mapLegState({ ...base, legStatus: 'Cancelled', hasDriver: true })).toMatchObject({ booking: 'cancelled', trip: 'cancelled' });
  });

  it('a rejected request is cancelled and marked rejected', () => {
    expect(mapLegState({ ...base, legStatus: 'Cancelled', tripStatus: 'Rejected' }).rejected).toBe(true);
    expect(mapLegState({ ...base, legStatus: 'Cancelled', rejectionReason: 'No cars' }).rejected).toBe(true);
  });

  it('completed is an assigned booking with a completed trip when a chauffeur is on record', () => {
    expect(mapLegState({ ...base, legStatus: 'Completed', hasDriver: true })).toMatchObject({ booking: 'assigned', trip: 'completed' });
    expect(mapLegState({ ...base, legStatus: 'Completed' })).toMatchObject({ booking: 'assigned', trip: undefined });
  });

  it('an unfinished stage long past is closed, so it cannot sit in the queue or on a screen', () => {
    const s = mapLegState({ ...base, legStatus: 'Onboard', hasDriver: true });
    expect(s).toMatchObject({ booking: 'assigned', trip: 'completed', closedOnImport: true });
    expect(mapLegState({ ...base, legStatus: 'Trip Confirmed' })).toMatchObject({ booking: 'assigned', closedOnImport: true });
  });

  it('a request nobody paid for or confirmed, long past, did not happen', () => {
    const s = mapLegState({ ...base, legStatus: 'Pending', paid: false });
    expect(s.booking).toBe('cancelled');
    expect(s.cancelReason).toMatch(/not confirmed or paid/i);
    expect(mapLegState({ ...base, legStatus: 'Pending', paid: true }).booking).toBe('assigned');
  });

  it('an upcoming job with no chauffeur is back in the dispatch queue, whatever it was marked', () => {
    const s = mapLegState({ ...base, scheduledAt: soon, legStatus: 'Trip Confirmed' });
    expect(s.booking).toBe('pending');
    expect(s.trip).toBeUndefined();
    expect(mapLegState({ ...base, scheduledAt: soon, legStatus: 'Pending', paid: false }).booking).toBe('pending');
  });

  it('an upcoming job with a chauffeur keeps its stage', () => {
    const s = mapLegState({ ...base, scheduledAt: soon, legStatus: 'Trip Confirmed', hasDriver: true });
    expect(s).toMatchObject({ booking: 'assigned', trip: 'accepted', stages: { confirmed: true, enroute: false } });
    expect(mapLegState({ ...base, scheduledAt: soon, legStatus: 'Arrived', hasDriver: true }).stages).toMatchObject({ enroute: true, arrived: true });
  });

  it('falls back to the trip status when the leg has none', () => {
    expect(mapLegState({ ...base, legStatus: '', tripStatus: 'Cancelled' }).booking).toBe('cancelled');
  });
});

describe('planCustomer', () => {
  const doc = { _id: 'c1', email: ' Rider@Example.COM ', fullName: 'Mary Jane Watson', contact_no: '+12065550100' };
  it('tidies the email and splits the name on the first space', () => {
    expect(planCustomer(doc)).toMatchObject({ email: 'rider@example.com', firstName: 'Mary', lastName: 'Jane Watson', name: 'Mary Jane Watson', phone: '+12065550100' });
  });
  it('prefers the separate first and last names when they exist', () => {
    expect(planCustomer({ ...doc, firstName: 'Mary', lastName: 'Watson' })).toMatchObject({ lastName: 'Watson', name: 'Mary Watson' });
  });
  it('keeps an address only when street, city, state and postcode are all there', () => {
    const full = { ...doc, addressLine1: '1 Main St', addressLine2: 'Apt 2', addressLine3: 'Tacoma', addressLine4: 'WA', zipCode: 98466 };
    expect(planCustomer(full)?.address).toEqual({ line1: '1 Main St', line2: 'Apt 2', city: 'Tacoma', state: 'WA', postalCode: '98466' });
    expect(planCustomer({ ...full, zipCode: null })?.address).toBeUndefined();
    expect(planCustomer({ ...full, addressLine4: '' })?.address).toBeUndefined();
  });
  it('gives a missing phone a placeholder and refuses an unusable email', () => {
    expect(planCustomer({ ...doc, contact_no: '' })?.phone).toBe('n/a');
    expect(planCustomer({ ...doc, email: 'not-an-email' })).toBeNull();
  });
});

describe('small rules', () => {
  it('tidies occasions, trip types, hours and vehicle slugs', () => {
    expect(normaliseOccasion('Airport transfer')).toBe('Airport Transfer');
    expect(normaliseOccasion('  ')).toBeUndefined();
    expect(tripTypeOf({ _id: 1, rideType: 'hourly-trip' })).toBe('hourly');
    expect(tripTypeOf({ _id: 1, rideType: 'oneway-trip', tripOccasion: 'Airport transfer' })).toBe('airport');
    expect(tripTypeOf({ _id: 1, rideType: 'oneway-trip', tripOccasion: 'Wedding' })).toBe('point2point');
    expect(hoursOf({ time: '4' })).toBe(4);
    expect(hoursOf({ time: '-' })).toBeUndefined();
    expect(slugify('Executive Sedan (SEA Region)')).toBe('executive-sedan-sea-region');
  });
});
