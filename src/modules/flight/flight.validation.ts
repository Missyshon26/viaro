import { z } from 'zod';

/** IATA/ICAO style flight designators, e.g. AA100, BA2490. */
export const flightParamSchema = z.object({
  flightNumber: z
    .string()
    // "AS 123" and "AS-123" are how people write it; the providers want "AS123".
    .transform((v) => v.replace(/[\s-]+/g, ''))
    .pipe(
      z
        .string()
        .min(2)
        .max(10)
        .regex(/^[A-Za-z0-9]+$/, 'Flight number must be alphanumeric')
        .toUpperCase(),
    ),
});

/** The day the flight lands (Pacific), so the right day's flight is looked up. */
export const flightQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use yyyy-mm-dd')
    .optional(),
});

export type FlightQuery = z.infer<typeof flightQuerySchema>;

export type FlightParam = z.infer<typeof flightParamSchema>;
