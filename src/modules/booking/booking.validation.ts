import { z } from 'zod';
import { TRIP_TYPES } from '../../models/Booking';
import { paginationSchema } from '../../utils/pagination';
import { isParsableDate, now, toAppTime } from '../../config/timezone';
import {
  CRUISE_PORT_KEYS,
  MAX_CAR_SEATS,
  totalCarSeats,
  MAX_JOURNEY_LEGS,
  MAX_GRATUITY_PCT,
  MAX_STOPS,
  MIN_MINUTES_BETWEEN_LEGS,
  TRIP_OCCASIONS,
  type CruisePort,
  type TripOccasion,
} from '../../config/services';

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
    /** Book a package: its price for this vehicle is what is charged. A point-to-point booking, so no stops, flight or hours. */
    packageId: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid package id').optional(),
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
    /** The same seats by age. When sent, `carSeats` is taken as their total. */
    carSeatTypes: z
      .object({
        infant: z.coerce.number().int().min(0).max(MAX_CAR_SEATS).default(0),
        toddler: z.coerce.number().int().min(0).max(MAX_CAR_SEATS).default(0),
        booster: z.coerce.number().int().min(0).max(MAX_CAR_SEATS).default(0),
      })
      .optional(),
    /** Anything else the passenger needs the chauffeur or dispatch to know. */
    description: z.string().trim().min(1).max(500).optional(),
    /** A cruise terminal pickup. The ship name helps the chauffeur find the right gate. */
    cruisePort: z.enum(CRUISE_PORT_KEYS as [CruisePort, ...CruisePort[]]).optional(),
    cruiseShip: z.string().trim().min(1).max(80).optional(),
    /** Intermediate stops between pickup and drop-off, in order. Not for hourly charters. */
    stops: z.array(geoPointSchema).max(MAX_STOPS).optional(),
    /** What the trip is for; "Other" may carry a short description. */
    occasion: z.enum(TRIP_OCCASIONS as unknown as [TripOccasion, ...TripOccasion[]]).optional(),
    occasionDetails: z.string().trim().min(1).max(200).optional(),
    /** Luggage counts. */
    carryOnBags: z.coerce.number().int().min(0).max(60).optional(),
    checkedBags: z.coerce.number().int().min(0).max(60).optional(),
    /** The tip, as a percentage of the trip price. Absent or 0 = no tip. */
    gratuityPct: z.coerce.number().min(0).max(MAX_GRATUITY_PCT).optional(),
    /** Booking for someone else: the passenger's name and contact number. */
    passengerName: z.string().trim().min(2).max(120).optional(),
    passengerPhone: z.string().trim().min(6).max(30).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.packageId) {
      if (data.tripType !== 'point2point') {
        ctx.addIssue({ code: 'custom', path: ['packageId'], message: 'A package is booked as a point-to-point trip' });
      }
      for (const field of ['stops', 'cruisePort', 'flightDetails', 'hours'] as const) {
        const value = data[field];
        if (Array.isArray(value) ? value.length > 0 : value !== undefined) {
          ctx.addIssue({ code: 'custom', path: [field], message: 'That does not apply to a package' });
        }
      }
      if (data.meetAndGreet) {
        ctx.addIssue({ code: 'custom', path: ['meetAndGreet'], message: 'That does not apply to a package' });
      }
    }
    if (data.stops?.length && data.tripType === 'hourly') {
      ctx.addIssue({
        code: 'custom',
        path: ['stops'],
        message: 'An hourly charter goes wherever the hours take it; stops apply to transfers',
      });
    }
    if (data.carSeatTypes && totalCarSeats(data.carSeatTypes) > MAX_CAR_SEATS) {
      ctx.addIssue({
        code: 'custom',
        path: ['carSeatTypes'],
        message: `At most ${MAX_CAR_SEATS} child seats per booking`,
      });
    }
    if (data.passengerPhone && !data.passengerName) {
      ctx.addIssue({
        code: 'custom',
        path: ['passengerName'],
        message: "Enter the passenger's name",
      });
    }
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

/**
 * A journey of several legs is one itinerary, so its legs must follow each other in time
 * with room to drive between them. Without this, a return before the outbound (or two legs
 * at the same minute) was priced, charged and dispatched as a chauffeur's impossible
 * double-booking. Shared by card checkout and the console's multi-city booking.
 */
export function refineLegOrder(
  legs: { scheduledAt?: string }[],
  ctx: z.RefinementCtx,
  /** Where in the request the legs live, so the error points at the right field. */
  at: (string | number)[] = ['legs'],
): void {
  if (legs.length < 2) return;

  let previous: number | null = null;
  for (const [index, leg] of legs.entries()) {
    if (!leg.scheduledAt) {
      ctx.addIssue({
        code: 'custom',
        path: [...at, index, 'scheduledAt'],
        message: 'Every leg of a journey needs a pickup time',
      });
      return;
    }
    const time = toAppTime(leg.scheduledAt).toMillis();
    if (previous !== null && time < previous + MIN_MINUTES_BETWEEN_LEGS * 60_000) {
      ctx.addIssue({
        code: 'custom',
        path: [...at, index, 'scheduledAt'],
        message: `Leg ${index + 1} must start at least ${MIN_MINUTES_BETWEEN_LEGS} minutes after leg ${index}`,
      });
      return;
    }
    previous = time;
  }
}

/** Card checkout: one leg, or two for a round trip, paid as one payment. */
export const checkoutIntentSchema = z
  .object({
    legs: z.array(createBookingSchema).min(1).max(MAX_JOURNEY_LEGS),
  })
  .superRefine((data, ctx) => refineLegOrder(data.legs, ctx));

export type CheckoutIntentInput = z.infer<typeof checkoutIntentSchema>;

export const completeCheckoutSchema = z.object({
  paymentIntentId: z.string().regex(/^pi_[A-Za-z0-9_]+$/, 'Invalid payment id'),
});

export type CompleteCheckoutInput = z.infer<typeof completeCheckoutSchema>;

export const updateBookingSchema = z
  .object({
    pickup: geoPointSchema.optional(),
    drop: geoPointSchema.optional(),
    vehicleClass: z.string().min(1).max(60).optional(),
    // Rescheduling is still a pickup time: the same future-dated rule applies.
    scheduledAt: futureDateString.optional(),
    /** Change or clear (0) the credit the passenger wants put towards this ride. */
    walletCreditRequested: z.coerce.number().min(0).max(1_000_000).optional(),

    /*
     * Details the customer can still change after booking. `null` clears a value; leaving
     * a key out leaves it as it is — the two are different and the service honours both.
     */
    /** The full replacement list of stops. An empty list removes them all. */
    stops: z.array(geoPointSchema).max(MAX_STOPS).optional(),
    occasion: z.enum(TRIP_OCCASIONS as unknown as [TripOccasion, ...TripOccasion[]]).nullable().optional(),
    occasionDetails: z.string().trim().min(1).max(200).nullable().optional(),
    carryOnBags: z.coerce.number().int().min(0).max(60).optional(),
    checkedBags: z.coerce.number().int().min(0).max(60).optional(),
    passengerName: z.string().trim().min(2).max(120).nullable().optional(),
    passengerPhone: z.string().trim().min(6).max(30).nullable().optional(),
    /** Airport bookings only. */
    flightNumber: z.string().trim().min(2).max(10).optional(),
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

export const documentParamSchema = z.object({
  id: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id'),
  kind: z.enum(['invoice', 'receipt']),
});

export type DocumentParam = z.infer<typeof documentParamSchema>;
