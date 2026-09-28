import { z } from 'zod';

/**
 * A driver may only put themselves 'available' or 'offline'.
 * 'busy' is set by the system when a trip is accepted — letting a driver claim it by
 * hand would let them hide from dispatch while still holding a trip.
 */
export const setStatusSchema = z.object({
  status: z.enum(['available', 'offline']),
  /** Sent when going online so dispatch can place them immediately. */
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

export type SetStatusInput = z.infer<typeof setStatusSchema>;

export const applySchema = z.object({
  vehicleClass: z.string().min(1).max(60),
  documents: z.array(z.string().url()).max(10).optional(),
});

export type ApplyInput = z.infer<typeof applySchema>;

/* -------------------------------- documents -------------------------------- */

const businessText = (max: number) => z.string().trim().min(1).max(max);

export const documentProfileSchema = z.object({
  operatorType: z.enum(['independent', 'company']),
  business: z
    .object({
      legalName: businessText(200).optional(),
      entityType: businessText(60).optional(),
      registrationStatus: businessText(60).optional(),
      ubiNumber: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9\- ]{4,40}$/, 'Enter the UBI or state registration number')
        .optional(),
    })
    .optional(),
});

export type DocumentProfileInput = z.infer<typeof documentProfileSchema>;

/**
 * The upload body is the raw file; everything else rides in the query so the bytes
 * never have to be base64-inflated into JSON.
 */
export const uploadDocumentQuerySchema = z.object({
  type: z.string().regex(/^[a-z0-9_]{2,40}$/, 'Unknown document type'),
  fileName: z.string().trim().min(1).max(200),
  expiresAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use yyyy-mm-dd')
    .optional(),
});

export type UploadDocumentQuery = z.infer<typeof uploadDocumentQuerySchema>;

export const documentIdParamSchema = z.object({
  documentId: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid document id'),
});

export type DocumentIdParam = z.infer<typeof documentIdParamSchema>;
