import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { AGREEMENT_VERSION } from '../../src/config/agreement';
import { Booking } from '../../src/models/Booking';
import { User } from '../../src/models/User';
import { getOrCreateWallet } from '../../src/modules/wallet/wallet.service';
import { listen, accessTokenFor, pickupIn, point, resetData, seedCatalogue, startDatabase, stopDatabase, TINY_PNG } from './harness';

// Background work that needs a real Redis/queue is out of scope here and would only add noise.
vi.mock('../../src/jobs/cancellationWindow.job', () => ({
  scheduleCancellationWindowCheck: vi.fn(async () => undefined),
}));
// The real wallet service, wrapped so a test can make it fail.
vi.mock('../../src/modules/wallet/wallet.service', async (orig) => {
  const actual = await orig<typeof import('../../src/modules/wallet/wallet.service')>();
  return { ...actual, getOrCreateWallet: vi.fn(actual.getOrCreateWallet) };
});

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

const guest = (over: Record<string, unknown> = {}) => ({
  name: 'Sam Guest',
  email: 'sam@example.com',
  phone: '+12065550148',
  ...over,
});

/** Signs a new guest in and returns their token and id. */
async function newGuest(over: Record<string, unknown> = {}) {
  const res = await request(server).post('/auth/guest').send(guest(over));
  expect(res.status).toBe(201);
  return {
    id: String(res.body.data.user._id),
    auth: `Bearer ${res.body.data.accessToken}`,
    body: res.body.data,
  };
}

async function admin() {
  const user = await User.create({ role: 'admin', name: 'Ops', email: 'ops@example.com', phone: '+12065550100', passwordHash: 'x' });
  return accessTokenFor(String(user._id), 'admin');
}

describe('guest checkout, against a real database', () => {
  it('creates a signed-in guest account that is tagged and has a wallet', async () => {
    const { body } = await newGuest();
    expect(body.user).toMatchObject({ role: 'customer', email: 'sam@example.com', isGuest: true });
    expect(body.user).not.toHaveProperty('passwordHash');
    expect(body.user).not.toHaveProperty('signature');
    expect(body.user.walletId).toBeTruthy();
    expect(body.accessToken).toBeTruthy();
  });

  it('leaves no half-made account behind when the wallet cannot be set up, so the guest can try again', async () => {
    vi.mocked(getOrCreateWallet).mockRejectedValueOnce(new Error('wallet store down'));

    const failed = await request(server).post('/auth/guest').send(guest());
    expect(failed.status).toBe(500);
    expect(await User.countDocuments({ email: 'sam@example.com' })).toBe(0);

    // Without the rollback this retry would be refused as "already registered".
    const retry = await request(server).post('/auth/guest').send(guest());
    expect(retry.status).toBe(201);
  });

  it('refuses the same email twice, in any letter case', async () => {
    await newGuest();
    const again = await request(server).post('/auth/guest').send(guest({ email: 'SAM@Example.com' }));
    expect(again.status).toBe(409);
    expect(again.body.details).toMatchObject({ code: 'ACCOUNT_EXISTS' });
  });

  it('rejects incomplete details', async () => {
    expect((await request(server).post('/auth/guest').send(guest({ name: '' }))).status).toBe(400);
    expect((await request(server).post('/auth/guest').send(guest({ email: 'nope' }))).status).toBe(400);
  });

  it('lets the guest use the API as a customer straight away', async () => {
    const { auth } = await newGuest();
    const me = await request(server).get('/users/me').set('Authorization', auth);
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({ email: 'sam@example.com', isGuest: true });
  });
});

describe('rental agreement and signature, against a real database', () => {
  it('starts unsigned, then records the signature and the revision', async () => {
    const { auth, id } = await newGuest();

    const before = await request(server).get('/users/me/agreement').set('Authorization', auth);
    expect(before.body.data).toMatchObject({ signed: false, signedAt: null });

    const sign = await request(server)
      .put('/users/me/agreement')
      .set('Authorization', auth)
      .send({ signature: TINY_PNG, accepted: true, version: AGREEMENT_VERSION });
    expect(sign.status).toBe(200);
    expect(sign.body.data).toMatchObject({ signed: true, version: AGREEMENT_VERSION });
    expect(sign.body.data.signature).toBeUndefined();

    const after = await request(server).get('/users/me/agreement').set('Authorization', auth);
    expect(after.body.data).toMatchObject({ signed: true, signature: TINY_PNG });

    // The signature must never ride along in ordinary profile reads.
    const me = await request(server).get('/users/me').set('Authorization', auth);
    expect(JSON.stringify(me.body)).not.toContain('iVBOR');
    expect(me.body.data.agreement).toMatchObject({ version: AGREEMENT_VERSION });

    // An admin can see it, a stranger cannot.
    const adminAuth = await admin();
    const seen = await request(server).get(`/admin/users/${id}/agreement`).set('Authorization', adminAuth);
    expect(seen.status).toBe(200);
    expect(seen.body.data).toMatchObject({ signed: true, signature: TINY_PNG });
    const other = await newGuest({ email: 'other@example.com' });
    expect((await request(server).get(`/admin/users/${id}/agreement`).set('Authorization', other.auth)).status).toBe(403);
  });

  it('refuses a stale revision, no consent, and anything that is not a PNG', async () => {
    const { auth } = await newGuest();
    const put = (body: Record<string, unknown>) =>
      request(server).put('/users/me/agreement').set('Authorization', auth).send(body);

    expect((await put({ signature: TINY_PNG, accepted: true, version: 'old' })).status).toBe(409);
    expect((await put({ signature: TINY_PNG, accepted: false, version: AGREEMENT_VERSION })).status).toBe(400);
    const svg = `data:image/svg+xml;base64,${Buffer.from('<svg onload="x()"/>'.repeat(5)).toString('base64')}`;
    expect((await put({ signature: svg, accepted: true, version: AGREEMENT_VERSION })).status).toBe(400);

    const status = await request(server).get('/users/me/agreement').set('Authorization', auth);
    expect(status.body.data.signed).toBe(false);
  });
});

describe('a booking with stops, extras and a guest account', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    pickup: point('123 Pine St, Seattle'),
    drop: point('Sea-Tac Airport'),
    vehicleClass: 'sedan',
    tripType: 'point2point',
    city: 'seattle',
    passengers: 2,
    scheduledAt: pickupIn(10),
    meetAndGreet: true,
    stops: [point('Pike Place Market'), point('Space Needle')],
    occasion: 'Other',
    occasionDetails: 'Anniversary',
    // The sedan holds two bags in all; the luggage rule has its own tests.
    checkedBags: 1,
    carryOnBags: 1,
    passengerName: 'Alex Rider',
    passengerPhone: '+12065550123',
    ...over,
  });

  it('prices every part, tags the guest, stamps the agreement and stores it all', async () => {
    const { auth, id } = await newGuest();
    await request(server)
      .put('/users/me/agreement')
      .set('Authorization', auth)
      .send({ signature: TINY_PNG, accepted: true, version: AGREEMENT_VERSION });

    const res = await request(server).post('/bookings').set('Authorization', auth).send(body());
    expect(res.status).toBe(201);

    // Sedan flat $140 + Meet and Greet $25 + two stops at $15.
    expect(res.body.data.fareBreakdown).toMatchObject({ classFare: 140, meetAndGreetFee: 25, stopCount: 2, stopFee: 30 });
    const stored = res.body.data.booking;
    expect(stored.estimatedFare).toBe(195);
    expect(stored).toMatchObject({
      isGuest: true,
      agreementVersion: AGREEMENT_VERSION,
      occasion: 'Other',
      occasionDetails: 'Anniversary',
      checkedBags: 1,
      carryOnBags: 1,
      passengerName: 'Alex Rider',
      passengerPhone: '+12065550123',
    });
    expect(stored.stops.map((s: { address: string }) => s.address)).toEqual(['Pike Place Market', 'Space Needle']);
    expect(stored.fareBreakdown).toMatchObject({ stopFee: 30, classFare: 140 });
    expect(stored.serviceNotes).toEqual(
      expect.arrayContaining([
        'Stops: 1) Pike Place Market; 2) Space Needle.',
        'Occasion: Other (Anniversary).',
        'Luggage: 1 checked, 1 carry-on.',
        'Booked for someone else: Alex Rider, +12065550123.',
      ]),
    );

    // Read back through the API, as the customer and as an admin.
    const read = await request(server).get(`/bookings/${stored._id}`).set('Authorization', auth);
    expect(read.status).toBe(200);
    expect(read.body.data.stops).toHaveLength(2);
    expect(String(read.body.data.customerId._id ?? read.body.data.customerId)).toBe(id);

    const dash = await request(server).get('/admin/dashboard/bookings').set('Authorization', await admin());
    expect(dash.status).toBe(200);
    expect(dash.body.data.items[0]).toMatchObject({ isGuest: true });
  });

  it('does not tag, or stamp, an ordinary customer', async () => {
      const user = await User.create({ role: 'customer', name: 'Pat', email: 'pat@example.com', phone: '+12065550111', passwordHash: 'x' });
    const auth = await accessTokenFor(String(user._id), 'customer');

    const res = await request(server).post('/bookings').set('Authorization', auth).send(body({ stops: undefined, meetAndGreet: false }));
    expect(res.status).toBe(201);
    expect(res.body.data.booking.isGuest).toBe(false);
    expect(res.body.data.booking.agreementVersion).toBeUndefined();
    expect(res.body.data.booking.estimatedFare).toBe(140);
  });

  it('cannot be tagged as a guest by the request', async () => {
      const user = await User.create({ role: 'customer', name: 'Pat', email: 'pat@example.com', phone: '+12065550111', passwordHash: 'x' });
    const auth = await accessTokenFor(String(user._id), 'customer');
    const res = await request(server).post('/bookings').set('Authorization', auth).send(body({ isGuest: true }));
    expect(res.status).toBe(201);
    expect(res.body.data.booking.isGuest).toBe(false);
  });

  it('refuses stops on an hourly charter and more stops than allowed', async () => {
    const { auth } = await newGuest();
    const hourly = await request(server).post('/bookings').set('Authorization', auth).send(body({ tripType: 'hourly', hours: 3 }));
    expect(hourly.status).toBe(400);

    const many = Array.from({ length: 6 }, (_, i) => point(`Stop number ${i + 1}`));
    expect((await request(server).post('/bookings').set('Authorization', auth).send(body({ stops: many }))).status).toBe(400);
  });

  it('prices stops through the estimate endpoint the same way', async () => {
    const { auth } = await newGuest();
    const res = await request(server)
      .get('/pricing/fare-estimate')
      .query({ city: 'seattle', tripType: 'point2point', vehicleClass: 'sedan', requestedAt: pickupIn(10), stops: 3 })
      .set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ stopCount: 3, stopFee: 45, fare: 185 });
  });

  it('keeps the stop charge when the booking is amended', async () => {
    const { auth } = await newGuest();
    const made = await request(server).post('/bookings').set('Authorization', auth).send(body({ meetAndGreet: false }));
    expect(made.body.data.booking.estimatedFare).toBe(170);

    const changed = await request(server)
      .patch(`/bookings/${made.body.data.booking._id}`)
      .set('Authorization', auth)
      .send({ vehicleClass: 'mpv' });
    expect(changed.status).toBe(200);
    // The MPV charges no stop fee: 172 flat, stops free for that class.
    expect(changed.body.data.estimatedFare).toBe(172);
    expect(changed.body.data.stops).toHaveLength(2);
  });
});

describe('invoices and receipts, against a real database', () => {
  async function bookingFor(auth: string, over: Record<string, unknown> = {}) {
    const res = await request(server)
      .post('/bookings')
      .set('Authorization', auth)
      .send({
        pickup: point('123 Pine St, Seattle'),
        drop: point('Sea-Tac Airport'),
        vehicleClass: 'sedan',
        tripType: 'point2point',
        city: 'seattle',
        scheduledAt: pickupIn(10),
        stops: [point('Pike Place Market')],
        ...over,
      });
    expect(res.status).toBe(201);
    return String(res.body.data.booking._id);
  }

  const pdf = (res: request.Response) => Buffer.from(res.body as Buffer);

  it('serves an invoice for an unpaid ride, and no receipt yet', async () => {
    const { auth } = await newGuest();
    const id = await bookingFor(auth);

    const invoice = await request(server).get(`/bookings/${id}/documents/invoice`).set('Authorization', auth).buffer(true);
    expect(invoice.status).toBe(200);
    expect(invoice.headers['content-type']).toContain('application/pdf');
    expect(pdf(invoice).subarray(0, 5).toString()).toBe('%PDF-');

    const receipt = await request(server).get(`/bookings/${id}/documents/receipt`).set('Authorization', auth);
    expect(receipt.status).toBe(409);

    // The receipt screen is told what is available.
    const status = await request(server).get(`/users/me/rides/${id}/receipt`).set('Authorization', auth);
    expect(status.body.data.documents).toEqual({ invoice: true, receipt: false });
  });

  it('serves a receipt once the ride is paid', async () => {
    const { auth } = await newGuest();
    const id = await bookingFor(auth);
    await Booking.updateOne(
      { _id: id },
      {
        $set: {
          payment: {
            provider: 'stripe', intentId: 'pi_paid', leg: 0, amount: 155, currency: 'USD', status: 'paid',
            brand: 'visa', last4: '4242', refundedAmount: 0, refundIds: [], paidAt: new Date(),
          },
        },
      },
    );

    const receipt = await request(server).get(`/bookings/${id}/documents/receipt`).set('Authorization', auth).buffer(true);
    expect(receipt.status).toBe(200);
    expect(receipt.headers['content-disposition']).toContain('abl-receipt-ABL-');
    const status = await request(server).get(`/users/me/rides/${id}/receipt`).set('Authorization', auth);
    expect(status.body.data.documents).toEqual({ invoice: true, receipt: true });
  });

  it('keeps one customer out of another\'s documents, and lets an admin in', async () => {
    const owner = await newGuest();
    const intruder = await newGuest({ email: 'intruder@example.com' });
    const id = await bookingFor(owner.auth);

    expect((await request(server).get(`/bookings/${id}/documents/invoice`).set('Authorization', intruder.auth)).status).toBe(403);
    expect((await request(server).get(`/bookings/${id}/documents/invoice`).set('Authorization', await admin())).status).toBe(200);
  });
});

describe('flights, against a real database', () => {
  const airport = (over: Record<string, unknown> = {}) => ({
    pickup: point('Seattle-Tacoma International Airport'),
    drop: point('1201 Alaskan Way, Seattle'),
    vehicleClass: 'sedan',
    tripType: 'airport',
    city: 'seattle',
    flightDetails: { flightNumber: 'as 123' },
    ...over,
  });

  it('stores exactly the flight the customer entered, with no lookup behind their back', async () => {
    const { auth } = await newGuest();
    const res = await request(server).post('/bookings').set('Authorization', auth).send(airport({ scheduledAt: pickupIn(2) }));
    expect(res.status).toBe(201);
    expect(res.body.data.booking.flightDetails).toEqual({ flightNumber: 'AS 123' });
  });

  it('still needs a flight on an airport booking', async () => {
    const { auth } = await newGuest();
    const res = await request(server)
      .post('/bookings')
      .set('Authorization', auth)
      .send(airport({ scheduledAt: pickupIn(2), flightDetails: undefined }));
    expect(res.status).toBe(400);
  });

  it('lets a customer, or a visitor who has not signed in, look a flight up by hand', async () => {
    const { auth } = await newGuest();
    const res = await request(server).get('/flight/as%20123').query({ date: pickupIn(2).slice(0, 10) }).set('Authorization', auth);
    expect(res.status).toBe(200);
    // No provider here, so it is honest about the data being generated.
    expect(res.body.data).toMatchObject({ flightNumber: 'AS123', verified: false, placeholder: true });
    // A visitor filling in the booking form can check too; the answer is the same, and a bad date is still refused.
    const visitor = await request(server).get('/flight/AS123');
    expect(visitor.status).toBe(200);
    expect(visitor.body.data).toMatchObject({ flightNumber: 'AS123', verified: false });
    expect((await request(server).get('/flight/AS123').query({ date: 'tomorrow' })).status).toBe(400);
    expect((await request(server).get('/flight/AS123').query({ date: 'tomorrow' }).set('Authorization', auth)).status).toBe(400);
  });
});
