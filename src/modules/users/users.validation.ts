import { z } from 'zod';
import { addressSchema } from '../../utils/profile';

export const updateProfileSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    /** When either is sent, the display name is rebuilt from the pair. */
    firstName: z.string().trim().min(1, 'Enter your first name').max(60).optional(),
    lastName: z.string().trim().max(60).optional(),
    /** `null` removes the address; an object replaces it whole. */
    address: addressSchema.nullable().optional(),
    phone: z.string().min(6).max(30).optional(),
    vehicleClass: z.string().min(1).max(60).optional(), // drivers only
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No updatable fields supplied' });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Documents arrive as upload metadata, not multipart bodies — real S3 wiring is a
 * PLACEHOLDER (utils/s3.ts), so the client sends what it intends to upload.
 */
export const uploadDocumentSchema = z.object({
  fileName: z.string().min(1).max(200),
  mimeType: z.string().min(3).max(100),
  sizeBytes: z.coerce.number().int().positive().max(20 * 1024 * 1024).optional(),
});

export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;

export const objectIdParamSchema = z.object({
  driverId: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid driver id'),
});

export type ObjectIdParam = z.infer<typeof objectIdParamSchema>;

/**
 * Signing the rental agreement. `accepted` must be literally true — the signature alone is
 * not consent, the ticked box is — and `version` pins which wording was on screen, so a
 * stale tab cannot sign terms that have since changed.
 */
export const signAgreementSchema = z.object({
  signature: z.string().min(40).max(250_000),
  accepted: z.literal(true, { message: 'You must accept the agreement' }),
  version: z.string().min(1).max(40),
});

export type SignAgreementInput = z.infer<typeof signAgreementSchema>;
