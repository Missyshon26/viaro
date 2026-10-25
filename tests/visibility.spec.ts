import { describe, expect, it } from 'vitest';
import { ROLES } from '../src/utils/roles';
import {
  canSeeDriverPhone,
  canSeeTripFare,
  stripFareIfHidden,
  MASKED_PHONE,
} from '../src/utils/visibility';
import { shapeTripForRole } from '../src/modules/trip/trip.service';

/**
 * Spec §8 rules 2 and 4. These were implemented twice — once in trip.service, once
 * inline in reports.service — so the rules now live in utils/visibility and both call
 * sites go through them. These tests pin the rules themselves.
 */
describe('spec §8 rule 2 — drivers never see the fare', () => {
  it('hides the fare from drivers and nobody else', () => {
    expect(canSeeTripFare('driver')).toBe(false);
    for (const role of ROLES.filter((r) => r !== 'driver')) {
      expect(canSeeTripFare(role)).toBe(true);
    }
  });

  it('strips both money fields for a driver', () => {
    const doc = { _id: 't1', fareAmount: 165.77, creditApplied: 10, status: 'completed' };

    expect(stripFareIfHidden(doc, 'driver')).toEqual({ _id: 't1', status: 'completed' });
    expect(stripFareIfHidden(doc, 'admin')).toEqual(doc);
  });

  it('does not mutate the document it is given', () => {
    const doc = { _id: 't1', fareAmount: 165.77 };
    stripFareIfHidden(doc, 'driver');
    expect(doc.fareAmount).toBe(165.77);
  });
});

describe('spec §8 rule 4 — customers never see the real number', () => {
  it('masks for customers only', () => {
    expect(canSeeDriverPhone('customer')).toBe(false);
    for (const role of ROLES.filter((r) => r !== 'customer')) {
      expect(canSeeDriverPhone(role)).toBe(true);
    }
  });
});

describe('shapeTripForRole applies both rules', () => {
  const trip = {
    _id: 't1',
    status: 'started',
    fareAmount: 165.77,
    creditApplied: 5,
    driver: { driverId: 'd1', name: 'Miguel R.', phone: '+1 206 555 0148' },
  };

  it('gives a driver no fare but a real phone', () => {
    const shaped = shapeTripForRole(trip, 'driver');
    expect(shaped.fareAmount).toBeUndefined();
    expect(shaped.creditApplied).toBeUndefined();
    expect((shaped.driver as { phone: string }).phone).toBe('+1 206 555 0148');
  });

  it('gives a customer the fare but a masked phone', () => {
    const shaped = shapeTripForRole(trip, 'customer');
    expect(shaped.fareAmount).toBe(165.77);
    expect((shaped.driver as { phone: string }).phone).toBe(MASKED_PHONE);
  });

  it('gives admin and company the unredacted document', () => {
    for (const role of ['admin', 'company'] as const) {
      const shaped = shapeTripForRole(trip, role);
      expect(shaped.fareAmount).toBe(165.77);
      expect((shaped.driver as { phone: string }).phone).toBe('+1 206 555 0148');
    }
  });
});
