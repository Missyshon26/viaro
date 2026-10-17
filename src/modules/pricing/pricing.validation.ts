import { z } from 'zod';
import { TRIP_TYPES } from '../../models/Booking';
import { isParsableDate } from '../../config/timezone';

/**
 * Subscription plans are chosen from a server-side catalogue, never sent by the client.
 *
 * The request used to carry both `plan` and `price`, so a customer could POST
 * {"plan":"free","price":0} and receive a fully active subscription — which then applied
 * the subscriber discount to every fare, with nothing charged. The client now names a
 * plan only; the price is looked up in pricing.service and taken through the gateway
 * before the subscription is activated.
 */
export const createSubscriptionSchema = z.object({
  plan: z.string().min(2).max(60),
  /** Optional saved-card token; the default card is used when omitted. */
  paymentMethodId: z
    .string()
    .regex(/^[a-fA-F0-9]{24}$/, 'Invalid payment method id')
    .optional(),
});

export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;

export const fareEstimateQuerySchema = z.object({
  city: z.string().min(2).max(80),
  tripType: z.enum(TRIP_TYPES),
  /** ISO string. Offset-less values are read as America/Los_Angeles wall time. */
  requestedAt: z
    .string()
    .min(4)
    .refine(isParsableDate, { message: 'Not a valid ISO date' })
    .optional(),
  hours: z.coerce.number().min(1).max(24).optional(), // hourly trips only
  /** Optional: priced at the base rate when absent, so old clients keep working. */
  vehicleClass: z.string().min(1).max(60).optional(),
  /** Both addresses, so a fixed route price can apply (config/services.ts). */
  pickup: z.string().max(300).optional(),
  drop: z.string().max(300).optional(),
  /** 'true' adds the Meet and Greet fee. z.coerce.boolean would read 'false' as true. */
  meetAndGreet: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export type FareEstimateQuery = z.infer<typeof fareEstimateQuerySchema>;

/**
 * A base fare of zero is not a price, it is a broken city.
 *
 * `min(0)` accepted 0, and the admin console's edit form read an empty field as
 * Number("") === 0 — so clearing the field saved a live city at $0.00 and the server
 * happily agreed. The fare gates whether a city is bookable at all, so the floor belongs
 * here as well as on the form: the client check is a convenience, this is the rule.
 */
const baseFareSchema = z.coerce
  .number()
  .positive('Base fare must be greater than zero')
  .max(100_000);

export const createPricingRuleSchema = z.object({
  city: z.string().min(2).max(80),
  baseFare: baseFareSchema,
  peakMultiplier: z.coerce.number().min(1).max(10),
});

export type CreatePricingRuleInput = z.infer<typeof createPricingRuleSchema>;

export const updatePricingRuleSchema = z
  .object({
    city: z.string().min(2).max(80).optional(),
    baseFare: baseFareSchema.optional(),
    peakMultiplier: z.coerce.number().min(1).max(10).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No updatable fields supplied' });

export type UpdatePricingRuleInput = z.infer<typeof updatePricingRuleSchema>;

export const idParamSchema = z.object({
  id: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id'),
});

export type IdParam = z.infer<typeof idParamSchema>;
