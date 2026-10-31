import { Notification } from '../../models/Notification';
import { User } from '../../models/User';
import { logger } from '../../utils/logger';
import * as events from '../events/events.bus';

/**
 * Notifications for the people who run the platform.
 *
 * notify.send() tells a passenger or a chauffeur about THEIR trip. Nothing told operations
 * anything, so the console's bell was always empty. These are the events operations needs to
 * act on — a booking to look at, a cancellation, nobody to send, a case waiting — written once
 * for every admin so each has their own read / unread state.
 *
 * Deliberately separate from notify.send(): that also emails and pushes to the user, which for an
 * operator would mean a message per event on top of the one in the console. Never throws, and
 * callers do not wait for it: a notice that fails must not undo the thing it is about.
 */
export const OPS_NOTIFICATIONS = {
  BOOKING_CREATED: 'ops.booking_created',
  BOOKING_CHANGED: 'ops.booking_changed',
  BOOKING_CANCELLED: 'ops.booking_cancelled',
  TRIP_CANCELLED: 'ops.trip_cancelled',
  DRIVER_CANCELLED: 'ops.driver_cancelled',
  DRIVER_REGISTERED: 'ops.driver_registered',
  SUPPORT_NEW: 'ops.support_new',
  SUPPORT_REPLY: 'ops.support_reply',
  PAYMENT_FAILED: 'ops.payment_failed',
} as const;

export type OpsNotificationType = (typeof OPS_NOTIFICATIONS)[keyof typeof OPS_NOTIFICATIONS];

/** What the console links a notice to. All optional: some notices are about a person, not a record. */
export interface OpsPayload {
  message: string;
  bookingId?: string;
  tripId?: string;
  ticketId?: string;
  driverId?: string;
  [extra: string]: unknown;
}

/** The short, quotable booking reference ("ABL-7849B0") — the same one the customer's emails use. */
export const bookingRef = (id: unknown) => `ABL-${String(id).slice(-6).toUpperCase()}`;

export async function notifyOps(type: OpsNotificationType, payload: OpsPayload): Promise<void> {
  try {
    const admins = await User.find({ role: 'admin', deletedAt: null }).select('_id').lean();
    if (admins.length === 0) return;

    await Notification.insertMany(
      admins.map((admin) => ({ userId: admin._id, type, payload, read: false })),
      { ordered: false },
    );

    // Open consoles refresh their bell now instead of at the next poll.
    events.publish({ topic: 'notification', action: 'created', roles: ['admin'] });
  } catch (err) {
    logger.warn(`Could not record the operations notice '${type}'`, err);
  }
}
