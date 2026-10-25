import { ApiError } from '../../utils/ApiError';
import { WEDDING_OCCASION, WEDDING_VEHICLE_CLASSES, isWeddingVehicle } from '../../config/services';
import * as vehicleService from '../vehicle/vehicle.service';

/**
 * Rules about WHICH vehicle a booking may use, shared by every path that sets one:
 * creating a booking, opening a card checkout, and editing a booking afterwards.
 *
 * They live in one place because they were already drifting: a rule enforced only when a
 * booking is made is a rule the edit screen quietly undoes (book a sedan for a birthday,
 * then edit the occasion to "Wedding"; book a van, then edit the luggage to ten bags).
 */

/** The state a rule is judged on — what the booking WILL be, not what was sent. */
export interface RuleSubject {
  /** The resolved catalogue key. */
  vehicleClass: string;
  occasion?: string | null;
  checkedBags?: number | null;
  carryOnBags?: number | null;
}

/** Total bags, checked and carry-on together. */
export const totalBags = (subject: Pick<RuleSubject, 'checkedBags' | 'carryOnBags'>): number =>
  (subject.checkedBags ?? 0) + (subject.carryOnBags ?? 0);

/** Null when the vehicle may serve this occasion, else why not — worded for the customer. */
export function weddingViolation(subject: Pick<RuleSubject, 'vehicleClass' | 'occasion'>): string | null {
  if (subject.occasion !== WEDDING_OCCASION) return null;
  if (isWeddingVehicle(subject.vehicleClass)) return null;
  return 'Weddings are served by our First Class Sedan and First Class SUV. Please choose one of those, or change the occasion.';
}

/** Null when the luggage fits, else why not. A vehicle that holds `capacity` bags in total. */
export function bagsViolation(
  subject: Pick<RuleSubject, 'checkedBags' | 'carryOnBags'>,
  capacity: { label: string; bags: number },
): string | null {
  const bags = totalBags(subject);
  if (bags <= capacity.bags) return null;
  return `${capacity.label} holds ${capacity.bags} bag${capacity.bags === 1 ? '' : 's'}, and you have ${bags}. Choose a larger vehicle or take fewer bags.`;
}

/**
 * Refuses a booking that breaks a vehicle rule. Throws a 400 with a stable `code`, so a
 * client can tell "wrong vehicle for a wedding" from "too many bags" without parsing text.
 */
export async function assertVehicleRules(subject: RuleSubject): Promise<void> {
  const wedding = weddingViolation(subject);
  if (wedding) {
    throw new ApiError(400, wedding, {
      code: 'WEDDING_VEHICLE_REQUIRED',
      allowed: [...WEDDING_VEHICLE_CLASSES],
    });
  }

  if (totalBags(subject) > 0) {
    const capacity = await vehicleService.capacityFor(subject.vehicleClass);
    const overflow = capacity ? bagsViolation(subject, capacity) : null;
    if (overflow && capacity) {
      throw new ApiError(400, overflow, {
        code: 'BAGS_EXCEED_CAPACITY',
        capacity: capacity.bags,
        bags: totalBags(subject),
      });
    }
  }
}
