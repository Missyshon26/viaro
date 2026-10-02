import { z } from 'zod';
import { TICKET_CATEGORIES, TICKET_STATUSES } from '../../models/SupportTicket';
import { paginationSchema } from '../../utils/pagination';

const objectId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');

export const createTicketSchema = z.object({
  category: z.enum(TICKET_CATEGORIES),
  subject: z.string().min(3).max(200),
  message: z.string().min(3).max(4000),
  tripId: objectId.optional(),
});
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const replySchema = z.object({
  message: z.string().min(1).max(4000),
});
export type ReplyInput = z.infer<typeof replySchema>;

export const updateTicketSchema = z.object({
  status: z.enum(TICKET_STATUSES),
});
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

export const idParamSchema = z.object({ id: objectId });
export type IdParam = z.infer<typeof idParamSchema>;

/** The admin queue filters by who opened the case and by state; both are optional. */
export const TICKET_SOURCES = ['customer', 'driver'] as const;

export const listQuerySchema = paginationSchema.extend({
  source: z.enum(TICKET_SOURCES).optional(),
  status: z.enum(TICKET_STATUSES).optional(),
});
export type ListTicketsQuery = z.infer<typeof listQuerySchema>;
