import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { Booking } from '../../src/models/Booking';
import { listen, makeUser, pickupIn, point, resetData, seedCatalogue, startDatabase, stopDatabase } from './harness';

const stripe = vi.hoisted(() => ({
  refunds: [] as { paymentIntentId: string; amount: number; idempotencyKey: string; metadata: Record<string, string> }[],
  fail: null as null | { message: string },
}));

vi.mock('../../src/integrations/paymentGateway', async (orig) => {
  const actual = await orig<typeof import('../../src/integrations/paymentGateway')>();
  return {
    ...actual,
    isStripeEnabled: () => true,
    refundToCard: vi.fn(async (input: { paymentIntentId: string; amount: number; idempotencyKey: string; metadata: Record<string, string> }) => {
      if (stripe.fail) throw new actual.StripeError(stripe.fail.message, 400);
      // Stripe answers a repeated idempotency key with the same refund.
      const same = stripe.refunds.findIndex((r) => r.idempotencyKey === input.idempotencyKey);
      if (same >= 0) return { id: `re_test_${same + 1}`, amount: Math.round(stripe.refunds[same].amount * 100), status: 'succeeded' };
      stripe.refunds.push(input);
      return { id: `re_test_${stripe.refunds.length}`, amount: Math.round(input.amount * 100), status: 'succeeded' };
    }),
  };
});
vi.mock('../../src/jobs/cancellationWindow.job', () => ({ scheduleCancellationWindowCheck: vi.fn(async () => undefined) }));

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
  stripe.refunds.length = 0;
  stripe.fail = null;
});

/** A booking an operator made, marked as paid by card ($100). */
async function paidBooking(paid = 100) {
  const admin = await makeUser('admin');
  const client = await makeUser('customer');
  const made = await request(server)
    .post('/admin/bookings')
    .set('Authorization', admin.auth)
    .send({
      customerId: client.id,
      trip: {
        pickup: point('Sea-Tac Airport'),
        drop: point('Hotel Andra, Seattle'),
        vehicleClass: 'sedan',
        tripType: 'point2point',
        city: 'seattle',
        scheduledAt: pickupIn(5),
      },
    });
  const id = String(made.body.data.booking._id);
  await Booking.updateOne(
    { _id: id },
    { $set: { payment: { provider: 'stripe', intentId: 'pi_paid', leg: 0, amount: paid, currency: 'USD', status: 'paid', brand: 'visa', last4: '4242', refundedAmount: 0, refundIds: [], paidAt: new Date() } } },
  );
  return { admin, client, id };
}

let seq = 0;
const refund = (auth: string, id: string, body: Record<string, unknown>) =>
  request(server)
    .post(`/admin/bookings/${id}/refund`)
    .set('Authorization', auth)
    .send({ requestId: `req_${Date.now()}_${seq++}`, ...body });

describe('POST /admin/bookings/:id/refund', () => {
  it('refunds part of the payment and records it', async () => {
    const { admin, id } = await paidBooking();
    const res = await refund(admin.auth, id, { amount: 30, note: 'Late pickup' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ refunded: 30, payment: { refundedAmount: 30, status: 'partially_refunded' } });
    expect(stripe.refunds[0]).toMatchObject({ paymentIntentId: 'pi_paid', amount: 30 });
    expect(stripe.refunds[0].metadata).toMatchObject({ bookingId: id, reason: 'admin_refund', note: 'Late pickup' });
  });

  it('refunds the rest and then marks it fully refunded, without cancelling the ride', async () => {
    const { admin, id } = await paidBooking();
    await refund(admin.auth, id, { amount: 30 });
    const res = await refund(admin.auth, id, { amount: 70 });
    expect(res.status).toBe(200);
    expect(res.body.data.payment).toMatchObject({ refundedAmount: 100, status: 'refunded' });
    expect((await Booking.findById(id).lean())!.status).toBe('pending');
  });

  it('refuses more than is left, zero, and a booking already fully refunded', async () => {
    const { admin, id } = await paidBooking();
    expect((await refund(admin.auth, id, { amount: 100.01 })).status).toBe(400);
    expect((await refund(admin.auth, id, { amount: 0 })).status).toBe(400);
    expect((await refund(admin.auth, id, { amount: -5 })).status).toBe(400);
    await refund(admin.auth, id, { amount: 100 });
    expect((await refund(admin.auth, id, { amount: 1 })).status).toBe(409);
    expect(stripe.refunds).toHaveLength(1);
  });

  it('counts a repeated request once', async () => {
    const { admin, id } = await paidBooking();
    const body = { amount: 25, requestId: 'req_double_click_1' };
    await request(server).post(`/admin/bookings/${id}/refund`).set('Authorization', admin.auth).send(body);
    await request(server).post(`/admin/bookings/${id}/refund`).set('Authorization', admin.auth).send(body);
    expect(stripe.refunds).toHaveLength(1);
    expect((await Booking.findById(id).lean())!.payment!.refundedAmount).toBe(25);
  });

  it('says so when the booking was not paid by card', async () => {
    const { admin, id } = await paidBooking();
    await Booking.updateOne({ _id: id }, { $unset: { payment: 1 } });
    const res = await refund(admin.auth, id, { amount: 10 });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/no card payment/i);
  });

  it('passes Stripe\'s own reason back and records nothing when Stripe refuses', async () => {
    const { admin, id } = await paidBooking();
    stripe.fail = { message: 'Charge has already been refunded.' };
    const res = await refund(admin.auth, id, { amount: 10 });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/already been refunded/);
    expect((await Booking.findById(id).lean())!.payment!.refundedAmount).toBe(0);
  });

  it('needs a request id, a real booking, and an admin', async () => {
    const { admin, client, id } = await paidBooking();
    const bare = await request(server).post(`/admin/bookings/${id}/refund`).set('Authorization', admin.auth).send({ amount: 5 });
    expect(bare.status).toBe(400);
    expect((await refund(admin.auth, '5f9d88b8b54764421b7156c9', { amount: 5 })).status).toBe(404);
    expect((await refund(client.auth, id, { amount: 5 })).status).toBe(403);
    expect((await refund('', id, { amount: 5 })).status).toBe(401);
    expect(stripe.refunds).toHaveLength(0);
  });
});
