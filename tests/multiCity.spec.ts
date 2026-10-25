import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bookingFind: vi.fn(),
  bookingFindOne: vi.fn(),
  createBooking: vi.fn(),
  retrieveIntent: vi.fn(),
  refund: vi.fn(),
  calculateFare: vi.fn(),
  resolveClass: vi.fn(),
}));

vi.mock('../src/models/Booking', async (orig) => {
  const actual = await orig<typeof import('../src/models/Booking')>();
  return {
    ...actual,
    Booking: Object.assign(actual.Booking, { find: mocks.bookingFind, findOne: mocks.bookingFindOne }),
  };
});
vi.mock('../src/modules/booking/booking.service', () => ({ createBooking: mocks.createBooking }));
vi.mock('../src/integrations/paymentGateway', () => ({
  createPaymentIntent: vi.fn(),
  isStripeEnabled: () => true,
  refundToCard: mocks.refund,
  retrievePaymentIntent: mocks.retrieveIntent,
}));
vi.mock('../src/modules/payments/cardPayments', () => ({
  ensureStripeCustomer: vi.fn(),
  saveCardFromIntent: vi.fn(async () => undefined),
}));
vi.mock('../src/modules/pricing/pricing.service', () => ({ calculateFare: mocks.calculateFare }));
vi.mock('../src/modules/vehicle/vehicle.service', () => ({ resolveBookableClass: mocks.resolveClass }));

import { redis } from '../src/config/redis';
import { ApiError } from '../src/utils/ApiError';
import { completeCheckout, partialJourneyMessage } from '../src/modules/booking/booking.checkout';
import { checkoutIntentSchema } from '../src/modules/booking/booking.validation';
import { MAX_JOURNEY_LEGS } from '../src/config/services';

const point = (address: string) => ({ lat: 47.6, lng: -122.3, address: `${address} Street` });
const leg = (address: string, scheduledAt: string, extra: Record<string, unknown> = {}) => ({
  pickup: point(address),
  drop: point(`${address} destination`),
  vehicleClass: 'sedan',
  tripType: 'point2point' as const,
  city: 'seattle',
  scheduledAt,
  ...extra,
});

/** Three days well in the future, so the "not in the past" rule never trips. */
const day = (offset: number, time = '09:00') => {
  const d = new Date(Date.now() + (30 + offset) * 86_400_000);
  return `${d.toISOString().slice(0, 10)}T${time}:00`;
};

describe('checkout schema for multi-leg journeys', () => {
  it('accepts a single trip, a round trip and a multi-city itinerary', () => {
    expect(checkoutIntentSchema.safeParse({ legs: [leg('A', day(0))] }).success).toBe(true);
    expect(checkoutIntentSchema.safeParse({ legs: [leg('A', day(0)), leg('B', day(1))] }).success).toBe(true);
    const five = Array.from({ length: MAX_JOURNEY_LEGS }, (_, i) => leg(`City ${i}`, day(i)));
    expect(checkoutIntentSchema.safeParse({ legs: five }).success).toBe(true);
  });

  it('refuses too many legs and an empty journey', () => {
    const six = Array.from({ length: MAX_JOURNEY_LEGS + 1 }, (_, i) => leg(`City ${i}`, day(i)));
    expect(checkoutIntentSchema.safeParse({ legs: six }).success).toBe(false);
    expect(checkoutIntentSchema.safeParse({ legs: [] }).success).toBe(false);
  });

  it('refuses legs that are out of order, simultaneous, or too close to drive', () => {
    const outOfOrder = checkoutIntentSchema.safeParse({ legs: [leg('A', day(2)), leg('B', day(1))] });
    expect(outOfOrder.success).toBe(false);

    expect(checkoutIntentSchema.safeParse({ legs: [leg('A', day(1)), leg('B', day(1))] }).success).toBe(false);
    expect(
      checkoutIntentSchema.safeParse({ legs: [leg('A', day(1, '09:00')), leg('B', day(1, '09:20'))] }).success,
    ).toBe(false);
    expect(
      checkoutIntentSchema.safeParse({ legs: [leg('A', day(1, '09:00')), leg('B', day(1, '09:30'))] }).success,
    ).toBe(true);
  });

  it('points at the offending leg', () => {
    const r = checkoutIntentSchema.safeParse({ legs: [leg('A', day(0)), leg('B', day(1)), leg('C', day(0))] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toEqual(['legs', 2, 'scheduledAt']);
  });

  it('needs a pickup time on every leg of a multi-leg journey', () => {
    const noTime = { ...leg('B', day(1)), scheduledAt: undefined };
    expect(checkoutIntentSchema.safeParse({ legs: [leg('A', day(0)), noTime] }).success).toBe(false);
  });

  it('lets each leg choose its own vehicle, city, service and flight', () => {
    const r = checkoutIntentSchema.safeParse({
      legs: [
        leg('Seattle', day(0), { vehicleClass: 'sedan' }),
        leg('Portland', day(1), { vehicleClass: 'suv', city: 'portland' }),
        leg('Sea-Tac', day(2), { tripType: 'airport', flightDetails: { flightNumber: 'AS123' } }),
      ],
    });
    expect(r.success).toBe(true);
  });
});

describe('partialJourneyMessage', () => {
  it('keeps the familiar wording for a round trip', () => {
    expect(partialJourneyMessage(2, 1, 'no car')).toBe(
      'Your outbound journey is booked, but the return could not be (no car). Its fare has been refunded to your card.',
    );
  });

  it('names the failed leg and what was refunded in a longer itinerary', () => {
    expect(partialJourneyMessage(4, 1, 'no car')).toBe(
      'The first 1 leg is booked, but leg 2 could not be (no car). Its fare and the 2 after it have been refunded to your card.',
    );
    expect(partialJourneyMessage(3, 2, 'no car')).toBe(
      'The first 2 legs are booked, but leg 3 could not be (no car). Its fare has been refunded to your card.',
    );
  });
});

describe('completeCheckout across several legs', () => {
  const draft = (n: number) => ({
    userId: 'u1',
    legs: Array.from({ length: n }, (_, i) => leg(`City ${i}`, day(i))),
    fares: Array.from({ length: n }, (_, i) => 100 + i * 10),
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.bookingFind.mockReturnValue({ sort: async () => [] });
    mocks.retrieveIntent.mockResolvedValue({
      status: 'succeeded',
      amount_received: 33000,
      currency: 'usd',
      metadata: { kind: 'booking', userId: 'u1' },
      payment_method: { card: { brand: 'visa', last4: '4242' } },
    });
    mocks.refund.mockResolvedValue(undefined);
    mocks.createBooking.mockImplementation(async (_u: string, input: { pickup: { address: string } }, paid: { payment: { leg: number } }) => ({
      booking: { _id: `b${paid.payment.leg}`, address: input.pickup.address, customerId: 'u1' },
    }));
  });

  const park = (n: number, id = 'pi_multi1') => redis.set(`checkout:${id}`, JSON.stringify(draft(n)));

  it('books every leg, each tagged with its place in the journey and its own share', async () => {
    await park(3);
    const { bookings, error } = await completeCheckout('u1', 'pi_multi1');

    expect(error).toBeUndefined();
    expect(bookings).toHaveLength(3);
    const calls = mocks.createBooking.mock.calls;
    expect(calls.map((c) => c[2].journey)).toEqual([
      { index: 0, count: 3 },
      { index: 1, count: 3 },
      { index: 2, count: 3 },
    ]);
    expect(calls.map((c) => c[2].payment.leg)).toEqual([0, 1, 2]);
    expect(calls.map((c) => c[2].payment.amount)).toEqual([100, 110, 120]);
    expect(calls.map((c) => c[2].chargedFare)).toEqual([100, 110, 120]);
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it('tags a round trip as a journey too, and a single trip not at all', async () => {
    await park(2, 'pi_rt');
    await completeCheckout('u1', 'pi_rt');
    expect(mocks.createBooking.mock.calls.map((c) => c[2].journey)).toEqual([
      { index: 0, count: 2 },
      { index: 1, count: 2 },
    ]);

    mocks.createBooking.mockClear();
    await park(1, 'pi_one');
    await completeCheckout('u1', 'pi_one');
    expect(mocks.createBooking.mock.calls[0][2]).not.toHaveProperty('journey');
  });

  it('refunds the failed leg and every later one, keeping the legs already booked', async () => {
    await park(4, 'pi_part');
    mocks.createBooking.mockImplementation(async (_u: string, _i: unknown, paid: { payment: { leg: number } }) => {
      if (paid.payment.leg === 2) throw new ApiError(409, 'No vehicle available');
      return { booking: { _id: `b${paid.payment.leg}`, customerId: 'u1' } };
    });

    const { bookings, error } = await completeCheckout('u1', 'pi_part');

    expect(bookings.map((b) => b._id)).toEqual(['b0', 'b1']);
    // Leg 3 (index 2) and leg 4 (index 3): 120 + 130.
    expect(mocks.refund).toHaveBeenCalledOnce();
    expect(mocks.refund.mock.calls[0][0]).toMatchObject({ amount: 250, paymentIntentId: 'pi_part' });
    expect(error).toContain('The first 2 legs are booked, but leg 3 could not be (No vehicle available)');
    expect(mocks.createBooking).toHaveBeenCalledTimes(3); // leg 4 is never attempted
  });

  it('books nothing and refunds everything when the first leg fails', async () => {
    await park(3, 'pi_first');
    mocks.createBooking.mockRejectedValue(new ApiError(409, 'No vehicle available'));

    await expect(completeCheckout('u1', 'pi_first')).rejects.toMatchObject({ statusCode: 422 });
    expect(mocks.refund.mock.calls[0][0]).toMatchObject({ amount: 330 });
  });

  it('is safe to run twice: a second completion returns the same bookings', async () => {
    const made = [{ _id: 'b0', customerId: 'u1' }, { _id: 'b1', customerId: 'u1' }];
    mocks.bookingFind.mockReturnValue({ sort: async () => made });

    const { bookings } = await completeCheckout('u1', 'pi_again');

    expect(bookings).toBe(made);
    expect(mocks.createBooking).not.toHaveBeenCalled();
  });

  it('refuses a payment that belongs to another customer', async () => {
    mocks.bookingFind.mockReturnValue({ sort: async () => [{ _id: 'b0', customerId: 'someone-else' }] });
    await expect(completeCheckout('u1', 'pi_theirs')).rejects.toMatchObject({ statusCode: 403 });
  });
});
