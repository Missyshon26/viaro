import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';

const mocks = vi.hoisted(() => ({
  retrieve: vi.fn(),
  session: vi.fn(),
  refund: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('../../src/integrations/paymentGateway', async (orig) => ({
  ...(await orig<typeof import('../../src/integrations/paymentGateway')>()),
  isStripeEnabled: () => true,
  retrievePaymentIntent: mocks.retrieve,
  createCheckoutSession: mocks.session,
  refundToCard: mocks.refund,
  cancelPaymentIntent: mocks.cancel,
  createStripeCustomer: async () => ({ id: 'cus_test' }),
}));

import { Booking } from '../../src/models/Booking';
import { User } from '../../src/models/User';
import { handleLegacyCheckoutCompleted, lookupLegacyLink, startLegacyLink } from '../../src/modules/payments/legacyLink';
import { resetData, startDatabase, stopDatabase } from './harness';

const SECRET = 'pi_3OldPayment_secret_AbC123xyz';
const TRIP = new Types.ObjectId().toHexString();
const OTHER_TRIP = new Types.ObjectId().toHexString();

const intent = (over: Record<string, unknown> = {}) => ({
  id: 'pi_3OldPayment',
  status: 'requires_payment_method',
  amount: 30000,
  amount_received: 0,
  currency: 'usd',
  client_secret: SECRET,
  description: '13663',
  metadata: {},
  payment_method: null,
  ...over,
});

let customerId: Types.ObjectId;
async function legs(spec: { fare: number; status?: string; paid?: boolean }[], tripId = TRIP, tripNo = '13663') {
  const docs = spec.map((l, i) => ({
    _id: new Types.ObjectId(),
    customerId,
    pickup: { lat: 0, lng: 0, address: `Pickup ${i}` },
    drop: { lat: 0, lng: 0, address: `Drop ${i}` },
    scheduledAt: new Date(Date.now() + (i + 5) * 86_400_000),
    status: l.status ?? 'pending',
    estimatedFare: l.fare,
    legacy: { tripId: new Types.ObjectId(tripId), tripNo, legIndex: i, legCount: spec.length, paymentStatus: l.paid ? 'Paid' : 'Unpaid' },
  }));
  await Booking.collection.insertMany(docs);
  return docs;
}

describe('old emailed pay links', () => {
  beforeAll(startDatabase);
  afterAll(stopDatabase);
  beforeEach(async () => {
    await resetData();
    vi.clearAllMocks();
    mocks.retrieve.mockResolvedValue(intent());
    mocks.session.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' });
    mocks.cancel.mockResolvedValue({});
    const user = await User.create({ role: 'customer', name: 'Pat Rider', email: 'pat@example.com', phone: '+12065550100', passwordHash: 'x' });
    customerId = user._id as Types.ObjectId;
  });

  it('describes the trip behind a genuine link, with the amount the old email promised', async () => {
    await legs([{ fare: 150 }, { fare: 150 }]);
    const summary = await lookupLegacyLink(SECRET, TRIP);
    expect(summary).toMatchObject({ tripNo: '13663', amount: 300 });
    expect(summary.legs).toHaveLength(2);
  });

  it('accepts the trip tied by id as well as by number', async () => {
    await legs([{ fare: 300 }]);
    mocks.retrieve.mockResolvedValue(intent({ description: null, metadata: { tripID: TRIP } }));
    await expect(lookupLegacyLink(SECRET, TRIP)).resolves.toMatchObject({ amount: 300 });
  });

  it('refuses a made-up secret, a secret for another payment, and a payment that names another trip', async () => {
    await legs([{ fare: 300 }]);
    await expect(lookupLegacyLink('not-a-secret', TRIP)).rejects.toMatchObject({ statusCode: 404 });
    mocks.retrieve.mockResolvedValue(intent({ client_secret: 'pi_3OldPayment_secret_SOMETHINGELSE' }));
    await expect(lookupLegacyLink(SECRET, TRIP)).rejects.toMatchObject({ statusCode: 404 });
    mocks.retrieve.mockResolvedValue(intent({ description: '99999', metadata: { tripID: OTHER_TRIP } }));
    await expect(lookupLegacyLink(SECRET, TRIP)).rejects.toMatchObject({ statusCode: 404 });
    await expect(lookupLegacyLink(SECRET, new Types.ObjectId().toHexString())).rejects.toMatchObject({ statusCode: 404 });
  });

  it('says so when the trip is already paid or cancelled, and never opens a payment page for it', async () => {
    await legs([{ fare: 300, paid: true }]);
    await expect(startLegacyLink(SECRET, TRIP)).rejects.toMatchObject({ statusCode: 409 });
    await resetData();
    await legs([{ fare: 300, status: 'cancelled' }]);
    await expect(startLegacyLink(SECRET, TRIP)).rejects.toMatchObject({ statusCode: 409 });
    await resetData();
    await legs([{ fare: 300 }]);
    mocks.retrieve.mockResolvedValue(intent({ status: 'succeeded' }));
    await expect(startLegacyLink(SECRET, TRIP)).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it('opens a Stripe payment page for the old amount and the right trip', async () => {
    await legs([{ fare: 300 }]);
    const { url } = await startLegacyLink(SECRET, TRIP);
    expect(url).toBe('https://checkout.stripe.com/c/pay/cs_1');
    expect(mocks.session.mock.calls[0][0]).toMatchObject({
      amount: 300,
      customerId: 'cus_test',
      metadata: { kind: 'legacy_trip_link', tripId: TRIP, oldIntentId: 'pi_3OldPayment' },
    });
  });

  it('records a payment across a trip\'s legs by their fares, and closes the old payment', async () => {
    const [a, b] = await legs([{ fare: 100 }, { fare: 200 }]);
    mocks.retrieve.mockResolvedValue(intent({ id: 'pi_new', payment_method: { id: 'pm_1', card: { brand: 'visa', last4: '4242' } } }));

    const session = {
      id: 'cs_1', url: null, status: 'complete', payment_status: 'paid', payment_intent: 'pi_new', amount_total: 30000,
      currency: 'usd', expires_at: 0, metadata: { kind: 'legacy_trip_link', tripId: TRIP, oldIntentId: 'pi_3OldPayment' },
    } as never;
    await handleLegacyCheckoutCompleted(session);

    const first = await Booking.findById(a._id).lean();
    const second = await Booking.findById(b._id).lean();
    expect(first?.payment).toMatchObject({ intentId: 'pi_new', amount: 100, status: 'paid', last4: '4242', leg: 0 });
    expect(second?.payment).toMatchObject({ intentId: 'pi_new', amount: 200, status: 'paid', leg: 1 });
    expect(mocks.cancel).toHaveBeenCalledWith('pi_3OldPayment');

    // The same event again changes nothing and refunds nothing.
    await handleLegacyCheckoutCompleted(session);
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(await Booking.countDocuments({ 'payment.intentId': 'pi_new' })).toBe(2);
  });

  it('refunds a payment that cannot be placed because the trip was paid meanwhile', async () => {
    await legs([{ fare: 300, paid: true }]);
    await Booking.collection.updateMany({}, { $set: { payment: { provider: 'stripe', intentId: 'pi_other', leg: 0, amount: 300, currency: 'USD', status: 'paid', refundedAmount: 0, refundIds: [], paidAt: new Date() } } });
    mocks.retrieve.mockResolvedValue(intent({ id: 'pi_new' }));
    await handleLegacyCheckoutCompleted({
      id: 'cs_2', url: null, status: 'complete', payment_status: 'paid', payment_intent: 'pi_new', amount_total: 30000,
      currency: 'usd', expires_at: 0, metadata: { kind: 'legacy_trip_link', tripId: TRIP, oldIntentId: 'pi_3OldPayment' },
    } as never);
    expect(mocks.refund).toHaveBeenCalledWith(expect.objectContaining({ paymentIntentId: 'pi_new', amount: 300 }));
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it('ignores payments that are not old pay links', async () => {
    await handleLegacyCheckoutCompleted({ id: 'cs_3', payment_status: 'paid', metadata: { kind: 'booking_link', bookingId: 'x' } } as never);
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });
});
