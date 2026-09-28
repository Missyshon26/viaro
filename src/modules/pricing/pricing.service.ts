import { PricingRule } from '../../models/PricingRule';
import { Subscription } from '../../models/Subscription';
import type { TripType } from '../../models/Booking';
import { hourOfDay, now, toAppTime, toDate, type DateInput } from '../../config/timezone';
import { ApiError } from '../../utils/ApiError';
import { round2 } from '../../utils/money';
import * as vehicleService from '../vehicle/vehicle.service';
import { collectPayment } from '../../integrations/paymentGateway';
import type {
  CreatePricingRuleInput,
  CreateSubscriptionInput,
  UpdatePricingRuleInput,
} from './pricing.validation';

/**
 * Peak windows, expressed in America/Los_Angeles local time (spec §8 rule 1).
 * Defined once here and reused by both the estimate endpoint and the real fare
 * calculation used when a booking is created — never duplicated.
 */
export const PEAK_WINDOWS: Array<{ startHour: number; endHour: number }> = [
  { startHour: 7, endHour: 9 }, // 07:00–08:59 PT
  { startHour: 17, endHour: 19 }, // 17:00–18:59 PT
];

export function isPeakHour(when: DateInput = now()): boolean {
  const hour = hourOfDay(when);
  return PEAK_WINDOWS.some((w) => hour >= w.startHour && hour < w.endHour);
}

export async function hasActiveSubscription(userId: string): Promise<boolean> {
  const sub = await Subscription.findOne({ userId, status: 'active' }).lean();
  if (!sub) return false;
  // An 'active' row whose renewal date has passed is really expired.
  return toAppTime(sub.renewalDate) >= now();
}

export interface FareBreakdown {
  city: string;
  tripType: TripType;
  baseFare: number;
  peakMultiplier: number;
  isPeak: boolean;
  subscriber: boolean;
  hours?: number;
  /** Echoed back so a client can show which class the quote is for. */
  vehicleClass?: string;
  /** The class uplift applied, from config/vehicles.ts. 1 when the class is unknown. */
  vehicleMultiplier: number;
  fare: number;
}

/**
 * Single fare calculator — the estimate endpoint and booking creation both call this, so
 * a customer can never be quoted one number and charged another.
 *
 * Rule (spec §4.2): an active subscriber pays the flat city base fare with no peak
 * uplift. Everyone else pays baseFare * peakMultiplier during a peak window.
 */
export async function calculateFare(opts: {
  city: string;
  tripType: TripType;
  requestedAt?: DateInput;
  hours?: number;
  customerId?: string;
  /** Optional: an absent or unrecognised class bills at the base rate. */
  vehicleClass?: string;
}): Promise<FareBreakdown> {
  const rule = await PricingRule.findOne({ city: opts.city.toLowerCase() }).lean();
  if (!rule) throw ApiError.notFound(`No pricing rule configured for city '${opts.city}'`);

  const when = opts.requestedAt ?? now();
  const peak = isPeakHour(when);
  const subscriber = opts.customerId ? await hasActiveSubscription(opts.customerId) : false;

  // Hourly trips bill the (possibly peak-adjusted) rate per hour booked.
  const multiplier = subscriber || !peak ? 1 : rule.peakMultiplier;
  const hours = opts.tripType === 'hourly' ? (opts.hours ?? 1) : undefined;
  // The class uplift compounds with the peak multiplier: a Sprinter in a peak window
  // pays both. A subscriber still escapes the peak part, never the class part — the
  // plan waives surge pricing, it does not buy a bigger car at saloon rates.
  // The catalogue is a collection now, so operations can change a class multiplier
  // without a deploy. config/vehicles.ts is only the seed and the last-resort fallback.
  // A class restricted to hourly (or to transfers) cannot be quoted for the other kind.
  await vehicleService.assertClassOffered(opts.vehicleClass, opts.tripType);
  const vehicle = await vehicleService.multiplierFor(opts.vehicleClass, opts.tripType);
  const fare = round2(rule.baseFare * multiplier * (hours ?? 1) * vehicle);

  return {
    city: rule.city,
    tripType: opts.tripType,
    baseFare: rule.baseFare,
    peakMultiplier: rule.peakMultiplier,
    isPeak: peak,
    subscriber,
    ...(hours !== undefined ? { hours } : {}),
    ...(opts.vehicleClass ? { vehicleClass: opts.vehicleClass } : {}),
    vehicleMultiplier: vehicle,
    fare,
  };
}

/* ------------------------------ subscriptions ----------------------------- */

/**
 * The subscription catalogue — the ONLY source of a plan's price.
 *
 * Price used to arrive in the request body, so `{"plan":"free","price":0}` bought a real
 * subscription for nothing and switched on the subscriber discount for every subsequent
 * fare. A price the customer can name is not a price.
 */
export const SUBSCRIPTION_PLANS: Record<string, { label: string; price: number }> = {
  monthly: { label: 'Viaro Monthly', price: 49 },
  annual: { label: 'Viaro Annual', price: 499 },
};

export function listSubscriptionPlans() {
  return Object.entries(SUBSCRIPTION_PLANS).map(([key, plan]) => ({
    plan: key,
    label: plan.label,
    price: plan.price,
  }));
}

export async function createSubscription(userId: string, input: CreateSubscriptionInput) {
  const active = await Subscription.findOne({ userId, status: 'active' }).lean();
  if (active) throw ApiError.conflict('You already have an active subscription');

  const catalogue = SUBSCRIPTION_PLANS[input.plan.toLowerCase()];
  if (!catalogue) {
    throw ApiError.badRequest(
      `Unknown plan '${input.plan}'. Choose one of: ${Object.keys(SUBSCRIPTION_PLANS).join(', ')}`,
    );
  }

  /*
   * Charge BEFORE activating.
   *
   * Activation is what grants the discount, so it must never happen on the strength of an
   * unpaid request. A declined card leaves no subscription behind at all.
   */
  const charge = await collectPayment({
    amount: catalogue.price,
    reference: `subscription:${userId}:${Date.now()}`,
    description: `Viaro ${catalogue.label} subscription`,
  });

  if (!charge.success) throw new ApiError(402, 'Payment for the subscription was declined');

  const startDate = now();
  return Subscription.create({
    userId,
    plan: input.plan.toLowerCase(),
    price: catalogue.price,
    status: 'active',
    startDate: toDate(startDate),
    renewalDate: toDate(startDate.plus({ months: 1 })),
    paymentReference: charge.gatewayReference ?? null,
  });
}

export async function getMySubscription(userId: string) {
  const sub = await Subscription.findOne({ userId }).sort({ createdAt: -1 }).lean();
  if (!sub) throw ApiError.notFound('No subscription found');
  return sub;
}

export async function cancelSubscription(userId: string) {
  const sub = await Subscription.findOne({ userId, status: 'active' });
  if (!sub) throw ApiError.notFound('No active subscription to cancel');

  sub.status = 'cancelled';
  await sub.save();
  return sub;
}

/* ------------------------------ admin pricing ----------------------------- */

export async function createPricingRule(input: CreatePricingRuleInput) {
  const existing = await PricingRule.findOne({ city: input.city.toLowerCase() }).lean();
  if (existing) throw ApiError.conflict(`Pricing for '${input.city}' already exists — PATCH it instead`);
  return PricingRule.create(input);
}

export async function listPricingRules() {
  return PricingRule.find().sort({ city: 1 }).lean();
}

export async function updatePricingRule(id: string, input: UpdatePricingRuleInput) {
  const rule = await PricingRule.findByIdAndUpdate(id, { $set: input }, { new: true, runValidators: true });
  if (!rule) throw ApiError.notFound('Pricing rule not found');
  return rule;
}

/** Bookings reference a city by name, not by rule id, so removing a rule orphans nothing. */
export async function deletePricingRule(id: string): Promise<void> {
  const rule = await PricingRule.findByIdAndDelete(id);
  if (!rule) throw ApiError.notFound('Pricing rule not found');
}
