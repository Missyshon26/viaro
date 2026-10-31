import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { Booking } from '../../src/models/Booking';
import { User } from '../../src/models/User';
import { listen, makeUser, pickupIn, point, resetData, seedCatalogue, startDatabase, stopDatabase } from './harness';

vi.mock('../../src/jobs/cancellationWindow.job', () => ({
  scheduleCancellationWindowCheck: vi.fn(async () => undefined),
}));

const http = listen(app);
const server = http.server;

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
});

const trip = (over: Record<string, unknown> = {}) => ({
  pickup: point('Sea-Tac Airport'),
  drop: point('Hotel Andra, Seattle'),
  vehicleClass: 'sedan',
  tripType: 'airport', flightDetails: { flightNumber: 'AS123' },
  city: 'seattle',
  scheduledAt: pickupIn(5),
  passengers: 2,
  ...over,
});

const post = (path: string, auth: string, body: string | object) =>
  request(server).post(path).set('Authorization', auth).send(body);

describe('POST /admin/bookings/quote', () => {
  it('prices the trip for the client without saving anything', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer');
    const res = await post('/admin/bookings/quote', admin.auth, { customerId: client.id, trip: trip() });
    expect(res.status).toBe(200);
    expect(res.body.data.fare).toBeGreaterThan(0);
    expect(await Booking.countDocuments()).toBe(0);
  });

  it('prices stops with the class stop fee', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer');
    const none = await post('/admin/bookings/quote', admin.auth, { customerId: client.id, trip: trip({ tripType: 'point2point' }) });
    const two = await post('/admin/bookings/quote', admin.auth, {
      customerId: client.id,
      trip: trip({ tripType: 'point2point', stops: [point('Pike Place Market'), point('Space Needle')] }),
    });
    expect(two.body.data.fare - none.body.data.fare).toBe(30);
  });

  it('applies the vehicle rules a customer would face', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer');
    const res = await post('/admin/bookings/quote', admin.auth, {
      customerId: client.id,
      trip: trip({ occasion: 'Wedding' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /admin/bookings', () => {
  it('books the trip for the client, unpaid, recording who made it', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer');
    const res = await post('/admin/bookings', admin.auth, { customerId: client.id, trip: trip() });
    expect(res.status).toBe(201);

    const saved = await Booking.findById(res.body.data.booking._id).lean();
    expect(String(saved!.customerId)).toBe(client.id);
    expect(saved!.source).toBe('admin');
    expect(String(saved!.createdBy)).toBe(admin.id);
    expect(saved!.status).toBe('pending');
    expect(saved!.payment).toBeUndefined();
    expect(saved!.estimatedFare).toBeGreaterThan(0);
  });

  it('carries the client\'s guest tag and signed agreement onto the trip', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer', {
      isGuest: true,
      agreement: { version: 'v1', signedAt: new Date() },
    });
    const res = await post('/admin/bookings', admin.auth, { customerId: client.id, trip: trip() });
    expect(res.status).toBe(201);
    const saved = await Booking.findById(res.body.data.booking._id).lean();
    expect(saved!.isGuest).toBe(true);
    expect(saved!.agreementVersion).toBe('v1');
  });

  it('shows up on the client\'s own trips', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer');
    const made = await post('/admin/bookings', admin.auth, { customerId: client.id, trip: trip() });
    const read = await request(server)
      .get(`/bookings/${made.body.data.booking._id}`)
      .set('Authorization', client.auth);
    expect(read.status).toBe(200);
    expect(read.body.data.drop.address).toContain('Hotel Andra');
  });

  it('refuses a suspended client, an unknown client and a non-client', async () => {
    const admin = await makeUser('admin');
    const suspended = await makeUser('customer', { status: 'suspended' });
    expect((await post('/admin/bookings', admin.auth, { customerId: suspended.id, trip: trip() })).status).toBe(409);
    expect((await post('/admin/bookings', admin.auth, { customerId: '5f9d88b8b54764421b7156c9', trip: trip() })).status).toBe(404);
    expect((await post('/admin/bookings', admin.auth, { customerId: admin.id, trip: trip() })).status).toBe(404);
    expect(await Booking.countDocuments()).toBe(0);
  });

  it('refuses a deleted client', async () => {
    const admin = await makeUser('admin');
    const gone = await makeUser('customer');
    await User.updateOne({ _id: gone.id }, { $set: { deletedAt: new Date() } });
    expect((await post('/admin/bookings', admin.auth, { customerId: gone.id, trip: trip() })).status).toBe(404);
  });

  it('enforces the same rules as the passenger site (past pickup, wedding vehicle, bags)', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer');
    const bad = [
      trip({ scheduledAt: pickupIn(-2) }),
      trip({ occasion: 'Wedding' }),
      trip({ checkedBags: 40 }),
      trip({ vehicleClass: 'no-such-class' }),
    ];
    for (const t of bad) {
      const res = await post('/admin/bookings', admin.auth, { customerId: client.id, trip: t });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
    expect(await Booking.countDocuments()).toBe(0);
  });

  it('needs a client and a trip', async () => {
    const admin = await makeUser('admin');
    expect((await post('/admin/bookings', admin.auth, { trip: trip() })).status).toBe(400);
    expect((await post('/admin/bookings', admin.auth, { customerId: 'nope', trip: trip() })).status).toBe(400);
  });

  it('is admin only', async () => {
    const client = await makeUser('customer');
    expect((await post('/admin/bookings', client.auth, { customerId: client.id, trip: trip() })).status).toBe(403);
    expect((await post('/admin/bookings', '', { customerId: client.id, trip: trip() })).status).toBe(401);
  });
});

describe('POST /admin/bookings/journey (multi-city and round trips)', () => {
  const back = (over: Record<string, unknown> = {}) =>
    trip({ pickup: point('Hotel Andra, Seattle'), drop: point('Sea-Tac Airport'), tripType: 'point2point', flightDetails: undefined, scheduledAt: pickupIn(5, 18), ...over });
  const out = (over: Record<string, unknown> = {}) => trip({ scheduledAt: pickupIn(5, 10), ...over });

  it('quotes every leg and the total without saving', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer');
    const res = await post('/admin/bookings/journey/quote', admin.auth, { customerId: client.id, legs: [out(), back()] });
    expect(res.status).toBe(200);
    expect(res.body.data.fares).toHaveLength(2);
    expect(res.body.data.total).toBeCloseTo(res.body.data.fares[0] + res.body.data.fares[1], 2);
    expect(await Booking.countDocuments()).toBe(0);
  });

  it('books a round trip as one tagged journey, unpaid, in pickup order', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer');
    const res = await post('/admin/bookings/journey', admin.auth, { customerId: client.id, legs: [out(), back()] });
    expect(res.status).toBe(201);
    expect(res.body.data.error).toBeUndefined();

    const saved = await Booking.find().sort({ scheduledAt: 1 }).lean();
    expect(saved).toHaveLength(2);
    expect(saved.map((b) => b.journey)).toEqual([{ index: 0, count: 2 }, { index: 1, count: 2 }]);
    for (const b of saved) {
      expect(b.source).toBe('admin');
      expect(String(b.createdBy)).toBe(admin.id);
      expect(String(b.customerId)).toBe(client.id);
      expect(b.payment).toBeUndefined();
    }
  });

  it('books up to five legs and refuses six or one', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer');
    const leg = (h: number) => back({ scheduledAt: pickupIn(6, h) });
    const five = [8, 10, 12, 14, 16].map(leg);
    expect((await post('/admin/bookings/journey', admin.auth, { customerId: client.id, legs: five })).status).toBe(201);
    expect(await Booking.countDocuments()).toBe(5);

    const six = [6, 8, 10, 12, 14, 16].map(leg);
    expect((await post('/admin/bookings/journey', admin.auth, { customerId: client.id, legs: six })).status).toBe(400);
    expect((await post('/admin/bookings/journey', admin.auth, { customerId: client.id, legs: [out()] })).status).toBe(400);
    expect(await Booking.countDocuments()).toBe(5);
  });

  it('refuses legs out of order or too close together', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer');
    const early = back({ scheduledAt: pickupIn(5, 8) });
    const reversed = await post('/admin/bookings/journey', admin.auth, { customerId: client.id, legs: [out(), early] });
    expect(reversed.status).toBe(400);
    expect(JSON.stringify(reversed.body)).toContain('minutes after');
    expect(await Booking.countDocuments()).toBe(0);
  });

  it('saves nothing when a later leg breaks a rule, and says which leg', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer');
    const res = await post('/admin/bookings/journey', admin.auth, {
      customerId: client.id,
      legs: [out(), back({ occasion: 'Wedding' })],
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/Leg 2/);
    expect(await Booking.countDocuments()).toBe(0);
  });

  it('refuses a suspended client and non-admins', async () => {
    const admin = await makeUser('admin');
    const suspended = await makeUser('customer', { status: 'suspended' });
    expect((await post('/admin/bookings/journey', admin.auth, { customerId: suspended.id, legs: [out(), back()] })).status).toBe(409);
    const client = await makeUser('customer');
    expect((await post('/admin/bookings/journey', client.auth, { customerId: client.id, legs: [out(), back()] })).status).toBe(403);
    expect(await Booking.countDocuments()).toBe(0);
  });
});
