import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import request from 'supertest';
import app from '../../src/app';
import { listen, makeUser, pickupIn, point, portOf, resetData, seedCatalogue, startDatabase, stopDatabase } from './harness';

vi.mock('../../src/jobs/cancellationWindow.job', () => ({
  scheduleCancellationWindowCheck: vi.fn(async () => undefined),
}));

const web = listen(app);
const server = web.server;

beforeAll(async () => {
  await startDatabase();
  await seedCatalogue();
});
afterAll(async () => {
  await web.close();
  await stopDatabase();
});
beforeEach(async () => {
  await resetData();
});

/** A browser's open event stream: collects what the server writes, and can be closed. */
function openStream(auth: string) {
  const frames: { at: number; text: string }[] = [];
  let response: http.IncomingMessage | null = null;
  const req = http.get(
    { host: '127.0.0.1', port: portOf(server), path: '/events/stream', headers: { Authorization: auth, Accept: 'text/event-stream' } },
    (res) => {
      response = res;
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => frames.push({ at: Date.now(), text: chunk }));
    },
  );
  req.on('error', () => undefined);
  return {
    frames,
    headers: () => response?.headers,
    text: () => frames.map((f) => f.text).join(''),
    close: () => req.destroy(),
    waitFor: async (needle: string, ms = 2000) => {
      const start = Date.now();
      while (Date.now() - start < ms) {
        const hit = frames.find((f) => f.text.includes(needle));
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 10));
      }
      return null;
    },
  };
}

const trip = () => ({
  pickup: point('Sea-Tac Airport'),
  drop: point('Hotel Andra, Seattle'),
  vehicleClass: 'sedan',
  tripType: 'point2point',
  city: 'seattle',
  scheduledAt: pickupIn(5),
  passengers: 2,
});

describe('changes reach open screens straight away', () => {
  it('streams with the headers that stop proxies holding it back, and says hello at once', async () => {
    const admin = await makeUser('admin');
    const stream = openStream(admin.auth);
    expect(await stream.waitFor(': connected')).not.toBeNull();
    expect(stream.headers()).toMatchObject({ 'content-type': 'text/event-stream', 'x-accel-buffering': 'no' });
    expect(String(stream.headers()?.['cache-control'])).toContain('no-transform');
    stream.close();
  });

  it('tells the admin and the booking customer — within a second — and nobody else', async () => {
    const admin = await makeUser('admin');
    const ann = await makeUser('customer', { name: 'Ann Rider' });
    const bob = await makeUser('customer', { name: 'Bob Traveller' });

    const adminStream = openStream(admin.auth);
    const annStream = openStream(ann.auth);
    const bobStream = openStream(bob.auth);
    await Promise.all([adminStream.waitFor(': connected'), annStream.waitFor(': connected'), bobStream.waitFor(': connected')]);

    const sent = Date.now();
    const made = await request(server).post('/bookings').set('Authorization', ann.auth).send(trip());
    expect(made.status).toBe(201);
    const id = made.body.data.booking._id as string;

    const forAdmin = await adminStream.waitFor('"topic":"booking"');
    const forAnn = await annStream.waitFor('"topic":"booking"');
    expect(forAdmin).not.toBeNull();
    expect(forAnn).not.toBeNull();
    expect(forAdmin!.at - sent).toBeLessThan(1000);
    expect(forAnn!.at - sent).toBeLessThan(1000);
    expect(adminStream.text()).toContain(`"id":"${id}"`);

    // The frame names what changed, never the booking itself or who it belongs to.
    expect(adminStream.text()).not.toMatch(/customerId|pickup|address/);
    // Another customer hears nothing about it.
    await new Promise((r) => setTimeout(r, 150));
    expect(bobStream.text()).not.toContain(id);

    // An admin cancel reaches the customer too.
    await request(server).delete(`/bookings/${id}`).set('Authorization', ann.auth);
    expect(await adminStream.waitFor('"action":"cancelled"')).not.toBeNull();

    adminStream.close();
    annStream.close();
    bobStream.close();
  });

  it('refuses a stream without a sign-in', async () => {
    const res = await request(server).get('/events/stream');
    expect(res.status).toBe(401);
  });
});
