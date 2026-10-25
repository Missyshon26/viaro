import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findById: vi.fn(), find: vi.fn(), tripFindOne: vi.fn() }));

vi.mock('../src/models/Booking', async (orig) => {
  const actual = await orig<typeof import('../src/models/Booking')>();
  return { ...actual, Booking: Object.assign(actual.Booking, { findById: mocks.findById, find: mocks.find }) };
});
vi.mock('../src/models/Trip', async (orig) => {
  const actual = await orig<typeof import('../src/models/Trip')>();
  return { ...actual, Trip: Object.assign(actual.Trip, { findOne: mocks.tripFindOne }) };
});

import { getBookingForUser, journeyLegsOf } from '../src/modules/booking/booking.service';

const leg = (i: number) => ({ _id: `b${i}`, journey: { index: i, count: 3 } });
const chain = (rows: unknown[]) => {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.sort = () => q;
  q.lean = async () => rows;
  return q;
};
const bookingDoc = (over: Record<string, unknown> = {}) => ({
  _id: 'b1',
  customerId: { _id: 'u1', name: 'Sam' },
  journey: { index: 1, count: 3 },
  payment: { intentId: 'pi_x' },
  ...over,
});
const found = (doc: unknown) =>
  mocks.findById.mockReturnValue({ populate: () => ({ lean: async () => doc }) });

describe('journey legs on a booking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.find.mockReturnValue(chain([leg(0), leg(1), leg(2)]));
  });

  it('finds the legs through the shared payment, in order', async () => {
    const legs = await journeyLegsOf({ customerId: 'u1', payment: { intentId: 'pi_x' } });
    expect(legs).toHaveLength(3);
    expect(mocks.find).toHaveBeenCalledWith({ 'payment.intentId': 'pi_x' });
  });

  it('has none to show for a booking with no payment', async () => {
    expect(await journeyLegsOf({ customerId: 'u1', payment: undefined })).toEqual([]);
    expect(mocks.find).not.toHaveBeenCalled();
  });

  it('adds the legs for the owning customer', async () => {
    found(bookingDoc());
    const result = (await getBookingForUser('b1', { userId: 'u1', role: 'customer' })) as { journeyLegs?: unknown[] };
    expect(result.journeyLegs).toHaveLength(3);
  });

  it('adds the legs for an admin', async () => {
    found(bookingDoc());
    const result = (await getBookingForUser('b1', { userId: 'a1', role: 'admin' })) as { journeyLegs?: unknown[] };
    expect(result.journeyLegs).toHaveLength(3);
  });

  it('does not add them for a booking that is not part of a journey', async () => {
    found(bookingDoc({ journey: undefined }));
    const result = await getBookingForUser('b1', { userId: 'u1', role: 'customer' });
    expect(result).not.toHaveProperty('journeyLegs');
    expect(mocks.find).not.toHaveBeenCalled();
  });

  it('never shows other customers\' bookings', async () => {
    found(bookingDoc({ customerId: { _id: 'someone-else' } }));
    await expect(getBookingForUser('b1', { userId: 'u1', role: 'customer' })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mocks.find).not.toHaveBeenCalled();
  });

  it('does not hand the other legs to a chauffeur or an operator', async () => {
    found(bookingDoc());
    mocks.tripFindOne.mockReturnValue({ select: () => ({ lean: async () => ({ driverId: 'd1' }) }) });
    const result = await getBookingForUser('b1', { userId: 'u9', role: 'driver' } as never);
    expect(result).not.toHaveProperty('journeyLegs');
  });
});
