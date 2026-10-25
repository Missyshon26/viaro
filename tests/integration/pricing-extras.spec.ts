import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { Booking } from '../../src/models/Booking';
import { Driver } from '../../src/models/Driver';
import { Transaction } from '../../src/models/Transaction';
import { Trip } from '../../src/models/Trip';
import { User } from '../../src/models/User';
import { applyRevenueSplit, getPlatformWallet } from '../../src/modules/wallet/wallet.service';
import { listen, makeUser, pickupIn, point, resetData, seedCatalogue, startDatabase, stopDatabase } from './harness';

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

let admin: { id: string; auth: string };
const setSettings = (patch: Record<string, unknown>) =>
  request(server).patch('/admin/settings').set('Authorization', admin.auth).send(patch);

beforeEach(async () => {
  await resetData();
  admin = await makeUser('admin');
  // The settings are cached for a moment; saving clears it, so each test starts from zero.
  const reset = await setSettings({ taxPct: 0, welcomeDiscount: 0, loyaltyDiscount: 0, loyaltyEveryNth: 4 });
  expect(reset.status).toBe(200);
});

// A sedan transfer at 2pm is a flat $140.
const trip = (over: Record<string, unknown> = {}, hour = 14) => ({
  pickup: point('Hotel Andra, Seattle'),
  drop: point('Sea-Tac Airport'),
  vehicleClass: 'sedan',
  tripType: 'point2point',
  city: 'seattle',
  scheduledAt: pickupIn(5, hour),
  ...over,
});

const quote = async (customerId: string, over: Record<string, unknown> = {}) => {
  const res = await request(server)
    .post('/admin/bookings/quote')
    .set('Authorization', admin.auth)
    .send({ customerId, trip: trip(over) });
  expect(res.status).toBe(200);
  return res.body.data as Record<string, number | string>;
};

/** Books a trip for the client the way operations does, one day apart so none collide. */
let day = 6;
const book = async (customerId: string, over: Record<string, unknown> = {}) => {
  const res = await request(server)
    .post('/admin/bookings')
    .set('Authorization', admin.auth)
    .send({ customerId, trip: trip({ scheduledAt: pickupIn(day++, 14), ...over }) });
  expect(res.status).toBe(201);
  return res.body.data.booking as { _id: string; estimatedFare: number; fareBreakdown?: Record<string, unknown> };
};

describe('settings', () => {
  it('saves and returns the tax and discount settings', async () => {
    const res = await setSettings({ taxPct: 9, welcomeDiscount: 20, loyaltyDiscount: 15, loyaltyEveryNth: 4 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ taxPct: 9, welcomeDiscount: 20, loyaltyDiscount: 15, loyaltyEveryNth: 4 });
    const read = await request(server).get('/admin/settings').set('Authorization', admin.auth);
    expect(read.body.data).toMatchObject({ taxPct: 9, welcomeDiscount: 20 });
  });

  it('refuses values that are almost certainly mistakes', async () => {
    expect((await setSettings({ taxPct: 31 })).status).toBe(400);
    expect((await setSettings({ taxPct: -1 })).status).toBe(400);
    expect((await setSettings({ welcomeDiscount: -5 })).status).toBe(400);
    expect((await setSettings({ loyaltyEveryNth: 1 })).status).toBe(400);
    expect((await setSettings({ loyaltyEveryNth: 2.5 })).status).toBe(400);
  });

  it('adds nothing until operations set something: the fare is the plain price', async () => {
    const client = await makeUser('customer');
    const q = await quote(client.id);
    expect(q).toMatchObject({ subtotal: 140, gratuity: 0, discount: 0, tax: 0, fare: 140 });
  });
});

describe('gratuity and tax in a quote', () => {
  it('adds the chosen tip to the price', async () => {
    const client = await makeUser('customer');
    const q = await quote(client.id, { gratuityPct: 15 });
    expect(q).toMatchObject({ subtotal: 140, gratuityPct: 15, gratuity: 21, fare: 161 });
  });

  it('adds tax on the price plus tip', async () => {
    await setSettings({ taxPct: 8.5 });
    const client = await makeUser('customer');
    const q = await quote(client.id, { gratuityPct: 10 });
    expect(q).toMatchObject({ subtotal: 140, gratuity: 14, taxPct: 8.5, tax: 13.09, fare: 167.09 });
  });

  it('refuses a tip above the limit', async () => {
    const client = await makeUser('customer');
    const res = await request(server)
      .post('/admin/bookings/quote')
      .set('Authorization', admin.auth)
      .send({ customerId: client.id, trip: trip({ gratuityPct: 31 }) });
    expect(res.status).toBe(400);
  });

  it('is on the customer estimate too, with every line', async () => {
    await setSettings({ taxPct: 10 });
    const client = await makeUser('customer');
    const res = await request(server)
      .get('/pricing/fare-estimate')
      .query({ city: 'seattle', tripType: 'point2point', vehicleClass: 'sedan', requestedAt: pickupIn(5, 14), gratuity: 20 })
      .set('Authorization', client.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ subtotal: 140, gratuity: 28, tax: 16.8, fare: 184.8 });
  });
});

describe('welcome and loyalty discounts', () => {
  it('gives the welcome discount on the very first trip only', async () => {
    await setSettings({ welcomeDiscount: 20 });
    const client = await makeUser('customer');
    expect(await quote(client.id)).toMatchObject({ discountKind: 'welcome', discount: 20, fare: 120 });

    const first = await book(client.id);
    expect(first.estimatedFare).toBe(120);
    expect(first.fareBreakdown).toMatchObject({ discountKind: 'welcome', discount: 20 });

    const second = await quote(client.id);
    expect(second.discount).toBe(0);
    expect(second.fare).toBe(140);
  });

  it('does not give the welcome discount back after the first trip is cancelled', async () => {
    await setSettings({ welcomeDiscount: 20 });
    const client = await makeUser('customer');
    const first = await book(client.id);
    await Booking.updateOne({ _id: first._id }, { $set: { status: 'cancelled' } });
    expect((await quote(client.id)).discount).toBe(0);
  });

  it('gives the loyalty discount on every 4th trip, 4th then 8th', async () => {
    await setSettings({ loyaltyDiscount: 15 });
    const client = await makeUser('customer');
    for (let n = 1; n <= 3; n += 1) {
      expect((await quote(client.id)).discount).toBe(0);
      await book(client.id);
    }
    expect(await quote(client.id)).toMatchObject({ discountKind: 'loyalty', discount: 15, fare: 125 });
    const fourth = await book(client.id);
    expect(fourth.estimatedFare).toBe(125);

    for (let n = 5; n <= 7; n += 1) {
      expect((await quote(client.id)).discount).toBe(0);
      await book(client.id);
    }
    expect(await quote(client.id)).toMatchObject({ discountKind: 'loyalty', discount: 15 });
  });

  it('does not count a cancelled trip towards the next reward', async () => {
    await setSettings({ loyaltyDiscount: 15 });
    const client = await makeUser('customer');
    const made = [await book(client.id), await book(client.id), await book(client.id)];
    await Booking.updateOne({ _id: made[1]._id }, { $set: { status: 'cancelled' } });
    expect((await quote(client.id)).discount).toBe(0); // only two real trips so far
    await book(client.id);
    expect((await quote(client.id)).discount).toBe(15); // now the 4th real trip
  });

  it('honours the every-Nth setting', async () => {
    await setSettings({ loyaltyDiscount: 10, loyaltyEveryNth: 2 });
    const client = await makeUser('customer');
    await book(client.id);
    expect((await quote(client.id)).discount).toBe(10); // the 2nd trip
  });

  it('keeps one customer\'s trips out of another\'s count', async () => {
    await setSettings({ welcomeDiscount: 20 });
    const a = await makeUser('customer');
    const b = await makeUser('customer');
    await book(a.id);
    expect((await quote(b.id)).discount).toBe(20);
  });

  it('lowers the tax along with the price', async () => {
    await setSettings({ welcomeDiscount: 40, taxPct: 10 });
    const client = await makeUser('customer');
    expect(await quote(client.id)).toMatchObject({ discount: 40, tax: 10, fare: 110 });
  });

  it('never takes a fare below zero', async () => {
    await setSettings({ welcomeDiscount: 1000 });
    const client = await makeUser('customer');
    expect(await quote(client.id)).toMatchObject({ discount: 140, fare: 0 });
  });

  it('gives only the first leg of a new customer\'s journey the welcome discount', async () => {
    await setSettings({ welcomeDiscount: 20 });
    const client = await makeUser('customer');
    const res = await request(server)
      .post('/admin/bookings/journey/quote')
      .set('Authorization', admin.auth)
      .send({ customerId: client.id, legs: [trip({ scheduledAt: pickupIn(5, 10) }), trip({ scheduledAt: pickupIn(5, 18) })] });
    expect(res.status).toBe(200);
    expect(res.body.data.fares).toEqual([120, 140]);
    expect(res.body.data.total).toBe(260);

    // Booking it gives the same two prices.
    const made = await request(server)
      .post('/admin/bookings/journey')
      .set('Authorization', admin.auth)
      .send({ customerId: client.id, legs: [trip({ scheduledAt: pickupIn(5, 10) }), trip({ scheduledAt: pickupIn(5, 18) })] });
    expect(made.status).toBe(201);
    const saved = await Booking.find({ customerId: client.id }).sort({ scheduledAt: 1 }).lean();
    expect(saved.map((b) => b.estimatedFare)).toEqual([120, 140]);
  });
});

describe('what a booking stores', () => {
  it('keeps the whole bill, and charges the total', async () => {
    await setSettings({ taxPct: 10, welcomeDiscount: 20 });
    const client = await makeUser('customer');
    const res = await request(server)
      .post('/bookings')
      .set('Authorization', client.auth)
      .send({ ...trip({ gratuityPct: 10 }) });
    expect(res.status).toBe(201);
    // 140 + 14 tip − 20 welcome = 134; tax 13.40; total 147.40
    expect(res.body.data.booking.estimatedFare).toBe(147.4);
    expect(res.body.data.fareBreakdown).toMatchObject({ subtotal: 140, gratuity: 14, discount: 20, tax: 13.4, fare: 147.4 });
    const stored = await Booking.findById(res.body.data.booking._id).lean();
    expect(stored!.fareBreakdown).toMatchObject({
      subtotal: 140,
      gratuityPct: 10,
      gratuity: 14,
      discountKind: 'welcome',
      discount: 20,
      taxPct: 10,
      tax: 13.4,
    });
  });

  it('puts tip, discount and tax on the invoice, adding up to the total', async () => {
    await setSettings({ taxPct: 10, welcomeDiscount: 20 });
    const client = await makeUser('customer');
    const res = await request(server).post('/bookings').set('Authorization', client.auth).send(trip({ gratuityPct: 10 }));
    const { buildDocument } = await import('../../src/modules/booking/booking.documents.js');
    const stored = await Booking.findById(res.body.data.booking._id).lean();
    const doc = buildDocument('invoice', {
      booking: stored as never,
      customer: { name: 'Pat' },
      vehicleLabel: 'Business Sedan',
    });
    const labels = doc.lines.map((l) => l.label);
    expect(labels).toEqual(expect.arrayContaining(['Gratuity (10%)', 'Welcome discount', 'Tax (10%)']));
    const sum = Math.round(doc.lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
    expect(sum).toBe(doc.total);
    expect(doc.lines.find((l) => l.label === 'Welcome discount')!.amount).toBe(-20);
  });
});

describe('amending a booking', () => {
  it('keeps the tip, tax rate and discount it was booked with, whatever the settings are now', async () => {
    await setSettings({ taxPct: 10, welcomeDiscount: 20 });
    const client = await makeUser('customer');
    const made = await request(server).post('/bookings').set('Authorization', client.auth).send(trip({ gratuityPct: 10 }));
    expect(made.body.data.booking.estimatedFare).toBe(147.4);

    // Operations change everything afterwards.
    await setSettings({ taxPct: 0, welcomeDiscount: 0 });

    const changed = await request(server)
      .patch(`/bookings/${made.body.data.booking._id}`)
      .set('Authorization', client.auth)
      .send({ vehicleClass: 'mpv' });
    expect(changed.status).toBe(200);
    // MPV flat $172 + 10% tip 17.20 − the same $20 welcome = 169.20; the same 10% tax 16.92.
    expect(changed.body.data.estimatedFare).toBe(186.12);
    expect(changed.body.data.fareBreakdown).toMatchObject({ gratuityPct: 10, taxPct: 10, discount: 20 });
  });

  it('does not add tax or a tip to a booking made before they existed', async () => {
    const client = await makeUser('customer');
    const made = await book(client.id);
    // Make it look like an old booking, then turn tax on.
    await Booking.updateOne({ _id: made._id }, { $unset: { 'fareBreakdown.subtotal': 1, 'fareBreakdown.gratuityPct': 1, 'fareBreakdown.taxPct': 1, 'fareBreakdown.tax': 1, 'fareBreakdown.gratuity': 1, 'fareBreakdown.discount': 1 } });
    await setSettings({ taxPct: 10 });
    const changed = await request(server)
      .patch(`/bookings/${made._id}`)
      .set('Authorization', client.auth)
      .send({ vehicleClass: 'mpv' });
    expect(changed.status).toBe(200);
    expect(changed.body.data.estimatedFare).toBe(172);
  });
});

describe('settlement leaves the tax out', () => {
  it('splits the fare less the tax between the business, never the tax itself', async () => {
    await setSettings({ taxPct: 10 });
    const client = await makeUser('customer');
    const made = await book(client.id); // 140 + 14 tax = 154
    expect(made.estimatedFare).toBe(154);

    const driverUser = await User.create({
      role: 'driver', name: 'Dee Driver', email: 'dee@example.com', phone: '+12065550111', passwordHash: 'x',
    });
    const driver = await Driver.create({ userId: driverUser._id, vehicleClass: 'sedan', status: 'offline' });
    const trip_ = await Trip.create({
      bookingId: made._id,
      driverId: driver._id,
      status: 'completed',
      fareAmount: 154,
      taxAmount: 14,
      timestamps: {},
    });

    await applyRevenueSplit(String(trip_._id));

    const platform = await getPlatformWallet();
    const credit = await Transaction.findOne({ walletId: platform._id, 'meta.reason': 'revenue_split_platform' }).lean();
    expect(credit!.amount).toBe(140);
  });

  it('keeps the tax on the booking, ready for the trip to copy', async () => {
    await setSettings({ taxPct: 10 });
    const client = await makeUser('customer');
    const made = await book(client.id);
    const stored = await Booking.findById(made._id).lean();
    expect(stored!.fareBreakdown!.tax).toBe(14);
  });
});

describe('estimating a later leg of a journey', () => {
  it('judges the welcome discount as if the earlier legs were booked', async () => {
    await setSettings({ welcomeDiscount: 20 });
    const client = await makeUser('customer');
    const estimate = (tripsAhead: number) =>
      request(server)
        .get('/pricing/fare-estimate')
        .query({ city: 'seattle', tripType: 'point2point', vehicleClass: 'sedan', requestedAt: pickupIn(5, 14), tripsAhead })
        .set('Authorization', client.auth);
    expect((await estimate(0)).body.data.fare).toBe(120);
    expect((await estimate(1)).body.data.fare).toBe(140);
    expect((await estimate(9)).status).toBe(400);
  });
});

describe('email icons', () => {
  it('are served to mail clients without a login', async () => {
    const res = await request(server).get('/email_icons/facebook.png');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
  });
});
