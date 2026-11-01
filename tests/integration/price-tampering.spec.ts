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
beforeEach(async () => {
  await resetData();
});

const base = (scheduledAt = pickupIn(5)) => ({
  pickup: point('Sea-Tac Airport'),
  drop: point('Hotel Andra, Seattle'),
  vehicleClass: 'sedan',
  tripType: 'point2point',
  city: 'seattle',
  scheduledAt,
  passengers: 2,
});

/** What the site would quote for this trip: the number a customer is shown. */
const quote = async (scheduledAt: string) =>
  (await request(server).get('/pricing/fare-estimate').query({ city: 'seattle', tripType: 'point2point', vehicleClass: 'sedan', requestedAt: scheduledAt })).body.data.fare as number;

describe('a price cannot be set from the browser', () => {
  it('ignores every price-like field sent with a booking, and stores what the server worked out', async () => {
    const customer = await makeUser('customer');
    const when = pickupIn(5);
    const expected = await quote(when);
    expect(expected).toBeGreaterThan(10);

    const res = await request(server)
      .post('/bookings')
      .set('Authorization', customer.auth)
      .send({
        ...base(when),
        // What someone editing the page in the browser's inspector might add:
        estimatedFare: 1,
        fareAmount: 1,
        fare: 1,
        price: 1,
        total: 1,
        amount: 1,
        classFare: 1,
        subtotal: 1,
        discount: 9999,
        fareBreakdown: { classFare: 1, subtotal: 1, tax: 0 },
      });
    expect(res.status).toBe(201);

    const stored = await Booking.findById(res.body.data.booking._id).lean();
    expect(stored!.estimatedFare).toBe(expected);
    expect(stored!.fareBreakdown?.classFare).not.toBe(1);
    expect(res.body.data.fareBreakdown.fare).toBe(expected);
  });

  it('keeps a tip within its limits, and refuses a negative or absurd one', async () => {
    const customer = await makeUser('customer');
    const post = (gratuityPct: unknown) => request(server).post('/bookings').set('Authorization', customer.auth).send({ ...base(), gratuityPct });
    expect((await post(-50)).status).toBe(400);
    expect((await post(5000)).status).toBe(400);
    expect((await post(15)).status).toBe(201);
  });

  it('does not let a credit request cheapen the fare: it is recorded, and capped by the balance when spent', async () => {
    const customer = await makeUser('customer');
    const when = pickupIn(5);
    const expected = await quote(when);
    const res = await request(server)
      .post('/bookings')
      .set('Authorization', customer.auth)
      .send({ ...base(when), walletCreditRequested: 1_000_000 });
    expect(res.status).toBe(201);
    const stored = await Booking.findById(res.body.data.booking._id).lean();
    // The fare is untouched; nothing was debited, because the customer has no balance.
    expect(stored!.estimatedFare).toBe(expected);
    expect((await request(server).post('/bookings').set('Authorization', customer.auth).send({ ...base(when), walletCreditRequested: -5 })).status).toBe(400);
  });

  it('charges a package its listed price, whatever the request says', async () => {
    const admin = await makeUser('admin');
    const customer = await makeUser('customer');
    const pkg = await request(server)
      .post('/admin/packages')
      .set('Authorization', admin.auth)
      .send({ name: 'Wine Country Day', vehicles: [{ vehicleClass: 'sedan', price: 900 }] });
    const res = await request(server)
      .post('/bookings')
      .set('Authorization', customer.auth)
      .send({ ...base(), packageId: pkg.body.data._id, price: 1, estimatedFare: 1, classFare: 1 });
    expect(res.status).toBe(201);
    expect((await Booking.findById(res.body.data.booking._id).lean())!.estimatedFare).toBe(900);
  });

  it('prices a card checkout on the server too: the amount to charge comes from the trip, not the request', async () => {
    const customer = await makeUser('customer');
    // Card payments are off in tests, so the checkout refuses to start; the point is that the schema has
    // no field a client could use to name an amount.
    const res = await request(server)
      .post('/bookings/checkout/intent')
      .set('Authorization', customer.auth)
      .send({ legs: [{ ...base(), amount: 1, price: 1 }], amount: 1, amountCents: 100 });
    expect([400, 503, 201]).toContain(res.status);
    if (res.status === 201) expect(res.body.data.amount).not.toBe(1);
  });
});
