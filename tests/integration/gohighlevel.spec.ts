import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { env } from '../../src/config/env';
import { Booking } from '../../src/models/Booking';
import { Driver } from '../../src/models/Driver';
import { Trip } from '../../src/models/Trip';
import { User } from '../../src/models/User';
import { getGoHighLevel, setGoHighLevel, type GoHighLevel, type GoHighLevelContact } from '../../src/integrations/goHighLevel';
import { accessTokenFor, listen, makeUser, pickupIn, point, resetData, seedCatalogue, startDatabase, stopDatabase } from './harness';

vi.mock('../../src/jobs/cancellationWindow.job', () => ({
  scheduleCancellationWindowCheck: vi.fn(async () => undefined),
}));

const http = listen(app);
const server = http.server;

class FakeGoHighLevel implements GoHighLevel {
  tagged: GoHighLevelContact[] = [];
  fail = false;
  async tagServiceCompleted(contact: GoHighLevelContact) {
    this.tagged.push(contact);
    return this.fail ? ({ ok: false, reason: 'GoHighLevel answered 401' } as const) : ({ ok: true } as const);
  }
}

let crm: FakeGoHighLevel;

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
  crm = new FakeGoHighLevel();
  setGoHighLevel(crm);
});
afterEach(() => setGoHighLevel(null));

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

/** A booking with a driver on it, the trip under way. */
async function startedTrip(customer: Record<string, unknown> = {}) {
  const admin = await makeUser('admin');
  const client = await makeUser('customer', { name: 'Ann Rider', email: 'ann.rider@gmail.com', phone: '+12065550123', ...customer });
  const made = await request(server)
    .post('/admin/bookings')
    .set('Authorization', admin.auth)
    .send({
      customerId: client.id,
      trip: { pickup: point('Sea-Tac Airport'), drop: point('Hotel Andra, Seattle'), vehicleClass: 'sedan', tripType: 'point2point', city: 'seattle', scheduledAt: pickupIn(5), passengers: 2 },
    });
  const bookingId = made.body.data.booking._id as string;
  const driverUser = await User.create({ role: 'driver', name: 'Dee Driver', email: 'dee@example.com', phone: '+12065550111', passwordHash: 'x' });
  const driver = await Driver.create({ userId: driverUser._id, vehicleClass: 'sedan', status: 'busy' });
  const trip = await Trip.create({ bookingId, driverId: driver._id, status: 'started', fareAmount: 140, timestamps: { started: new Date() } });
  await Booking.updateOne({ _id: bookingId }, { $set: { status: 'assigned' } });
  return { admin, tripId: String(trip._id), driverAuth: await accessTokenFor(String(driverUser._id), 'driver') };
}

describe('the feedback survey after a completed trip (GoHighLevel)', () => {
  it('tags the customer once when the driver completes the trip', async () => {
    const { tripId, driverAuth } = await startedTrip();
    const done = await request(server).post(`/trips/${tripId}/complete`).set('Authorization', driverAuth);
    expect(done.status).toBe(200);
    await settle();

    expect(crm.tagged).toEqual([{ email: 'ann.rider@gmail.com', phone: '+12065550123', firstName: 'Ann', lastName: 'Rider' }]);
    expect((await Trip.findById(tripId).lean())!.feedbackRequestedAt).toBeTruthy();

    // Completing again is refused, and sends nothing more.
    expect((await request(server).post(`/trips/${tripId}/complete`).set('Authorization', driverAuth)).status).toBe(409);
    await settle();
    expect(crm.tagged).toHaveLength(1);
  });

  it('does the same when an operator closes the trip as completed', async () => {
    const { admin, tripId } = await startedTrip();
    const res = await request(server).patch(`/trips/${tripId}/status`).set('Authorization', admin.auth).send({ status: 'completed' });
    expect(res.status).toBe(200);
    await settle();
    expect(crm.tagged).toHaveLength(1);
    expect(crm.tagged[0].email).toBe('ann.rider@gmail.com');
  });

  it('prefers the saved first and last name over splitting the full name', async () => {
    const { tripId, driverAuth } = await startedTrip({ name: 'Ann Marie Rider', firstName: 'Ann Marie', lastName: 'Rider' });
    await request(server).post(`/trips/${tripId}/complete`).set('Authorization', driverAuth);
    await settle();
    expect(crm.tagged[0]).toMatchObject({ firstName: 'Ann Marie', lastName: 'Rider' });
  });

  it('sends nothing for a cancelled trip, or for a placeholder address nobody can read', async () => {
    const cancelled = await startedTrip();
    await request(server).patch(`/trips/${cancelled.tripId}/status`).set('Authorization', cancelled.admin.auth).send({ status: 'cancelled' });
    const placeholder = await startedTrip({ email: 'guest@abl.invalid' });
    await request(server).post(`/trips/${placeholder.tripId}/complete`).set('Authorization', placeholder.driverAuth);
    await settle();
    expect(crm.tagged).toHaveLength(0);
  });

  it('sends no survey for a no-show, because the passenger never rode', async () => {
    const { admin, tripId } = await startedTrip();
    await Trip.updateOne({ _id: tripId }, { $set: { status: 'accepted' } });
    const res = await request(server).post(`/trips/${tripId}/no-show`).set('Authorization', admin.auth);
    expect(res.status).toBe(200);
    await settle();
    expect(crm.tagged).toHaveLength(0);
  });

  it('never fails the completion when GoHighLevel refuses, and lets a later try go through', async () => {
    crm.fail = true;
    const { tripId, driverAuth } = await startedTrip();
    const done = await request(server).post(`/trips/${tripId}/complete`).set('Authorization', driverAuth);
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('completed');
    await settle();
    expect(crm.tagged).toHaveLength(1);
    // The claim was let go, so the request is not recorded as sent.
    expect((await Trip.findById(tripId).lean())!.feedbackRequestedAt).toBeUndefined();
  });

  it('does nothing at all while GoHighLevel is not set up', async () => {
    setGoHighLevel(null);
    expect(getGoHighLevel()).toBeNull();
    const { tripId, driverAuth } = await startedTrip();
    const done = await request(server).post(`/trips/${tripId}/complete`).set('Authorization', driverAuth);
    expect(done.status).toBe(200);
    expect((await Trip.findById(tripId).lean())!.feedbackRequestedAt).toBeUndefined();
  });
});

describe('the GoHighLevel request itself', () => {
  it('upserts the contact with the tag, the token and the API version old ABL used', async () => {
    setGoHighLevel(null);
    env.GHL_API_TOKEN = 'pit-test-token';
    env.GHL_LOCATION_ID = 'loc123';
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200 });
    });
    try {
      const result = await getGoHighLevel()!.tagServiceCompleted({ email: 'a@b.co', phone: '+1', firstName: 'A', lastName: 'B' });
      expect(result).toEqual({ ok: true });
      expect(calls[0].url).toBe('https://services.leadconnectorhq.com/contacts/upsert');
      expect(calls[0].init.method).toBe('POST');
      expect(calls[0].init.headers).toMatchObject({ Authorization: 'Bearer pit-test-token', Version: '2021-07-28' });
      expect(JSON.parse(String(calls[0].init.body))).toEqual({ locationId: 'loc123', email: 'a@b.co', phone: '+1', firstName: 'A', lastName: 'B', tags: ['service completed'] });

      vi.stubGlobal('fetch', async () => new Response('bad token', { status: 401 }));
      expect(await getGoHighLevel()!.tagServiceCompleted({ email: 'a@b.co' })).toEqual({ ok: false, reason: 'GoHighLevel answered 401: bad token' });

      vi.stubGlobal('fetch', async () => {
        throw new Error('network down');
      });
      expect(await getGoHighLevel()!.tagServiceCompleted({ email: 'a@b.co' })).toEqual({ ok: false, reason: 'network down' });
    } finally {
      vi.unstubAllGlobals();
      delete env.GHL_API_TOKEN;
      delete env.GHL_LOCATION_ID;
    }
  });

  it('is off unless both the token and the location are set', () => {
    setGoHighLevel(null);
    delete env.GHL_API_TOKEN;
    delete env.GHL_LOCATION_ID;
    expect(getGoHighLevel()).toBeNull();
    env.GHL_API_TOKEN = 'only-the-token';
    try {
      expect(getGoHighLevel()).toBeNull();
    } finally {
      delete env.GHL_API_TOKEN;
    }
  });
});
