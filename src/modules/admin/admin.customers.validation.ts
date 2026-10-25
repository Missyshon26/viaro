import { z } from 'zod';
import { paginationSchema } from '../../utils/pagination';
import { addressSchema } from '../../utils/profile';
import { USER_STATUSES } from '../../models/User';

/**
 * The admin's client (customer) screen: list, add, edit, download.
 *
 * A client is a customer account. Operations can add one on someone's behalf (a phone
 * booking, a corporate guest) and fix their details, but never sees or sets a password —
 * the client is emailed a link to choose their own.
 */

const phone = z.string().trim().min(6).max(30);

export const createCustomerSchema = z
  .object({
    firstName: z.string().trim().min(1, 'Enter the first name').max(60),
    lastName: z.string().trim().max(60).default(''),
    email: z.string().trim().email().toLowerCase(),
    phone,
    address: addressSchema.optional(),
    /** Send the set-your-password email. On by default; off for a client who will not use the site. */
    sendInvite: z.boolean().default(true),
  })
  .refine((d) => `${d.firstName} ${d.lastName}`.trim().length >= 2, {
    message: 'Enter the full name',
    path: ['firstName'],
  });

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = z
  .object({
    firstName: z.string().trim().min(1).max(60).optional(),
    lastName: z.string().trim().max(60).optional(),
    email: z.string().trim().email().toLowerCase().optional(),
    phone: phone.optional(),
    /** `null` removes the address. */
    address: addressSchema.nullable().optional(),
    /** `suspended` signs the client out everywhere and blocks sign-in until reinstated. */
    status: z.enum(USER_STATUSES).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No updatable fields supplied' });

export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

const filters = {
  /** Matches name, email or phone, anywhere in the text. */
  search: z.string().trim().max(100).optional(),
  status: z.enum(USER_STATUSES).optional(),
  /** `true` = only accounts made through "Continue as guest". */
  guest: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
};

export const listCustomersQuerySchema = paginationSchema.extend(filters);
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;

export const exportCustomersQuerySchema = z.object({
  ...filters,
  format: z.enum(['xlsx', 'csv']).default('xlsx'),
});
export type ExportCustomersQuery = z.infer<typeof exportCustomersQuerySchema>;
