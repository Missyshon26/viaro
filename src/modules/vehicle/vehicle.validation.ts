import { z } from 'zod';
import { IMAGE_KEY as IMAGE_KEY_PATTERN } from '../../utils/imageStorage';

const imageSchema = z.object({
  src: z.string().min(1).max(500),
  alt: z.string().min(1).max(200),
  caption: z.string().min(1).max(60),
});

export const createVehicleClassSchema = z.object({
  /**
   * Lowercase, no spaces — it is stored verbatim on every booking, so it has to be a
   * stable key rather than a display string.
   */
  value: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and hyphens only'),
  label: z.string().min(2).max(80),
  detail: z.string().max(160).optional(),
  seats: z.coerce.number().int().min(1).max(60),
  bags: z.coerce.number().int().min(0).max(60),
  multiplier: z.coerce.number().min(0.1).max(20),
  /** all | hourly (charters only) | transfer (point-to-point and airport only). */
  usage: z.enum(['all', 'hourly', 'transfer']).optional(),
  /** Hourly-trip multiplier when it differs; null clears it back to `multiplier`. */
  hourlyMultiplier: z.coerce.number().min(0.1).max(20).nullable().optional(),
  /** Fixed transfer price in dollars; null clears it back to the multiplier formula. */
  flatRate: z.coerce.number().positive().max(100_000).nullable().optional(),
  /** Fixed price per hour for hourly charters; null clears it. */
  hourlyRate: z.coerce.number().positive().max(100_000).nullable().optional(),
  /** Floor on the fare before surcharges; null clears it. */
  minimumFare: z.coerce.number().positive().max(100_000).nullable().optional(),
  /** Charge per intermediate stop; null (or 0) makes stops free for this class. */
  stopFee: z.coerce.number().min(0).max(100_000).nullable().optional(),
  images: z.array(imageSchema).max(10).optional(),
  active: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(999).optional(),
});

export type CreateVehicleClassInput = z.infer<typeof createVehicleClassSchema>;

/**
 * `value` is deliberately absent: changing it would orphan every booking that stored
 * the old key. Renaming a class is a `label` change.
 */
export const updateVehicleClassSchema = createVehicleClassSchema
  .omit({ value: true })
  .partial()
  .refine((data) => Object.keys(data).length > 0, 'Nothing to update');

export type UpdateVehicleClassInput = z.infer<typeof updateVehicleClassSchema>;

export const idParamSchema = z.object({
  id: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id'),
});

export const listVehicleQuerySchema = z.object({
  /** Admin-only view of retired classes. */
  includeInactive: z.coerce.boolean().optional(),
});

export type ListVehicleQuery = z.infer<typeof listVehicleQuerySchema>;

/** The words that go with an uploaded photo; both optional (a default is made up). */
export const imageTextSchema = z.object({
  alt: z.string().trim().min(1).max(160).optional(),
  caption: z.string().trim().min(1).max(60).optional(),
});

export type ImageText = z.infer<typeof imageTextSchema>;

export const imageParamSchema = z.object({
  id: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id'),
  key: z.string().regex(IMAGE_KEY_PATTERN, 'Invalid photo'),
});

export const updateImageSchema = imageTextSchema
  .extend({ cover: z.literal(true).optional() })
  .refine((d) => Object.keys(d).length > 0, { message: 'Nothing to change' });

export type UpdateImageInput = z.infer<typeof updateImageSchema>;
