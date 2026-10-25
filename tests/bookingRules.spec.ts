import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ capacityFor: vi.fn() }));
vi.mock('../src/modules/vehicle/vehicle.service', () => ({ capacityFor: mocks.capacityFor }));

import {
  assertVehicleRules,
  bagsViolation,
  totalBags,
  weddingViolation,
} from '../src/modules/booking/booking.rules';
import { WEDDING_VEHICLE_CLASSES, isWeddingVehicle } from '../src/config/services';

describe('the wedding rule', () => {
  it('names exactly the two First Class classes', () => {
    expect([...WEDDING_VEHICLE_CLASSES]).toEqual(['sedan-first', 'suv-first', 'legacy-first-class-sedan-long-distance', 'legacy-first-class-suv']);
    // the same two classes under the keys they carry from the old booking site
    expect(isWeddingVehicle('legacy-first-class-suv')).toBe(true);
    expect(isWeddingVehicle('legacy-executive-sedan-sea-region')).toBe(false);
    expect(isWeddingVehicle('sedan-first')).toBe(true);
    expect(isWeddingVehicle('SUV-First')).toBe(true);
    expect(isWeddingVehicle(' suv-first ')).toBe(true);
  });

  it.each(['sedan', 'mpv', 'suv', 'suv-luxury', 'minibus', 'limo', 'nemt', ''])('does not include %s', (key) => {
    expect(isWeddingVehicle(key)).toBe(false);
  });

  it('only restricts weddings', () => {
    expect(weddingViolation({ vehicleClass: 'sedan', occasion: 'Birthday' })).toBeNull();
    expect(weddingViolation({ vehicleClass: 'sedan', occasion: undefined })).toBeNull();
    expect(weddingViolation({ vehicleClass: 'sedan', occasion: null })).toBeNull();
    expect(weddingViolation({ vehicleClass: 'minibus', occasion: 'Other' })).toBeNull();
  });

  it('lets a wedding use either First Class vehicle, and no other', () => {
    expect(weddingViolation({ vehicleClass: 'sedan-first', occasion: 'Wedding' })).toBeNull();
    expect(weddingViolation({ vehicleClass: 'suv-first', occasion: 'Wedding' })).toBeNull();
    expect(weddingViolation({ vehicleClass: 'sedan', occasion: 'Wedding' })).toMatch(/First Class Sedan and First Class SUV/);
    expect(weddingViolation({ vehicleClass: 'limo', occasion: 'Wedding' })).not.toBeNull();
  });
});

describe('the luggage rule', () => {
  const sedan = { label: 'Business Sedan', bags: 2 };

  it('counts checked and carry-on bags together', () => {
    expect(totalBags({ checkedBags: 2, carryOnBags: 1 })).toBe(3);
    expect(totalBags({ checkedBags: 2 })).toBe(2);
    expect(totalBags({})).toBe(0);
    expect(totalBags({ checkedBags: null, carryOnBags: null })).toBe(0);
  });

  it('accepts luggage up to exactly the capacity', () => {
    expect(bagsViolation({ checkedBags: 1, carryOnBags: 1 }, sedan)).toBeNull();
    expect(bagsViolation({ checkedBags: 2 }, sedan)).toBeNull();
    expect(bagsViolation({}, sedan)).toBeNull();
  });

  it('refuses one bag over, and says by how much', () => {
    expect(bagsViolation({ checkedBags: 2, carryOnBags: 1 }, sedan)).toBe(
      'Business Sedan holds 2 bags, and you have 3. Choose a larger vehicle or take fewer bags.',
    );
  });

  it('uses the singular for a one-bag vehicle', () => {
    expect(bagsViolation({ checkedBags: 2 }, { label: 'Tiny', bags: 1 })).toContain('holds 1 bag,');
  });
});

describe('assertVehicleRules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.capacityFor.mockResolvedValue({ label: 'Business Sedan', seats: 3, bags: 2 });
  });

  it('passes an ordinary booking without looking anything up', async () => {
    await expect(assertVehicleRules({ vehicleClass: 'sedan' })).resolves.toBeUndefined();
    expect(mocks.capacityFor).not.toHaveBeenCalled();
  });

  it('refuses the wrong vehicle for a wedding, with a code a client can act on', async () => {
    await expect(assertVehicleRules({ vehicleClass: 'sedan', occasion: 'Wedding' })).rejects.toMatchObject({
      statusCode: 400,
      details: { code: 'WEDDING_VEHICLE_REQUIRED', allowed: ['sedan-first', 'suv-first', 'legacy-first-class-sedan-long-distance', 'legacy-first-class-suv'] },
    });
  });

  it('accepts a wedding in a First Class vehicle', async () => {
    mocks.capacityFor.mockResolvedValue({ label: 'First Class Sedan', seats: 3, bags: 2 });
    await expect(
      assertVehicleRules({ vehicleClass: 'sedan-first', occasion: 'Wedding', checkedBags: 1 }),
    ).resolves.toBeUndefined();
  });

  it('refuses luggage that does not fit', async () => {
    await expect(
      assertVehicleRules({ vehicleClass: 'sedan', checkedBags: 3, carryOnBags: 1 }),
    ).rejects.toMatchObject({
      statusCode: 400,
      details: { code: 'BAGS_EXCEED_CAPACITY', capacity: 2, bags: 4 },
    });
    expect(mocks.capacityFor).toHaveBeenCalledWith('sedan');
  });

  it('does not block a booking when the vehicle\'s capacity is unknown', async () => {
    mocks.capacityFor.mockResolvedValue(null);
    await expect(assertVehicleRules({ vehicleClass: 'ghost', checkedBags: 20 })).resolves.toBeUndefined();
  });

  it('checks the wedding rule first, so the more fundamental problem is the one reported', async () => {
    await expect(
      assertVehicleRules({ vehicleClass: 'sedan', occasion: 'Wedding', checkedBags: 9 }),
    ).rejects.toMatchObject({ details: { code: 'WEDDING_VEHICLE_REQUIRED' } });
  });
});
