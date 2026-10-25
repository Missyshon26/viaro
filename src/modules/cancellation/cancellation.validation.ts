import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid trip id'),
});

export type IdParam = z.infer<typeof idParamSchema>;

export const cancelBodySchema = z
  .object({
    reason: z.string().min(3).max(300).optional(),
  })
  .optional()
  .default({});

export type CancelBody = z.infer<typeof cancelBodySchema>;
