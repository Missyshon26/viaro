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

const body = (over: Record<string, unknown> = {}) => ({
  pickup: point('123 Pine St, Seattle'),
  drop: point('1201 Alaskan Way, Seattle'),
  vehicleClass: 'sedan',
  tripType: 'point2point',
  city: 'seattle',
  scheduledAt: pickupIn(10),
  ...over,
});

describe('car seats by age and the customer note', () => {
  it('stores both, totals the seats, and puts them in the dispatch notes', async () => {
    const { auth } = await makeUser('customer');
    const res = await request(server)
      .post('/bookings')
      .set('Authorization', auth)
      .send(body({ carSeatTypes: { infant: 1, booster: 2 }, description: 'Please bring a wheelchair ramp' }));
    expect(res.status).toBe(201);
    const stored = await Booking.findById(res.body.data.booking._id).lean();
    expect(stored?.carSeats).toBe(3);
    expect(stored?.carSeatTypes).toEqual({ infant: 1, toddler: 0, booster: 2 });
    expect(stored?.description).toBe('Please bring a wheelchair ramp');
    expect((stored?.serviceNotes ?? []).join(' | ')).toMatch(/1 × infant seat \(ages 0-1\), 2 × booster seat/);
    expect((stored?.serviceNotes ?? []).join(' | ')).toMatch(/Customer note: Please bring a wheelchair ramp/);
  });

  it('still takes a plain seat count, as older clients send', async () => {
    const { auth } = await makeUser('customer');
    const res = await request(server).post('/bookings').set('Authorization', auth).send(body({ carSeats: 2 }));
    expect(res.status).toBe(201);
    const stored = await Booking.findById(res.body.data.booking._id).lean();
    expect(stored?.carSeats).toBe(2);
    expect(stored?.carSeatTypes).toBeUndefined();
  });

  it('refuses more seats than a booking can carry, and an over-long note', async () => {
    const { auth } = await makeUser('customer');
    const tooMany = await request(server)
      .post('/bookings')
      .set('Authorization', auth)
      .send(body({ carSeatTypes: { infant: 2, toddler: 2 } }));
    expect(tooMany.status).toBe(400);
    const tooLong = await request(server)
      .post('/bookings')
      .set('Authorization', auth)
      .send(body({ description: 'x'.repeat(501) }));
    expect(tooLong.status).toBe(400);
  });

  it('a booking with neither is unchanged', async () => {
    const { auth } = await makeUser('customer');
    const res = await request(server).post('/bookings').set('Authorization', auth).send(body());
    const stored = await Booking.findById(res.body.data.booking._id).lean();
    expect(stored?.description).toBeUndefined();
    expect(stored?.carSeatTypes).toBeUndefined();
    expect(stored?.serviceNotes).toEqual([]);
  });
});
