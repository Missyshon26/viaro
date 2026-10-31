import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { Booking } from '../../src/models/Booking';
import { User } from '../../src/models/User';
import { listen, accessTokenFor, pickupIn, point, resetData, seedCatalogue, startDatabase, stopDatabase } from './harness';

/**
 * Multi-leg card checkout, end to end against a real database. The payment gateway is a
 * stand-in (never the real Stripe): what is under test is what this system does with a
 * payment — price every leg, book every leg once it succeeds, tie them together, refuse a
 * nonsense itinerary.
 */
const gateway = vi.hoisted(() => ({
  opened: [] as { id: string; amount: number; metadata: Record<string, string> }[],
  refunds: [] as { amount: number }[],
}));

vi.mock('../../src/integrations/paymentGateway', () => ({
  isStripeEnabled: () => true,
  createPaymentIntent: vi.fn(async (input: { amount: number; metadata: Record<string, string> }) => {
    const id = `pi_test_${gateway.opened.length + 1}`;
    gateway.opened.push({ id, amount: input.amount, metadata: input.metadata });
    return { id, client_secret: `${id}_secret` };
  }),
  retrievePaymentIntent: vi.fn(async (id: string) => {
    const opened = gateway.opened.find((o) => o.id === id);
    return {
      status: 'succeeded',
      amount_received: Math.round((opened?.amount ?? 0) * 100),
      currency: 'usd',
      metadata: opened?.metadata ?? {},
      payment_method: { card: { brand: 'visa', last4: '4242' } },
    };
  }),
  refundToCard: vi.fn(async (input: { amount: number }) => {
    gateway.refunds.push({ amount: input.amount });
  }),
}));
vi.mock('../../src/modules/payments/cardPayments', async (orig) => {
  const actual = await orig<typeof import('../../src/modules/payments/cardPayments')>();
  return {
    ...actual,
    ensureStripeCustomer: vi.fn(async () => 'cus_test'),
    saveCardFromIntent: vi.fn(async () => undefined),
  };
});
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
  gateway.opened.length = 0;
  gateway.refunds.length = 0;
});

async function customer() {
  const user = await User.create({ role: 'customer', name: 'Pat', email: 'pat@example.com', phone: '+12065550111', passwordHash: 'x' });
  return { id: String(user._id), auth: await accessTokenFor(String(user._id), 'customer') };
}
async function admin() {
  const user = await User.create({ role: 'admin', name: 'Ops', email: 'ops@example.com', phone: '+12065550100', passwordHash: 'x' });
  return accessTokenFor(String(user._id), 'admin');
}

const leg = (label: string, scheduledAt: string, over: Record<string, unknown> = {}) => ({
  pickup: point(`${label} pickup`),
  drop: point(`${label} drop-off`),
  vehicleClass: 'sedan',
  tripType: 'point2point',
  city: 'seattle',
  passengers: 2,
  scheduledAt,
  ...over,
});

/** Three legs a day apart, in different vehicles, one with a stop and one an airport pickup. */
const itinerary = () => [
  leg('Leg one', pickupIn(10), { stops: [point('Pike Place Market')] }),
  leg('Leg two', pickupIn(11), { vehicleClass: 'mpv' }),
  leg('Leg three', pickupIn(12), { tripType: 'airport', flightDetails: { flightNumber: 'AS123' } }),
];

describe('multi-city checkout', () => {
  it('prices each leg with its own vehicle and charges one total', async () => {
    const { auth } = await customer();
    const res = await request(server).post('/bookings/checkout/intent').set('Authorization', auth).send({ legs: itinerary() });

    expect(res.status).toBe(201);
    // sedan 140 + one $15 stop · MPV 172 · sedan airport 140.
    expect(res.body.data.fares).toEqual([155, 172, 140]);
    expect(res.body.data.amount).toBe(467);
    expect(gateway.opened).toHaveLength(1);
    expect(gateway.opened[0].amount).toBe(467);
  });

  it('books every leg once paid, tied together and each holding its own share', async () => {
    const { auth, id } = await customer();
    const intent = await request(server).post('/bookings/checkout/intent').set('Authorization', auth).send({ legs: itinerary() });
    const paymentIntentId = intent.body.data.paymentIntentId;

    const done = await request(server).post('/bookings/checkout').set('Authorization', auth).send({ paymentIntentId });
    expect([200, 201]).toContain(done.status);
    expect(done.body.data.bookings).toHaveLength(3);
    expect(done.body.data.error).toBeUndefined();

    const stored = await Booking.find({ 'payment.intentId': paymentIntentId }).sort({ 'journey.index': 1 }).lean();
    expect(stored.map((b) => b.journey)).toEqual([
      { index: 0, count: 3 },
      { index: 1, count: 3 },
      { index: 2, count: 3 },
    ]);
    expect(stored.map((b) => b.payment?.leg)).toEqual([0, 1, 2]);
    expect(stored.map((b) => b.payment?.amount)).toEqual([155, 172, 140]);
    expect(stored.map((b) => b.estimatedFare)).toEqual([155, 172, 140]);
    expect(stored.map((b) => b.vehicleClass)).toEqual(['sedan', 'mpv', 'sedan']);
    expect(stored.every((b) => String(b.customerId) === id)).toBe(true);
    expect(stored[0].stops).toHaveLength(1);
    expect(stored[0].fareBreakdown).toMatchObject({ classFare: 140, stopFee: 15 });
    expect(stored[2].flightDetails).toMatchObject({ flightNumber: 'AS123' });
    expect(gateway.refunds).toHaveLength(0);
  });

  it('shows every leg from any one of them, to the customer and to an admin', async () => {
    const { auth } = await customer();
    const intent = await request(server).post('/bookings/checkout/intent').set('Authorization', auth).send({ legs: itinerary() });
    const paymentIntentId = intent.body.data.paymentIntentId;
    await request(server).post('/bookings/checkout').set('Authorization', auth).send({ paymentIntentId });

    const middle = (await Booking.findOne({ 'payment.intentId': paymentIntentId, 'journey.index': 1 }))!;
    for (const who of [auth, await admin()]) {
      const read = await request(server).get(`/bookings/${middle._id}`).set('Authorization', who);
      expect(read.status).toBe(200);
      expect(read.body.data.journey).toEqual({ index: 1, count: 3 });
      expect(read.body.data.journeyLegs).toHaveLength(3);
      expect(read.body.data.journeyLegs.map((l: { journey: { index: number } }) => l.journey.index)).toEqual([0, 1, 2]);
    }
  });

  it('is safe to complete twice: the same bookings come back and none are duplicated', async () => {
    const { auth } = await customer();
    const intent = await request(server).post('/bookings/checkout/intent').set('Authorization', auth).send({ legs: itinerary() });
    const paymentIntentId = intent.body.data.paymentIntentId;

    const first = await request(server).post('/bookings/checkout').set('Authorization', auth).send({ paymentIntentId });
    const second = await request(server).post('/bookings/checkout').set('Authorization', auth).send({ paymentIntentId });

    expect(second.body.data.bookings.map((b: { _id: string }) => b._id)).toEqual(
      first.body.data.bookings.map((b: { _id: string }) => b._id),
    );
    expect(await Booking.countDocuments({ 'payment.intentId': paymentIntentId })).toBe(3);
  });

  it('issues a receipt for a paid leg that names its place in the journey', async () => {
    const { auth } = await customer();
    const intent = await request(server).post('/bookings/checkout/intent').set('Authorization', auth).send({ legs: itinerary() });
    const paymentIntentId = intent.body.data.paymentIntentId;
    await request(server).post('/bookings/checkout').set('Authorization', auth).send({ paymentIntentId });
    const second = (await Booking.findOne({ 'payment.intentId': paymentIntentId, 'journey.index': 1 }))!;

    const receipt = await request(server).get(`/bookings/${second._id}/documents/receipt`).set('Authorization', auth).buffer(true);
    expect(receipt.status).toBe(200);
    expect(Buffer.from(receipt.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('refuses an itinerary whose legs are out of order, too close together, or too many', async () => {
    const { auth } = await customer();
    const send = (legs: unknown[]) => request(server).post('/bookings/checkout/intent').set('Authorization', auth).send({ legs });

    expect((await send([leg('A leg', pickupIn(12)), leg('B leg', pickupIn(10))])).status).toBe(400);
    expect((await send([leg('A leg', pickupIn(10, 9)), leg('B leg', pickupIn(10, 9))])).status).toBe(400);
    const six = Array.from({ length: 6 }, (_, i) => leg(`Leg ${i}`, pickupIn(10 + i)));
    expect((await send(six)).status).toBe(400);
    expect(gateway.opened).toHaveLength(0);
  });

  it('opens no payment when any leg cannot be priced', async () => {
    const { auth } = await customer();
    const res = await request(server)
      .post('/bookings/checkout/intent')
      .set('Authorization', auth)
      .send({ legs: [leg('A leg', pickupIn(10)), leg('B leg', pickupIn(11), { vehicleClass: 'no-such-class' })] });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(gateway.opened).toHaveLength(0);
  });

  it('refuses to complete someone else\'s payment', async () => {
    const owner = await customer();
    const intent = await request(server).post('/bookings/checkout/intent').set('Authorization', owner.auth).send({ legs: itinerary() });
    const other = await User.create({ role: 'customer', name: 'Lee', email: 'lee@example.com', phone: '+12065550222', passwordHash: 'x' });
    const otherAuth = await accessTokenFor(String(other._id), 'customer');

    const res = await request(server)
      .post('/bookings/checkout')
      .set('Authorization', otherAuth)
      .send({ paymentIntentId: intent.body.data.paymentIntentId });
    expect(res.status).toBe(403);
    expect(await Booking.countDocuments({})).toBe(0);
  });
});
