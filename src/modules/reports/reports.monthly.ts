import { Types } from 'mongoose';
import { Driver } from '../../models/Driver';
import { Trip } from '../../models/Trip';
import { Booking } from '../../models/Booking';
import { Rating } from '../../models/Rating';
import { Transaction } from '../../models/Transaction';
import { Wallet } from '../../models/Wallet';
import { ApiError } from '../../utils/ApiError';
import { round2 } from '../../utils/money';
import { APP_TIMEZONE } from '../../config/timezone';
import type { AuthUser } from '../../middlewares/authGuard';

/**
 * A chauffeur's rides and pay, month by month (chauffeur portal → Earnings → Monthly
 * report).
 *
 * Months are calendar months in APP_TIMEZONE (Pacific), the zone every trip is booked
 * in — a ride finishing at 11 pm on the 31st belongs to that month, not the next one
 * in UTC. Earnings are the driver's own `driver_earnings` wallet credits, matched to
 * trips by `meta.tripId`, so the report shows what was actually paid, rating adjustment
 * included. Fares are never shown to drivers (spec §8 rule 2).
 */
const monthKey = (date: Date) =>
  date.toLocaleString('en-CA', { timeZone: APP_TIMEZONE, year: 'numeric', month: '2-digit' }).slice(0, 7);

const monthLabel = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  });
};

export async function monthlyReport(user: AuthUser, input: { months?: number }) {
  if (user.role !== 'driver') throw ApiError.forbidden('The monthly report is for chauffeurs');
  const driver = await Driver.findOne({ userId: user.userId }).select('_id').lean();
  if (!driver) throw ApiError.notFound('Driver profile not found');

  const months = Math.min(Math.max(input.months ?? 12, 1), 24);
  // First day of the earliest month in range (a day of slack either side of the zone).
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCMonth(since.getUTCMonth() - (months - 1));
  since.setUTCDate(since.getUTCDate() - 1);

  const [trips, wallet] = await Promise.all([
    Trip.find({
      driverId: driver._id,
      $or: [
        { status: 'completed', 'timestamps.completed': { $gte: since } },
        { status: 'cancelled', updatedAt: { $gte: since } },
      ],
    })
      .select('bookingId status timestamps cancellation updatedAt')
      .lean(),
    Wallet.findOne({ ownerId: user.userId, ownerType: 'driver' }).select('_id').lean(),
  ]);

  const tripIds = trips.map((t) => t._id);
  const [bookings, ratings, credits, withdrawals] = await Promise.all([
    Booking.find({ _id: { $in: trips.map((t) => t.bookingId) } })
      .select('pickup.address drop.address vehicleClass tripType')
      .lean(),
    Rating.find({ tripId: { $in: tripIds } }).select('tripId score').lean(),
    wallet
      ? Transaction.find({
          walletId: wallet._id,
          type: 'credit',
          'meta.reason': 'driver_earnings',
          createdAt: { $gte: since },
        })
          .select('amount meta createdAt')
          .lean()
      : [],
    wallet
      ? Transaction.find({ walletId: wallet._id, type: 'withdrawal', createdAt: { $gte: since } })
          .select('amount feeApplied createdAt')
          .lean()
      : [],
  ]);

  const bookingById = new Map(bookings.map((b) => [String(b._id), b]));
  const scoreByTrip = new Map(ratings.map((r) => [String(r.tripId), r.score]));
  // Pay for a trip in this window is shown against the month the trip was completed.
  // Anything else — an older trip settled late, a credit with no trip — counts in the
  // month it was paid.
  const tripIdSet = new Set(tripIds.map(String));
  const earnedByTrip = new Map<string, number>();
  const otherEarnings: { at: Date; amount: number }[] = [];
  for (const credit of credits) {
    const tripId = credit.meta?.tripId ? String(credit.meta.tripId as Types.ObjectId) : null;
    if (tripId && tripIdSet.has(tripId)) {
      earnedByTrip.set(tripId, round2((earnedByTrip.get(tripId) ?? 0) + credit.amount));
    } else {
      otherEarnings.push({ at: credit.createdAt, amount: credit.amount });
    }
  }

  // Every month in range, even empty ones, newest first.
  const keys: string[] = [];
  const cursor = new Date();
  for (let i = 0; i < months; i += 1) {
    keys.push(monthKey(cursor));
    cursor.setUTCDate(15);
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }
  const uniqueKeys = [...new Set(keys)];

  type Month = {
    month: string;
    label: string;
    completed: number;
    cancelled: number;
    earnings: number;
    withdrawn: number;
    withdrawalFees: number;
    ratingsReceived: number;
    averageRating: number | null;
    rides: {
      tripId: string;
      completedAt: Date | null;
      pickup: string | null;
      drop: string | null;
      vehicleClass: string | null;
      earned: number;
      rating: number | null;
    }[];
  };
  const byMonth = new Map<string, Month & { ratingSum: number }>(
    uniqueKeys.map((key) => [
      key,
      {
        month: key,
        label: monthLabel(key),
        completed: 0,
        cancelled: 0,
        earnings: 0,
        withdrawn: 0,
        withdrawalFees: 0,
        ratingsReceived: 0,
        averageRating: null,
        rides: [],
        ratingSum: 0,
      },
    ]),
  );

  for (const trip of trips) {
    if (trip.status === 'cancelled') {
      const bucket = byMonth.get(monthKey(trip.updatedAt));
      if (bucket && trip.cancellation?.cancelledBy === 'driver') bucket.cancelled += 1;
      continue;
    }
    const completedAt = trip.timestamps?.completed ?? null;
    const bucket = completedAt ? byMonth.get(monthKey(completedAt)) : undefined;
    if (!bucket) continue;

    const booking = bookingById.get(String(trip.bookingId));
    const earned = earnedByTrip.get(String(trip._id)) ?? 0;
    const score = scoreByTrip.get(String(trip._id)) ?? null;

    bucket.completed += 1;
    bucket.earnings = round2(bucket.earnings + earned);
    if (score !== null) {
      bucket.ratingsReceived += 1;
      bucket.ratingSum += score;
    }
    bucket.rides.push({
      tripId: String(trip._id),
      completedAt,
      pickup: booking?.pickup?.address ?? null,
      drop: booking?.drop?.address ?? null,
      vehicleClass: booking?.vehicleClass ?? null,
      earned,
      rating: score,
    });
  }

  for (const extra of otherEarnings) {
    const bucket = byMonth.get(monthKey(extra.at));
    if (bucket) bucket.earnings = round2(bucket.earnings + extra.amount);
  }
  for (const w of withdrawals) {
    const bucket = byMonth.get(monthKey(w.createdAt));
    if (!bucket) continue;
    bucket.withdrawn = round2(bucket.withdrawn + w.amount);
    bucket.withdrawalFees = round2(bucket.withdrawalFees + (w.feeApplied ?? 0));
  }

  const result: Month[] = uniqueKeys.map((key) => {
    const { ratingSum, ...month } = byMonth.get(key)!;
    month.averageRating = month.ratingsReceived > 0 ? round2(ratingSum / month.ratingsReceived) : null;
    month.rides.sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
    return month;
  });

  return {
    timezone: APP_TIMEZONE,
    months: result,
    totals: {
      completed: result.reduce((s, m) => s + m.completed, 0),
      earnings: round2(result.reduce((s, m) => s + m.earnings, 0)),
      withdrawn: round2(result.reduce((s, m) => s + m.withdrawn, 0)),
    },
  };
}
