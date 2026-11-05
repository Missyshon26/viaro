import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { Booking } from '../../src/models/Booking';
import { Driver } from '../../src/models/Driver';
import { Trip } from '../../src/models/Trip';
import { User } from '../../src/models/User';
import { handleStripeEvent } from '../../src/modules/payments/stripeEvents';
import { refundBookingToCard } from '../../src/modules/payments/cardPayments';
import { balanceOf } from '../../src/modules/payments/balance';
import { listen, makeUser, pickupIn, point, resetData, seedCatalogue, startDatabase, stopDatabase } from './harness';

const stripe = vi.hoisted(() => ({
  sessions: [] as { id: string; amount: number; metadata: Record<string, string> }[],
  expired: [] as string[],
  refunds: [] as { paymentIntentId: string; amount: number; idempotencyKey: string }[],
}));

vi.mock('../../src/integrations/paymentGateway', async (orig) => {
  const actual = await orig<typeof import('../../src/integrations/paymentGateway')>();
  return {
    ...actual,
    isStripeEnabled: () => true,
    createCheckoutSession: vi.fn(async (input: { amount: number; metadata: Record<string, string> }) => {
      const id = `cs_test_${stripe.sessions.length + 1}`;
      stripe.sessions.push({ id, amount: input.amount, metadata: input.metadata });
      return { id, url: `https://checkout.stripe.test/${id}`, status: 'open' };
    }),
    expireCheckoutSession: vi.fn(async (id: string) => {
      stripe.expired.push(id);
      return { id, status: 'expired' };
    }),
    retrieveCheckoutSession: vi.fn(async (id: string) => ({ id, status: 'expired', payment_status: 'unpaid' })),
    retrievePaymentIntent: vi.fn(async () => ({ status: 'succeeded', payment_method: { card: { brand: 'visa', last4: '4242' } } })),
    refundToCard: vi.fn(async (input: { paymentIntentId: string; amount: number; idempotencyKey: string }) => {
      const same = stripe.refunds.findIndex((r) => r.idempotencyKey === input.idempotencyKey);
      if (same >= 0) return { id: `re_test_${same + 1}`, amount: Math.round(stripe.refunds[same].amount * 100), status: 'succeeded' };
      stripe.refunds.push(input);
      return { id: `re_test_${stripe.refunds.length}`, amount: Math.round(input.amount * 100), status: 'succeeded' };
    }),
  };
});
vi.mock('../../src/modules/payments/cardPayments', async (orig) => {
  const actual = await orig<typeof import('../../src/modules/payments/cardPayments')>();
  return { ...actual, ensureStripeCustomer: vi.fn(async () => 'cus_test') };
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
  stripe.sessions.length = 0;
  stripe.expired.length = 0;
  stripe.refunds.length = 0;
});

/** A booking an operator made, then marked as paid by card for its whole fare. */
async function paidBooking(vehicleClass = 'sedan') {
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
        vehicleClass,
        tripType: 'point2point',
        city: 'seattle',
        scheduledAt: pickupIn(5),
      },
    });
  const id = String(made.body.data.booking._id);
  const fare = made.body.data.booking.estimatedFare as number;
  await Booking.updateOne(
    { _id: id },
    {
      $set: {
        payment: {
          provider: 'stripe', intentId: 'pi_first', leg: 0, amount: fare, currency: 'USD', status: 'paid',
          brand: 'visa', last4: '4242', refundedAmount: 0, refundIds: [], paidAt: new Date(),
        },
      },
    },
  );
  return { admin, client, id, fare };
}

const change = (auth: string, id: string, body: Record<string, unknown>) =>
  request(server).patch(`/admin/bookings/${id}`).set('Authorization', auth).send({ notifyCustomer: false, ...body });
const upgradeLink = (auth: string, id: string) => request(server).post(`/admin/bookings/${id}/upgrade-link`).set('Authorization', auth);
const refund = (auth: string, id: string, amount: number, requestId = 'req-00001') =>
  request(server).post(`/admin/bookings/${id}/refund`).set('Authorization', auth).send({ amount, requestId });
const reload = async (id: string) => (await Booking.findById(id).lean())!;

const upgradePaid = (sessionId: string, bookingId: string, amount: number) => ({
  type: 'checkout.session.completed',
  data: {
    object: {
      id: sessionId, status: 'complete', payment_status: 'paid', payment_intent: `pi_for_${sessionId}`,
      amount_total: Math.round(amount * 100), currency: 'usd', metadata: { kind: 'booking_upgrade', bookingId },
    },
  },
});

describe('upgrading a paid trip to a dearer vehicle', () => {
  it('moves the fare, leaves the first payment alone, and shows what is owed', async () => {
    const { admin, id, fare } = await paidBooking('sedan');
    const res = await change(admin.auth, id, { vehicleClass: 'suv' });
    expect(res.status).toBe(200);

    const saved = await reload(id);
    expect(saved.vehicleClass).toBe('suv');
    expect(saved.estimatedFare!).toBeGreaterThan(fare);
    expect(saved.payment!.amount).toBe(fare);
    expect(balanceOf(saved)).toBeCloseTo(saved.estimatedFare! - fare, 2);
  });

  it('emails a payment link for exactly the difference, and replaces an older link', async () => {
    const { admin, id, fare } = await paidBooking('sedan');
    await change(admin.auth, id, { vehicleClass: 'suv' });
    const owed = balanceOf(await reload(id));

    const first = await upgradeLink(admin.auth, id);
    expect(first.status).toBe(200);
    expect(first.body.data.amount).toBe(owed);
    expect(stripe.sessions[0]).toMatchObject({ amount: owed, metadata: { kind: 'booking_upgrade', bookingId: id } });
    expect(owed).toBeLessThan((await reload(id)).estimatedFare!);
    expect(fare).toBeGreaterThan(0);

    await upgradeLink(admin.auth, id);
    expect(stripe.expired).toEqual([stripe.sessions[0].id]);
    expect((await reload(id)).upgradeLink!.sessionId).toBe(stripe.sessions[1].id);
  });

  it('records the difference as its own payment when Stripe confirms it, once', async () => {
    const { admin, id } = await paidBooking('sedan');
    await change(admin.auth, id, { vehicleClass: 'suv' });
    const owed = balanceOf(await reload(id));
    await upgradeLink(admin.auth, id);

    const event = upgradePaid(stripe.sessions[0].id, id, owed);
    await handleStripeEvent(event as never);
    await handleStripeEvent(event as never); // a replayed webhook

    const saved = await reload(id);
    expect(saved.extraPayments).toHaveLength(1);
    expect(saved.extraPayments![0]).toMatchObject({ amount: owed, intentId: `pi_for_${stripe.sessions[0].id}`, reason: 'upgrade', last4: '4242' });
    expect(saved.upgradeLink).toBeUndefined();
    expect(balanceOf(saved)).toBe(0);
    expect(saved.payment!.intentId).toBe('pi_first');
  });

  it('refuses a link when the booking is unpaid, or nothing more is owed', async () => {
    const { admin, id } = await paidBooking('sedan');
    expect((await upgradeLink(admin.auth, id)).status).toBe(409); // fare equals what was paid
    await Booking.updateOne({ _id: id }, { $unset: { payment: 1 } });
    expect((await upgradeLink(admin.auth, id)).status).toBe(409); // not paid: the ordinary link applies
    expect(stripe.sessions).toHaveLength(0);
  });

  it('refunds an upgrade payment that lands on a booking that was cancelled meanwhile', async () => {
    const { admin, id } = await paidBooking('sedan');
    await change(admin.auth, id, { vehicleClass: 'suv' });
    const owed = balanceOf(await reload(id));
    await upgradeLink(admin.auth, id);
    await Booking.updateOne({ _id: id }, { $set: { status: 'cancelled' } });

    await handleStripeEvent(upgradePaid(stripe.sessions[0].id, id, owed) as never);

    expect((await reload(id)).extraPayments ?? []).toHaveLength(0);
    expect(stripe.refunds).toEqual([expect.objectContaining({ paymentIntentId: `pi_for_${stripe.sessions[0].id}`, amount: owed })]);
  });
});

describe('downgrading a paid trip to a cheaper vehicle', () => {
  it('shows the overpayment, and a refund of it settles the booking', async () => {
    const { admin, id, fare } = await paidBooking('suv');
    const res = await change(admin.auth, id, { vehicleClass: 'sedan' });
    expect(res.status).toBe(200);

    const saved = await reload(id);
    expect(saved.estimatedFare!).toBeLessThan(fare);
    const over = -balanceOf(saved);
    expect(over).toBeGreaterThan(0);

    const done = await refund(admin.auth, id, over);
    expect(done.status).toBe(200);
    expect(stripe.refunds).toEqual([expect.objectContaining({ paymentIntentId: 'pi_first', amount: over })]);
    expect(balanceOf(await reload(id))).toBe(0);
  });
});

describe('refunds after an upgrade payment', () => {
  /** A paid booking that also holds a $60 upgrade payment. */
  async function upgraded() {
    const base = await paidBooking('sedan');
    await Booking.updateOne(
      { _id: base.id },
      {
        $set: {
          extraPayments: [
            { intentId: 'pi_extra', sessionId: 'cs_x', amount: 60, currency: 'USD', reason: 'upgrade', refundedAmount: 0, refundIds: [], paidAt: new Date() },
          ],
        },
      },
    );
    return base;
  }

  it('an admin refund larger than the first payment draws on the upgrade payment too', async () => {
    const { admin, id, fare } = await upgraded();
    const res = await refund(admin.auth, id, fare + 25);
    expect(res.status).toBe(200);
    expect(stripe.refunds.map((r) => [r.paymentIntentId, r.amount])).toEqual([
      ['pi_first', fare],
      ['pi_extra', 25],
    ]);
    const saved = await reload(id);
    expect(saved.payment!.refundedAmount).toBe(fare);
    expect(saved.extraPayments![0].refundedAmount).toBe(25);
    expect((await refund(admin.auth, id, 35.01, 'req-00002')).status).toBe(400); // only $35 is left
  });

  it('a cancellation refund returns the upgrade payment as well as the first one', async () => {
    const { id, fare } = await upgraded();
    const refunded = await refundBookingToCard(id, 100, 'test_cancel');
    expect(refunded).toBe(fare + 60);
    expect(stripe.refunds.map((r) => [r.paymentIntentId, r.amount])).toEqual([
      ['pi_first', fare],
      ['pi_extra', 60],
    ]);
    const saved = await reload(id);
    expect(saved.payment!.status).toBe('refunded');
    expect(saved.extraPayments![0].refundedAmount).toBe(60);
  });
});

describe('the vehicle on a trip that has a chauffeur', () => {
  async function withTrip(status: 'accepted' | 'completed', settled = false) {
    const base = await paidBooking('sedan');
    const driverUser = await User.create({ role: 'driver', name: 'Dee Driver', email: 'dee@example.com', phone: '+12065550111', passwordHash: 'x' });
    const driver = await Driver.create({ userId: driverUser._id, vehicleClass: 'sedan', status: 'offline' });
    const trip = await Trip.create({ bookingId: base.id, driverId: driver._id, status, settled, fareAmount: base.fare, timestamps: {} });
    return { ...base, trip };
  }

  it('moves the trip fare with the booking, so the invoice and the end-of-ride charge match', async () => {
    const { admin, id, trip } = await withTrip('accepted');
    await change(admin.auth, id, { vehicleClass: 'suv' });
    const booking = await reload(id);
    expect((await Trip.findById(trip._id).lean())!.fareAmount).toBe(booking.estimatedFare);
  });

  it('refuses a vehicle change once the trip is completed and settled', async () => {
    const { admin, id, trip, fare } = await withTrip('completed', true);
    const res = await change(admin.auth, id, { vehicleClass: 'suv' });
    expect(res.status).toBe(409);
    expect((await reload(id)).vehicleClass).toBe('sedan');
    expect((await Trip.findById(trip._id).lean())!.fareAmount).toBe(fare);
  });
});
