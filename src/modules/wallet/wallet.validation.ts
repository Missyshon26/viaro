import { z } from 'zod';
import { paginationSchema } from '../../utils/pagination';

export const walletQuerySchema = paginationSchema;

export const withdrawSchema = z.object({
  amount: z.coerce.number().positive().max(1_000_000),
  /**
   * The driver's account at the payment gateway (e.g. a Stripe connected account id).
   * Optional until drivers are onboarded to the gateway — without it the transfer is
   * recorded but not executed, and can be replayed from the ledger entry.
   */
  destination: z.string().min(3).max(120).optional(),
});

export type WithdrawInput = z.infer<typeof withdrawSchema>;

export const useCreditSchema = z.object({
  tripId: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid trip id'),
  amount: z.coerce.number().positive().max(1_000_000),
});

export type UseCreditInput = z.infer<typeof useCreditSchema>;

/**
 * Releasing credit back off a ride. `amount` is optional — omitting it releases
 * everything currently applied, which is what a "remove" control sends.
 */
export const releaseCreditSchema = z.object({
  tripId: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid trip id'),
  amount: z.coerce.number().positive().max(1_000_000).optional(),
});

export type ReleaseCreditInput = z.infer<typeof releaseCreditSchema>;

export const collectPaymentSchema = z.object({
  tripId: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid trip id'),
});

export type CollectPaymentInput = z.infer<typeof collectPaymentSchema>;

/**
 * Saved cards. The client tokenises with the gateway SDK and sends the token —
 * a raw card number must never reach this API.
 */
export const savePaymentMethodSchema = z.object({
  gatewayToken: z.string().min(5).max(200),
  brand: z.string().max(30).optional(),
  last4: z.string().regex(/^\d{4}$/, 'last4 must be 4 digits').optional(),
  expMonth: z.coerce.number().int().min(1).max(12).optional(),
  expYear: z.coerce.number().int().min(2024).max(2100).optional(),
  makeDefault: z.boolean().optional(),
});

export type SavePaymentMethodInput = z.infer<typeof savePaymentMethodSchema>;

export const methodIdParamSchema = z.object({
  id: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid payment method id'),
});

export type MethodIdParam = z.infer<typeof methodIdParamSchema>;
