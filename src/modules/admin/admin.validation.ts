import { z } from 'zod';
import { DRIVER_PAYOUT_MODES, DRIVER_STATUSES } from '../../models/Driver';
import { paginationSchema } from '../../utils/pagination';
import { MAX_JOURNEY_LEGS } from '../../config/services';
import { createBookingSchema, refineLegOrder } from '../booking/booking.validation';

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

/** GET /admin/dashboard/users — a page of accounts, optionally one role and/or a text search. */
export const usersQuerySchema = paginationSchema.extend({
  role: z.enum(['customer', 'driver', 'admin', 'company']).optional(),
  q: z.string().trim().max(120).optional(),
});
export type UsersQuery = z.infer<typeof usersQuerySchema>;

export const JOURNEY_STAGES = ['awaiting', 'assigned', 'in_progress', 'completed', 'cancelled'] as const;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use yyyy-mm-dd');
const text = z.string().trim().max(120);

/** GET /admin/dashboard/journeys — one page of bookings with their trip, filtered in the database. */
export const journeysQuerySchema = paginationSchema.extend({
  /** One stage, 'overdue', or 'active' (assigned or in progress, which the dashboard links to). */
  stage: z.enum([...JOURNEY_STAGES, 'overdue', 'active']).optional(),
  q: text.optional(),
  from: day.optional(),
  to: day.optional(),
  vehicle: text.optional(),
  service: text.optional(),
  city: text.optional(),
  payment: text.optional(),
  /** One customer's bookings (the console's account page). */
  customerId: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid customer id').optional(),
});

export type JourneysQuery = z.infer<typeof journeysQuerySchema>;

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
    taxPct: z.coerce.number().min(0, 'Tax cannot be negative').max(30, 'Tax above 30% is probably a typo').optional(),
    fuelSurchargePct: z.coerce.number().min(0, 'The surcharge cannot be negative').max(30, 'A surcharge above 30% is probably a typo').optional(),
    welcomeDiscount: z.coerce.number().min(0).max(1000).optional(),
    loyaltyDiscount: z.coerce.number().min(0).max(1000).optional(),
    loyaltyEveryNth: z.coerce.number().int().min(2, 'At least every 2nd trip').max(50).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, 'Nothing to update');

export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;

/**
 * A trip an operator books for a client. The trip itself is exactly what the passenger site
 * sends, nested so its own rules (stops, cruise, hourly) are enforced unchanged.
 */
/**
 * A discount the operator gives on this booking: a percentage (0–100) or a flat dollar amount.
 * Admin-only — it is deliberately not part of createBookingSchema, which customers post to.
 */
export const adminDiscountSchema = z
  .object({
    type: z.enum(['percent', 'flat']),
    value: z.coerce.number().min(0).max(100_000),
  })
  .refine((d) => d.type !== 'percent' || d.value <= 100, { message: 'A percentage discount cannot be more than 100', path: ['value'] });

/**
 * A client who has no account yet, entered right on the "Add a trip" form. The account is made
 * when the trip is booked; the client is emailed to set a password, then sent the invoice.
 */
export const adminNewClientSchema = z
  .object({
    firstName: z.string().trim().min(1, 'Enter the first name').max(60),
    lastName: z.string().trim().max(60).default(''),
    email: z.string().trim().email('Enter a valid email address').toLowerCase(),
    phone: z.string().trim().min(6, 'Enter the phone number').max(30),
  })
  .refine((d) => `${d.firstName} ${d.lastName}`.trim().length >= 2, {
    message: 'Enter the full name',
    path: ['firstName'],
  });
export type AdminNewClientInput = z.infer<typeof adminNewClientSchema>;

const customerIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Choose a client');
const oneClient = (d: { customerId?: string; newClient?: unknown }) => Boolean(d.customerId) !== Boolean(d.newClient);
const oneClientMessage = { message: "Choose a client, or enter the new client's details", path: ['customerId'] };

export const adminTripSchema = z
  .object({
    /** An existing client, or `newClient` for one who has no account yet — exactly one of the two. */
    customerId: customerIdSchema.optional(),
    newClient: adminNewClientSchema.optional(),
    trip: createBookingSchema,
    discount: adminDiscountSchema.optional(),
  })
  .refine(oneClient, oneClientMessage);
export type AdminTripInput = z.infer<typeof adminTripSchema>;

/** A multi-city journey or round trip an operator books for a client: two to five legs. */
export const adminJourneySchema = z
  .object({
    customerId: customerIdSchema.optional(),
    newClient: adminNewClientSchema.optional(),
    legs: z.array(createBookingSchema).min(2).max(MAX_JOURNEY_LEGS),
    discount: adminDiscountSchema.optional(),
  })
  .refine(oneClient, oneClientMessage)
  .superRefine((data, ctx) => refineLegOrder(data.legs, ctx));
export type AdminJourneyInput = z.infer<typeof adminJourneySchema>;

/**
 * A refund made from the trip page. `amount` is dollars (the whole fare or part of it);
 * `requestId` is made once per refund dialog so a repeated request cannot refund twice.
 */
export const adminRefundSchema = z.object({
  amount: z.coerce.number().positive('Enter an amount greater than zero').max(1_000_000),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Missing request id'),
  note: z.string().trim().max(200).optional(),
});
export type AdminRefundInput = z.infer<typeof adminRefundSchema>;

/** Emailing an invoice: with a Pay Now link (the default) or the PDF alone. */
export const adminEmailInvoiceSchema = z.object({ withPaymentLink: z.boolean().optional() }).optional();

/** Turning down a booking request: the reason is shown to the customer, so it is required. */
export const adminRejectSchema = z.object({
  reason: z.string().trim().min(3, 'Give the customer a reason').max(300),
});
export type AdminRejectInput = z.infer<typeof adminRejectSchema>;

/** Approving or rejecting a customer's signed agreement. */
export const adminAgreementReviewSchema = z.object({ decision: z.enum(['approve', 'reject']) });
export type AdminAgreementReviewInput = z.infer<typeof adminAgreementReviewSchema>;
