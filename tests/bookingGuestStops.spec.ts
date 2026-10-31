import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userFindById: vi.fn(),
  bookingCreate: vi.fn(),
  calculateFare: vi.fn(),
  notifySend: vi.fn(),
  publish: vi.fn(),
}));

vi.mock('../src/models/User', async (orig) => {
  const actual = await orig<typeof import('../src/models/User')>();
  return { ...actual, User: Object.assign(actual.User, { findById: mocks.userFindById }) };
});
vi.mock('../src/models/Booking', async (orig) => {
  const actual = await orig<typeof import('../src/models/Booking')>();
  return { ...actual, Booking: Object.assign(actual.Booking, { create: mocks.bookingCreate }) };
});
vi.mock('../src/modules/pricing/pricing.service', () => ({ calculateFare: mocks.calculateFare }));
vi.mock('../src/modules/vehicle/vehicle.service', () => ({
  resolveBookableClass: vi.fn(async (v: string) => v),
}));
vi.mock('../src/jobs/cancellationWindow.job', () => ({
  scheduleCancellationWindowCheck: vi.fn(async () => undefined),
}));
vi.mock('../src/modules/notifications/notifications.service', () => ({
  send: mocks.notifySend,
  NOTIFICATION_TYPES: { BOOKING_CREATED: 'booking_created' },
}));
vi.mock('../src/modules/events/events.bus', () => ({ publish: mocks.publish }));

import { createBooking } from '../src/modules/booking/booking.service';

const point = (address: string) => ({ lat: 47.6, lng: -122.3, address });
const input = {
  pickup: point('123 Pine St, Seattle'),
  drop: point('Sea-Tac Airport'),
  vehicleClass: 'sedan',
  tripType: 'point2point' as const,
  city: 'seattle',
};

const asUser = (doc: unknown) =>
  mocks.userFindById.mockReturnValue({ select: () => ({ lean: async () => doc }) });

describe('createBooking: guest tag, agreement stamp and stops', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calculateFare.mockResolvedValue({ fare: 140 });
    mocks.notifySend.mockResolvedValue(undefined);
    mocks.publish.mockReturnValue(undefined);
    mocks.bookingCreate.mockImplementation(async (doc: Record<string, unknown>) => ({
      _id: 'b1',
      customerId: 'u1',
      scheduledAt: new Date(),
      ...doc,
    }));
  });

  it('tags a booking made by a guest account', async () => {
    asUser({ isGuest: true });
    await createBooking('u1', input);
    expect(mocks.bookingCreate.mock.calls[0][0].isGuest).toBe(true);
  });

  it('leaves an ordinary customer untagged', async () => {
    asUser({ isGuest: false });
    await createBooking('u1', input);
    expect(mocks.bookingCreate.mock.calls[0][0]).not.toHaveProperty('isGuest');
  });

  it('cannot be tagged from the request body', async () => {
    asUser({ isGuest: false });
    await createBooking('u1', { ...input, isGuest: true } as typeof input);
    expect(mocks.bookingCreate.mock.calls[0][0]).not.toHaveProperty('isGuest');
  });

  it('records the agreement revision the customer had signed', async () => {
    const signedAt = new Date('2026-10-20T10:00:00Z');
    asUser({ agreement: { version: '2026-10', signedAt } });
    await createBooking('u1', input);
    expect(mocks.bookingCreate.mock.calls[0][0]).toMatchObject({
      agreementVersion: '2026-10',
      agreementSignedAt: signedAt,
    });
  });

  it('prices and stores the stops, and notes them for the chauffeur', async () => {
    asUser({});
    await createBooking('u1', { ...input, stops: [point('Stop A'), point('Stop B')] });

    expect(mocks.calculateFare.mock.calls[0][0].stopCount).toBe(2);
    const stored = mocks.bookingCreate.mock.calls[0][0];
    expect(stored.stops).toHaveLength(2);
    expect(stored.serviceNotes).toContain('Stops: 1) Stop A; 2) Stop B.');
  });

  it('stores no stops key at all when there are none', async () => {
    asUser({});
    await createBooking('u1', input);
    expect(mocks.bookingCreate.mock.calls[0][0]).not.toHaveProperty('stops');
    expect(mocks.calculateFare.mock.calls[0][0].stopCount).toBeUndefined();
  });

  it('still returns the saved booking when the confirmation notice cannot be stored', async () => {
    asUser({});
    mocks.notifySend.mockRejectedValue(new Error('notification store down'));

    const { booking } = await createBooking('u1', input);

    // The booking exists: reporting a failure here would have the customer book it again.
    expect(booking._id).toBe('b1');
    expect(mocks.bookingCreate).toHaveBeenCalledOnce();
  });

  it('still returns the saved booking when the live update to the consoles fails', async () => {
    asUser({});
    mocks.publish.mockImplementation(() => {
      throw new Error('socket gone');
    });

    await expect(createBooking('u1', input)).resolves.toMatchObject({ booking: { _id: 'b1' } });
  });
});
