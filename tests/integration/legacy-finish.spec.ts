import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Booking } from '../../src/models/Booking';
import { Driver } from '../../src/models/Driver';
import { Trip } from '../../src/models/Trip';
import { User } from '../../src/models/User';
import { finishLegacyHistory, PLACEHOLDER_DRIVER_EMAIL } from '../../src/modules/migration/legacy.finish';
import { startOfDay, now } from '../../src/config/timezone';
import { resetData, startDatabase, stopDatabase } from './harness';

const dayMs = 86_400_000;
const today = startOfDay(now()).toMillis();
const at = (days: number) => new Date(today + days * dayMs + 10 * 3_600_000);

const booking = (over: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(),
  customerId: new Types.ObjectId(),
  legacy: { tripId: String(new Types.ObjectId()), tripNo: '1', legIndex: 0, legCount: 1, paymentStatus: 'Paid' },
  status: 'assigned',
  scheduledAt: at(-10),
  estimatedFare: 100,
  createdAt: at(-20),
  updatedAt: at(-20),
  ...over,
});

describe('finishing the carried-over history', () => {
  beforeAll(startDatabase);
  afterAll(stopDatabase);
  beforeEach(resetData);

  it('completes past rides, leaves today onwards and cancelled ones alone, and says which were refunded', async () => {
    const pastNoTrip = booking();
    const pastRefunded = booking({ legacy: { tripId: 'r', tripNo: '2', legIndex: 0, legCount: 1, paymentStatus: 'Refunded' } });
    const pastPending = booking({ status: 'pending' });
    const pastCancelled = booking({ status: 'cancelled' });
    const earlierToday = booking({ status: 'pending', scheduledAt: new Date(today + 3_600_000) });
    const tomorrow = booking({ status: 'pending', scheduledAt: at(1) });
    await Booking.collection.insertMany([pastNoTrip, pastRefunded, pastPending, pastCancelled, earlierToday, tomorrow]);

    const dry = await finishLegacyHistory({ apply: false });
    expect(dry).toMatchObject({ pastBookings: 3, tripsCreated: 3, refundedPastBookings: 1, stillOpen: 2 });
    expect(await Trip.countDocuments()).toBe(0);
    expect(await User.countDocuments({ email: PLACEHOLDER_DRIVER_EMAIL })).toBe(0);

    await finishLegacyHistory({ apply: true });

    const trips = await Trip.find().lean();
    expect(trips).toHaveLength(3);
    expect(trips.every((t) => t.status === 'completed' && t.settled === true)).toBe(true);
    expect(trips.map((t) => String(t.bookingId)).sort()).toEqual([pastNoTrip._id, pastRefunded._id, pastPending._id].map(String).sort());
    expect((await Booking.findById(pastPending._id).lean())?.status).toBe('assigned');
    expect((await Booking.findById(pastCancelled._id).lean())?.status).toBe('cancelled');
    expect((await Booking.findById(earlierToday._id).lean())?.status).toBe('pending');
    expect((await Booking.findById(tomorrow._id).lean())?.status).toBe('pending');
    expect(await Trip.countDocuments({ bookingId: { $in: [earlierToday._id, tomorrow._id, pastCancelled._id] } })).toBe(0);
    expect(await Driver.countDocuments()).toBe(1);
    expect(trips.find((t) => String(t.bookingId) === String(pastNoTrip._id))?.fareAmount).toBe(100);
  });

  it('is safe to run twice and keeps an existing chauffeur on a trip that was already finished', async () => {
    const withDriver = booking();
    const driverId = new Types.ObjectId();
    await Booking.collection.insertMany([withDriver, booking()]);
    await Trip.collection.insertOne({
      _id: new Types.ObjectId(), bookingId: withDriver._id, driverId, status: 'accepted', fareAmount: 100,
      timestamps: {}, penaltyApplied: false, creditApplied: 0, settled: false, createdAt: at(-10), updatedAt: at(-10),
    });

    const first = await finishLegacyHistory({ apply: true });
    expect(first).toMatchObject({ tripsCreated: 1, tripsCompleted: 1 });
    const second = await finishLegacyHistory({ apply: true });
    expect(second).toMatchObject({ tripsCreated: 0, tripsCompleted: 0 });

    expect(await Trip.countDocuments()).toBe(2);
    expect(await Driver.countDocuments()).toBe(1);
    const kept = await Trip.findOne({ bookingId: withDriver._id }).lean();
    expect(String(kept?.driverId)).toBe(String(driverId));
    expect(kept?.status).toBe('completed');
  });
});
