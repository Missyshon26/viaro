import { Types } from 'mongoose';
import { Notification, type NotificationDocument } from '../../models/Notification';
import { User } from '../../models/User';
import { sendSmsOrPush } from '../../integrations/smsPush';
import { emitTo, ns } from '../../sockets/io';
import { format } from '../../config/timezone';
import { logger } from '../../utils/logger';
import { ApiError } from '../../utils/ApiError';
import { paginated, toSkipLimit, type PaginationQuery } from '../../utils/pagination';
import { emailForNotification } from './notification.emails';

/**
 * Single fanout point for every user-facing event (spec §4.8).
 *
 * Trip lifecycle services call notify.send() — they never touch the Notification model,
 * the socket, or the SMS/push provider directly. That keeps one place to change when the
 * delivery channel is finally chosen.
 */
export const NOTIFICATION_TYPES = {
  BOOKING_CREATED: 'booking.created',
  /** An amendment changed what the ride will cost — the customer is told the new figure. */
  BOOKING_REPRICED: 'booking.repriced',
  /** Pickup, drop-off, vehicle or time changed — the customer gets the new details. */
  BOOKING_UPDATED: 'booking.updated',
  /** Cancelled before a chauffeur was assigned (after that it is TRIP_CANCELLED). */
  BOOKING_CANCELLED: 'booking.cancelled',
  DRIVER_ASSIGNED: 'trip.driver_assigned',
  RIDE_OFFER: 'dispatch.ride_offer',
  TRIP_STARTED: 'trip.started',
  TRIP_COMPLETED: 'trip.completed',
  TRIP_CANCELLED: 'trip.cancelled',
  PENALTY_APPLIED: 'driver.penalty_applied',
  REFUND_ISSUED: 'wallet.refund_issued',
  FLIGHT_ARRIVAL: 'flight.arrival_time',
  CANCELLATION_WINDOW_CLOSING: 'booking.cancellation_window_closing',
  PAYOUT_READY: 'wallet.payout_ready',
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

/**
 * Every date inside a notification payload is rendered through the shared timezone helper
 * (spec §8 rule 1) — never with toLocaleString or a raw Date, which would leak the
 * server's zone into a customer's screen.
 */
export function formatWhen(value: Date | string | number): string {
  return format(value);
}

export async function send(
  userId: Types.ObjectId | string,
  type: NotificationType | string,
  payload: Record<string, unknown> = {},
): Promise<NotificationDocument> {
  const notification = await Notification.create({ userId, type, payload, read: false });

  emitTo(ns.notify(String(userId)), 'notification:new', notification.toJSON());

  // Email runs alongside and is not awaited — see notification.emails.ts.
  void emailForNotification(userId, type, payload);

  // PLACEHOLDER delivery channel — logs what would have been sent (spec §4.8).
  try {
    const user = await User.findById(userId).select('phone name').lean();
    if (user) {
      await sendSmsOrPush({
        to: user.phone,
        title: type,
        body: typeof payload.message === 'string' ? payload.message : type,
        data: payload,
      });
    }
  } catch (err) {
    // A delivery failure must never roll back the business action that triggered it.
    logger.warn('Notification delivery failed', err);
  }

  return notification;
}

/** Fan a single event out to several users (e.g. customer + driver on trip completion). */
export async function sendMany(
  userIds: Array<Types.ObjectId | string | undefined | null>,
  type: NotificationType | string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const unique = [...new Set(userIds.filter(Boolean).map(String))];
  await Promise.all(unique.map((id) => send(id, type, payload)));
}

export async function listForUser(userId: string, q: PaginationQuery) {
  const { skip, limit } = toSkipLimit(q);
  const [items, total] = await Promise.all([
    Notification.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments({ userId }),
  ]);
  return paginated(items, total, q);
}

export async function markRead(notificationId: string, userId: string) {
  const notification = await Notification.findById(notificationId);
  if (!notification) throw ApiError.notFound('Notification not found');
  if (String(notification.userId) !== userId) {
    throw ApiError.forbidden('You can only update your own notifications');
  }

  notification.read = true;
  await notification.save();
  return notification;
}
