import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { Booking } from '../../src/models/Booking';
import { Notification } from '../../src/models/Notification';
import { send as notifySend } from '../../src/modules/notifications/notifications.service';
import { VehicleClass } from '../../src/models/VehicleClass';
import { listen, makeUser, pickupIn, point, resetData, seedCatalogue, startDatabase, stopDatabase } from './harness';

vi.mock('../../src/jobs/cancellationWindow.job', () => ({
  scheduleCancellationWindowCheck: vi.fn(async () => undefined),
}));
// The real notifier, wrapped so a test can make it fail.
vi.mock('../../src/modules/notifications/notifications.service', async (orig) => {
  const actual = await orig<typeof import('../../src/modules/notifications/notifications.service')>();
  return { ...actual, send: vi.fn(actual.send) };
});
vi.mock('../../src/modules/dispatch/dispatch.service', () => ({
  receiveBookingRequest: vi.fn(async () => undefined),
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
beforeEach(resetData);

const body = (over: Record<string, unknown> = {}) => ({
  pickup: point('123 Pine St, Seattle'),
  drop: point('1201 Alaskan Way, Seattle'),
  vehicleClass: 'sedan',
  tripType: 'point2point',
  city: 'seattle',
  scheduledAt: pickupIn(10),
  ...over,
});

async function book(auth: string, over: Record<string, unknown> = {}) {
  const res = await request(server).post('/bookings').set('Authorization', auth).send(body(over));
  expect(res.status).toBe(201);
  return String(res.body.data.booking._id);
}

const patch = (auth: string, id: string, data: Record<string, unknown>) =>
  request(server).patch(`/bookings/${id}`).set('Authorization', auth).send(data);

describe('the wedding vehicle rule', () => {
  it('refuses a wedding in any vehicle but the two First Class ones', async () => {
    const { auth } = await makeUser('customer');
    for (const vehicleClass of ['sedan', 'mpv', 'suv', 'minibus']) {
      const res = await request(server).post('/bookings').set('Authorization', auth).send(body({ vehicleClass, occasion: 'Wedding' }));
      expect(res.status, vehicleClass).toBe(400);
      expect(res.body.details).toMatchObject({ code: 'WEDDING_VEHICLE_REQUIRED', allowed: ['sedan-first', 'suv-first'] });
    }
    expect(await Booking.countDocuments({})).toBe(0);
  });

  it('accepts a wedding in either First Class vehicle', async () => {
    const { auth } = await makeUser('customer');
    for (const vehicleClass of ['sedan-first', 'suv-first']) {
      const res = await request(server).post('/bookings').set('Authorization', auth).send(body({ vehicleClass, occasion: 'Wedding' }));
      expect(res.status, vehicleClass).toBe(201);
      expect(res.body.data.booking.occasion).toBe('Wedding');
    }
  });

  it('does not restrict any other occasion', async () => {
    const { auth } = await makeUser('customer');
    const res = await request(server).post('/bookings').set('Authorization', auth).send(body({ vehicleClass: 'minibus', occasion: 'Homecoming/Prom' }));
    expect(res.status).toBe(201);
  });

  it('cannot be got round by editing the occasion afterwards', async () => {
    const { auth } = await makeUser('customer');
    const id = await book(auth);
    const res = await patch(auth, id, { occasion: 'Wedding' });
    expect(res.status).toBe(400);
    expect(res.body.details.code).toBe('WEDDING_VEHICLE_REQUIRED');
    // The refused edit changed nothing.
    const stored = (await Booking.findById(id))!;
    expect(stored.occasion).toBeUndefined();
    expect(stored.amendments).toHaveLength(0);
  });

  it('cannot be got round by editing the vehicle afterwards', async () => {
    const { auth } = await makeUser('customer');
    const id = await book(auth, { vehicleClass: 'sedan-first', occasion: 'Wedding' });
    const res = await patch(auth, id, { vehicleClass: 'mpv' });
    expect(res.status).toBe(400);
    expect((await Booking.findById(id))!.vehicleClass).toBe('sedan-first');
  });

  it('lets both change together, to a valid pair', async () => {
    const { auth } = await makeUser('customer');
    const id = await book(auth);
    const res = await patch(auth, id, { occasion: 'Wedding', vehicleClass: 'suv-first' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ occasion: 'Wedding', vehicleClass: 'suv-first' });
  });
});

describe('the bag-capacity check', () => {
  it('lets luggage up to the vehicle\'s capacity through, checked and carry-on together', async () => {
    const { auth } = await makeUser('customer');
    // The Business Sedan holds 2.
    expect((await request(server).post('/bookings').set('Authorization', auth).send(body({ checkedBags: 1, carryOnBags: 1 }))).status).toBe(201);
    expect((await request(server).post('/bookings').set('Authorization', auth).send(body({ checkedBags: 2 }))).status).toBe(201);
  });

  it('refuses one bag too many, naming the vehicle and the numbers', async () => {
    const { auth } = await makeUser('customer');
    const res = await request(server).post('/bookings').set('Authorization', auth).send(body({ checkedBags: 2, carryOnBags: 1 }));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Business Sedan holds 2 bags, and you have 3. Choose a larger vehicle or take fewer bags.');
    expect(res.body.details).toMatchObject({ code: 'BAGS_EXCEED_CAPACITY', capacity: 2, bags: 3 });
    expect(await Booking.countDocuments({})).toBe(0);
  });

  it('is judged against the chosen vehicle, so a bigger one takes the same luggage', async () => {
    const { auth } = await makeUser('customer');
    // The MPV holds 5.
    expect((await request(server).post('/bookings').set('Authorization', auth).send(body({ vehicleClass: 'mpv', checkedBags: 3, carryOnBags: 2 }))).status).toBe(201);
    expect((await request(server).post('/bookings').set('Authorization', auth).send(body({ vehicleClass: 'mpv', checkedBags: 4, carryOnBags: 2 }))).status).toBe(400);
  });

  it('follows the catalogue: a class operations has resized is judged by its new capacity', async () => {
    await VehicleClass.updateOne({ value: 'sedan' }, { $set: { bags: 4 } });
    const { auth } = await makeUser('customer');
    expect((await request(server).post('/bookings').set('Authorization', auth).send(body({ checkedBags: 3, carryOnBags: 1 }))).status).toBe(201);
    await VehicleClass.updateOne({ value: 'sedan' }, { $set: { bags: 2 } });
  });

  it('cannot be got round by editing the luggage, or by moving to a smaller vehicle', async () => {
    const { auth } = await makeUser('customer');
    const id = await book(auth, { vehicleClass: 'mpv', checkedBags: 3, carryOnBags: 2 });

    expect((await patch(auth, id, { checkedBags: 5 })).status).toBe(400);
    const smaller = await patch(auth, id, { vehicleClass: 'sedan' });
    expect(smaller.status).toBe(400);
    expect(smaller.body.details.code).toBe('BAGS_EXCEED_CAPACITY');

    const stored = (await Booking.findById(id))!;
    expect(stored).toMatchObject({ vehicleClass: 'mpv', checkedBags: 3, carryOnBags: 2 });
  });

  it('leaves an older booking editable for things that have nothing to do with the rule', async () => {
    const { auth } = await makeUser('customer');
    const id = await book(auth);
    // Simulate a booking made before the rule existed: more bags than the sedan holds.
    await Booking.updateOne({ _id: id }, { $set: { checkedBags: 5 } });
    expect((await patch(auth, id, { scheduledAt: pickupIn(11) })).status).toBe(200);

    // The edit screen posts every field each time. Re-sending the same vehicle and luggage
    // alongside a new time is still not a change to either, so it must not be refused.
    const resent = await patch(auth, id, { scheduledAt: pickupIn(12), vehicleClass: 'sedan', checkedBags: 5, carryOnBags: 0 });
    expect(resent.status).toBe(200);
    // Making it WORSE is still refused.
    expect((await patch(auth, id, { checkedBags: 6 })).status).toBe(400);
  });

  it('does not count "0 and 0" as a luggage change on a booking that never had any', async () => {
    const { auth } = await makeUser('customer');
    const id = await book(auth);
    const res = await patch(auth, id, { checkedBags: 0, carryOnBags: 0, scheduledAt: pickupIn(11) });
    expect(res.status).toBe(200);
    expect(res.body.data.amendments.map((a: { field: string }) => a.field)).toEqual(['scheduledAt']);
  });
});

describe('editing a booking after it is made', () => {
  it('adds stops, re-prices them, and records the change', async () => {
    const { auth } = await makeUser('customer');
    const id = await book(auth);
    expect((await Booking.findById(id))!.estimatedFare).toBe(140);

    const res = await patch(auth, id, { stops: [point('Pike Place Market'), point('Space Needle')] });
    expect(res.status).toBe(200);
    // Sedan flat $140 + two stops at $15.
    expect(res.body.data.estimatedFare).toBe(170);
    expect(res.body.data.fareBreakdown).toMatchObject({ classFare: 140, stopCount: 2, stopFee: 30 });
    expect(res.body.data.stops.map((s: { address: string }) => s.address)).toEqual(['Pike Place Market', 'Space Needle']);
    expect(res.body.data.serviceNotes).toContain('Stops: 1) Pike Place Market; 2) Space Needle.');
    expect(res.body.data.amendments.at(-1)).toMatchObject({ field: 'stops', from: '—', by: 'customer' });
  });

  it('removes stops and takes their charge off again', async () => {
    const { auth } = await makeUser('customer');
    const id = await book(auth, { stops: [point('Pike Place Market')] });
    expect((await Booking.findById(id))!.estimatedFare).toBe(155);

    const res = await patch(auth, id, { stops: [] });
    expect(res.status).toBe(200);
    expect(res.body.data.estimatedFare).toBe(140);
    expect(res.body.data.stops ?? []).toHaveLength(0);
  });

  it('tells the customer by email-notification when the price moves', async () => {
    const { auth, id: userId } = await makeUser('customer');
    const id = await book(auth);
    await patch(auth, id, { stops: [point('Pike Place Market')] });
    const types = (await Notification.find({ userId }).lean()).map((n) => n.type);
    expect(types).toEqual(expect.arrayContaining(['booking.repriced', 'booking.updated']));
  });

  it('changes occasion, luggage and passenger without touching the price', async () => {
    const { auth } = await makeUser('customer');
    const id = await book(auth);

    const res = await patch(auth, id, {
      occasion: 'Other',
      occasionDetails: 'Anniversary',
      checkedBags: 1,
      carryOnBags: 1,
      passengerName: 'Alex Rider',
      passengerPhone: '+12065550123',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.estimatedFare).toBe(140);
    expect(res.body.data).toMatchObject({
      occasion: 'Other',
      occasionDetails: 'Anniversary',
      checkedBags: 1,
      carryOnBags: 1,
      passengerName: 'Alex Rider',
    });
    expect(res.body.data.amendments.map((a: { field: string }) => a.field).sort()).toEqual(['luggage', 'occasion', 'passenger']);
    expect(res.body.data.serviceNotes).toEqual(
      expect.arrayContaining([
        'Occasion: Other (Anniversary).',
        'Luggage: 1 checked, 1 carry-on.',
        'Booked for someone else: Alex Rider, +12065550123.',
      ]),
    );
  });

  it('can take a detail away again', async () => {
    const { auth } = await makeUser('customer');
    const id = await book(auth, { occasion: 'Other', occasionDetails: 'Anniversary', passengerName: 'Alex Rider', passengerPhone: '+12065550123' });
    const res = await patch(auth, id, { occasion: null, passengerName: null });
    expect(res.status).toBe(200);
    const stored = (await Booking.findById(id))!;
    expect(stored.occasion).toBeUndefined();
    expect(stored.occasionDetails).toBeUndefined();
    expect(stored.passengerName).toBeUndefined();
    expect(stored.passengerPhone).toBeUndefined();
  });

  it('changes the flight on an airport booking, and refuses it on any other', async () => {
    const { auth } = await makeUser('customer');
    const airport = await book(auth, {
      tripType: 'airport',
      pickup: point('Seattle-Tacoma International Airport'),
      flightDetails: { flightNumber: 'AS100' },
    });
    const ok = await patch(auth, airport, { flightNumber: 'as200' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.flightDetails.flightNumber).toBe('AS200');
    expect(ok.body.data.amendments.at(-1)).toMatchObject({ field: 'flight', from: 'AS100', to: 'AS200' });

    const plain = await book(auth);
    expect((await patch(auth, plain, { flightNumber: 'AS200' })).status).toBe(400);
  });

  it('refuses stops on an hourly charter', async () => {
    const { auth } = await makeUser('customer');
    const id = await book(auth, { tripType: 'hourly', hours: 3 });
    expect((await patch(auth, id, { stops: [point('Pike Place Market')] })).status).toBe(400);
  });

  it('will not change the NUMBER of stops on a booking that is already paid, but will swap one', async () => {
    const { auth } = await makeUser('customer');
    const id = await book(auth, { stops: [point('Pike Place Market')] });
    await Booking.updateOne(
      { _id: id },
      {
        $set: {
          payment: {
            provider: 'stripe', intentId: 'pi_paid', leg: 0, amount: 155, currency: 'USD', status: 'paid',
            refundedAmount: 0, refundIds: [], paidAt: new Date(),
          },
        },
      },
    );

    const locked = await patch(auth, id, { stops: [point('Pike Place Market'), point('Space Needle')] });
    expect(locked.status).toBe(409);
    expect(locked.body.details.code).toBe('STOP_COUNT_LOCKED_BY_PAYMENT');
    expect((await Booking.findById(id))!.stops).toHaveLength(1);

    const swapped = await patch(auth, id, { stops: [point('Space Needle')] });
    expect(swapped.status).toBe(200);
    expect(swapped.body.data.estimatedFare).toBe(155);
  });

  it('closes three hours before pickup, for these details as for any other', async () => {
    const { auth } = await makeUser('customer');
    const soon = new Date(Date.now() + 90 * 60_000).toISOString();
    const id = await book(auth, { scheduledAt: soon });
    const res = await patch(auth, id, { occasion: 'Wedding', vehicleClass: 'sedan-first' });
    expect(res.status).toBe(409);
    expect(res.body.details.code).toBe('CHANGE_WINDOW_CLOSED');
  });

  it('keeps one customer out of another\'s booking', async () => {
    const owner = await makeUser('customer');
    const intruder = await makeUser('customer');
    const id = await book(owner.auth);
    expect((await patch(intruder.auth, id, { checkedBags: 1 })).status).toBe(403);
  });

  it('refuses an empty edit and nonsense', async () => {
    const { auth } = await makeUser('customer');
    const id = await book(auth);
    expect((await patch(auth, id, {})).status).toBe(400);
    expect((await patch(auth, id, { occasion: 'Funeral' })).status).toBe(400);
    expect((await patch(auth, id, { checkedBags: -2 })).status).toBe(400);
  });

  it('does nothing, and says nothing, when an edit changes nothing', async () => {
    const { auth, id: userId } = await makeUser('customer');
    const id = await book(auth, { occasion: 'Wedding', vehicleClass: 'sedan-first', checkedBags: 1 });
    const before = await Notification.countDocuments({ userId });
    const res = await patch(auth, id, { occasion: 'Wedding', checkedBags: 1 });
    expect(res.status).toBe(200);
    expect(res.body.data.amendments).toHaveLength(0);
    expect(await Notification.countDocuments({ userId })).toBe(before);
  });

  it('reports the change as made even if the notice about it cannot be stored', async () => {
    const { auth } = await makeUser('customer');
    const id = await book(auth);
    vi.mocked(notifySend).mockRejectedValue(new Error('notification store down'));
    try {
      const res = await patch(auth, id, { stops: [point('Pike Place Market')] });
      expect(res.status).toBe(200);
      // And it really was saved, so a retry would not double up.
      expect((await Booking.findById(id))!.stops).toHaveLength(1);
    } finally {
      vi.mocked(notifySend).mockReset();
    }
  });

  it('cancels, and reports it, even if the cancellation notice cannot be stored', async () => {
    const { auth } = await makeUser('customer');
    const id = await book(auth);
    vi.mocked(notifySend).mockRejectedValue(new Error('notification store down'));
    try {
      const res = await request(server).delete(`/bookings/${id}`).set('Authorization', auth);
      expect(res.status).toBe(200);
      expect((await Booking.findById(id))!.status).toBe('cancelled');
    } finally {
      vi.mocked(notifySend).mockReset();
    }
  });
});
