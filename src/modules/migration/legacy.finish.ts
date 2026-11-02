import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { Booking } from '../../models/Booking';
import { Driver } from '../../models/Driver';
import { Trip } from '../../models/Trip';
import { User } from '../../models/User';
import { Wallet } from '../../models/Wallet';
import { startOfDay, toDate, now } from '../../config/timezone';

/**
 * Closes the history carried over from the old system.
 *
 * The old system is no longer taking rides, so every imported booking whose pickup day has
 * passed, and which was not cancelled, is finished. A booking only counts as completed here once
 * it has a completed trip, and a trip needs a chauffeur — but many old rides have no chauffeur on
 * record. Those are given a completed trip under one clearly named placeholder chauffeur, so they
 * no longer read as open work. Everything from today on, and everything cancelled, is left alone.
 *
 * Money is not touched. Refunds already show (a card refund through the booking's own payment, an
 * old-system refund through its carried-over payment status). Idempotent: a booking that already
 * has a trip is skipped, and a trip that is already completed is not changed.
 */
export const PLACEHOLDER_DRIVER_EMAIL = 'old-system-driver@allblacklimoseattle.com';
export const PLACEHOLDER_DRIVER_NAME = 'Old system (chauffeur not recorded)';

export interface FinishReport {
  /** Pickups from this moment are left open. */
  openFrom: Date;
  pastBookings: number;
  tripsCreated: number;
  tripsCompleted: number;
  bookingsReopenedAsAssigned: number;
  placeholderDriverCreated: boolean;
  stillOpen: number;
  stillOpenByStatus: Record<string, number>;
  refundedPastBookings: number;
}

async function placeholderDriver(apply: boolean): Promise<{ id: Types.ObjectId; created: boolean }> {
  const existing = await User.findOne({ email: PLACEHOLDER_DRIVER_EMAIL }).select('_id').lean();
  if (existing) {
    const driver = await Driver.findOne({ userId: existing._id }).select('_id').lean();
    if (driver) return { id: driver._id as Types.ObjectId, created: false };
  }
  const driverId = new Types.ObjectId();
  if (!apply) return { id: driverId, created: true };

  const at = toDate(now());
  const userId = new Types.ObjectId();
  const walletId = new Types.ObjectId();
  // Nobody signs in as this chauffeur: the password is random and never shown.
  const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
  await User.collection.insertOne({
    _id: userId,
    role: 'driver',
    name: PLACEHOLDER_DRIVER_NAME,
    email: PLACEHOLDER_DRIVER_EMAIL,
    phone: '+10000000000',
    passwordHash,
    walletId,
    status: 'active',
    phoneVerified: false,
    isGuest: false,
    legacy: { id: 'finish-placeholder', importedAt: at },
    createdAt: at,
    updatedAt: at,
  });
  await Wallet.collection.insertOne({ _id: walletId, ownerId: userId, ownerType: 'driver', balance: 0, createdAt: at, updatedAt: at });
  await Driver.collection.insertOne({
    _id: driverId,
    userId,
    vehicleClass: 'legacy-unknown',
    status: 'offline',
    operatorType: 'independent',
    createdAt: at,
    updatedAt: at,
  });
  return { id: driverId, created: true };
}

export async function finishLegacyHistory({ apply }: { apply: boolean }): Promise<FinishReport> {
  const openFrom = startOfDay(now()).toJSDate();
  const past = { legacy: { $exists: true }, status: { $ne: 'cancelled' as const }, scheduledAt: { $lt: openFrom } };

  const bookings = await Booking.find(past).select('_id scheduledAt estimatedFare fareBreakdown status createdAt').lean();
  const trips = await Trip.find({ bookingId: { $in: bookings.map((b) => b._id) } }).select('bookingId status').lean();
  const tripOf = new Map(trips.map((t) => [String(t.bookingId), t]));

  const needTrip = bookings.filter((b) => !tripOf.has(String(b._id)));
  const unfinished = trips.filter((t) => t.status === 'accepted' || t.status === 'started');
  const reopen = bookings.filter((b) => b.status !== 'assigned');

  const report: FinishReport = {
    openFrom,
    pastBookings: bookings.length,
    tripsCreated: needTrip.length,
    tripsCompleted: unfinished.length,
    bookingsReopenedAsAssigned: reopen.length,
    placeholderDriverCreated: false,
    stillOpen: 0,
    stillOpenByStatus: {},
    refundedPastBookings: await Booking.countDocuments({ ...past, 'legacy.paymentStatus': 'Refunded' }),
  };

  if (apply) {
    if (needTrip.length) {
      const driver = await placeholderDriver(true);
      report.placeholderDriverCreated = driver.created;
      const docs = needTrip.map((b) => {
        const when = b.scheduledAt;
        const created = (b as { createdAt?: Date }).createdAt ?? when;
        const tax = (b.fareBreakdown as { tax?: number } | undefined)?.tax;
        return {
          _id: new Types.ObjectId(),
          bookingId: b._id,
          driverId: driver.id,
          status: 'completed',
          fareAmount: b.estimatedFare ?? 0,
          ...(tax ? { taxAmount: tax } : {}),
          timestamps: { requested: created, assigned: created, accepted: created, started: when, completed: when },
          penaltyApplied: false,
          creditApplied: 0,
          // Long since paid out in the old system: nothing here may pay a chauffeur again.
          settled: true,
          createdAt: created,
          updatedAt: created,
        };
      });
      for (let i = 0; i < docs.length; i += 400) await Trip.collection.insertMany(docs.slice(i, i + 400));
    }
    for (const t of unfinished) {
      const b = bookings.find((x) => String(x._id) === String(t.bookingId));
      await Trip.collection.updateOne(
        { _id: t._id },
        { $set: { status: 'completed', settled: true, 'timestamps.started': b?.scheduledAt, 'timestamps.completed': b?.scheduledAt } },
      );
    }
    if (reopen.length) {
      await Booking.collection.updateMany({ _id: { $in: reopen.map((b) => b._id) } }, { $set: { status: 'assigned' } });
    }
  } else if (needTrip.length) {
    report.placeholderDriverCreated = !(await User.exists({ email: PLACEHOLDER_DRIVER_EMAIL }));
  }

  const open = await Booking.aggregate<{ _id: string; n: number }>([
    { $match: { legacy: { $exists: true }, status: { $ne: 'cancelled' }, scheduledAt: { $gte: openFrom } } },
    { $group: { _id: '$status', n: { $sum: 1 } } },
  ]);
  for (const row of open) {
    report.stillOpenByStatus[row._id] = row.n;
    report.stillOpen += row.n;
  }
  return report;
}
