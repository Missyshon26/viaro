import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { Booking } from '../../src/models/Booking';
import { User } from '../../src/models/User';
import { Wallet } from '../../src/models/Wallet';
import { Notification } from '../../src/models/Notification';
import * as mail from '../../src/modules/notifications/notification.emails';
import * as email from '../../src/integrations/email';
import { listen, makeUser, pickupIn, point, resetData, seedCatalogue, startDatabase, stopDatabase } from './harness';

vi.mock('../../src/integrations/email', async (orig) => {
  const actual = await orig<typeof import('../../src/integrations/email')>();
  return { ...actual, sendEmail: vi.fn(async () => ({ sent: true, provider: 'test' })) };
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
  vi.mocked(email.sendEmail).mockClear();
});

const trip = (over: Record<string, unknown> = {}) => ({
  pickup: point('Sea-Tac Airport'),
  drop: point('Hotel Andra, Seattle'),
  vehicleClass: 'sedan',
  tripType: 'airport', flightDetails: { flightNumber: 'AS123' },
  city: 'seattle',
  scheduledAt: pickupIn(5),
  passengers: 2,
  ...over,
});

const post = (path: string, auth: string, body: string | object) =>
  request(server).post(path).set('Authorization', auth).send(body);

describe('POST /admin/bookings/quote', () => {
  it('prices the trip for the client without saving anything', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer');
    const res = await post('/admin/bookings/quote', admin.auth, { customerId: client.id, trip: trip() });
    expect(res.status).toBe(200);
    expect(res.body.data.fare).toBeGreaterThan(0);
    expect(await Booking.countDocuments()).toBe(0);
  });

  it('prices stops with the class stop fee', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer');
    const none = await post('/admin/bookings/quote', admin.auth, { customerId: client.id, trip: trip({ tripType: 'point2point' }) });
    const two = await post('/admin/bookings/quote', admin.auth, {
      customerId: client.id,
      trip: trip({ tripType: 'point2point', stops: [point('Pike Place Market'), point('Space Needle')] }),
    });
    expect(two.body.data.fare - none.body.data.fare).toBe(30);
  });

  it('applies the vehicle rules a customer would face', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer');
    const res = await post('/admin/bookings/quote', admin.auth, {
      customerId: client.id,
      trip: trip({ occasion: 'Wedding' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /admin/bookings', () => {
  it('books the trip for the client, unpaid, recording who made it', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer');
    const res = await post('/admin/bookings', admin.auth, { customerId: client.id, trip: trip() });
    expect(res.status).toBe(201);

    const saved = await Booking.findById(res.body.data.booking._id).lean();
    expect(String(saved!.customerId)).toBe(client.id);
    expect(saved!.source).toBe('admin');
    expect(String(saved!.createdBy)).toBe(admin.id);
    expect(saved!.status).toBe('pending');
    expect(saved!.payment).toBeUndefined();
    expect(saved!.estimatedFare).toBeGreaterThan(0);
  });

  it('saves the operator\'s note on the booking and returns it with the trip', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer');
    const note = 'Wheelchair user. Gate code 4411.';
    const res = await post('/admin/bookings', admin.auth, { customerId: client.id, trip: trip({ description: note }) });
    expect(res.status).toBe(201);
    expect(res.body.data.booking.description).toBe(note);
    expect((await Booking.findById(res.body.data.booking._id).lean())!.description).toBe(note);

    const quote = await post('/admin/bookings/quote', admin.auth, { customerId: client.id, trip: trip({ description: note }) });
    expect(quote.status).toBe(200);
  });

  it('saves a passenger phone with no passenger name, and tells dispatch', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer');
    const res = await post('/admin/bookings', admin.auth, { customerId: client.id, trip: trip({ passengerPhone: '+12065550148' }) });
    expect(res.status).toBe(201);
    const saved = await Booking.findById(res.body.data.booking._id).lean();
    expect(saved!.passengerPhone).toBe('+12065550148');
    expect(saved!.passengerName).toBeUndefined();
    expect(saved!.serviceNotes).toContain('Passenger phone: +12065550148.');
  });

  it('refuses a note over 500 characters', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer');
    const res = await post('/admin/bookings', admin.auth, { customerId: client.id, trip: trip({ description: 'x'.repeat(501) }) });
    expect(res.status).toBe(400);
  });

  it('carries the client\'s guest tag and signed agreement onto the trip', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer', {
      isGuest: true,
      agreement: { version: 'v1', signedAt: new Date() },
    });
    const res = await post('/admin/bookings', admin.auth, { customerId: client.id, trip: trip() });
    expect(res.status).toBe(201);
    const saved = await Booking.findById(res.body.data.booking._id).lean();
    expect(saved!.isGuest).toBe(true);
    expect(saved!.agreementVersion).toBe('v1');
  });

  it('shows up on the client\'s own trips', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer');
    const made = await post('/admin/bookings', admin.auth, { customerId: client.id, trip: trip() });
    const read = await request(server)
      .get(`/bookings/${made.body.data.booking._id}`)
      .set('Authorization', client.auth);
    expect(read.status).toBe(200);
    expect(read.body.data.drop.address).toContain('Hotel Andra');
  });

  it('refuses a suspended client, an unknown client and a non-client', async () => {
    const admin = await makeUser('admin');
    const suspended = await makeUser('customer', { status: 'suspended' });
    expect((await post('/admin/bookings', admin.auth, { customerId: suspended.id, trip: trip() })).status).toBe(409);
    expect((await post('/admin/bookings', admin.auth, { customerId: '5f9d88b8b54764421b7156c9', trip: trip() })).status).toBe(404);
    expect((await post('/admin/bookings', admin.auth, { customerId: admin.id, trip: trip() })).status).toBe(404);
    expect(await Booking.countDocuments()).toBe(0);
  });

  it('refuses a deleted client', async () => {
    const admin = await makeUser('admin');
    const gone = await makeUser('customer');
    await User.updateOne({ _id: gone.id }, { $set: { deletedAt: new Date() } });
    expect((await post('/admin/bookings', admin.auth, { customerId: gone.id, trip: trip() })).status).toBe(404);
  });

  it('enforces the same rules as the passenger site (past pickup, wedding vehicle, bags)', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer');
    const bad = [
      trip({ scheduledAt: pickupIn(-2) }),
      trip({ occasion: 'Wedding' }),
      trip({ checkedBags: 40 }),
      trip({ vehicleClass: 'no-such-class' }),
    ];
    for (const t of bad) {
      const res = await post('/admin/bookings', admin.auth, { customerId: client.id, trip: t });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
    expect(await Booking.countDocuments()).toBe(0);
  });

  it('needs a client and a trip', async () => {
    const admin = await makeUser('admin');
    expect((await post('/admin/bookings', admin.auth, { trip: trip() })).status).toBe(400);
    expect((await post('/admin/bookings', admin.auth, { customerId: 'nope', trip: trip() })).status).toBe(400);
  });

  it('is admin only', async () => {
    const client = await makeUser('customer');
    expect((await post('/admin/bookings', client.auth, { customerId: client.id, trip: trip() })).status).toBe(403);
    expect((await post('/admin/bookings', '', { customerId: client.id, trip: trip() })).status).toBe(401);
  });
});

describe('POST /admin/bookings/journey (multi-city and round trips)', () => {
  const back = (over: Record<string, unknown> = {}) =>
    trip({ pickup: point('Hotel Andra, Seattle'), drop: point('Sea-Tac Airport'), tripType: 'point2point', flightDetails: undefined, scheduledAt: pickupIn(5, 18), ...over });
  const out = (over: Record<string, unknown> = {}) => trip({ scheduledAt: pickupIn(5, 10), ...over });

  it('quotes every leg and the total without saving', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer');
    const res = await post('/admin/bookings/journey/quote', admin.auth, { customerId: client.id, legs: [out(), back()] });
    expect(res.status).toBe(200);
    expect(res.body.data.fares).toHaveLength(2);
    expect(res.body.data.total).toBeCloseTo(res.body.data.fares[0] + res.body.data.fares[1], 2);
    expect(await Booking.countDocuments()).toBe(0);
  });

  it('books a round trip as one tagged journey, unpaid, in pickup order', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer');
    const res = await post('/admin/bookings/journey', admin.auth, { customerId: client.id, legs: [out(), back()] });
    expect(res.status).toBe(201);
    expect(res.body.data.error).toBeUndefined();

    const saved = await Booking.find().sort({ scheduledAt: 1 }).lean();
    expect(saved).toHaveLength(2);
    expect(saved.map((b) => b.journey)).toEqual([{ index: 0, count: 2 }, { index: 1, count: 2 }]);
    for (const b of saved) {
      expect(b.source).toBe('admin');
      expect(String(b.createdBy)).toBe(admin.id);
      expect(String(b.customerId)).toBe(client.id);
      expect(b.payment).toBeUndefined();
    }
  });

  it('books up to five legs and refuses six or one', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer');
    const leg = (h: number) => back({ scheduledAt: pickupIn(6, h) });
    const five = [8, 10, 12, 14, 16].map(leg);
    expect((await post('/admin/bookings/journey', admin.auth, { customerId: client.id, legs: five })).status).toBe(201);
    expect(await Booking.countDocuments()).toBe(5);

    const six = [6, 8, 10, 12, 14, 16].map(leg);
    expect((await post('/admin/bookings/journey', admin.auth, { customerId: client.id, legs: six })).status).toBe(400);
    expect((await post('/admin/bookings/journey', admin.auth, { customerId: client.id, legs: [out()] })).status).toBe(400);
    expect(await Booking.countDocuments()).toBe(5);
  });

  it('refuses legs out of order or too close together', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer');
    const early = back({ scheduledAt: pickupIn(5, 8) });
    const reversed = await post('/admin/bookings/journey', admin.auth, { customerId: client.id, legs: [out(), early] });
    expect(reversed.status).toBe(400);
    expect(JSON.stringify(reversed.body)).toContain('minutes after');
    expect(await Booking.countDocuments()).toBe(0);
  });

  it('saves nothing when a later leg breaks a rule, and says which leg', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer');
    const res = await post('/admin/bookings/journey', admin.auth, {
      customerId: client.id,
      legs: [out(), back({ occasion: 'Wedding' })],
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/Leg 2/);
    expect(await Booking.countDocuments()).toBe(0);
  });

  it('refuses a suspended client and non-admins', async () => {
    const admin = await makeUser('admin');
    const suspended = await makeUser('customer', { status: 'suspended' });
    expect((await post('/admin/bookings/journey', admin.auth, { customerId: suspended.id, legs: [out(), back()] })).status).toBe(409);
    const client = await makeUser('customer');
    expect((await post('/admin/bookings/journey', client.auth, { customerId: client.id, legs: [out(), back()] })).status).toBe(403);
    expect(await Booking.countDocuments()).toBe(0);
  });
});

describe('a client who has no account yet, entered on the Add a trip form', () => {
  const newClient = { firstName: 'Camila', lastName: 'Saywali', email: 'Camila@Saywali.com', phone: '+12065550123' };
  const sentTo = (to: string) => vi.mocked(email.sendEmail).mock.calls.map((c) => c[0]).filter((m) => m.to === to);

  it('prices them as a brand-new client, saving nothing', async () => {
    const admin = await makeUser('admin');
    const existing = await makeUser('customer'); // no bookings yet: the same first-trip price
    const forNew = await post('/admin/bookings/quote', admin.auth, { newClient, trip: trip() });
    const forExisting = await post('/admin/bookings/quote', admin.auth, { customerId: existing.id, trip: trip() });
    expect(forNew.status).toBe(200);
    expect(forNew.body.data.fare).toBe(forExisting.body.data.fare);
    expect(await User.findOne({ email: 'camila@saywali.com' })).toBeNull();
    expect(await Booking.countDocuments()).toBe(0);
  });

  it('needs exactly one of a client and new-client details', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer');
    expect((await post('/admin/bookings', admin.auth, { trip: trip() })).status).toBe(400);
    expect((await post('/admin/bookings', admin.auth, { customerId: client.id, newClient, trip: trip() })).status).toBe(400);
    expect((await post('/admin/bookings', admin.auth, { newClient: { ...newClient, email: 'nope' }, trip: trip() })).status).toBe(400);
    expect((await post('/admin/bookings', admin.auth, { newClient: { ...newClient, phone: '12' }, trip: trip() })).status).toBe(400);
  });

  it('makes the account when the trip is booked, and books the trip for it', async () => {
    const admin = await makeUser('admin');
    const res = await post('/admin/bookings', admin.auth, { newClient, trip: trip() });
    expect(res.status).toBe(201);
    expect(res.body.data.client).toMatchObject({ name: 'Camila Saywali', email: 'camila@saywali.com', created: true });

    const user = await User.findOne({ email: 'camila@saywali.com' });
    expect(user).toMatchObject({ role: 'customer', name: 'Camila Saywali', phone: '+12065550123', status: 'active' });
    expect(await Wallet.findOne({ ownerId: user!._id, ownerType: 'customer' })).not.toBeNull();
    expect(user!.walletId).toBeDefined();

    const booking = await Booking.findById(res.body.data.booking._id).lean();
    expect(String(booking!.customerId)).toBe(String(user!._id));
    expect(booking!.source).toBe('admin');
    expect(booking!.payment).toBeUndefined();
  });

  it('emails them that their account was created, and tells them about the trip with the invoice and a way to pay', async () => {
    const admin = await makeUser('admin');
    const res = await post('/admin/bookings', admin.auth, { newClient, trip: trip() });
    const id = String(res.body.data.booking._id);

    // 1. "Account Created", with the link to choose a password. This sender runs under test.
    const invites = sentTo('camila@saywali.com');
    expect(invites).toHaveLength(1);
    expect(invites[0].subject).toBe('Account Created');
    expect(invites[0].html ?? invites[0].text).toMatch(/reset-password\?token=/);

    // 2. The booking notice to the new client: in the app, and an invoice email built from the same
    //    event (the real sender skips itself under test), exactly as for any trip an operator books.
    const user = await User.findOne({ email: 'camila@saywali.com' }).lean();
    await vi.waitFor(async () => {
      expect(await Notification.countDocuments({ userId: user!._id, type: 'booking.created' })).toBe(1);
    });
    const ctx = await mail.loadContext({ bookingId: id });
    const built = await mail.emailFor('booking.created', { name: user!.name, email: user!.email, role: 'customer' }, ctx, { bookingId: id });
    expect(built!.message.text).toContain('booked for you by All Black Limo');
    expect(built!.attachments?.some((a) => /abl-invoice/.test(a.filename))).toBe(true);
  });

  it('reports whether the invitation went out, and still books the trip when it did not', async () => {
    const admin = await makeUser('admin');
    const ok = await post('/admin/bookings', admin.auth, { newClient, trip: trip() });
    expect(ok.body.data.client.inviteSent).toBe(true);

    vi.mocked(email.sendEmail).mockResolvedValueOnce({ sent: false, provider: 'test' });
    const failed = await post('/admin/bookings', admin.auth, { newClient: { ...newClient, email: 'second@saywali.com' }, trip: trip() });
    expect(failed.status).toBe(201);
    expect(failed.body.data.client).toMatchObject({ email: 'second@saywali.com', created: true, inviteSent: false });
    expect(await User.countDocuments({ email: 'second@saywali.com' })).toBe(1);
    expect(await Booking.countDocuments({ customerId: (await User.findOne({ email: 'second@saywali.com' }))!._id })).toBe(1);
  });

  it('leaves nothing behind when the trip itself is refused', async () => {
    const admin = await makeUser('admin');
    const res = await post('/admin/bookings', admin.auth, { newClient, trip: trip({ checkedBags: 9 }) });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await User.findOne({ email: 'camila@saywali.com' })).toBeNull();
    expect(await Booking.countDocuments()).toBe(0);
    expect(sentTo('camila@saywali.com')).toHaveLength(0);
  });

  it('refuses an email that already has an account, and says to search for them', async () => {
    const admin = await makeUser('admin');
    await makeUser('customer', { email: 'camila@saywali.com' });
    const res = await post('/admin/bookings', admin.auth, { newClient, trip: trip() });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/search for them/i);
    expect(await Booking.countDocuments()).toBe(0);
    const quote = await post('/admin/bookings/quote', admin.auth, { newClient, trip: trip() });
    expect(quote.status).toBe(409);
  });

  it('does the same for a round trip: one account, every leg', async () => {
    const admin = await makeUser('admin');
    const legs = [trip({ scheduledAt: pickupIn(5) }), trip({ scheduledAt: pickupIn(6), pickup: point('Hotel Andra, Seattle'), drop: point('Sea-Tac Airport'), tripType: 'point2point', flightDetails: undefined })];
    const quote = await post('/admin/bookings/journey/quote', admin.auth, { newClient, legs });
    expect(quote.status).toBe(200);
    expect(await User.countDocuments({ email: 'camila@saywali.com' })).toBe(0);

    const res = await post('/admin/bookings/journey', admin.auth, { newClient, legs });
    expect(res.status).toBe(201);
    expect(res.body.data.bookings).toHaveLength(2);
    expect(await User.countDocuments({ email: 'camila@saywali.com' })).toBe(1);
    const owners = new Set((await Booking.find().lean()).map((b) => String(b.customerId)));
    expect(owners.size).toBe(1);
  });

  it('is for admins only', async () => {
    const client = await makeUser('customer');
    expect((await post('/admin/bookings', client.auth, { newClient, trip: trip() })).status).toBe(403);
  });
});
