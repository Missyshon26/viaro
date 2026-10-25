import { DateTime } from 'luxon';
import { APP_TIMEZONE } from '../../config/constants';
import { joinName, splitName, type Address } from '../../utils/profile';

/**
 * The rules for turning the old system's records into this app's. Pure functions only — no
 * database — so each rule can be tested on its own. The orchestration that reads the old
 * collections and writes the new ones is in legacy.import.ts.
 */

/* -------------------------------------------------------------------------- */
/* Old record shapes (only the fields the rules read)                          */
/* -------------------------------------------------------------------------- */

export interface LegacyStop {
  content?: string;
  amount?: number | string;
}
export interface LegacySeat {
  type?: string;
  count?: number | string;
  seatCost?: number | string;
}
export interface LegacyLeg {
  source?: string;
  destination?: string;
  scheduledDate?: string;
  scheduledTime?: string;
  primeTime?: boolean;
  primeTimeCost?: number;
  time?: string;
  baseRate?: number;
  meetAndGreet?: boolean;
  meetAndGreetCost?: number;
  additionalSeats?: LegacySeat[];
  stops?: LegacyStop[];
  gratuity?: string;
  gratuityAmount?: number;
  status?: string;
  driverId?: unknown;
  flightInformation?: string;
  shortDescription?: string;
}
export interface LegacyTrip {
  _id: unknown;
  tripNo?: string;
  bookingSource?: string;
  customerId?: string;
  customerName?: string;
  rideType?: string;
  vehicleId?: unknown;
  tripdata?: LegacyLeg[];
  tripOccasion?: string;
  tripOccasionDetails?: string;
  noOfPassengers?: string;
  carryOnBagsCount?: string;
  checkedBagCount?: string;
  subTotal?: number | null;
  tax?: number;
  gratuityFinalAmount?: number;
  grandTotal?: number | null;
  discount?: string | number | null;
  tripStatus?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  paymentReference?: string;
  paidAt?: Date;
  createdAt?: Date;
  driverId?: unknown;
  rejectionReason?: string;
  isGuest?: boolean;
  additionalPassengerDetails?: { passengerName?: string; passengerContactNo?: string }[];
}

/* -------------------------------------------------------------------------- */
/* Time                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * "12-01-2025" + "6:30 AM", read as Pacific time, returned as the UTC instant.
 *
 * The old data is month-day-year, but a few legs were saved day-month-year ("30-11-2025").
 * Month-day-year is tried first; day-month-year only when that is impossible (a month over
 * 12), so a date that could be read either way is always read the old app's usual way.
 */
export function parseLegacyWhen(date?: string, time?: string, createdAt?: Date): Date | null {
  const d = (date ?? '').trim();
  if (!d) return null;
  const zone = APP_TIMEZONE;
  const t = (time ?? '').trim();
  const read = (dateFormat: string): Date | null => {
    const withTime = DateTime.fromFormat(`${d} ${t}`, `${dateFormat} h:mm a`, { zone, locale: 'en-US' });
    if (withTime.isValid) return withTime.toJSDate();
    // An unreadable or missing time: keep the day, put it at noon rather than lose the booking.
    const dayOnly = DateTime.fromFormat(d, dateFormat, { zone, locale: 'en-US' }).set({ hour: 12 });
    return dayOnly.isValid ? dayOnly.toJSDate() : null;
  };
  const monthFirst = read('MM-dd-yyyy');
  const dayFirst = read('dd-MM-yyyy');
  if (!monthFirst) return dayFirst;
  // Readable both ways: a pickup cannot be more than a day BEFORE the booking was made, so if
  // month-first lands earlier than that and day-first does not, the date was saved day-first.
  if (dayFirst && createdAt) {
    const earliest = createdAt.getTime() - 24 * 3_600_000;
    if (monthFirst.getTime() < earliest && dayFirst.getTime() >= earliest) return dayFirst;
  }
  return monthFirst;
}

/** A pickup year outside this window is almost certainly a typo in the old data. */
export const PLAUSIBLE_YEARS = { from: 2025, to: 2027 };
export const isPlausiblePickup = (d: Date): boolean => {
  const y = d.getUTCFullYear();
  return y >= PLAUSIBLE_YEARS.from && y <= PLAUSIBLE_YEARS.to;
};

/* -------------------------------------------------------------------------- */
/* Money                                                                       */
/* -------------------------------------------------------------------------- */

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
};
const toCents = (dollars: number): number => Math.round(dollars * 100);
const fromCents = (cents: number): number => cents / 100;

/**
 * Splits `totalCents` by `weights` so the pieces add up to the total EXACTLY — the largest
 * remainder method, which never loses or invents a cent the way rounding each share would.
 */
export function allocateCents(totalCents: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  const w = sum > 0 ? weights : weights.map(() => 1);
  const wSum = w.reduce((a, b) => a + b, 0);
  const raw = w.map((x) => (totalCents * x) / wSum);
  const floors = raw.map(Math.floor);
  let left = totalCents - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

export interface LegMoney {
  /** What this leg is worth: the share of what the customer was actually charged. */
  fare: number;
  breakdown: {
    classFare: number;
    primetimeSurcharge: number;
    meetAndGreetFee: number;
    stopCount: number;
    stopFee: number;
    pricingModel: 'legacy';
    subtotal?: number;
    gratuityPct?: number;
    gratuity?: number;
    discount?: number;
    tax?: number;
  };
}

/** What the old leg lists as its own charges (only the ones that were switched on). */
function legParts(leg: LegacyLeg) {
  const primetime = leg.primeTime ? num(leg.primeTimeCost) : 0;
  const meetAndGreet = leg.meetAndGreet ? num(leg.meetAndGreetCost) : 0;
  const stops = leg.stops ?? [];
  const stopFee = stops.reduce((a, s) => a + num(s.amount), 0);
  const seats = (leg.additionalSeats ?? []).reduce((a, s) => a + num(s.seatCost) * (num(s.count) || 1), 0);
  const base = num(leg.baseRate) + seats;
  return { base, primetime, meetAndGreet, stopCount: stops.length, stopFee, parts: base + primetime + meetAndGreet + stopFee };
}

/**
 * The old trip's grand total is what the customer was charged, and it is the number kept.
 * The old pricing arithmetic cannot be reproduced from the stored lines (the lines and the
 * total disagree on most trips), so the total is split across the legs in proportion to
 * their own charges and each leg's itemisation is made to add up to its share exactly.
 */
export function tripMoney(trip: LegacyTrip): LegMoney[] {
  const legs = trip.tripdata ?? [];
  const parts = legs.map(legParts);
  const legGratuity = legs.map((l) => num(l.gratuityAmount));
  const gratuityTotal = typeof trip.gratuityFinalAmount === 'number' ? trip.gratuityFinalAmount : legGratuity.reduce((a, b) => a + b, 0);
  const discountTotal = Math.max(0, num(trip.discount));
  const taxTotal = Math.max(0, num(trip.tax));
  const sumParts = parts.reduce((a, p) => a + p.parts, 0);

  const total =
    typeof trip.grandTotal === 'number' && trip.grandTotal >= 0
      ? trip.grandTotal
      : Math.max(0, (typeof trip.subTotal === 'number' ? trip.subTotal : sumParts) + gratuityTotal - discountTotal + taxTotal);

  const weights = parts.map((p, i) => p.parts + legGratuity[i]);
  const fareC = allocateCents(toCents(total), weights);
  const gratC = allocateCents(toCents(gratuityTotal), weights);
  const discC = allocateCents(toCents(discountTotal), weights);
  const taxC = allocateCents(toCents(taxTotal), weights);

  return legs.map((leg, i) => {
    const p = parts[i];
    const fare = fromCents(fareC[i]);
    const gratuity = fromCents(Math.min(gratC[i], fareC[i]));
    const discount = fromCents(discC[i]);
    const tax = fromCents(taxC[i]);
    // The base absorbs whatever the old lines did not explain, so the lines sum to the fare.
    const classFare = fare - p.primetime - p.meetAndGreet - p.stopFee - gratuity + discount - tax;
    const gratuityPct = num(leg.gratuity);

    if (classFare < 0) {
      return {
        fare,
        breakdown: { classFare: fare, primetimeSurcharge: 0, meetAndGreetFee: 0, stopCount: p.stopCount, stopFee: 0, pricingModel: 'legacy' as const },
      };
    }
    return {
      fare,
      breakdown: {
        classFare: Math.round(classFare * 100) / 100,
        primetimeSurcharge: p.primetime,
        meetAndGreetFee: p.meetAndGreet,
        stopCount: p.stopCount,
        stopFee: p.stopFee,
        pricingModel: 'legacy' as const,
        subtotal: Math.round((classFare + p.primetime + p.meetAndGreet + p.stopFee) * 100) / 100,
        ...(gratuity > 0 ? { gratuity, ...(gratuityPct > 0 ? { gratuityPct } : {}) } : {}),
        ...(discount > 0 ? { discount } : {}),
        ...(tax > 0 ? { tax } : {}),
      },
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * An unfinished stage this long after its pickup was never closed in the old system — the
 * ride happened (or was abandoned) long ago. Left as it was it would sit in the dispatch
 * queue and on drivers' screens forever, so it is closed on import.
 */
export const STALE_AFTER_HOURS = 36;

export type BookingState = 'pending' | 'assigned' | 'cancelled';
export type TripState = 'accepted' | 'started' | 'completed' | 'cancelled';

export interface LegState {
  booking: BookingState;
  /** Only when a chauffeur is on record: a trip needs one. */
  trip?: TripState;
  stages: { confirmed?: boolean; enroute?: boolean; arrived?: boolean };
  rejected?: boolean;
  closedOnImport?: boolean;
  cancelReason?: string;
}

const STAGE_RANK: Record<string, number> = {
  Pending: 0,
  'Trip Confirmed': 1,
  Confirmed: 1,
  'Driver Assigned': 1,
  Enroute: 2,
  Arrived: 3,
  Onboard: 4,
};

export function mapLegState(input: {
  legStatus?: string;
  tripStatus?: string;
  rejectionReason?: string;
  hasDriver: boolean;
  scheduledAt: Date;
  now: Date;
  paid: boolean;
}): LegState {
  const status = (input.legStatus || '').trim() || (input.tripStatus || '').trim() || 'Pending';
  const rejected = status === 'Rejected' || (input.tripStatus === 'Rejected' && status === 'Cancelled') || Boolean(input.rejectionReason);

  if (status === 'Cancelled' || status === 'Rejected') {
    return { booking: 'cancelled', trip: input.hasDriver ? 'cancelled' : undefined, stages: {}, rejected };
  }
  if (status === 'Completed') {
    return { booking: 'assigned', trip: input.hasDriver ? 'completed' : undefined, stages: {} };
  }

  const rank = STAGE_RANK[status] ?? 0;
  const past = input.scheduledAt.getTime() < input.now.getTime() - STALE_AFTER_HOURS * 3_600_000;

  if (past) {
    // A request that was never paid or confirmed and whose date has passed did not happen.
    if (rank === 0 && !input.paid) {
      return {
        booking: 'cancelled',
        stages: {},
        closedOnImport: true,
        cancelReason: 'Not confirmed or paid before the pickup date (closed when carried over from the old system).',
      };
    }
    return { booking: 'assigned', trip: input.hasDriver ? 'completed' : undefined, stages: {}, closedOnImport: true };
  }

  // Still ahead of us. Without a chauffeur it needs dispatching, whatever the old status said.
  if (!input.hasDriver) return { booking: 'pending', stages: {} };
  return {
    booking: 'assigned',
    trip: status === 'Onboard' ? 'started' : 'accepted',
    stages: { confirmed: rank >= 1, enroute: rank >= 2, arrived: rank >= 3 },
  };
}

/* -------------------------------------------------------------------------- */
/* Names, places, kinds                                                        */
/* -------------------------------------------------------------------------- */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (s: string): boolean => EMAIL.test(s);

export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
}

/** The tidy form of an occasion; the old data has "Airport transfer" and "Airport Transfer". */
export function normaliseOccasion(raw?: string): string | undefined {
  const s = (raw ?? '').trim();
  if (!s) return undefined;
  if (/^airport transfer$/i.test(s)) return 'Airport Transfer';
  return s.slice(0, 60);
}

export function tripTypeOf(trip: LegacyTrip): 'point2point' | 'airport' | 'hourly' {
  if (trip.rideType === 'hourly-trip') return 'hourly';
  return /^airport transfer$/i.test((trip.tripOccasion ?? '').trim()) ? 'airport' : 'point2point';
}

export function hoursOf(leg: LegacyLeg): number | undefined {
  const h = parseInt(leg.time ?? '', 10);
  return Number.isInteger(h) && h >= 1 && h <= 24 ? h : undefined;
}

export interface CustomerPlan {
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address?: Address;
}

export interface LegacyCustomerDoc {
  _id: unknown;
  user_id?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  contact_no?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressLine3?: string;
  addressLine4?: string;
  zipCode?: unknown;
  stripeId?: string;
  wallet_balance?: number;
  documentStatus?: string;
  customerStatus?: string;
  isGuest?: boolean;
  created_at?: Date;
}

export function planCustomer(doc: LegacyCustomerDoc): CustomerPlan | null {
  const email = (doc.email ?? '').trim().toLowerCase();
  if (!isEmail(email)) return null;

  const first = (doc.firstName ?? '').trim();
  const last = (doc.lastName ?? '').trim();
  const split = splitName((doc.fullName ?? '').trim() || email.split('@')[0]);
  const firstName = first || split.firstName;
  const lastName = first ? last : split.lastName;

  const line1 = (doc.addressLine1 ?? '').trim();
  const city = (doc.addressLine3 ?? '').trim();
  const state = (doc.addressLine4 ?? '').trim();
  const zip = typeof doc.zipCode === 'string' || typeof doc.zipCode === 'number' ? String(doc.zipCode).trim() : '';
  const address: Address | undefined =
    line1 && city && state && zip
      ? { line1, ...((doc.addressLine2 ?? '').trim() ? { line2: (doc.addressLine2 as string).trim() } : {}), city, state, postalCode: zip }
      : undefined;

  return {
    name: joinName(firstName, lastName) || email,
    firstName,
    lastName,
    email,
    phone: (doc.contact_no ?? '').trim() || 'n/a',
    ...(address ? { address } : {}),
  };
}
