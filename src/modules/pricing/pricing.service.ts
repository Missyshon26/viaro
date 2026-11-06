import { PricingRule } from '../../models/PricingRule';
import { Subscription } from '../../models/Subscription';
import type { TripType } from '../../models/Booking';
import { hourOfDay, now, toAppTime, toDate, type DateInput } from '../../config/timezone';
import { ApiError } from '../../utils/ApiError';
import { ceilDollars, round2 } from '../../utils/money';
import * as vehicleService from '../vehicle/vehicle.service';
import * as packageService from '../package/package.service';
import { collectPayment, isStripeEnabled } from '../../integrations/paymentGateway';
import { getCardOnFile } from '../payments/cardPayments';
import { getSettingsValues } from '../admin/settings.service';
import { applyAdjustments, discountFor, type Discount, type DiscountKind, type ManualDiscount } from './pricing.adjustments';
import { MEET_AND_GREET_FEE, routeFareFor } from '../../config/services';
import { routeMiles } from '../../integrations/routeDistance';
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

/**
 * Primetime: a flat surcharge on pickups late at night or early in the morning, in
 * America/Los_Angeles local time (pre-deployment checklist §2: +$20, 10pm–7am).
 *
 * Unlike the peak multiplier this applies to every pricing model, fixed rates included,
 * and a subscription does not waive it — it pays for an unsocial-hours chauffeur, not
 * for demand.
 */
export const PRIMETIME = { startHour: 22, endHour: 7, surcharge: 20 } as const;

export function isPrimetime(when: DateInput = now()): boolean {
  const hour = hourOfDay(when);
  // The window wraps midnight: 22:00–23:59 and 00:00–06:59.
  return hour >= PRIMETIME.startHour || hour < PRIMETIME.endHour;
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
  /**
   * How the class part of the fare was worked out:
   *   flat        — the class's fixed transfer price
   *   hourly      — the class's fixed price per hour × hours
   *   multiplier  — city base fare × peak × hours × class multiplier
   *   route       — a fixed price for this journey (config/services.ts ROUTE_FARES)
   *   package     — the fixed price a package lists for this vehicle
   */
  pricingModel: 'flat' | 'hourly' | 'multiplier' | 'route' | 'package';
  /** The package's name, when pricingModel is 'package'. */
  packageName?: string;
  /** The route the price came from, when pricingModel is 'route'. */
  route?: string;
  /** Whether the peak multiplier was actually charged (never on a fixed rate). */
  peakApplied: boolean;
  /** The fare before surcharges, after any minimum fare. */
  classFare: number;
  /** Set when the class's minimum fare lifted the price. */
  minimumFare?: number;
  primetime: boolean;
  primetimeSurcharge: number;
  /** The Meet and Greet add-on; 0 when not requested. */
  meetAndGreetFee: number;
  /** How many intermediate stops were priced, and the charge for them (0 if none). */
  stopCount: number;
  stopFee: number;
  /**
   * Per-mile pricing, for a flat-rate transfer whose class has it: the route measured by the
   * server, the miles the flat rate covers, the miles beyond them (rounded up), the rate for each,
   * and the charge. `distanceFee` is 0 when the trip is within the included miles, or the class
   * does not charge by the mile. `distanceUnknown` is set when the route could not be measured,
   * in which case the flat rate is charged on its own.
   */
  distanceMiles?: number;
  includedMiles?: number;
  extraMiles?: number;
  perMileRate?: number;
  distanceFee: number;
  distanceUnknown?: boolean;
  /** The trip price: classFare + distanceFee + primetimeSurcharge + meetAndGreetFee + stopFee. */
  subtotal: number;
  /** The automatic fuel surcharge (a percentage of the subtotal, rounded up to whole dollars). */
  fuelSurchargePct: number;
  fuelSurcharge: number;
  /** The tip the customer chose (a percentage of the subtotal), and what it comes to. */
  gratuityPct: number;
  gratuity: number;
  /** A welcome or loyalty discount, in dollars; 0 when none applies. */
  discountKind?: DiscountKind;
  discount: number;
  /** Sales tax on subtotal + gratuity − discount. */
  taxPct: number;
  tax: number;
  /** What is charged: subtotal + fuel surcharge + gratuity − discount + tax. */
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
  /** Both addresses, so a fixed route price (e.g. Tacoma ↔ Sea-Tac) can apply. */
  pickupAddress?: string;
  dropAddress?: string;
  meetAndGreet?: boolean;
  /** Intermediate stops on a transfer; each is charged the class's stopFee. */
  stopCount?: number;
  /** The stops' addresses, so the route can be measured through them. */
  stopAddresses?: readonly string[];
  /**
   * Price this as a package: the package's own price for the vehicle replaces the distance or
   * class fare, and the extras that belong to a transfer (primetime, meet and greet, stops,
   * miles) do not apply. Tip, fuel surcharge, discount and tax still do.
   */
  packageId?: string;
  /** The tip the customer chose, as a percentage of the trip price. Absent = none. */
  gratuityPct?: number;
  /** A discount an operator typed in; replaces the automatic welcome / loyalty one. */
  manualDiscount?: ManualDiscount;
  /** Earlier trips in the same request (the legs of a journey priced together). */
  tripsAhead?: number;
  /**
   * Re-pricing a booking that already exists: keep the tip, tax rate and discount it was
   * given, instead of looking them up again. Today's settings, or the customer's trip
   * count, must not change what an amendment costs.
   */
  locked?: { gratuityPct: number; taxPct: number; fuelPct?: number; discount?: Discount | null };
}): Promise<FareBreakdown> {
  const city = opts.city.toLowerCase();
  // Optional: a vehicle with its own rate (the old ABL way) prices anywhere. Only the city
  // multiplier formula needs the rule, and that check is made once the model is known.
  const rule = await PricingRule.findOne({ city }).lean();

  const when = opts.requestedAt ?? now();
  const peak = isPeakHour(when);
  const subscriber = opts.customerId ? await hasActiveSubscription(opts.customerId) : false;

  // Hourly trips bill the (possibly peak-adjusted) rate per hour booked.
  const multiplier = subscriber || !peak ? 1 : (rule?.peakMultiplier ?? 1);
  const hours = opts.tripType === 'hourly' ? (opts.hours ?? 1) : undefined;
  // The class uplift compounds with the peak multiplier: a Sprinter in a peak window
  // pays both. A subscriber still escapes the peak part, never the class part — the
  // plan waives surge pricing, it does not buy a bigger car at saloon rates.
  // The catalogue is a collection now, so operations can change a class multiplier
  // without a deploy. config/vehicles.ts is only the seed and the last-resort fallback.
  // A class restricted to hourly (or to transfers) cannot be quoted for the other kind.
  await vehicleService.assertClassOffered(opts.vehicleClass, opts.tripType);
  const rates = await vehicleService.ratesFor(opts.vehicleClass, opts.tripType);

  /*
   * A fixed rate on the class wins: the rate card is the price, so neither the city base
   * fare nor the peak window touches it. The city rule is still required above — it is
   * what makes a city bookable at all.
   */
  // A route price is the most specific of all, so it wins over the class's flat rate.
  // Transfers only: an hourly charter is priced by the hour wherever it goes.
  const pkg = opts.packageId && opts.vehicleClass ? await packageService.priceFor(opts.packageId, opts.vehicleClass) : null;
  if (opts.packageId && !opts.vehicleClass) throw ApiError.badRequest('Choose a vehicle for this package');
  const route =
    opts.tripType === 'hourly' || pkg
      ? null
      : routeFareFor(opts.pickupAddress, opts.dropAddress, opts.vehicleClass);

  const pricingModel: FareBreakdown['pricingModel'] = pkg
    ? 'package'
    : route
    ? 'route'
    : rates.fixedRate !== null
      ? opts.tripType === 'hourly'
        ? 'hourly'
        : 'flat'
      : 'multiplier';
  // Only the city formula depends on the city's rule; every other price comes from the
  // vehicle, the route or the package, so an unlisted city is still quotable.
  if (pricingModel === 'multiplier' && !rule) throw ApiError.notFound(`No pricing rule configured for city '${opts.city}'`);
  const computed = pkg
    ? pkg.price
    : route
    ? route.price
    : pricingModel === 'multiplier'
      ? (rule?.baseFare ?? 0) * multiplier * (hours ?? 1) * rates.multiplier
      : (rates.fixedRate as number) * (hours ?? 1);

  const floored = !pkg && rates.minimumFare !== null && computed < rates.minimumFare;
  const classFare = ceilDollars(floored ? (rates.minimumFare as number) : computed);

  const primetime = !pkg && isPrimetime(when);
  const primetimeSurcharge = primetime ? PRIMETIME.surcharge : 0;
  const meetAndGreetFee = opts.meetAndGreet && !pkg ? MEET_AND_GREET_FEE : 0;
  // Stops belong to transfers: an hourly charter goes wherever the hours take it.
  const stopCount = opts.tripType === 'hourly' || pkg ? 0 : Math.max(0, Math.floor(opts.stopCount ?? 0));
  const stopFee = ceilDollars(stopCount * rates.stopFee);

  /*
   * By the mile: a flat transfer rate covers the first `baseMiles`; each mile after costs
   * `perMileRate`, miles rounded up. The server measures the route (never the request), through
   * the stops. If it cannot, the flat rate stands alone and the quote says the distance was
   * unknown, rather than guessing a number into a customer's bill.
   */
  let distance: { miles: number; included: number; extra: number; rate: number; fee: number } | null = null;
  let distanceUnknown = false;
  const perMile =
    pricingModel === 'flat' && rates.perMileRate !== null && rates.perMileRate > 0 && rates.baseMiles !== null;
  const limited = !pkg && rates.maxMiles !== null && opts.tripType !== 'hourly';
  if ((perMile || limited) && opts.pickupAddress && opts.dropAddress) {
    const miles = await routeMiles(opts.pickupAddress, opts.dropAddress, opts.stopAddresses ?? []);
    if (miles === null) {
      // Could not be measured: the flat rate stands, and the limit cannot be checked either.
      distanceUnknown = true;
    } else {
      if (limited && miles > (rates.maxMiles as number)) {
        throw new ApiError(
          400,
          `${rates.label ?? 'This vehicle'} is not available for trips over ${rates.maxMiles} miles. Please choose another vehicle.`,
          { code: 'TOO_FAR', maxMiles: rates.maxMiles, miles: Math.round(miles * 10) / 10 },
        );
      }
      if (perMile) {
        const extra = Math.ceil(Math.max(0, miles - (rates.baseMiles as number)));
        distance = {
          miles: Math.round(miles * 10) / 10,
          included: rates.baseMiles as number,
          extra,
          rate: rates.perMileRate as number,
          fee: ceilDollars(extra * (rates.perMileRate as number)),
        };
      }
    }
  }
  const distanceFee = distance?.fee ?? 0;

  const subtotal = round2(classFare + distanceFee + primetimeSurcharge + meetAndGreetFee + stopFee);

  const locked = opts.locked;
  const adjustments = applyAdjustments({
    subtotal,
    fuelPct: locked ? (locked.fuelPct ?? 0) : (await getSettingsValues()).fuelSurchargePct,
    gratuityPct: locked ? locked.gratuityPct : opts.gratuityPct,
    taxPct: locked ? locked.taxPct : (await getSettingsValues()).taxPct,
    manualDiscount: locked ? null : opts.manualDiscount,
    discount: locked
      ? locked.discount
      : opts.customerId
        ? await discountFor(opts.customerId, opts.tripsAhead ?? 0)
        : null,
  });

  return {
    city: rule?.city ?? city,
    tripType: opts.tripType,
    baseFare: rule?.baseFare ?? 0,
    peakMultiplier: rule?.peakMultiplier ?? 1,
    isPeak: peak,
    subscriber,
    ...(hours !== undefined ? { hours } : {}),
    ...(opts.vehicleClass ? { vehicleClass: opts.vehicleClass } : {}),
    vehicleMultiplier: rates.multiplier,
    pricingModel,
    ...(pkg ? { packageName: pkg.name } : {}),
    ...(route ? { route: route.label } : {}),
    peakApplied: pricingModel === 'multiplier' && multiplier !== 1,
    classFare,
    ...(floored ? { minimumFare: rates.minimumFare as number } : {}),
    primetime,
    primetimeSurcharge,
    meetAndGreetFee,
    stopCount,
    stopFee,
    ...(distance
      ? { distanceMiles: distance.miles, includedMiles: distance.included, extraMiles: distance.extra, perMileRate: distance.rate }
      : {}),
    distanceFee,
    ...(distanceUnknown ? { distanceUnknown: true } : {}),
    subtotal,
    fuelSurchargePct: adjustments.fuelSurchargePct,
    fuelSurcharge: adjustments.fuelSurcharge,
    gratuityPct: adjustments.gratuityPct,
    gratuity: adjustments.gratuity,
    ...(adjustments.discountKind ? { discountKind: adjustments.discountKind } : {}),
    discount: adjustments.discount,
    taxPct: adjustments.taxPct,
    tax: adjustments.tax,
    fare: adjustments.total,
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
  monthly: { label: 'ABL Monthly', price: 49 },
  annual: { label: 'ABL Annual', price: 499 },
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
  // Charged to the card saved at the customer's last booking checkout.
  const card = isStripeEnabled() ? await getCardOnFile(userId) : null;
  if (isStripeEnabled() && !card) {
    throw new ApiError(402, 'Add a card by booking a ride first, then you can subscribe.');
  }
  const charge = await collectPayment({
    amount: catalogue.price,
    reference: `subscription:${userId}:${Date.now()}`,
    description: `ABL ${catalogue.label} subscription`,
    ...(card ? { customerId: card.customerId, paymentMethodId: card.paymentMethodId } : {}),
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
