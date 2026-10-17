import { z } from 'zod';
import { TRIP_TYPES } from '../../models/Booking';
import { paginationSchema } from '../../utils/pagination';
import { isParsableDate, now, toAppTime } from '../../config/timezone';
import { CRUISE_PORT_KEYS, MAX_CAR_SEATS, type CruisePort } from '../../config/services';

/**
 * A pickup time that is real, and in the future.
 *
 * Two separate problems lived on the old `z.string().min(4)`:
 *   - unparsable text reached `toAppTime`, which throws a bare Error -> a 500 on what is
 *     plainly a bad request;
 *   - a date in the past was accepted, so `scheduledAt:"2020-01-01"` created a pending
 *     booking and broadcast it to the dispatch pool for a ride that could never happen.
 *
 * MIN_LEAD_MINUTES gives dispatch a moment to actually find a chauffeur, and absorbs
 * clock skew between a client and the server.
 */
export const MIN_LEAD_MINUTES = 5;

/*
 * One superRefine, not a chain of refines.
 *
 * zod runs every `.refine()` in a chain even after an earlier one has already failed, so
 * a chained parse-check could not protect the later rules: `toAppTime('notadate')` still
 * ran and threw, producing the very 500 this schema exists to prevent. `superRefine`
 * lets the parse check short-circuit with an explicit early return.
 */
const futureDateString = z
  .string()
  .min(4)
  .superRefine((value, ctx) => {
    if (!isParsableDate(value)) {
      ctx.addIssue({ code: 'custom', message: 'Not a valid ISO date' });
      return;
    }

    const at = toAppTime(value);

    if (at < now().minus({ minutes: 1 })) {
      ctx.addIssue({ code: 'custom', message: 'Pickup time cannot be in the past' });
      return;
    }

    if (at < now().plus({ minutes: MIN_LEAD_MINUTES }).minus({ minutes: 1 })) {
      ctx.addIssue({
        code: 'custom',
        message: `Schedule a pickup at least ${MIN_LEAD_MINUTES} minutes ahead`,
      });
    }
  });

/** A date that must merely be parsable (flight arrivals can legitimately be in the past). */
const anyDateString = z
  .string()
  .min(4)
  .refine(isParsableDate, { message: 'Not a valid ISO date' });

const geoPointSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  address: z.string().min(3).max(300),
});

export const createBookingSchema = z
  .object({
    pickup: geoPointSchema,
    drop: geoPointSchema,
    vehicleClass: z.string().min(1).max(60),
    /** Party size. Optional so existing clients keep working. */
    passengers: z.coerce.number().int().min(1).max(60).optional(),
    tripType: z.enum(TRIP_TYPES),
    city: z.string().min(2).max(80),
    /**
     * Wallet credit to put towards this ride. Nothing is debited now — see
     * IBooking.walletCreditRequested. Zero clears a previous choice.
     */
    walletCreditRequested: z.coerce.number().min(0).max(1_000_000).optional(),

    /** ISO string; offset-less values are read as America/Los_Angeles wall time. */
    scheduledAt: futureDateString.optional(),
    hours: z.coerce.number().min(1).max(24).optional(),
    flightDetails: z
      .object({
        flightNumber: z.string().min(2).max(10),
        scheduledArrival: anyDateString.optional(),
      })
      .optional(),
    favoriteDriverId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
    /** Extras (config/services.ts). Meet and Greet is charged; car seats are free. */
    meetAndGreet: z.boolean().optional(),
    carSeats: z.coerce.number().int().min(0).max(MAX_CAR_SEATS).optional(),
    /** A cruise terminal pickup. The ship name helps the chauffeur find the right gate. */
    cruisePort: z.enum(CRUISE_PORT_KEYS as [CruisePort, ...CruisePort[]]).optional(),
    cruiseShip: z.string().trim().min(1).max(80).optional(),
  })
  .superRefine((data, ctx) => {
    // A cruise pickup is a transfer from the terminal; an hourly charter has no port leg.
    if (data.cruisePort && data.tripType === 'hourly') {
      ctx.addIssue({
        code: 'custom',
        path: ['cruisePort'],
        message: 'A cruise port pickup cannot be an hourly charter',
      });
    }
    // Spec §4.3: airport bookings must carry the flight the ride is meeting.
    if (data.tripType === 'airport' && !data.flightDetails) {
      ctx.addIssue({
        code: 'custom',
        path: ['flightDetails'],
        message: 'flightDetails is required for airport trips',
      });
    }
  });

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const updateBookingSchema = z
  .object({
    pickup: geoPointSchema.optional(),
    drop: geoPointSchema.optional(),
    vehicleClass: z.string().min(1).max(60).optional(),
    // Rescheduling is still a pickup time: the same future-dated rule applies.
    scheduledAt: futureDateString.optional(),
    /** Change or clear (0) the credit the passenger wants put towards this ride. */
    walletCreditRequested: z.coerce.number().min(0).max(1_000_000).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No updatable fields supplied' });

export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;

export const favoriteDriverSchema = z.object({
  driverId: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid driver id'),
});

export type FavoriteDriverInput = z.infer<typeof favoriteDriverSchema>;

/**
 * Why a booking is being cancelled, on the query string rather than in a body.
 *
 * DELETE bodies are legal but not dependably forwarded — proxies and some fetch
 * implementations drop them — and losing a cancellation reason silently is worse than
 * a slightly less tidy URL. Optional throughout: nobody has to explain themselves.
 */
export const cancelBookingQuerySchema = z.object({
  reason: z.string().trim().min(1).max(300).optional(),
});

export type CancelBookingQuery = z.infer<typeof cancelBookingQuerySchema>;

export const idParamSchema = z.object({
  id: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id'),
});

export type IdParam = z.infer<typeof idParamSchema>;

export const ridesQuerySchema = paginationSchema;
