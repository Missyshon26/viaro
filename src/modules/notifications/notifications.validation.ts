import { z } from 'zod';
import { paginationSchema } from '../../utils/pagination';

export const listQuerySchema = paginationSchema;

export const idParamSchema = z.object({
  id: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid notification id'),
});

export type IdParam = z.infer<typeof idParamSchema>;
