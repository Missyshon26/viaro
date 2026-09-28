import { Types } from 'mongoose';
import { getSettingsValues } from '../admin/settings.service';
import { SupportTicket } from '../../models/SupportTicket';
import { ApiError } from '../../utils/ApiError';
import { now, toDate } from '../../config/timezone';
import type { AuthUser } from '../../middlewares/authGuard';
import { paginated, toSkipLimit, type PaginationQuery } from '../../utils/pagination';
import * as notify from '../notifications/notifications.service';
import { User } from '../../models/User';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { sendEmail } from '../../integrations/email';
import type { CreateTicketInput, ReplyInput, UpdateTicketInput } from './support.validation';

/**
 * Access rule: a user sees only their own tickets; admins see every ticket.
 * Companies are excluded — a driver's appeal is between them and the platform.
 */
async function loadTicketFor(ticketId: string, user: AuthUser) {
  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) throw ApiError.notFound('Ticket not found');

  if (user.role !== 'admin' && String(ticket.userId) !== user.userId) {
    throw ApiError.forbidden('This ticket belongs to another user');
  }

  return ticket;
}

const CATEGORY_LABEL: Record<string, string> = {
  trip_dispute: 'Trip dispute',
  penalty_appeal: 'Penalty appeal',
  payment: 'Payment',
  account: 'Account',
  other: 'Other',
};

/**
 * Emails the support inbox (admin Settings) when a user opens a case or adds to one.
 *
 * Cases used to exist only in the admin console, so nobody knew one had arrived until
 * they happened to look. Best effort and never awaited by the caller's outcome: a mail
 * outage must not stop a customer filing a dispute.
 */
async function alertSupportInbox(
  ticket: { _id: unknown; subject: string; category: string; tripId?: unknown },
  user: AuthUser,
  message: string,
  kind: 'new' | 'reply',
) {
  try {
    const { supportInboxEmail } = await getSettingsValues();
    if (!supportInboxEmail) return;
    const from = await User.findById(user.userId).select('name email phone').lean();
    const who = from ? `${from.name} <${from.email}>${from.phone ? `, ${from.phone}` : ''}` : user.userId;
    const lines = [
      kind === 'new' ? 'A new support case was opened.' : 'The customer replied to a support case.',
      '',
      `Case:     ${ticket.subject}`,
      `Type:     ${CATEGORY_LABEL[ticket.category] ?? ticket.category}`,
      `From:     ${who} (${user.role})`,
      ticket.tripId ? `Trip:     ${String(ticket.tripId)}` : null,
      `Case ID:  ${String(ticket._id)}`,
      '',
      message,
      '',
      'Reply from the admin console so the customer sees it in their account.',
    ].filter((line) => line !== null);

    await sendEmail({
      to: supportInboxEmail,
      replyTo: from?.email,
      subject: `${kind === 'new' ? '[New case]' : '[Reply]'} ${CATEGORY_LABEL[ticket.category] ?? 'Support'}: ${ticket.subject}`,
      text: lines.join('\n'),
    });
  } catch (err) {
    logger.error('[support] inbox alert failed', err);
  }
}

export async function createTicket(user: AuthUser, input: CreateTicketInput) {
  const ticket = await SupportTicket.create({
    userId: user.userId,
    category: input.category,
    subject: input.subject,
    tripId: input.tripId,
    status: 'open',
    messages: [{ senderId: user.userId, senderRole: user.role, message: input.message }],
  });
  void alertSupportInbox(ticket, user, input.message, 'new');
  return ticket;
}

export async function listTickets(user: AuthUser, q: PaginationQuery) {
  const filter = user.role === 'admin' ? {} : { userId: user.userId };
  const { skip, limit } = toSkipLimit(q);

  const [items, total] = await Promise.all([
    SupportTicket.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    SupportTicket.countDocuments(filter),
  ]);

  return paginated(items, total, q);
}

export async function getTicket(ticketId: string, user: AuthUser) {
  return loadTicketFor(ticketId, user);
}

export async function reply(ticketId: string, user: AuthUser, input: ReplyInput) {
  const ticket = await loadTicketFor(ticketId, user);
  if (ticket.status === 'closed') throw ApiError.conflict('This ticket is closed');

  ticket.messages.push({
    senderId: new Types.ObjectId(user.userId),
    senderRole: user.role,
    message: input.message,
    // Spec §8.1: every stored timestamp goes through the shared timezone helper, never a
    // raw `new Date()` — otherwise the server's zone leaks into a customer's transcript.
    createdAt: toDate(now()),
  });

  // An agent reply puts the ball back in the user's court, and vice versa.
  ticket.status = user.role === 'admin' ? 'pending' : 'open';
  await ticket.save();

  if (user.role === 'admin') {
    await notify.send(ticket.userId, 'support.reply', {
      message: `Support replied to "${ticket.subject}"`,
      ticketId: String(ticket._id),
    });
  } else {
    void alertSupportInbox(ticket, user, input.message, 'reply');
  }

  return ticket;
}

/** Admin-only: move a ticket through its lifecycle. */
export async function updateStatus(ticketId: string, input: UpdateTicketInput) {
  const ticket = await SupportTicket.findByIdAndUpdate(
    ticketId,
    { $set: { status: input.status } },
    { new: true },
  );
  if (!ticket) throw ApiError.notFound('Ticket not found');

  await notify.send(ticket.userId, 'support.status', {
    message: `Your ticket "${ticket.subject}" is now ${ticket.status}`,
    ticketId: String(ticket._id),
    status: ticket.status,
  });

  return ticket;
}
