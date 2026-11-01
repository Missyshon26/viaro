import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { Booking } from '../../src/models/Booking';
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
beforeEach(resetData);

const body = () => ({
  pickup: point('123 Pine St, Seattle'),
  drop: point('1201 Alaskan Way, Seattle'),
  vehicleClass: 'sedan',
  tripType: 'point2point',
  city: 'seattle',
  scheduledAt: pickupIn(10),
});

describe('invoice trip numbers', () => {
  it('are plain running numbers, one more each booking', async () => {
    const { auth } = await makeUser('customer');
    const a = await request(server).post('/bookings').set('Authorization', auth).send(body());
    const b = await request(server).post('/bookings').set('Authorization', auth).send(body());
    expect(a.status).toBe(201);
    const first = (await Booking.findById(a.body.data.booking._id).lean())?.tripNo;
    const second = (await Booking.findById(b.body.data.booking._id).lean())?.tripNo;
    expect(first).toMatch(/^[0-9]+$/);
    expect(Number(second)).toBe(Number(first) + 1);
  });
});

describe('trip numbers never repeat', () => {
  it('give a booking made at the same moment as another a different number', async () => {
    const { auth } = await makeUser('customer');
    const made = await Promise.all(
      [1, 2, 3, 4, 5].map(() => request(server).post('/bookings').set('Authorization', auth).send(body())),
    );
    expect(made.every((r) => r.status === 201)).toBe(true);
    const numbers = (await Booking.find().lean()).map((b) => b.tripNo);
    expect(new Set(numbers).size).toBe(5);
  });

  it('carry on after the highest imported old number, and step over one that is taken', async () => {
    const { auth } = await makeUser('customer');
    const probe = await request(server).post('/bookings').set('Authorization', auth).send(body());
    const base = Number((await Booking.findById(probe.body.data.booking._id).lean())?.tripNo);
    // An old booking imported later holds the very next number.
    await Booking.collection.insertOne({
      ...(await Booking.findById(probe.body.data.booking._id).lean()),
      _id: new (await import('mongoose')).Types.ObjectId(),
      tripNo: undefined,
      legacy: { tripId: new (await import('mongoose')).Types.ObjectId(), tripNo: String(base + 1), legIndex: 0, legCount: 1 },
    } as never);
    const next = await request(server).post('/bookings').set('Authorization', auth).send(body());
    const got = (await Booking.findById(next.body.data.booking._id).lean())?.tripNo;
    expect(Number(got)).toBeGreaterThan(base + 1);
  });

  it('the database refuses the same number on two ordinary bookings', async () => {
    const { auth } = await makeUser('customer');
    const r = await request(server).post('/bookings').set('Authorization', auth).send(body());
    const doc = await Booking.findById(r.body.data.booking._id).lean();
    await Booking.syncIndexes();
    await expect(
      Booking.collection.insertOne({ ...doc, _id: new (await import('mongoose')).Types.ObjectId() } as never),
    ).rejects.toThrow(/duplicate key/i);
  });
});
