import { z } from 'zod';
import { DRIVER_PAYOUT_MODES, DRIVER_STATUSES } from '../../models/Driver';
import { paginationSchema } from '../../utils/pagination';

/**
 * A company either links an existing driver account by email, or creates one outright.
 * Supplying a password means "create"; omitting it means "link an existing account".
 */
export const createDriverSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().toLowerCase(),
  phone: z.string().min(6).max(30),
  password: z.string().min(8).max(128).optional(),
  vehicleClass: z.string().min(1).max(60),
});

export type CreateDriverInput = z.infer<typeof createDriverSchema>;

export const updateDriverSchema = z
  .object({
    vehicleClass: z.string().min(1).max(60).optional(),
    status: z.enum(DRIVER_STATUSES).optional(),
    /**
     * What this driver is paid per completed trip, set by their owner.
     *   percentage -> % of the owner's revenue share for that trip
     *   flat       -> fixed amount per trip
     */
    payout: z
      .object({
        mode: z.enum(DRIVER_PAYOUT_MODES),
        value: z.coerce.number().min(0),
      })
      .optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No updatable fields supplied' })
  .refine((d) => !(d.payout?.mode === 'percentage' && d.payout.value > 100), {
    message: 'A percentage payout cannot exceed 100',
    path: ['payout', 'value'],
  });

export type UpdateDriverInput = z.infer<typeof updateDriverSchema>;

export const idParamSchema = z.object({
  id: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id'),
});

export type IdParam = z.infer<typeof idParamSchema>;

export const listQuerySchema = paginationSchema;

/** PATCH /admin/settings/payout — the default rate for chauffeurs with none of their own. */
export const payoutDefaultsSchema = z
  .object({
    mode: z.enum(DRIVER_PAYOUT_MODES),
    value: z.coerce.number().min(0).max(10_000),
  })
  .refine((d) => !(d.mode === 'percentage' && d.value > 100), {
    message: 'A percentage payout cannot exceed 100',
    path: ['value'],
  });

export type PayoutDefaultsInput = z.infer<typeof payoutDefaultsSchema>;

/** PATCH /admin/settings — any subset of the admin-editable business settings. */
export const settingsUpdateSchema = z
  .object({
    driverPayout: z
      .object({ mode: z.enum(DRIVER_PAYOUT_MODES), value: z.coerce.number().min(0).max(10_000) })
      .refine((d) => !(d.mode === 'percentage' && d.value > 100), {
        message: 'A percentage payout cannot exceed 100',
        path: ['value'],
      })
      .optional(),
    companyRevenuePct: z.coerce.number().min(0).max(100).optional(),
    withdrawalFeePct: z.coerce.number().min(0).max(50).optional(),
    supportInboxEmail: z.string().trim().toLowerCase().email().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, 'Nothing to update');

export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;
