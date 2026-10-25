import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { Booking } from '../../src/models/Booking';
import { Driver } from '../../src/models/Driver';
import { Notification } from '../../src/models/Notification';
import { Trip } from '../../src/models/Trip';
import { Transaction } from '../../src/models/Transaction';
import { getOrCreateWallet, getPlatformWallet } from '../../src/modules/wallet/wallet.service';
import { User } from '../../src/models/User';
import {
  accessTokenFor,
  listen,
  makeUser,
  pickupIn,
  point,
  resetData,
  seedCatalogue,
  startDatabase,
  stopDatabase,
} from './harness';

const stripe = vi.hoisted(() => ({ refunds: [] as { paymentIntentId: string; amount: number }[], fail: false }));
vi.mock('../../src/integrations/paymentGateway', async (orig) => {
  const actual = await orig<typeof import('../../src/integrations/paymentGateway')>();
  return {
    ...actual,
    isStripeEnabled: () => true,
    refundToCard: vi.fn(async (input: { paymentIntentId: string; amount: number }) => {
      if (stripe.fail) throw new actual.StripeError('card network down', 400);
      stripe.refunds.push(input);
      return { id: `re_${stripe.refunds.length}`, amount: Math.round(input.amount * 100), status: 'succeeded' };
    }),
  };
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
  stripe.refunds.length = 0;
  stripe.fail = false;
});

/** A booking made for a client by an operator, optionally already taken by a chauffeur. */
async function setup(opts: { assigned?: boolean; paid?: boolean } = {}) {
  const admin = await makeUser('admin');
  const client = await makeUser('customer');
  const made = await request(server)
    .post('/admin/bookings')
    .set('Authorization', admin.auth)
    .send({
      customerId: client.id,
      trip: {
        pickup: point('Hotel Andra, Seattle'),
        drop: point('Sea-Tac Airport'),
        vehicleClass: 'sedan',
        tripType: 'point2point',
        city: 'seattle',
        scheduledAt: pickupIn(5),
      },
    });
  const bookingId = String(made.body.data.booking._id);

  if (opts.paid) {
    await Booking.updateOne(
      { _id: bookingId },
      { $set: { payment: { provider: 'stripe', intentId: 'pi_paid', leg: 0, amount: 140, currency: 'USD', status: 'paid', brand: 'visa', last4: '4242', refundedAmount: 0, refundIds: [], paidAt: new Date() } } },
    );
  }

  let driverAuth = '';
  let tripId = '';
  if (opts.assigned) {
    const driverUser = await User.create({ role: 'driver', name: 'Dee Driver', email: 'dee@example.com', phone: '+12065550111', passwordHash: 'x' });
    const driver = await Driver.create({ userId: driverUser._id, vehicleClass: 'sedan', status: 'busy' });
    const trip = await Trip.create({ bookingId, driverId: driver._id, status: 'accepted', fareAmount: 140, timestamps: {} });
    await Booking.updateOne({ _id: bookingId }, { $set: { status: 'assigned' } });
    tripId = String(trip._id);
    driverAuth = await accessTokenFor(String(driverUser._id), 'driver');
  }
  return { admin, client, bookingId, driverAuth, tripId };
}

const driverPost = (auth: string, tripId: string, step: string) =>
  request(server).post(`/trips/${tripId}/${step}`).set('Authorization', auth);
const kinds = async (userId: string) => (await Notification.find({ userId }).lean()).map((n) => n.type);

describe('on the way and arrived', () => {
  it('records the time, keeps the trip accepted, and tells the passenger once', async () => {
    const { client, driverAuth, tripId } = await setup({ assigned: true });
    const res = await driverPost(driverAuth, tripId, 'enroute');
    expect(res.status).toBe(200);
    const trip = await Trip.findById(tripId).lean();
    expect(trip!.status).toBe('accepted');
    expect(trip!.timestamps.enroute).toBeTruthy();
    expect(await kinds(client.id)).toContain('trip.enroute');
  });

  it('a second tap changes nothing and sends nothing', async () => {
    const { client, driverAuth, tripId } = await setup({ assigned: true });
    await driverPost(driverAuth, tripId, 'enroute');
    const first = (await Trip.findById(tripId).lean())!.timestamps.enroute;
    const again = await driverPost(driverAuth, tripId, 'enroute');
    expect(again.status).toBe(409);
    expect((await Trip.findById(tripId).lean())!.timestamps.enroute).toEqual(first);
    expect((await kinds(client.id)).filter((k) => k === 'trip.enroute')).toHaveLength(1);
  });

  it('arriving also records being on the way when that was skipped', async () => {
    const { client, driverAuth, tripId } = await setup({ assigned: true });
    expect((await driverPost(driverAuth, tripId, 'arrived')).status).toBe(200);
    const trip = await Trip.findById(tripId).lean();
    expect(trip!.timestamps.arrived).toBeTruthy();
    expect(trip!.timestamps.enroute).toBeTruthy();
    expect(await kinds(client.id)).toContain('trip.arrived');
  });

  it('cannot go "on the way" after arriving', async () => {
    const { driverAuth, tripId } = await setup({ assigned: true });
    await driverPost(driverAuth, tripId, 'arrived');
    const res = await driverPost(driverAuth, tripId, 'enroute');
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already arrived/i);
  });

  it('only for a trip that has not started, and only the chauffeur on it', async () => {
    const { driverAuth, tripId } = await setup({ assigned: true });
    await Trip.updateOne({ _id: tripId }, { $set: { status: 'started' } });
    expect((await driverPost(driverAuth, tripId, 'arrived')).status).toBe(409);

    const other = await User.create({ role: 'driver', name: 'Sam', email: 'sam@example.com', phone: '+1206555', passwordHash: 'x' });
    await Driver.create({ userId: other._id, vehicleClass: 'sedan', status: 'available' });
    const otherAuth = await accessTokenFor(String(other._id), 'driver');
    await Trip.updateOne({ _id: tripId }, { $set: { status: 'accepted' } });
    const res = await driverPost(otherAuth, tripId, 'enroute');
    expect([403, 404]).toContain(res.status);
    expect((await Trip.findById(tripId).lean())!.timestamps?.enroute).toBeUndefined();
  });

  it('operations can mark either step from the console', async () => {
    const { admin, client, tripId } = await setup({ assigned: true });
    const patch = (status: string) =>
      request(server).patch(`/trips/${tripId}/status`).set('Authorization', admin.auth).send({ status });
    expect((await patch('enroute')).status).toBe(200);
    expect((await patch('arrived')).status).toBe(200);
    const kindsNow = await kinds(client.id);
    expect(kindsNow).toEqual(expect.arrayContaining(['trip.enroute', 'trip.arrived']));
    expect((await Trip.findById(tripId).lean())!.status).toBe('accepted');
  });
});

describe('closing a trip by hand', () => {
  it('flags the notice so the passenger gets the short "Trip Completed" note', async () => {
    const { admin, client, tripId } = await setup({ assigned: true });
    const res = await request(server).patch(`/trips/${tripId}/status`).set('Authorization', admin.auth).send({ status: 'completed' });
    expect(res.status).toBe(200);
    const note = await Notification.findOne({ userId: client.id, type: 'trip.completed' }).lean();
    expect(note!.payload).toMatchObject({ closedBy: 'admin' });
  });

  it('the chauffeur finishing it does not carry the flag', async () => {
    const { client, driverAuth, tripId } = await setup({ assigned: true });
    await driverPost(driverAuth, tripId, 'start');
    const res = await driverPost(driverAuth, tripId, 'complete');
    expect(res.status).toBe(200);
    const note = await Notification.findOne({ userId: client.id, type: 'trip.completed' }).lean();
    expect(note!.payload?.closedBy).toBeUndefined();
  });
});

describe('rejecting a booking request', () => {
  const reject = (auth: string, id: string, body: Record<string, unknown>) =>
    request(server).post(`/admin/bookings/${id}/reject`).set('Authorization', auth).send(body);

  it('cancels it as a rejection, with the reason, and tells the customer', async () => {
    const { admin, client, bookingId } = await setup();
    const res = await reject(admin.auth, bookingId, { reason: 'No chauffeur available that night' });
    expect(res.status).toBe(200);
    const saved = await Booking.findById(bookingId).lean();
    expect(saved!.status).toBe('cancelled');
    expect(saved!.cancellation).toMatchObject({ by: 'admin', rejected: true, reason: 'No chauffeur available that night' });
    const note = await Notification.findOne({ userId: client.id, type: 'booking.cancelled' }).lean();
    expect(note!.payload).toMatchObject({ rejected: true, reason: 'No chauffeur available that night' });
  });

  it('refunds a card payment in full', async () => {
    const { admin, bookingId } = await setup({ paid: true });
    const res = await reject(admin.auth, bookingId, { reason: 'Outside our service area' });
    expect(res.status).toBe(200);
    expect(res.body.data.refunded).toBe(140);
    expect(stripe.refunds).toHaveLength(1);
    expect(stripe.refunds[0]).toMatchObject({ paymentIntentId: 'pi_paid', amount: 140 });
    expect((await Booking.findById(bookingId).lean())!.payment!.refundedAmount).toBe(140);
  });

  it('still rejects when the refund fails, and says so', async () => {
    const { admin, bookingId } = await setup({ paid: true });
    stripe.fail = true;
    const res = await reject(admin.auth, bookingId, { reason: 'Outside our service area' });
    expect(res.status).toBe(200);
    expect(res.body.data.refundError).toMatch(/Refund/);
    expect((await Booking.findById(bookingId).lean())!.status).toBe('cancelled');
  });

  it('needs a reason', async () => {
    const { admin, bookingId } = await setup();
    expect((await reject(admin.auth, bookingId, {})).status).toBe(400);
    expect((await reject(admin.auth, bookingId, { reason: 'no' })).status).toBe(400);
    expect((await Booking.findById(bookingId).lean())!.status).not.toBe('cancelled');
  });

  it('refuses a ride a chauffeur has taken, and one already cancelled', async () => {
    const taken = await setup({ assigned: true });
    const res = await reject(taken.admin.auth, taken.bookingId, { reason: 'Changed our mind' });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/chauffeur/i);
    expect((await Booking.findById(taken.bookingId).lean())!.status).toBe('assigned');

    const open = await setup();
    await reject(open.admin.auth, open.bookingId, { reason: 'First time' });
    expect((await reject(open.admin.auth, open.bookingId, { reason: 'Second time' })).status).toBe(409);
    expect(stripe.refunds).toHaveLength(0);
  });

  it('is admin only, and for a booking that exists', async () => {
    const { admin, client, bookingId } = await setup();
    expect((await reject(client.auth, bookingId, { reason: 'Because I can' })).status).toBe(403);
    expect((await reject(admin.auth, '5f9d88b8b54764421b7156c9', { reason: 'Nothing there' })).status).toBe(404);
  });
});

describe('confirming a trip', () => {
  it('records it, keeps the trip accepted, and tells the passenger once', async () => {
    const { admin, client, tripId } = await setup({ assigned: true });
    const patch = () => request(server).patch(`/trips/${tripId}/status`).set('Authorization', admin.auth).send({ status: 'confirmed' });
    expect((await patch()).status).toBe(200);
    const trip = await Trip.findById(tripId).lean();
    expect(trip!.status).toBe('accepted');
    expect(trip!.timestamps.confirmed).toBeTruthy();
    expect(await kinds(client.id)).toContain('trip.confirmed');
    expect((await patch()).status).toBe(409);
    expect((await kinds(client.id)).filter((k) => k === 'trip.confirmed')).toHaveLength(1);
  });

  it('is operations only, and only before the ride starts', async () => {
    const { client, driverAuth, admin, tripId } = await setup({ assigned: true });
    const as = (auth: string) => request(server).patch(`/trips/${tripId}/status`).set('Authorization', auth).send({ status: 'confirmed' });
    expect((await as(client.auth)).status).toBe(403);
    expect((await as(driverAuth)).status).toBe(403);
    await Trip.updateOne({ _id: tripId }, { $set: { status: 'started' } });
    expect((await as(admin.auth)).status).toBe(409);
  });
});

describe('a no-show', () => {
  const noShow = (auth: string, tripId: string) => request(server).post(`/trips/${tripId}/no-show`).set('Authorization', auth);

  it('closes the trip as charged, frees the chauffeur, and sends the no-show notice rather than the thank-you', async () => {
    const { admin, client, tripId } = await setup({ assigned: true });
    const res = await noShow(admin.auth, tripId);
    expect(res.status).toBe(200);
    const trip = await Trip.findById(tripId).lean();
    expect(trip).toMatchObject({ status: 'completed', noShow: true, settled: true });
    expect((await Driver.findOne({ _id: trip!.driverId }).lean())!.status).toBe('available');
    const types = await kinds(client.id);
    expect(types).toContain('trip.no_show');
    expect(types).not.toContain('trip.completed');
  });

  it('only before the ride starts, once, and only by operations', async () => {
    const { admin, client, driverAuth, tripId } = await setup({ assigned: true });
    expect((await noShow(client.auth, tripId)).status).toBe(403);
    expect((await noShow(driverAuth, tripId)).status).toBe(403);
    expect((await noShow(admin.auth, tripId)).status).toBe(200);
    expect((await noShow(admin.auth, tripId)).status).toBe(409);

    const started = await setup({ assigned: true });
    await Trip.updateOne({ _id: started.tripId }, { $set: { status: 'started' } });
    const res = await noShow(started.admin.auth, started.tripId);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already started/);
  });
});

describe('undoing a no-show', () => {
  const noShow = (auth: string, tripId: string) => request(server).post(`/trips/${tripId}/no-show`).set('Authorization', auth);
  const undo = (auth: string, tripId: string) => request(server).post(`/trips/${tripId}/no-show/revert`).set('Authorization', auth);

  /** Where the money stands: the business's wallet and the chauffeur's. */
  async function balances(tripId: string) {
    const trip = await Trip.findById(tripId).lean();
    const driver = await Driver.findById(trip!.driverId).lean();
    const platform = await getPlatformWallet();
    const driverWallet = await getOrCreateWallet(driver!.userId, 'driver');
    return {
      platform: Math.round((await (await import('../../src/models/Wallet.js')).Wallet.findById(platform._id).lean())!.balance * 100) / 100,
      driver: Math.round((await (await import('../../src/models/Wallet.js')).Wallet.findById(driverWallet._id).lean())!.balance * 100) / 100,
    };
  }

  it('puts the trip back to accepted, takes the money back, and frees nothing it should not', async () => {
    const { admin, client, tripId } = await setup({ assigned: true });
    await noShow(admin.auth, tripId);
    const settled = await balances(tripId);
    expect(settled.driver).toBeGreaterThan(0);
    expect(settled.platform).toBeGreaterThan(0);

    const res = await undo(admin.auth, tripId);
    expect(res.status).toBe(200);

    const trip = await Trip.findById(tripId).lean();
    expect(trip!.status).toBe('accepted');
    expect(trip!.noShow).toBeUndefined();
    expect(trip!.settled).toBe(false);
    expect(trip!.timestamps?.completed).toBeUndefined();

    expect(await balances(tripId)).toEqual({ platform: 0, driver: 0 });
    expect((await Driver.findById(trip!.driverId).lean())!.status).toBe('busy');
    expect(await kinds(client.id)).toContain('trip.no_show_reverted');
  });

  it('writes a counter-entry for every settlement row, once each', async () => {
    const { admin, tripId } = await setup({ assigned: true });
    await noShow(admin.auth, tripId);
    const original = await Transaction.countDocuments({
      'meta.tripId': (await Trip.findById(tripId).lean())!._id,
      'meta.reason': { $in: ['revenue_split_platform', 'revenue_split_company', 'driver_payout_paid', 'driver_earnings'] },
    });
    expect(original).toBeGreaterThanOrEqual(3);
    await undo(admin.auth, tripId);
    const reversals = await Transaction.countDocuments({ 'meta.reason': 'settlement_reversal' });
    expect(reversals).toBe(original);
  });

  it('a second Undo changes nothing', async () => {
    const { admin, tripId } = await setup({ assigned: true });
    await noShow(admin.auth, tripId);
    await undo(admin.auth, tripId);
    const again = await undo(admin.auth, tripId);
    expect(again.status).toBe(409);
    expect(await balances(tripId)).toEqual({ platform: 0, driver: 0 });
  });

  it('can be marked a no-show again afterwards, and settles once, not twice', async () => {
    const { admin, tripId } = await setup({ assigned: true });
    await noShow(admin.auth, tripId);
    const first = await balances(tripId);
    await undo(admin.auth, tripId);
    expect((await noShow(admin.auth, tripId)).status).toBe(200);
    expect(await balances(tripId)).toEqual(first);
  });

  it('refuses a trip that is not a no-show', async () => {
    const { admin, tripId } = await setup({ assigned: true });
    const accepted = await undo(admin.auth, tripId);
    expect(accepted.status).toBe(409);
    expect(accepted.body.message).toMatch(/not marked as a no-show/);

    await Trip.updateOne({ _id: tripId }, { $set: { status: 'completed' } });
    expect((await undo(admin.auth, tripId)).status).toBe(409);
  });

  it('is operations only', async () => {
    const { admin, client, driverAuth, tripId } = await setup({ assigned: true });
    await noShow(admin.auth, tripId);
    expect((await undo(client.auth, tripId)).status).toBe(403);
    expect((await undo(driverAuth, tripId)).status).toBe(403);
    expect((await Trip.findById(tripId).lean())!.noShow).toBe(true);
  });

  it('sends no email about it, only an in-app note', async () => {
    const { emailFor } = await import('../../src/modules/notifications/notification.emails.js');
    const built = await emailFor('trip.no_show_reverted', { name: 'Pat', email: 'p@x.test', role: 'customer' }, { booking: { _id: 'b' } as never, trip: null, vehicleLabel: 'x' }, {});
    expect(built).toBeNull();
  });
});
