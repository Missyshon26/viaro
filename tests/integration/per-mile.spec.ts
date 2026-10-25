import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { Booking } from '../../src/models/Booking';
import { VehicleClass } from '../../src/models/VehicleClass';
import { buildDocument } from '../../src/modules/booking/booking.documents';
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
vi.mock('../../src/modules/dispatch/dispatch.service', () => ({
  receiveBookingRequest: vi.fn(async () => undefined),
}));

const http = listen(app);
const server = http.server;
const miles = vi.mocked(routeMiles);

beforeAll(async () => {
  await startDatabase();
  await seedCatalogue();
});
afterAll(async () => {
  await http.close();
  await stopDatabase();
});
beforeEach(async () => {
  await resetData();
  miles.mockReset();
  // sedan: $129 covers 18 miles, then $3 a mile (the old Executive Sedan's terms)
  await VehicleClass.updateOne({ value: 'sedan' }, { $set: { flatRate: 129, baseMiles: 18, perMileRate: 3, stopFee: 40 } });
});

const estimate = (over: Record<string, unknown> = {}) =>
  request(server)
    .get('/pricing/fare-estimate')
    .query({ city: 'seattle', tripType: 'point2point', requestedAt: '2026-11-20T10:00:00', vehicleClass: 'sedan', pickup: 'Pike Place Market, Seattle', drop: 'Bellevue, WA', ...over });

describe('pricing by the mile', () => {
  it('a trip within the included miles costs the flat rate and nothing more', async () => {
    miles.mockResolvedValue(14.2);
    const res = await estimate();
    expect(res.body.data).toMatchObject({ fare: 129, classFare: 129, distanceFee: 0, distanceMiles: 14.2, includedMiles: 18, extraMiles: 0, perMileRate: 3 });
  });

  it('every mile beyond them is charged, rounded up', async () => {
    miles.mockResolvedValue(22.3);
    const res = await estimate();
    expect(res.body.data).toMatchObject({ distanceFee: 15, extraMiles: 5, fare: 144, subtotal: 144 });
  });

  it('exactly the included miles is free; a hair over is one more mile', async () => {
    miles.mockResolvedValue(18);
    expect((await estimate()).body.data.distanceFee).toBe(0);
    miles.mockResolvedValue(18.01);
    expect((await estimate()).body.data.distanceFee).toBe(3);
  });

  it('sits with the other charges: primetime, Meet and Greet and a stop are added to it', async () => {
    miles.mockResolvedValue(28);
    const res = await estimate({ requestedAt: '2026-11-20T23:30:00', meetAndGreet: 'true', stops: 1, via: 'Space Needle, Seattle' });
    // 129 + 10 miles x $3 + $20 primetime + $25 Meet and Greet + $40 stop
    expect(res.body.data.fare).toBe(129 + 30 + 20 + 25 + 40);
    expect(miles).toHaveBeenCalledWith('Pike Place Market, Seattle', 'Bellevue, WA', ['Space Needle, Seattle']);
  });

  it('when the route cannot be measured, the flat rate stands and the quote says so', async () => {
    miles.mockResolvedValue(null);
    const res = await estimate();
    expect(res.body.data).toMatchObject({ fare: 129, distanceFee: 0, distanceUnknown: true });
  });

  it('an hourly charter is priced by the hour, never by the mile', async () => {
    await VehicleClass.updateOne({ value: 'sedan' }, { $set: { hourlyRate: 119 } });
    const res = await estimate({ tripType: 'hourly', hours: 3 });
    expect(res.body.data.fare).toBe(357);
    expect(miles).not.toHaveBeenCalled();
  });

  it('a class with no per-mile terms is not measured at all', async () => {
    await VehicleClass.updateOne({ value: 'sedan' }, { $set: { baseMiles: null, perMileRate: null } });
    const res = await estimate();
    expect(res.body.data.fare).toBe(129);
    expect(miles).not.toHaveBeenCalled();
  });

  it('the booking is created at the same price, and keeps the make-up for its invoice', async () => {
    miles.mockResolvedValue(30);
    const { auth } = await makeUser('customer');
    const res = await request(server)
      .post('/bookings')
      .set('Authorization', auth)
      .send({ pickup: point('Pike Place Market, Seattle'), drop: point('Bellevue, WA'), vehicleClass: 'sedan', tripType: 'point2point', city: 'seattle', scheduledAt: pickupIn(10) });
    expect(res.status).toBe(201);
    const stored = await Booking.findById(res.body.data.booking._id).lean();
    // 129 + 12 miles x $3
    expect(stored?.estimatedFare).toBe(165);
    expect(stored?.fareBreakdown).toMatchObject({ distanceMiles: 30, includedMiles: 18, extraMiles: 12, perMileRate: 3, distanceFee: 36, classFare: 129 });

    const invoice = buildDocument('invoice', { booking: stored as never, customer: { name: 'Pat' }, vehicleLabel: 'Business Sedan' });
    expect(invoice.lines.find((l) => l.label.startsWith('Additional miles'))).toMatchObject({ amount: 36 });
    expect(Math.round(invoice.lines.reduce((s, l) => s + l.amount, 0) * 100) / 100).toBe(invoice.total);
  });
});
