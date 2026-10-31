import { z } from 'zod';
import { paginationSchema } from '../../utils/pagination';

export const listQuerySchema = paginationSchema.extend({
  /** 'true' lists only the ones not yet read. */
  unread: z.enum(['true', 'false']).optional(),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

export const idParamSchema = z.object({
  id: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid notification id'),
});

export type IdParam = z.infer<typeof idParamSchema>;
