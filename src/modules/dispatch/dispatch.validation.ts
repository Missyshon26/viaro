import { z } from 'zod';

/** POST /admin/dispatch/:id/assign — the admin naming a driver for a booking. */
export const assignDriverSchema = z.object({
  driverId: z.string().regex(/^[a-fA-F0-9]{24}$/, 'driverId must be a 24-character id'),
});

export type AssignDriverInput = z.infer<typeof assignDriverSchema>;
