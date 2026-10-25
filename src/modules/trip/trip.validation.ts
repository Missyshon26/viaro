import { z } from 'zod';

import { paginationSchema } from '../../utils/pagination';
import { TRIP_STATUSES } from '../../models/Trip';

const objectId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');

/** GET /trips — role-scoped list (driver Schedule, customer trips). */
export const listTripsQuerySchema = paginationSchema.extend({
  status: z.enum(TRIP_STATUSES).optional(),
});

export type ListTripsQuery = z.infer<typeof listTripsQuerySchema>;

export const idParamSchema = z.object({ id: objectId });

export type IdParam = z.infer<typeof idParamSchema>;

export const cancelSchema = z.object({
  reason: z.string().min(3).max(300).optional(),
});

export type CancelInput = z.infer<typeof cancelSchema>;

export const vehicleClassSchema = z.object({
  vehicleClass: z.string().min(1).max(60),
});

export type VehicleClassInput = z.infer<typeof vehicleClassSchema>;

const geoPointSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  address: z.string().min(3).max(300),
});

export const changeLocationSchema = z
  .object({
    pickup: geoPointSchema.optional(),
    drop: geoPointSchema.optional(),
  })
  .refine((d) => d.pickup || d.drop, { message: 'Supply pickup, drop, or both' });

export type ChangeLocationInput = z.infer<typeof changeLocationSchema>;

export const rateSchema = z.object({
  score: z.coerce.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

export type RateInput = z.infer<typeof rateSchema>;

/** PATCH /trips/:id/status — the admin override. */
export const adminTripStatusSchema = z.object({
  status: z.enum(['confirmed', 'enroute', 'arrived', 'started', 'completed', 'cancelled']),
  /** Recorded on a cancellation so the record says why operations stepped in. */
  reason: z.string().min(3).max(300).optional(),
});

export type AdminTripStatusInput = z.infer<typeof adminTripStatusSchema>;
