import { ChatMessage } from '../../models/ChatMessage';
import { Trip } from '../../models/Trip';
import { Booking } from '../../models/Booking';
import { Driver } from '../../models/Driver';
import { ApiError } from '../../utils/ApiError';
import type { AuthUser } from '../../middlewares/authGuard';
import type { UserRole } from '../../utils/roles';
import { emitTo, ns } from '../../sockets/io';
import * as events from '../events/events.bus';

export interface ChatParticipation {
  tripId: string;
  /** Admins may observe but never post — spec §4.9 "Monitor Chats". */
  canSend: boolean;
}

/**
 * Shared authorisation for both the socket namespace and the REST history endpoint:
 *   customer -> must own the booking       (read + write)
 *   driver   -> must be the assigned driver (read + write)
 *   admin    -> any trip                    (READ ONLY)
 *   company  -> no chat access at all       (spec §2 RBAC matrix)
 */
export async function assertChatAccess(tripId: string, user: AuthUser): Promise<ChatParticipation> {
  const trip = await Trip.findById(tripId).lean();
  if (!trip) throw ApiError.notFound('Trip not found');

  if (user.role === 'admin') return { tripId, canSend: false };

  if (user.role === 'company') {
    throw ApiError.forbidden('Companies do not have access to trip chat');
  }

  if (user.role === 'customer') {
    const booking = await Booking.findById(trip.bookingId).lean();
    if (!booking || String(booking.customerId) !== user.userId) {
      throw ApiError.forbidden('This trip belongs to another customer');
    }
    return { tripId, canSend: true };
  }

  const driver = await Driver.findById(trip.driverId).lean();
  if (!driver || String(driver.userId) !== user.userId) {
    throw ApiError.forbidden('This trip is assigned to another driver');
  }
  return { tripId, canSend: true };
}

export async function saveMessage(
  tripId: string,
  senderId: string,
  senderRole: UserRole,
  message: string,
) {
  const text = message.trim();
  if (!text) throw ApiError.badRequest('Message cannot be empty');
  if (text.length > 2000) throw ApiError.badRequest('Message is too long');

  return ChatMessage.create({ tripId, senderId, senderRole, message: text });
}

/**
 * Post a message — shared by the REST route and the socket namespace, so both save,
 * broadcast and notify identically.
 *
 * Messages used to be accepted ONLY over the '/chat/:tripId' socket, and no Viaro app
 * ever opened that socket, so nobody could send anything. The REST route makes chat work
 * from any client; the socket broadcast is kept for clients that do connect.
 */
export async function postMessage(tripId: string, user: AuthUser, message: string) {
  const participation = await assertChatAccess(tripId, user);
  if (!participation.canSend) {
    throw ApiError.forbidden('Read-only access — admins may monitor chats only');
  }

  const saved = await saveMessage(tripId, user.userId, user.role, message);
  const payload = {
    _id: saved._id,
    tripId,
    senderId: user.userId,
    senderRole: user.role,
    message: saved.message,
    createdAt: saved.createdAt,
  };

  // Anyone connected to the trip's chat socket gets it immediately.
  emitTo(ns.chat(tripId), 'message:new', payload);

  // Open chat screens on the passenger site, chauffeur portal and admin console are
  // told to re-read the thread (they listen on /events).
  const trip = await Trip.findById(tripId).select('bookingId driverId').lean();
  const [booking, driver] = await Promise.all([
    trip ? Booking.findById(trip.bookingId).select('customerId').lean() : null,
    trip ? Driver.findById(trip.driverId).select('userId').lean() : null,
  ]);
  events.publish({
    topic: 'chat',
    action: 'message',
    id: tripId,
    userIds: [booking?.customerId, driver?.userId].filter(Boolean).map(String),
    roles: ['admin'],
  });

  return payload;
}

/** Persisted log for a trip, oldest first (spec §4.9). */
export async function getHistory(tripId: string, user: AuthUser) {
  await assertChatAccess(tripId, user);
  return ChatMessage.find({ tripId })
    .sort({ createdAt: 1 })
    .populate({ path: 'senderId', select: 'name role' })
    .lean();
}
