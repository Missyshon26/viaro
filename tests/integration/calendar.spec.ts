import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import app from '../../src/app';
import { Booking } from '../../src/models/Booking';
import { Driver } from '../../src/models/Driver';
import { Trip } from '../../src/models/Trip';
import { User } from '../../src/models/User';
import {
  CalendarError,
  setCalendarApi,
  type CalendarApi,
  type CalendarEventBody,
} from '../../src/integrations/googleCalendar';
import * as sync from '../../src/modules/calendar/calendar.sync';
import { env } from '../../src/config/env';
import { eventIdFor } from '../../src/modules/calendar/calendar.event';
import * as events from '../../src/modules/events/events.bus';
import { listen, makeUser, pickupIn, point, resetData, seedCatalogue, startDatabase, stopDatabase } from './harness';

vi.mock('../../src/jobs/cancellationWindow.job', () => ({ scheduleCancellationWindowCheck: vi.fn(async () => undefined) }));

/** A Google Calendar in memory: it keeps the events, counts the calls, and can be made to fail. */
class FakeCalendar implements CalendarApi {
  events = new Map<string, CalendarEventBody & { removed?: boolean }>();
  calls: string[] = [];
  insertDelayMs = 0;
  fail: null | { status: number; message: string } = null;
  forget = new Set<string>(); // ids "deleted by hand in Google" — patch answers 404

  private maybeFail() {
    if (this.fail) throw new CalendarError(this.fail.message, this.fail.status);
  }
  async insert(id: string, body: CalendarEventBody) {
    this.calls.push(`insert:${id}`);
    if (this.insertDelayMs) await new Promise((r) => setTimeout(r, this.insertDelayMs));
    this.maybeFail();
    if (this.events.has(id)) throw new CalendarError('The requested identifier already exists.', 409);
    this.events.set(id, body);
    return { id, htmlLink: `https://calendar.test/event/${id}` };
  }
  async patch(id: string, body: Partial<CalendarEventBody>) {
    this.calls.push(`patch:${id}`);
    this.maybeFail();
    if (this.forget.has(id) || !this.events.has(id)) throw new CalendarError('Not Found', 404);
    this.events.set(id, { ...this.events.get(id)!, ...body, removed: false } as never);
    return { id, htmlLink: `https://calendar.test/event/${id}` };
  }
  async remove(id: string) {
    this.calls.push(`remove:${id}`);
    this.maybeFail();
    const e = this.events.get(id);
    if (e) this.events.set(id, { ...e, removed: true });
  }
  async check() {
    this.maybeFail();
    return { name: 'ABL Trips' };
  }
  live() {
    return [...this.events.entries()].filter(([, e]) => !e.removed);
  }
}

const http = listen(app);
const server = http.server;
let cal: FakeCalendar;

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
  cal = new FakeCalendar();
  setCalendarApi(cal);
});
afterEach(() => {
  sync.stopCalendarSync();
  setCalendarApi(null);
  vi.useRealTimers();
});

async function book(over: Record<string, unknown> = {}, who?: { admin: { id: string; auth: string }; client: { id: string; auth: string } }) {
  const admin = who?.admin ?? (await makeUser('admin'));
  const client = who?.client ?? (await makeUser('customer', { name: 'Pat Rider' }));
  const res = await request(server)
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
        ...over,
      },
    });
  expect(res.status).toBe(201);
  return { admin, client, id: String(res.body.data.booking._id) };
}

async function assignChauffeur(bookingId: string) {
  const u = await User.create({ role: 'driver', name: 'Dee Driver', email: `d${Math.random()}@example.com`, phone: '+12065550111', passwordHash: 'x' });
  const d = await Driver.create({ userId: u._id, vehicleClass: 'sedan', status: 'busy' });
  await Trip.create({ bookingId, driverId: d._id, status: 'accepted', fareAmount: 140, timestamps: {} });
  await Booking.updateOne({ _id: bookingId }, { $set: { status: 'assigned' } });
}

describe('putting a booking on the calendar', () => {
  it('creates one event with a fixed id, and remembers what it wrote', async () => {
    const { id } = await book();
    const result = await sync.syncBooking(id);
    expect(result.action).toBe('created');
    expect(cal.live()).toHaveLength(1);
    const [eventId, event] = cal.live()[0];
    expect(eventId).toBe(eventIdFor(id));
    expect(event.summary).toBe('Business Sedan · Pat Rider · Point to point');
    expect(event.colorId).toBe('7');

    const saved = await Booking.findById(id).lean();
    expect(saved!.calendar).toMatchObject({ eventId, link: `https://calendar.test/event/${eventId}` });
    expect(saved!.calendar!.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does nothing when nothing has changed', async () => {
    const { id } = await book();
    await sync.syncBooking(id);
    cal.calls.length = 0;
    expect((await sync.syncBooking(id)).action).toBe('unchanged');
    expect(cal.calls).toEqual([]);
  });

  it('changes the same event when a chauffeur is assigned, and turns it green', async () => {
    const { id } = await book();
    await sync.syncBooking(id);
    await assignChauffeur(id);
    expect((await sync.syncBooking(id)).action).toBe('updated');
    expect(cal.live()).toHaveLength(1);
    const event = cal.live()[0][1];
    expect(event.colorId).toBe('10');
    expect(event.description).toContain('Chauffeur: Dee Driver');
  });

  it('follows the booking when its time changes', async () => {
    const { id } = await book();
    await sync.syncBooking(id);
    await Booking.updateOne({ _id: id }, { $set: { scheduledAt: new Date(Date.now() + 9 * 86_400_000) } });
    expect((await sync.syncBooking(id)).action).toBe('updated');
    expect(cal.live()).toHaveLength(1);
  });

  it('gives each leg of a journey its own event', async () => {
    const admin = await makeUser('admin');
    const client = await makeUser('customer', { name: 'Pat Rider' });
    const res = await request(server)
      .post('/admin/bookings/journey')
      .set('Authorization', admin.auth)
      .send({
        customerId: client.id,
        legs: [0, 1].map((i) => ({
          pickup: point('Hotel Andra, Seattle'),
          drop: point('Sea-Tac Airport'),
          vehicleClass: 'sedan',
          tripType: 'point2point',
          city: 'seattle',
          scheduledAt: pickupIn(5, 10 + i * 6),
        })),
      });
    for (const b of res.body.data.bookings) await sync.syncBooking(String(b._id));
    expect(cal.live()).toHaveLength(2);
    expect(cal.live().map(([, e]) => e.summary).sort()).toEqual([
      expect.stringContaining('Leg 1/2'),
      expect.stringContaining('Leg 2/2'),
    ]);
  });
});

describe('taking a booking off the calendar', () => {
  it('removes the event when the booking is cancelled, once', async () => {
    const { id } = await book();
    await sync.syncBooking(id);
    await Booking.updateOne({ _id: id }, { $set: { status: 'cancelled' } });
    expect((await sync.syncBooking(id)).action).toBe('removed');
    expect(cal.live()).toHaveLength(0);
    expect((await Booking.findById(id).lean())!.calendar!.removed).toBe(true);

    cal.calls.length = 0;
    expect((await sync.syncBooking(id)).action).toBe('skipped');
    expect(cal.calls).toEqual([]);
  });

  it('never touches Google for a booking that was cancelled before it was ever added', async () => {
    const { id } = await book();
    await Booking.updateOne({ _id: id }, { $set: { status: 'cancelled' } });
    expect((await sync.syncBooking(id)).action).toBe('skipped');
    expect(cal.calls).toEqual([]);
  });

  it('skips a trip that was long ago and never added', async () => {
    const { id } = await book();
    await Booking.updateOne({ _id: id }, { $set: { scheduledAt: new Date(Date.now() - 5 * 86_400_000) } });
    expect((await sync.syncBooking(id)).action).toBe('skipped');
    expect(cal.calls).toEqual([]);
  });
});

describe('when Google disagrees with us', () => {
  it('puts the event back if someone deleted it by hand', async () => {
    const { id } = await book();
    await sync.syncBooking(id);
    cal.events.delete(eventIdFor(id));
    await Booking.updateOne({ _id: id }, { $set: { scheduledAt: new Date(Date.now() + 8 * 86_400_000) } });
    expect((await sync.syncBooking(id)).action).toBe('created');
    expect(cal.live()).toHaveLength(1);
  });

  it('changes the existing event instead of failing when its id is already taken', async () => {
    const { id } = await book();
    cal.events.set(eventIdFor(id), { summary: 'old', description: '', start: { dateTime: '', timeZone: '' }, end: { dateTime: '', timeZone: '' }, reminders: { useDefault: false, overrides: [] }, removed: true });
    expect((await sync.syncBooking(id)).action).toBe('created');
    expect(cal.live()).toHaveLength(1);
    expect(cal.live()[0][1].summary).toContain('Pat Rider');
  });

  it('leaves the booking marked as needing a sync when Google fails, and the sweep finishes it', async () => {
    const { id } = await book();
    cal.fail = { status: 500, message: 'Backend Error' };
    await expect(sync.syncBooking(id)).rejects.toThrow('Backend Error');
    expect((await Booking.findById(id).lean())!.calendar!.hash).toBe('pending');
    expect(cal.live()).toHaveLength(0);

    cal.fail = null;
    const swept = await sync.sweepOnce();
    expect(swept).toMatchObject({ tried: 1, failed: 0 });
    expect(cal.live()).toHaveLength(1);
    expect((await Booking.findById(id).lean())!.calendar!.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('several changes at once', () => {
  it('never lets an older run overwrite a newer one, and never makes two events', async () => {
    const { id } = await book();
    cal.insertDelayMs = 60;
    const first = sync.syncInOrder(id); // slow: reads the booking with no chauffeur
    await new Promise((r) => setTimeout(r, 10));
    await assignChauffeur(id); // the booking changes while the first run is mid-flight
    const second = sync.syncInOrder(id);
    await Promise.all([first, second]);

    expect(cal.live()).toHaveLength(1);
    const event = cal.live()[0][1];
    expect(event.colorId).toBe('10');
    expect(event.description).toContain('Chauffeur: Dee Driver');
    expect(cal.calls.filter((c) => c.startsWith('insert'))).toHaveLength(1);
  });

  it('many requests for one booking end with one correct event', async () => {
    const { id } = await book();
    await Promise.all(Array.from({ length: 8 }, () => sync.syncInOrder(id)));
    expect(cal.live()).toHaveLength(1);
    expect(cal.calls.filter((c) => c.startsWith('insert'))).toHaveLength(1);
  });
});

describe('the sweep', () => {
  it('backfills bookings made before the calendar was switched on, soonest first', async () => {
    const who = { admin: await makeUser('admin'), client: await makeUser('customer', { name: 'Pat Rider' }) };
    await book({ scheduledAt: pickupIn(9) }, who);
    await book({ scheduledAt: pickupIn(3) }, who);
    await book({ scheduledAt: pickupIn(6) }, who);

    const swept = await sync.sweepOnce();
    expect(swept).toMatchObject({ tried: 3, failed: 0 });
    expect(cal.live()).toHaveLength(3);
    expect((await sync.sweepOnce()).tried).toBe(0); // nothing left to do
  });

  it('leaves out bookings made before the switch-on date, and adds the ones made after', async () => {
    const who = { admin: await makeUser('admin'), client: await makeUser('customer', { name: 'Pat Rider' }) };
    const old = (await book({ scheduledAt: pickupIn(4) }, who)).id;
    // createdAt is immutable through Mongoose, so write it underneath.
    await Booking.collection.updateOne({ _id: new Types.ObjectId(old) }, { $set: { createdAt: new Date('2020-01-01T00:00:00Z') } });
    const fresh = (await book({ scheduledAt: pickupIn(5) }, who)).id;

    env.GOOGLE_CALENDAR_SYNC_FROM = '2026-01-01T00:00:00Z';
    try {
      expect(await sync.sweepOnce()).toMatchObject({ tried: 1, failed: 0 });
      expect(cal.calls).toEqual([`insert:${eventIdFor(fresh)}`]);
      expect((await sync.syncBooking(old)).action).toBe('skipped');
      expect(cal.live()).toHaveLength(1);
    } finally {
      delete env.GOOGLE_CALENDAR_SYNC_FROM;
    }
  });

  it('removes events for bookings cancelled while the calendar was unreachable', async () => {
    const { id } = await book();
    await sync.syncBooking(id);
    await Booking.updateOne({ _id: id }, { $set: { status: 'cancelled' } });
    expect((await sync.sweepOnce()).tried).toBe(1);
    expect(cal.live()).toHaveLength(0);
  });

  it('notices a booking changed since it was synced, and not our own bookkeeping', async () => {
    const { id } = await book();
    await sync.syncBooking(id);
    expect((await sync.sweepOnce()).tried).toBe(0); // writing the calendar record is not an edit

    await new Promise((r) => setTimeout(r, 5));
    await Booking.updateOne({ _id: id }, { $set: { passengers: 4 } });
    expect((await sync.sweepOnce()).tried).toBe(1);
    expect((await sync.sweepOnce()).tried).toBe(0);
  });

  it('treats an edit in the very same instant as a sync as still to do, then settles', async () => {
    const { id } = await book();
    await sync.syncBooking(id);
    const syncedAt = (await Booking.findById(id).lean())!.calendar!.syncedAt;
    await Booking.updateOne({ _id: id }, { $set: { passengers: 4, updatedAt: syncedAt } }, { timestamps: false });

    expect((await sync.sweepOnce()).tried).toBe(1);
    expect(cal.live()[0][1].description).toContain('Party of 4');
    expect((await sync.sweepOnce()).tried).toBe(0);
  });

  it('a check that finds nothing to change is recorded, so it is not repeated', async () => {
    const { id } = await book();
    await sync.syncBooking(id);
    const syncedAt = (await Booking.findById(id).lean())!.calendar!.syncedAt;
    // Touched but not in any way the calendar shows.
    await Booking.updateOne({ _id: id }, { $set: { updatedAt: syncedAt } }, { timestamps: false });

    expect((await sync.sweepOnce()).tried).toBe(1);
    cal.calls.length = 0;
    expect((await sync.sweepOnce()).tried).toBe(0);
    expect(cal.calls).toEqual([]);
  });

  it('keeps going past a failure and reports it', async () => {
    const who = { admin: await makeUser('admin'), client: await makeUser('customer', { name: 'Pat Rider' }) };
    await book({ scheduledAt: pickupIn(3) }, who);
    await book({ scheduledAt: pickupIn(4) }, who);
    cal.fail = { status: 403, message: 'Forbidden' };
    const swept = await sync.sweepOnce();
    expect(swept).toMatchObject({ tried: 2, failed: 2, firstError: 'Forbidden' });
  });
});

describe('listening for changes', () => {
  it('syncs a booking when the system announces it changed, without anyone waiting', async () => {
    const { id } = await book();
    sync.startCalendarSync();
    events.publish({ topic: 'booking', action: 'created', id, roles: ['admin'] });
    await vi.waitFor(() => expect(cal.live()).toHaveLength(1));
  });

  it('syncs the booking behind a trip event', async () => {
    const { id } = await book();
    await sync.syncBooking(id);
    await assignChauffeur(id);
    const trip = await Trip.findOne({ bookingId: id }).lean();
    sync.startCalendarSync();
    events.publish({ topic: 'trip', action: 'accepted', id: String(trip!._id), roles: ['admin'] });
    await vi.waitFor(() => expect(cal.live()[0][1].colorId).toBe('10'));
  });

  it('retries after a failure instead of giving up', async () => {
    const { id } = await book();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    cal.fail = { status: 500, message: 'Backend Error' };
    sync.scheduleSync(id);
    await vi.waitFor(() => expect(cal.calls.length).toBeGreaterThanOrEqual(1));
    cal.fail = null;
    await vi.advanceTimersByTimeAsync(sync.RETRY_DELAYS_MS[0] + 100);
    await vi.waitFor(() => expect(cal.live()).toHaveLength(1));
  });

  it('does nothing at all when the calendar is not set up', async () => {
    setCalendarApi(null);
    const { id } = await book();
    expect((await sync.syncBooking(id)).action).toBe('skipped');
    sync.scheduleSync(id);
    sync.startCalendarSync();
    events.publish({ topic: 'booking', action: 'created', id, roles: ['admin'] });
    await new Promise((r) => setTimeout(r, 30));
    expect(cal.calls).toEqual([]);
    expect(await sync.sweepOnce()).toEqual({ tried: 0, failed: 0 });
    expect(await sync.calendarStatus()).toEqual({ enabled: false });
  });
});

describe('the console', () => {
  const asAdmin = async () => makeUser('admin');

  it('shows whether the calendar is reachable', async () => {
    const admin = await asAdmin();
    const ok = await request(server).get('/admin/calendar/status').set('Authorization', admin.auth);
    expect(ok.body.data).toEqual({ enabled: true, ok: true, name: 'ABL Trips' });

    cal.fail = { status: 404, message: 'Not Found' };
    const bad = await request(server).get('/admin/calendar/status').set('Authorization', admin.auth);
    expect(bad.body.data).toMatchObject({ enabled: true, ok: false });
    expect(bad.body.data.error).toMatch(/shared with the service account/);
  });

  it('syncs one booking now and returns the link', async () => {
    const { admin, id } = await book();
    const res = await request(server).post(`/admin/bookings/${id}/calendar-sync`).set('Authorization', admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ action: 'created', link: expect.stringContaining('calendar.test') });
  });

  it('says why when Google refuses, in words that tell you what to fix', async () => {
    const { admin, id } = await book();
    cal.fail = { status: 403, message: 'Forbidden' };
    const res = await request(server).post(`/admin/bookings/${id}/calendar-sync`).set('Authorization', admin.auth);
    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/Make changes to events/);
  });

  it('says so when the calendar is not set up', async () => {
    const { admin, id } = await book();
    setCalendarApi(null);
    const res = await request(server).post(`/admin/bookings/${id}/calendar-sync`).set('Authorization', admin.auth);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/not set up/);
  });

  it('is admin only', async () => {
    const { client, id } = await book();
    expect((await request(server).post(`/admin/bookings/${id}/calendar-sync`).set('Authorization', client.auth)).status).toBe(403);
    expect((await request(server).get('/admin/calendar/status').set('Authorization', client.auth)).status).toBe(403);
  });
});

describe('explaining Google\'s errors', () => {
  it('names the likely fix for the ones people hit', () => {
    expect(sync.explain(new CalendarError('Not Found', 404))).toMatch(/calendar id/);
    expect(sync.explain(new CalendarError('Forbidden', 403))).toMatch(/Make changes to events/);
    expect(sync.explain(new CalendarError('invalid_grant', 401))).toMatch(/GOOGLE_SERVICE_ACCOUNT_JSON/);
    expect(sync.explain(new Error('socket hang up'))).toBe('socket hang up');
  });
});

describe('who sees the calendar record', () => {
  it('only operations: it is bookkeeping, and links into their calendar', async () => {
    const { admin, client, id } = await book();
    await sync.syncBooking(id);

    const mine = await request(server).get(`/bookings/${id}`).set('Authorization', client.auth);
    expect(mine.status).toBe(200);
    expect(mine.body.data.calendar).toBeUndefined();

    const list = await request(server).get('/users/me/rides').set('Authorization', client.auth);
    expect(JSON.stringify(list.body)).not.toContain('calendar.test');

    const ops = await request(server).get(`/bookings/${id}`).set('Authorization', admin.auth);
    expect(ops.body.data.calendar).toMatchObject({ link: expect.stringContaining('calendar.test') });
  });
});
