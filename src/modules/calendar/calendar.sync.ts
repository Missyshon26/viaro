import type { Types } from 'mongoose';
import { Booking, type IBooking } from '../../models/Booking';
import { Driver } from '../../models/Driver';
import { Trip } from '../../models/Trip';
import { User } from '../../models/User';
import { adminWebUrl } from '../../config/env';
import { now, toDate } from '../../config/timezone';
import { logger } from '../../utils/logger';
import {
  CalendarError,
  getCalendarApi,
  isCalendarEnabled,
  type CalendarApi,
} from '../../integrations/googleCalendar';
import * as events from '../events/events.bus';
import * as vehicleService from '../vehicle/vehicle.service';
import { bookingReference } from '../booking/booking.documents';
import { buildCalendarEvent, eventHash, eventIdFor } from './calendar.event';

/**
 * Keeps one shared Google Calendar in step with the bookings.
 *
 *   a live booking        -> one event, created once and then changed in place
 *   a cancelled booking   -> its event is taken off the calendar
 *
 * How it stays right without being fragile:
 *
 *  - The event id is chosen by us (see eventIdFor), so creating twice cannot make two.
 *  - The booking is the only source of truth. A sync always re-reads it, so it does not
 *    matter which change triggered it or how many arrived at once.
 *  - Syncs for the same booking run one after another, so an older run can never finish
 *    after a newer one and overwrite it.
 *  - The intent is recorded BEFORE Google is called, so a crash between the two leaves a
 *    booking marked as needing a sync, never an invisible event.
 *  - A fingerprint of what was last written skips a sync that would change nothing.
 *  - A periodic sweep re-checks anything a missed trigger, a restart or a Google outage left
 *    behind, and backfills bookings made before the calendar was switched on.
 *
 * A calendar problem never touches a booking: every failure here is logged and retried, and
 * nothing in the booking flow waits for it.
 */

export type SyncAction = 'created' | 'updated' | 'removed' | 'unchanged' | 'skipped';
export interface SyncResult {
  action: SyncAction;
  link?: string;
  /** Why nothing was done, for `skipped`. */
  reason?: string;
}

/** Events older than this are not worth creating: the day has long passed. */
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

const calendarWrite = (id: string, set: Record<string, unknown>) =>
  // `timestamps: false`: our own bookkeeping must not look like the booking being edited,
  // or the sweep would think every synced booking had changed since it was synced.
  Booking.updateOne({ _id: id }, { $set: set }, { timestamps: false });

async function chauffeurFor(bookingId: Types.ObjectId) {
  const trip = await Trip.findOne({ bookingId, status: { $in: ['accepted', 'started', 'completed'] } })
    .select('driverId')
    .lean();
  if (!trip) return null;
  const driver = await Driver.findById(trip.driverId).select('userId').lean();
  const user = driver ? await User.findById(driver.userId).select('name phone').lean() : null;
  return user ? { name: user.name, phone: user.phone } : null;
}

/** Writes (or removes) the one event for this booking, if the calendar needs it. */
export async function syncBooking(bookingId: string, api: CalendarApi | null = getCalendarApi()): Promise<SyncResult> {
  if (!api) return { action: 'skipped', reason: 'The calendar is not set up' };

  const booking = await Booking.findById(bookingId).lean();
  if (!booking) return { action: 'skipped', reason: 'Booking not found' };

  const eventId = booking.calendar?.eventId ?? eventIdFor(bookingId);

  /* ---------------------------------- cancelled --------------------------------- */
  if (booking.status === 'cancelled') {
    // Never put on the calendar, or already off it: nothing to do.
    if (!booking.calendar || booking.calendar.removed) return { action: 'skipped', reason: 'Cancelled and not on the calendar' };
    await api.remove(eventId);
    await calendarWrite(bookingId, {
      calendar: { eventId, hash: 'removed', syncedAt: toDate(now()), removed: true },
    });
    return { action: 'removed' };
  }

  /* ----------------------------------- live ------------------------------------- */
  if (booking.scheduledAt.getTime() < Date.now() - LOOKBACK_MS && !booking.calendar) {
    return { action: 'skipped', reason: 'The trip was too long ago to add' };
  }

  const [customer, vehicleLabel, chauffeur] = await Promise.all([
    User.findById(booking.customerId).select('name phone email').lean(),
    vehicleService.labelFor(booking.vehicleClass),
    chauffeurFor(booking._id),
  ]);

  const body = buildCalendarEvent({
    booking: booking as IBooking,
    ref: bookingReference(booking._id),
    vehicleLabel,
    customer,
    chauffeur,
    consoleUrl: adminWebUrl ? `${adminWebUrl}/trips/${String(booking._id)}` : undefined,
  });
  const hash = eventHash(body);

  const onCalendar = Boolean(booking.calendar && !booking.calendar.removed);
  if (onCalendar && booking.calendar!.hash === hash) {
    // Checked and still right: record that, so the sweep does not look at it again.
    if (booking.calendar!.syncedAt.getTime() <= booking.updatedAt.getTime()) {
      await calendarWrite(bookingId, { 'calendar.syncedAt': toDate(now()) });
    }
    return { action: 'unchanged', link: booking.calendar!.link };
  }

  // Intent first: if the process dies before Google answers, the booking still says it
  // needs syncing (hash 'pending' matches nothing) and the event, if it was made, is known.
  await calendarWrite(bookingId, {
    calendar: {
      eventId,
      hash: 'pending',
      syncedAt: booking.calendar?.syncedAt ?? toDate(now()),
      ...(booking.calendar?.link ? { link: booking.calendar.link } : {}),
    },
  });

  let result: { id: string; htmlLink?: string };
  let action: SyncAction;

  if (onCalendar) {
    try {
      result = await api.patch(eventId, body);
      action = 'updated';
    } catch (err) {
      // Deleted by hand in Google Calendar: put it back.
      if (!(err instanceof CalendarError) || (err.status !== 404 && err.status !== 410)) throw err;
      result = await insertOrRevive(api, eventId, body);
      action = 'created';
    }
  } else {
    result = await insertOrRevive(api, eventId, body);
    action = 'created';
  }

  await calendarWrite(bookingId, {
    calendar: { eventId, hash, syncedAt: toDate(now()), ...(result.htmlLink ? { link: result.htmlLink } : {}) },
  });
  return { action, link: result.htmlLink };
}

/**
 * Creates the event. If its id already exists — a retry after a crash, or an event that was
 * removed earlier (Google keeps a removed event's id) — the existing one is changed and
 * brought back instead.
 */
async function insertOrRevive(api: CalendarApi, eventId: string, body: Parameters<CalendarApi['insert']>[1]) {
  try {
    return await api.insert(eventId, body);
  } catch (err) {
    if (err instanceof CalendarError && err.status === 409) {
      return api.patch(eventId, { ...body, status: 'confirmed' });
    }
    throw err;
  }
}

/* ------------------------------ running it safely ------------------------------ */

const chains = new Map<string, Promise<unknown>>();

/**
 * Runs the sync for one booking after any earlier run for it has finished. Each run reads
 * the booking afresh, so the last one always writes the final state.
 */
export function syncInOrder(bookingId: string): Promise<SyncResult> {
  const previous = chains.get(bookingId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => syncBooking(bookingId));
  chains.set(bookingId, next);
  const clear = () => {
    if (chains.get(bookingId) === next) chains.delete(bookingId);
  };
  next.then(clear, clear);
  return next;
}

/** Waits between retries after a failure: Google being briefly down should not need a person. */
export const RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 600_000];

/** Fire and forget, with retries. Never throws; never makes anyone wait. */
export function scheduleSync(bookingId: string, attempt = 0): void {
  if (!isCalendarEnabled()) return;
  syncInOrder(bookingId).catch((err) => {
    const delay = RETRY_DELAYS_MS[attempt];
    logger.warn(
      `Calendar sync failed for booking ${bookingId} (attempt ${attempt + 1})${delay ? `; trying again in ${Math.round(delay / 1000)}s` : '; the periodic sweep will pick it up'}: ${(err as Error).message}`,
    );
    if (delay === undefined) return;
    setTimeout(() => scheduleSync(bookingId, attempt + 1), delay).unref();
  });
}

/* --------------------------------- the sweep ---------------------------------- */

/**
 * Finds every booking whose calendar entry is missing, stale or still waiting on a
 * cancellation, and syncs it. Returns how many it tried and how many failed.
 */
export async function sweepOnce(limit = 500): Promise<{ tried: number; failed: number; firstError?: string }> {
  if (!isCalendarEnabled()) return { tried: 0, failed: 0 };

  const since = new Date(Date.now() - LOOKBACK_MS);
  const live = await Booking.find({
    status: { $ne: 'cancelled' },
    scheduledAt: { $gte: since },
    $or: [
      { calendar: { $exists: false } },
      { 'calendar.removed': true },
      { 'calendar.hash': 'pending' },
      // Same instant counts as stale: an edit in the very millisecond of a sync may have
      // landed after the sync read the booking.
      { $expr: { $lte: ['$calendar.syncedAt', '$updatedAt'] } },
    ],
  })
    .select('_id')
    .sort({ scheduledAt: 1 })
    .limit(limit)
    .lean();

  const room = Math.max(0, limit - live.length);
  const cancelled = room
    ? await Booking.find({ status: 'cancelled', calendar: { $exists: true }, 'calendar.removed': { $ne: true } })
        .select('_id')
        .limit(room)
        .lean()
    : [];

  let failed = 0;
  let firstError: string | undefined;
  // One at a time: the volume is small and Google's per-minute quota is not.
  for (const { _id } of [...live, ...cancelled]) {
    try {
      await syncInOrder(String(_id));
    } catch (err) {
      failed += 1;
      firstError ??= (err as Error).message;
    }
  }
  return { tried: live.length + cancelled.length, failed, ...(firstError ? { firstError } : {}) };
}

/* ----------------------------- starting and stopping ----------------------------- */

const SWEEP_EVERY_MS = 10 * 60 * 1000;
const FIRST_SWEEP_AFTER_MS = 30_000;

let stop: (() => void) | null = null;

/**
 * Starts listening for booking and trip changes and sweeping. Called once at boot; does
 * nothing at all when the calendar is not set up, so the feature costs nothing until used.
 */
export function startCalendarSync(): void {
  if (stop) return;
  if (!isCalendarEnabled()) {
    logger.info('Calendar sync is off (GOOGLE_CALENDAR_ID and GOOGLE_SERVICE_ACCOUNT_JSON are not both set)');
    return;
  }

  const unsubscribe = events.subscribe((event) => {
    if (!event.id) return;
    if (event.topic === 'booking') {
      scheduleSync(event.id);
    } else if (event.topic === 'trip') {
      // A trip event names the trip; the calendar is organised by booking.
      void Trip.findById(event.id)
        .select('bookingId')
        .lean()
        .then((trip) => trip && scheduleSync(String(trip.bookingId)))
        .catch((err) => logger.warn('Calendar sync could not resolve a trip event', err));
    }
  });

  const runSweep = () =>
    sweepOnce()
      .then(({ tried, failed, firstError }) => {
        if (tried) logger.info(`Calendar sweep: ${tried - failed} of ${tried} bookings synced${failed ? `; first failure: ${firstError}` : ''}`);
      })
      .catch((err) => logger.warn('Calendar sweep failed', err));

  const first = setTimeout(runSweep, FIRST_SWEEP_AFTER_MS);
  const every = setInterval(runSweep, SWEEP_EVERY_MS);
  first.unref();
  every.unref();

  stop = () => {
    unsubscribe();
    clearTimeout(first);
    clearInterval(every);
    stop = null;
  };
  logger.info('Calendar sync is on');
}

export function stopCalendarSync(): void {
  stop?.();
}

/** For the console: is the calendar reachable, and shared with us? */
export async function calendarStatus(): Promise<{ enabled: boolean; ok?: boolean; name?: string; error?: string }> {
  const api = getCalendarApi();
  if (!api) return { enabled: false };
  try {
    const { name } = await api.check();
    return { enabled: true, ok: true, name };
  } catch (err) {
    return { enabled: true, ok: false, error: explain(err) };
  }
}

/** Google's own wording, plus the likeliest fix for the errors people actually hit. */
export function explain(err: unknown): string {
  const message = (err as Error).message || 'Google Calendar did not answer';
  if (err instanceof CalendarError) {
    if (err.status === 404) {
      return `${message}. The calendar was not found: check the calendar id, and that the calendar is shared with the service account.`;
    }
    if (err.status === 403) {
      return `${message}. Share the calendar with the service account and give it "Make changes to events", and make sure the Google Calendar API is enabled.`;
    }
    if (err.status === 401) return `${message}. The service account key was not accepted: check GOOGLE_SERVICE_ACCOUNT_JSON.`;
  }
  return message;
}
