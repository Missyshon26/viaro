import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { handleStripeEvent } from '../../src/modules/payments/stripeEvents';
import { Booking } from '../../src/models/Booking';
import { User } from '../../src/models/User';
import { listen, accessTokenFor, pickupIn, point, resetData, seedCatalogue, startDatabase, stopDatabase } from './harness';

/**
 * Pressing Pay emails the customer the unpaid invoice (reservations on BCC), and the booking
 * made once the card succeeds carries that same invoice number — as on the old site.
 */
const mail = vi.hoisted(() => ({
  seq: 0,
  sent: [] as Record<string, any>[],
  opened: [] as { id: string; amount: number; metadata: Record<string, string> }[],
  refunds: [] as { paymentIntentId: string; amount: number }[],
  expired: [] as string[],
  cancelled: [] as string[],
}));

vi.mock('../../src/config/env', async (orig) => ({ ...(await orig<typeof import('../../src/config/env')>()), isTest: false }));
vi.mock('../../src/integrations/email', () => ({
  sendEmail: vi.fn(async (m: Record<string, any>) => {
    mail.sent.push(m);
    return { sent: true, provider: 'test' };
  }),
}));
vi.mock('../../src/integrations/paymentGateway', () => ({
  isStripeEnabled: () => true,
  createPaymentIntent: vi.fn(async (input: { amount: number; metadata: Record<string, string> }) => {
    const id = `pi_test_${++mail.seq}`;
    mail.opened.push({ id, amount: input.amount, metadata: input.metadata });
    return { id, client_secret: `${id}_secret` };
  }),
  retrievePaymentIntent: vi.fn(async (id: string) => {
    const o = mail.opened.find((x) => x.id === id) ?? (id === 'pi_link_1' ? { amount: mail.opened[0]?.amount ?? 0, metadata: {} } : undefined);
    return { status: 'succeeded', amount_received: Math.round((o?.amount ?? 0) * 100), currency: 'usd', metadata: o?.metadata ?? {}, payment_method: { card: { brand: 'visa', last4: '4242' } } };
  }),
  refundToCard: vi.fn(async (r: { paymentIntentId: string; amount: number }) => {
    mail.refunds.push({ paymentIntentId: r.paymentIntentId, amount: r.amount });
  }),
  createCheckoutSession: vi.fn(async () => ({ id: 'cs_test_1', url: 'https://pay.test/cs_test_1' })),
  expireCheckoutSession: vi.fn(async (id: string) => {
    mail.expired.push(id);
  }),
  cancelPaymentIntent: vi.fn(async (id: string) => {
    mail.cancelled.push(id);
  }),
}));
vi.mock('../../src/modules/payments/cardPayments', async (orig) => ({
  ...(await orig<typeof import('../../src/modules/payments/cardPayments')>()),
  ensureStripeCustomer: vi.fn(async () => 'cus_test'),
  saveCardFromIntent: vi.fn(async () => undefined),
}));
vi.mock('../../src/jobs/cancellationWindow.job', () => ({ scheduleCancellationWindowCheck: vi.fn(async () => undefined) }));

const http = listen(app);
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
  mail.sent.length = 0;
  mail.opened.length = 0;
  mail.refunds.length = 0;
  mail.expired.length = 0;
  mail.cancelled.length = 0;
});

const leg = (scheduledAt: string) => ({
  pickup: point('Pickup'), drop: point('Drop-off'), vehicleClass: 'sedan', tripType: 'point2point', city: 'seattle', passengers: 2, scheduledAt,
});

describe('pre-payment invoice at Pay click', () => {
  it('emails the unpaid invoice PDF with reservations on BCC, and the booking keeps that number', async () => {
    const user = await User.create({ role: 'customer', name: 'Pat', email: 'pat@example.com', phone: '+12065550111', passwordHash: 'x' });
    const auth = await accessTokenFor(String(user._id), 'customer');

    const intent = await request(http.server).post('/bookings/checkout/intent').set('Authorization', auth).send({ legs: [leg(pickupIn(10))] });
    expect(intent.status).toBe(201);
    await vi.waitFor(() => expect(mail.sent.some((m) => m.to === 'pat@example.com')).toBe(true));

    const invoice = mail.sent.find((m) => m.to === 'pat@example.com')!;
    expect(invoice.subject).toMatch(/Invoice/i);
    expect(invoice.bcc).toBe('reservations@allblacklimoseattle.com');
    expect(invoice.html).toContain('https://pay.test/cs_test_1'); // the Pay Now button
    expect(invoice.attachments).toHaveLength(1);
    expect(invoice.attachments[0].content.subarray(0, 4).toString()).toBe('%PDF');
    expect(await Booking.countDocuments()).toBe(0); // nothing booked until the card succeeds

    await request(http.server).post('/bookings/checkout').set('Authorization', auth).send({ paymentIntentId: intent.body.data.paymentIntentId });
    const booking = await Booking.findOne().lean();
    expect(booking?.tripNo).toBeTruthy();
    expect(invoice.attachments[0].filename).toContain(String(booking!.tripNo));
  });

  async function payClick() {
    const user = await User.create({ role: 'customer', name: 'Pat', email: 'pat@example.com', phone: '+12065550111', passwordHash: 'x' });
    const auth = await accessTokenFor(String(user._id), 'customer');
    const intent = await request(http.server).post('/bookings/checkout/intent').set('Authorization', auth).send({ legs: [leg(pickupIn(10))] });
    await vi.waitFor(() => expect(mail.sent.some((m) => m.to === 'pat@example.com')).toBe(true));
    // let the Pay Now link finish being remembered on the checkout
    await new Promise((r) => setTimeout(r, 100));
    return { auth, paymentIntentId: intent.body.data.paymentIntentId as string };
  }
  const linkPaid = (cardIntent: string) => ({
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_1', payment_status: 'paid', payment_intent: 'pi_link_1', amount_total: 14000, currency: 'usd', metadata: { kind: 'booking_draft_link', paymentIntentId: cardIntent } } },
  });

  it('paying through the emailed link books the trip, closes the card form, and the card form then pays nothing twice', async () => {
    const { auth, paymentIntentId } = await payClick();
    await handleStripeEvent(linkPaid(paymentIntentId));
    const booking = await Booking.findOne().lean();
    expect(booking?.payment?.intentId).toBe('pi_link_1');
    expect(mail.cancelled).toContain(paymentIntentId);
    // A replayed webhook changes nothing.
    await handleStripeEvent(linkPaid(paymentIntentId));
    expect(await Booking.countDocuments()).toBe(1);
    // The customer's card form somehow still succeeds: that payment is refunded, no second booking.
    const late = await request(http.server).post('/bookings/checkout').set('Authorization', auth).send({ paymentIntentId });
    expect(late.status).toBe(409);
    expect(mail.refunds).toEqual([{ paymentIntentId, amount: mail.opened[0].amount }]);
    expect(await Booking.countDocuments()).toBe(1);
  });

  it('paying by card first closes the emailed link, and a link payment arriving late is refunded', async () => {
    const { auth, paymentIntentId } = await payClick();
    const done = await request(http.server).post('/bookings/checkout').set('Authorization', auth).send({ paymentIntentId });
    expect(done.status).toBe(201);
    expect(mail.expired).toContain('cs_test_1');
    await handleStripeEvent(linkPaid(paymentIntentId));
    expect(await Booking.countDocuments()).toBe(1);
    expect(mail.refunds).toEqual([{ paymentIntentId: 'pi_link_1', amount: 140 }]);
  });
});
