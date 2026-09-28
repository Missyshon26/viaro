import { z } from 'zod';
import { REPORT_TYPES } from './reports.service';
import { isParsableDate } from '../../config/timezone';

// Rejected at the edge as a 400 rather than throwing inside the export worker.
const dateString = z
  .string()
  .min(4)
  .max(40)
  .refine(isParsableDate, { message: 'Not a valid ISO date' });

export const reportRangeSchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
});

export type ReportRangeQuery = z.infer<typeof reportRangeSchema>;

export const exportQuerySchema = reportRangeSchema.extend({
  type: z.enum(REPORT_TYPES).default('trips-completed'),
  format: z.enum(['csv', 'pdf']).default('csv'),
});

export type ExportQuery = z.infer<typeof exportQuerySchema>;

export const jobParamSchema = z.object({
  jobId: z.string().min(1).max(64),
});

export type JobParam = z.infer<typeof jobParamSchema>;

export const monthlyQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(24).optional(),
});
