import { z } from 'zod';
import { paginationSchema } from '../../utils/pagination';

/** GET /admin/dispatch/pool */
export const poolQuerySchema = paginationSchema;

export type PoolQuery = z.infer<typeof poolQuerySchema>;

/** POST /admin/dispatch/:id/assign — the admin naming a chauffeur for a booking. */
export const assignDriverSchema = z.object({
  driverId: z.string().regex(/^[a-fA-F0-9]{24}$/, 'driverId must be a 24-character id'),
});

export type AssignDriverInput = z.infer<typeof assignDriverSchema>;

/**
 * Socket payload for 'location:update' on the /dispatch namespace. Validated in
 * dispatch.socket.ts — socket frames never reach Express validation middleware.
 */
export const locationUpdateSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export type LocationUpdateInput = z.infer<typeof locationUpdateSchema>;
