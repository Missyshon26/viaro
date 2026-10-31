import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { Booking } from '../../src/models/Booking';
import { listen, makeUser, pickupIn, point, resetData, seedCatalogue, startDatabase, stopDatabase } from './harness';

vi.mock('../../src/jobs/cancellationWindow.job', () => ({
  scheduleCancellationWindowCheck: vi.fn(async () => undefined),
}));
vi.mock('../../src/modules/dispatch/dispatch.service', () => ({
  receiveBookingRequest: vi.fn(async () => undefined),
}));

const http = listen(app);
const server = http.server;

let admin: { id: string; auth: string };
let customerId: string;
let packageId: string;

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
  admin = await makeUser('admin');
  customerId = (await makeUser('customer', { name: 'Ann Rider' })).id;
  packageId = (
    await request(server)
      .post('/admin/packages')
      .set('Authorization', admin.auth)
      .send({ name: 'Wine Country Day', vehicles: [{ vehicleClass: 'sedan', price: 900 }] })
  ).body.data._id;
});

// 11pm is inside the primetime window, which a package must not add to.
const trip = (over: Record<string, unknown> = {}) => ({
  pickup: point('Hotel Andra, Seattle'),
  drop: point('Hotel Andra, Seattle'),
  vehicleClass: 'sedan',
  tripType: 'point2point',
  city: 'seattle',
  scheduledAt: pickupIn(5, 23),
  passengers: 2,
  packageId,
  ...over,
});

const estimate = (query: Record<string, string>) =>
  request(server).get('/pricing/fare-estimate').query({ city: 'seattle', tripType: 'point2point', vehicleClass: 'sedan', ...query });

describe('pricing a package', () => {
  it("charges the package's price for the vehicle, with no primetime, stops or distance on top", async () => {
    const res = await estimate({ packageId, requestedAt: pickupIn(5, 23) });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ pricingModel: 'package', packageName: 'Wine Country Day', classFare: 900, primetimeSurcharge: 0, fare: 900 });
  });

  it('refuses a hidden package, an unknown package and a vehicle the package does not list', async () => {
    await request(server).patch(`/admin/packages/${packageId}`).set('Authorization', admin.auth).send({ status: 'hidden' });
    expect((await estimate({ packageId })).status).toBe(404);
    await request(server).patch(`/admin/packages/${packageId}`).set('Authorization', admin.auth).send({ status: 'visible' });
    expect((await estimate({ packageId: 'b'.repeat(24) })).status).toBe(404);
    expect((await estimate({ packageId, vehicleClass: 'suv' })).status).toBe(400);
    expect((await estimate({ packageId: 'nope' })).status).toBe(400);
  });
});

describe('booking a package', () => {
  const book = (over: Record<string, unknown> = {}) =>
    request(server).post('/admin/bookings').set('Authorization', admin.auth).send({ customerId, trip: trip(over) });

  it('stores the package and its price on the booking, and tells the chauffeur what it is', async () => {
    const res = await book();
    expect(res.status).toBe(201);
    const stored = await Booking.findById(res.body.data.booking._id).lean();
    expect(stored).toMatchObject({ packageName: 'Wine Country Day', estimatedFare: 900, tripType: 'point2point' });
    expect(String(stored!.packageId)).toBe(packageId);
    expect(stored!.fareBreakdown).toMatchObject({ pricingModel: 'package', packageName: 'Wine Country Day', classFare: 900 });
    expect(stored!.serviceNotes?.some((n) => n.startsWith('Package: Wine Country Day'))).toBe(true);
  });

  it('keeps the booked name and price when the package is later renamed or repriced', async () => {
    const id = (await book()).body.data.booking._id;
    await request(server)
      .patch(`/admin/packages/${packageId}`)
      .set('Authorization', admin.auth)
      .send({ name: 'Renamed', vehicles: [{ vehicleClass: 'sedan', price: 1500 }] });
    const stored = await Booking.findById(id).lean();
    expect(stored).toMatchObject({ packageName: 'Wine Country Day', estimatedFare: 900 });
  });

  it('refuses things that do not belong on a package: stops, hours, a different trip type, another vehicle', async () => {
    expect((await book({ stops: [point('Pike Place')] })).status).toBe(400);
    expect((await book({ hours: 3 })).status).toBe(400);
    expect((await book({ tripType: 'hourly', hours: 3 })).status).toBe(400);
    expect((await book({ vehicleClass: 'suv' })).status).toBe(400);
    expect(await Booking.countDocuments()).toBe(0);
  });
});
