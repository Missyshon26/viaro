import { Booking } from '../../models/Booking';
import { round2 } from '../../utils/money';
import { MAX_GRATUITY_PCT } from '../../config/services';
import { getSettingsValues } from '../admin/settings.service';

/**
 * What goes on top of the trip price: a gratuity the customer chooses, a discount the
 * business gives, and tax. Kept apart from the fare calculator so the arithmetic is one
 * small function that can be tested on its own, and the rules below are written once.
 *
 *     trip price (class fare + primetime + meet & greet + stops)      = subtotal
 *   + gratuity     subtotal × the customer's chosen %
 *   − discount     a flat amount, never more than subtotal + gratuity
 *   + tax          (subtotal + gratuity − discount) × the tax %
 *   = total        what is charged
 *
 * Tax is worked out AFTER the discount: a discount lowers the price, so it lowers the
 * taxable amount too. Money is rounded to the cent at every step, so the lines on an invoice
 * always add up to its total.
 */
export type DiscountKind = 'welcome' | 'loyalty';

export interface Discount {
  kind: DiscountKind;
  /** Dollars. */
  amount: number;
}

export interface Adjustments {
  gratuityPct: number;
  gratuity: number;
  discountKind?: DiscountKind;
  discount: number;
  taxPct: number;
  tax: number;
  /** subtotal + gratuity − discount + tax */
  total: number;
}

export function applyAdjustments(input: {
  subtotal: number;
  gratuityPct?: number;
  discount?: Discount | null;
  taxPct?: number;
}): Adjustments {
  const gratuityPct = Math.min(Math.max(input.gratuityPct ?? 0, 0), MAX_GRATUITY_PCT);
  const taxPct = Math.max(input.taxPct ?? 0, 0);

  const gratuity = round2((input.subtotal * gratuityPct) / 100);
  const gross = round2(input.subtotal + gratuity);
  const discount = round2(Math.min(Math.max(input.discount?.amount ?? 0, 0), gross));
  const taxable = round2(gross - discount);
  const tax = round2((taxable * taxPct) / 100);

  return {
    gratuityPct,
    gratuity,
    ...(discount > 0 && input.discount ? { discountKind: input.discount.kind } : {}),
    discount,
    taxPct,
    tax,
    total: round2(taxable + tax),
  };
}

/**
 * Which discount, if any, this customer's next trip earns.
 *
 *  - welcome: their very first trip. Any earlier booking — even one that was cancelled —
 *    uses it up, so booking and cancelling cannot earn it twice.
 *  - loyalty: every Nth trip (4th, 8th, 12th… by default), counting trips that were not
 *    cancelled. A cancelled trip does not count towards the next reward.
 *  - never both: trip 1 is a welcome, and N is at least 2.
 *
 * `tripsAhead` is for pricing several legs of one journey before any is saved: leg 2 is
 * priced as the trip after leg 1, so only the first leg of a new customer's journey gets
 * the welcome discount.
 */
export async function discountFor(customerId: string, tripsAhead = 0): Promise<Discount | null> {
  const settings = await getSettingsValues();
  if (settings.welcomeDiscount <= 0 && settings.loyaltyDiscount <= 0) return null;

  const [everBooked, kept] = await Promise.all([
    Booking.countDocuments({ customerId }),
    Booking.countDocuments({ customerId, status: { $ne: 'cancelled' } }),
  ]);

  if (everBooked + tripsAhead === 0) {
    return settings.welcomeDiscount > 0 ? { kind: 'welcome', amount: settings.welcomeDiscount } : null;
  }

  const tripNumber = kept + tripsAhead + 1;
  if (settings.loyaltyDiscount > 0 && tripNumber % settings.loyaltyEveryNth === 0) {
    return { kind: 'loyalty', amount: settings.loyaltyDiscount };
  }
  return null;
}
