import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { listen, makeUser, resetData, seedCatalogue, startDatabase, stopDatabase } from './harness';

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

const QUOTE = { city: 'seattle', tripType: 'point2point', requestedAt: '2026-11-20T10:00:00', vehicleClass: 'sedan' };
const PRICING_FIELDS = ['multiplier', 'hourlyMultiplier', 'flatRate', 'hourlyRate', 'minimumFare', 'stopFee'];

describe('booking before sign-in', () => {
  it('shows a visitor the vehicles, without the rate card behind the prices', async () => {
    const res = await request(server).get('/vehicle-classes');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const v of res.body.data) {
      expect(v.value).toBeTruthy();
      expect(v.label).toBeTruthy();
      expect(v.seats).toBeGreaterThan(0);
      for (const f of PRICING_FIELDS) expect(v, `${v.value}.${f}`).not.toHaveProperty(f);
    }
  });

  it('still gives a signed-in user the full record, pricing included', async () => {
    const admin = await makeUser('admin');
    const res = await request(server).get('/vehicle-classes').set('Authorization', admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toHaveProperty('multiplier');
  });

  it('quotes a visitor a journey', async () => {
    const res = await request(server).get('/pricing/fare-estimate').query(QUOTE);
    expect(res.status).toBe(200);
    expect(res.body.data.fare).toBeGreaterThan(0);
    expect(res.body.data.discount ?? 0).toBe(0);
  });

  it('quotes a signed-in customer the same journey, and a bad token is treated as a visitor', async () => {
    const customer = await makeUser('customer');
    const signedIn = await request(server).get('/pricing/fare-estimate').query(QUOTE).set('Authorization', customer.auth);
    const visitor = await request(server).get('/pricing/fare-estimate').query(QUOTE);
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.data.fare).toBe(visitor.body.data.fare);

    const junk = await request(server).get('/pricing/fare-estimate').query(QUOTE).set('Authorization', 'Bearer not-a-token');
    expect(junk.status).toBe(200);
  });

  it('still rejects a malformed quote request', async () => {
    const res = await request(server).get('/pricing/fare-estimate').query({ city: 'x' });
    expect(res.status).toBe(400);
  });

  it('keeps booking itself behind sign-in', async () => {
    expect((await request(server).post('/bookings').send({})).status).toBe(401);
    expect((await request(server).post('/bookings/checkout/intent').send({})).status).toBe(401);
  });
});
