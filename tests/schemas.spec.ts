import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Booking } from '../src/models/Booking';
import { User } from '../src/models/User';
import { VehicleClass } from '../src/models/VehicleClass';

/**
 * The mocked suites never touch Mongoose's validation, so a field the schema silently
 * rejects (a typo in an enum, a max set too low) would pass them all. These build real
 * documents and ask the schema, with no database needed.
 */

/** Mongoose's async validation. Resolves to undefined when valid, else the error. */
const check = async (doc: { validate: () => Promise<unknown> }) => {
  try {
    await doc.validate();
    return undefined;
  } catch (err) {
    return err as { errors: Record<string, unknown> };
  }
};

const point = (address: string) => ({ lat: 47.6, lng: -122.3, address });
const oid = () => new Types.ObjectId();

const base = () => ({
  customerId: oid(),
  pickup: point('123 Pine St, Seattle'),
  drop: point('Sea-Tac Airport'),
  vehicleClass: 'sedan',
  tripType: 'airport',
  scheduledAt: new Date('2026-11-03T17:00:00Z'),
});

describe('Booking schema — everything the new features write', () => {
  it('accepts a booking carrying all of it', async () => {
    const doc = new Booking({
      ...base(),
      isGuest: true,
      stops: [point('Pike Place'), point('Space Needle')],
      journey: { index: 2, count: 3 },
      agreementVersion: '2026-10',
      agreementSignedAt: new Date(),
      occasion: 'Wedding',
      occasionDetails: 'Rehearsal dinner',
      carryOnBags: 1,
      checkedBags: 2,
      passengerName: 'Alex Rider',
      passengerPhone: '+12065550148',
      flightDetails: { flightNumber: 'as123', scheduledArrival: new Date('2026-11-03T16:50:00Z') },
      fareBreakdown: {
        classFare: 140,
        primetimeSurcharge: 20,
        meetAndGreetFee: 25,
        stopCount: 2,
        stopFee: 30,
        pricingModel: 'flat',
        route: 'Tacoma to Sea-Tac',
        hours: 3,
      },
      estimatedFare: 215,
    });

    expect(await check(doc)).toBeUndefined();
    // Normalisation the code relies on: flight numbers are upper-cased.
    expect(doc.flightDetails?.flightNumber).toBe('AS123');
    expect(doc.stops).toHaveLength(2);
  });

  it('still accepts a plain booking with none of the new fields', async () => {
    const doc = new Booking({ ...base(), tripType: 'point2point' });
    expect(await check(doc)).toBeUndefined();
    expect(doc.isGuest).toBe(false);
    expect(doc.stops).toBeUndefined();
    expect(doc.journey).toBeUndefined();
    expect(doc.fareBreakdown).toBeUndefined();
  });

  it('allows a payment on every leg up to the maximum, and no further', async () => {
    const payment = (leg: number) => ({
      provider: 'stripe',
      intentId: 'pi_1',
      leg,
      amount: 100,
      currency: 'USD',
      status: 'paid',
      refundedAmount: 0,
      refundIds: [],
      paidAt: new Date(),
    });
    for (const leg of [0, 1, 2, 3, 4]) {
      expect(await check(new Booking({ ...base(), payment: payment(leg) }))).toBeUndefined();
    }
    expect((await check(new Booking({ ...base(), payment: payment(5) })))?.errors['payment.leg']).toBeDefined();
  });

  it('rejects a journey that is not really one, or a position outside it', async () => {
    expect((await check(new Booking({ ...base(), journey: { index: 0, count: 1 } })))?.errors['journey.count']).toBeDefined();
    expect((await check(new Booking({ ...base(), journey: { index: 5, count: 5 } })))?.errors['journey.index']).toBeDefined();
    expect((await check(new Booking({ ...base(), journey: { index: 0, count: 6 } })))?.errors['journey.count']).toBeDefined();
  });

  it('rejects an unknown amendment author', async () => {
    const badAuthor = await check(
      new Booking({ ...base(), amendments: [{ field: 'drop', from: 'a', to: 'b', by: 'robot', at: new Date() }] }),
    );
    expect(badAuthor).toBeDefined();
  });

  it('rejects a stop with no coordinates, and negative bag counts', async () => {
    expect(await check(new Booking({ ...base(), stops: [{ address: 'Pike Place' }] }))).toBeDefined();
    expect((await check(new Booking({ ...base(), checkedBags: -1 })))?.errors.checkedBags).toBeDefined();
  });

  it('rejects a fare breakdown with a missing or negative line', async () => {
    expect(await check(new Booking({ ...base(), fareBreakdown: { classFare: 100 } }))).toBeDefined();
    expect(
      await check(
        new Booking({
          ...base(),
          fareBreakdown: { classFare: -1, primetimeSurcharge: 0, meetAndGreetFee: 0, stopCount: 0, stopFee: 0 },
        }),
      ),
    ).toBeDefined();
  });
});

describe('User schema — guest and agreement', () => {
  const user = (extra: Record<string, unknown> = {}) =>
    new User({ role: 'customer', name: 'Sam', email: 'sam@example.com', phone: '+12065550148', passwordHash: 'x', ...extra });

  it('accepts a guest who has signed', async () => {
    const doc = user({
      isGuest: true,
      agreement: { version: '2026-10', signedAt: new Date() },
      signature: 'data:image/png;base64,AAAA',
    });
    expect(await check(doc)).toBeUndefined();
  });

  it('defaults to not a guest and not signed', () => {
    const doc = user();
    expect(doc.isGuest).toBe(false);
    expect(doc.agreement).toBeUndefined();
  });

  it('refuses an agreement with no date', async () => {
    expect(await check(user({ agreement: { version: '2026-10' } }))).toBeDefined();
  });

  it('never serialises the signature image into an ordinary payload', () => {
    const json = user({
      signature: 'data:image/png;base64,AAAA',
      agreement: { version: 'v', signedAt: new Date() },
    }).toJSON() as unknown as Record<string, unknown>;
    expect(json).not.toHaveProperty('signature');
    expect(json).not.toHaveProperty('passwordHash');
    expect(json.agreement).toMatchObject({ version: 'v' });
  });

  it('keeps the signature out of ordinary reads', () => {
    expect((User.schema.path('signature').options as { select?: boolean }).select).toBe(false);
  });
});

describe('VehicleClass schema — stop fee', () => {
  const cls = (extra: Record<string, unknown> = {}) =>
    new VehicleClass({ value: 'sedan', label: 'Sedan', seats: 3, bags: 2, multiplier: 1, ...extra });

  it('defaults to no stop fee, and accepts one', async () => {
    expect(cls().stopFee).toBeNull();
    expect(await check(cls({ stopFee: 15 }))).toBeUndefined();
  });

  it('refuses a negative stop fee', async () => {
    expect((await check(cls({ stopFee: -1 })))?.errors.stopFee).toBeDefined();
  });
});
