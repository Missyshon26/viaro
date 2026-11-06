import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { PricingRule } from '../../src/models/PricingRule';
import { VehicleClass } from '../../src/models/VehicleClass';
import { routeMiles } from '../../src/integrations/routeDistance';
import { listen, makeUser, pickupIn, point, resetData, seedCatalogue, startDatabase, stopDatabase } from './harness';

vi.mock('../../src/integrations/routeDistance', () => ({
  routeMiles: vi.fn(),
  isRouteDistanceEnabled: () => true,
  clearRouteDistanceCache: vi.fn(),
}));
vi.mock('../../src/jobs/cancellationWindow.job', () => ({
  scheduleCancellationWindowCheck: vi.fn(async () => undefined),
}));

const http = listen(app);
const server = http.server;
const miles = vi.mocked(routeMiles);

/*
 * The old ABL priced by vehicle alone: the car's base price (covering its first 18 miles),
 * each mile after, $40 a stop, $20 at night, and the hour rate for a charter. It had no
 * city. A vehicle with its own rate must therefore cost the same in every city, and a city
 * with no pricing rule must still be bookable.
 */
beforeAll(async () => {
  await startDatabase();
  await seedCatalogue();
  // A city whose rule is very different from Seattle's, to prove it changes nothing.
  await PricingRule.create({ city: 'los angeles', baseFare: 199, peakMultiplier: 1.2 });
});
afterAll(async () => {
  await http.close();
  await stopDatabase();
});
beforeEach(async () => {
  await resetData();
  miles.mockReset();
  miles.mockResolvedValue(22.3);
  // The old Executive Sedan's terms.
  await VehicleClass.updateOne(
    { value: 'sedan' },
    { $set: { flatRate: 129, hourlyRate: 119, baseMiles: 18, perMileRate: 3, stopFee: 40, maxMiles: null } },
  );
});

const estimate = (over: Record<string, unknown> = {}) =>
  request(server)
    .get('/pricing/fare-estimate')
    .query({ city: 'seattle', tripType: 'point2point', requestedAt: '2026-11-20T10:00:00', vehicleClass: 'sedan', pickup: 'Pike Place Market, Seattle', drop: 'Bellevue, WA', ...over });

describe('a vehicle with its own rate costs the same in every city', () => {
  it('Seattle and a city with a much higher base fare and peak multiplier quote the same transfer', async () => {
    // 22.3 miles -> 23 -> 5 extra miles: 129 + 15
    const seattle = await estimate({ city: 'seattle' });
    const la = await estimate({ city: 'los angeles' });
    expect(seattle.body.data.classFare + seattle.body.data.distanceFee).toBe(144);
    expect(la.body.data.fare).toBe(seattle.body.data.fare);
    expect(la.body.data.subtotal).toBe(144);
  });

  it('...even in the peak window, where the city multiplier would have raised it', async () => {
    const off = await estimate({ city: 'los angeles', requestedAt: '2026-11-20T10:00:00' });
    const peak = await estimate({ city: 'los angeles', requestedAt: '2026-11-20T07:30:00' });
    expect(peak.body.data.isPeak).toBe(true);
    expect(peak.body.data.peakApplied).toBe(false);
    expect(peak.body.data.fare).toBe(off.body.data.fare);
  });

  it('an hourly charter is hours x the vehicle rate whatever the city', async () => {
    const a = await estimate({ city: 'los angeles', tripType: 'hourly', hours: 3 });
    const b = await estimate({ city: 'seattle', tripType: 'hourly', hours: 3 });
    expect(a.body.data.subtotal).toBe(357);
    expect(b.body.data.subtotal).toBe(357);
  });
});

describe('a city with no pricing rule', () => {
  it('is quoted for a vehicle with its own rate, exactly as in a listed city', async () => {
    const listed = await estimate({ city: 'seattle' });
    const unlisted = await estimate({ city: 'Portland' });
    expect(unlisted.status).toBe(200);
    expect(unlisted.body.data).toMatchObject({ city: 'portland', pricingModel: 'flat', baseFare: 0, peakMultiplier: 1 });
    expect(unlisted.body.data.fare).toBe(listed.body.data.fare);
  });

  it('carries the other old charges: $20 at night, $40 a stop, $25 Meet and Greet', async () => {
    const res = await estimate({ city: 'portland', requestedAt: '2026-11-20T23:30:00', stops: 2, via: 'Space Needle, Seattle|Pioneer Square, Seattle', meetAndGreet: 'true' });
    // 129 + 5 miles x $3 + $20 + 2 stops x $40 + $25
    expect(res.body.data.subtotal).toBe(129 + 15 + 20 + 80 + 25);
  });

  it('is still refused when the vehicle has no rate of its own, since only the city formula could price it', async () => {
    const res = await estimate({ city: 'portland', vehicleClass: 'suv' });
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/No pricing rule configured for city 'portland'/);
  });

  it('can be booked, at the quoted price', async () => {
    const { auth } = await makeUser('customer');
    const quote = await estimate({ city: 'portland' });
    const res = await request(server)
      .post('/bookings')
      .set('Authorization', auth)
      .send({ pickup: point('Pike Place Market, Seattle'), drop: point('Bellevue, WA'), vehicleClass: 'sedan', tripType: 'point2point', city: 'portland', scheduledAt: pickupIn(10) });
    expect(res.status).toBe(201);
    expect(res.body.data.booking.estimatedFare).toBe(quote.body.data.fare);
  });
});

describe('the city formula is untouched for a vehicle that has no rate', () => {
  it('still prices by base fare x class multiplier in a listed city', async () => {
    miles.mockResolvedValue(5);
    const res = await estimate({ city: 'seattle', vehicleClass: 'suv', requestedAt: '2026-11-20T10:00:00' });
    expect(res.body.data).toMatchObject({ pricingModel: 'multiplier', baseFare: 129, classFare: Math.ceil(129 * 1.4) });
  });
});
