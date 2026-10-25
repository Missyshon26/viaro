import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { Booking } from '../../src/models/Booking';
import { handleStripeEvent } from '../../src/modules/payments/stripeEvents';
import { listen, makeUser, pickupIn, point, resetData, seedCatalogue, startDatabase, stopDatabase } from './harness';

const stripe = vi.hoisted(() => ({
  sessions: [] as { id: string; amount: number; metadata: Record<string, string>; expiresAt: number }[],
  expired: [] as string[],
  refunds: [] as { paymentIntentId: string; amount: number }[],
  failExpire: false,
  paid: new Set<string>(),
}));

vi.mock('../../src/integrations/paymentGateway', async (orig) => {
  const actual = await orig<typeof import('../../src/integrations/paymentGateway')>();
  return {
    ...actual,
    isStripeEnabled: () => true,
    createCheckoutSession: vi.fn(async (input: { amount: number; metadata: Record<string, string>; expiresAt: number }) => {
      const id = `cs_test_${stripe.sessions.length + 1}`;
      stripe.sessions.push({ id, amount: input.amount, metadata: input.metadata, expiresAt: input.expiresAt });
      return { id, url: `https://checkout.stripe.test/${id}`, status: 'open' };
    }),
    expireCheckoutSession: vi.fn(async (id: string) => {
      if (stripe.failExpire) throw new actual.StripeError('already ended', 400);
      stripe.expired.push(id);
      return { id, status: 'expired' };
    }),
    retrieveCheckoutSession: vi.fn(async (id: string) => ({
      id,
      status: stripe.paid.has(id) ? 'complete' : 'expired',
      payment_status: stripe.paid.has(id) ? 'paid' : 'unpaid',
      payment_intent: `pi_for_${id}`,
      amount_total: Math.round((stripe.sessions.find((s) => s.id === id)?.amount ?? 0) * 100),
      currency: 'usd',
      metadata: stripe.sessions.find((s) => s.id === id)?.metadata ?? {},
    })),
    retrievePaymentIntent: vi.fn(async () => ({
      status: 'succeeded',
      payment_method: { card: { brand: 'visa', last4: '4242' } },
    })),
    refundToCard: vi.fn(async (input: { paymentIntentId: string; amount: number }) => {
      stripe.refunds.push({ paymentIntentId: input.paymentIntentId, amount: input.amount });
    }),
  };
});
vi.mock('../../src/modules/payments/cardPayments', async (orig) => {
  const actual = await orig<typeof import('../../src/modules/payments/cardPayments')>();
  return { ...actual, ensureStripeCustomer: vi.fn(async () => 'cus_test') };
});
vi.mock('../../src/jobs/cancellationWindow.job', () => ({ scheduleCancellationWindowCheck: vi.fn(async () => undefined) }));
vi.mock('../../src/modules/dispatch/dispatch.service', () => ({ receiveBookingRequest: vi.fn(async () => undefined) }));

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
  stripe.sessions.length = 0;
  stripe.expired.length = 0;
  stripe.refunds.length = 0;
  stripe.failExpire = false;
  stripe.paid.clear();
});

const tripBody = () => ({
  pickup: point('Sea-Tac Airport'),
  drop: point('Hotel Andra, Seattle'),
  vehicleClass: 'sedan',
  tripType: 'airport',
  flightDetails: { flightNumber: 'AS123' },
  city: 'seattle',
  scheduledAt: pickupIn(5),
});

async function adminBooking() {
  const admin = await makeUser('admin');
  const client = await makeUser('customer');
  const res = await request(server)
    .post('/admin/bookings')
    .set('Authorization', admin.auth)
    .send({ customerId: client.id, trip: tripBody() });
  return { admin, client, id: String(res.body.data.booking._id) as string, fare: res.body.data.booking.estimatedFare as number };
}

const sendLink = (auth: string, id: string) => request(server).post(`/admin/bookings/${id}/payment-link`).set('Authorization', auth);

const completed = (sessionId: string, bookingId: string, amount: number) => ({
  type: 'checkout.session.completed',
  data: {
    object: {
      id: sessionId,
      status: 'complete',
      payment_status: 'paid',
      payment_intent: `pi_for_${sessionId}`,
      amount_total: Math.round(amount * 100),
      currency: 'usd',
      metadata: { kind: 'booking_link', bookingId },
    },
  },
});

describe('sending a payment link', () => {
  it('asks Stripe for the booking fare and stores the link', async () => {
    const { admin, id, fare } = await adminBooking();
    const res = await sendLink(admin.auth, id);
    expect(res.status).toBe(200);
    expect(res.body.data.url).toBe('https://checkout.stripe.test/cs_test_1');
    expect(res.body.data.amount).toBe(fare);
    expect(stripe.sessions).toHaveLength(1);
    expect(stripe.sessions[0]).toMatchObject({ amount: fare, metadata: { kind: 'booking_link', bookingId: id } });

    const saved = await Booking.findById(id).lean();
    expect(saved!.paymentLink).toMatchObject({ sessionId: 'cs_test_1', amount: fare });
    expect(saved!.payment).toBeUndefined();
  });

  it('keeps the link under 24 hours, which is all Stripe allows', async () => {
    const { admin, id } = await adminBooking();
    await sendLink(admin.auth, id);
    const seconds = stripe.sessions[0].expiresAt - Math.floor(Date.now() / 1000);
    expect(seconds).toBeGreaterThan(23 * 3600);
    expect(seconds).toBeLessThanOrEqual(24 * 3600);
  });

  it('expires the previous link before issuing a new one', async () => {
    const { admin, id } = await adminBooking();
    await sendLink(admin.auth, id);
    const second = await sendLink(admin.auth, id);
    expect(second.status).toBe(200);
    expect(stripe.expired).toEqual(['cs_test_1']);
    expect((await Booking.findById(id).lean())!.paymentLink!.sessionId).toBe('cs_test_2');
  });

  it('refuses a booking that is cancelled, already paid or unknown', async () => {
    const { admin, id } = await adminBooking();
    await Booking.updateOne({ _id: id }, { $set: { status: 'cancelled' } });
    expect((await sendLink(admin.auth, id)).status).toBe(409);

    await Booking.updateOne({ _id: id }, { $set: { status: 'pending', payment: { provider: 'stripe', intentId: 'pi_x', leg: 0, amount: 50, currency: 'USD', status: 'paid', refundedAmount: 0, refundIds: [], paidAt: new Date() } } });
    expect((await sendLink(admin.auth, id)).status).toBe(409);
    expect((await sendLink(admin.auth, '5f9d88b8b54764421b7156c9')).status).toBe(404);
    expect(stripe.sessions).toHaveLength(0);
  });

  it('is admin only', async () => {
    const { client, id } = await adminBooking();
    expect((await sendLink(client.auth, id)).status).toBe(403);
    expect((await sendLink('', id)).status).toBe(401);
  });
});

describe('when the link is paid', () => {
  it('marks the booking paid, exactly once, however many times Stripe says so', async () => {
    const { admin, id, fare } = await adminBooking();
    await sendLink(admin.auth, id);
    await handleStripeEvent(completed('cs_test_1', id, fare));
    await handleStripeEvent(completed('cs_test_1', id, fare));

    const saved = await Booking.findById(id).lean();
    expect(saved!.payment).toMatchObject({
      provider: 'stripe',
      intentId: 'pi_for_cs_test_1',
      amount: fare,
      status: 'paid',
      brand: 'visa',
      last4: '4242',
      leg: 0,
    });
    expect(stripe.refunds).toHaveLength(0);
  });

  it('refunds a payment that arrives after the booking was cancelled', async () => {
    const { admin, id, fare } = await adminBooking();
    await sendLink(admin.auth, id);
    await Booking.updateOne({ _id: id }, { $set: { status: 'cancelled' } });
    await handleStripeEvent(completed('cs_test_1', id, fare));
    expect((await Booking.findById(id).lean())!.payment).toBeUndefined();
    expect(stripe.refunds).toEqual([{ paymentIntentId: 'pi_for_cs_test_1', amount: fare }]);
  });

  it('refunds a second payment on a booking that is already paid', async () => {
    const { admin, id, fare } = await adminBooking();
    await sendLink(admin.auth, id);
    await handleStripeEvent(completed('cs_test_1', id, fare));
    await handleStripeEvent(completed('cs_other', id, fare));
    expect((await Booking.findById(id).lean())!.payment!.intentId).toBe('pi_for_cs_test_1');
    expect(stripe.refunds).toEqual([{ paymentIntentId: 'pi_for_cs_other', amount: fare }]);
  });

  it('ignores unpaid sessions and payments that are not payment links', async () => {
    const { admin, id, fare } = await adminBooking();
    await sendLink(admin.auth, id);
    const unpaid = completed('cs_test_1', id, fare);
    (unpaid.data.object as { payment_status: string }).payment_status = 'unpaid';
    await handleStripeEvent(unpaid);
    const other = completed('cs_test_1', id, fare);
    (other.data.object.metadata as { kind: string }).kind = 'booking';
    await handleStripeEvent(other);
    expect((await Booking.findById(id).lean())!.payment).toBeUndefined();
  });

  it('tells the operator when the previous link was paid just before a resend', async () => {
    const { admin, id, fare } = await adminBooking();
    await sendLink(admin.auth, id);
    stripe.failExpire = true;
    stripe.paid.add('cs_test_1');
    const res = await sendLink(admin.auth, id);
    expect(res.status).toBe(409);
    expect((await Booking.findById(id).lean())!.payment).toMatchObject({ amount: fare });
    expect(stripe.sessions).toHaveLength(1);
  });
});
