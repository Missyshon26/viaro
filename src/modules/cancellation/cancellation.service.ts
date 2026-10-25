import { Trip } from '../../models/Trip';
import { Booking, type TripType } from '../../models/Booking';
import { Driver } from '../../models/Driver';
import { hoursUntil, format, now, toDate, type DateInput } from '../../config/timezone';
import { ApiError } from '../../utils/ApiError';
import { pct, round2 } from '../../utils/money';
import { Transaction } from '../../models/Transaction';
import { logger } from '../../utils/logger';
import {
  applyTripCancellationActor,
  recordBookingCancellation,
} from '../booking/booking.cancellation';
import * as events from '../events/events.bus';
import * as walletService from '../wallet/wallet.service';
import * as notify from '../notifications/notifications.service';
import { refundBookingToCard } from '../payments/cardPayments';
import { NOTIFICATION_TYPES } from '../notifications/notifications.service';

/**
 * Refund policy — spec §8 rule 6.
 *
 * ONE function parameterised by trip type, never three near-duplicates. The three REST
 * endpoints (point-to-point, airport, hourly) all funnel through it, and the trip type is
 * read from the booking rather than trusted from the URL, so calling the hourly endpoint
 * on a point-to-point trip cannot buy a longer refund window.
 */
export const REFUND_THRESHOLD_HOURS: Record<TripType, number> = {
  point2point: 24,
  airport: 24,
  hourly: 72,
};

export const REFUND_PCT_WHEN_ELIGIBLE = 90;

export interface PolicyResult {
  tripType: TripType;
  thresholdHours: number;
  hoursUntilPickup: number;
  refundPct: number;
  eligible: boolean;
}

export function evaluate(tripType: TripType, scheduledAt: DateInput): PolicyResult {
  // All time comparisons run in America/Los_Angeles (spec §8 rule 1).
  const hours = hoursUntil(scheduledAt);
  const thresholdHours = REFUND_THRESHOLD_HOURS[tripType];
  const eligible = hours >= thresholdHours;

  return {
    tripType,
    thresholdHours,
    hoursUntilPickup: round2(hours),
    refundPct: eligible ? REFUND_PCT_WHEN_ELIGIBLE : 0,
    eligible,
  };
}

/**
 * Customer-initiated cancellation. `expectedTripType` is the endpoint the client called;
 * a mismatch against the booking is rejected rather than silently honoured.
 */
export async function cancelTripByCustomer(
  tripId: string,
  customerId: string,
  expectedTripType: TripType,
  reason?: string,
) {
  const trip = await Trip.findById(tripId);
  if (!trip) throw ApiError.notFound('Trip not found');

  const booking = await Booking.findById(trip.bookingId);
  if (!booking) throw ApiError.notFound('Linked booking not found');
  if (String(booking.customerId) !== customerId) {
    throw ApiError.forbidden('This trip belongs to another customer');
  }

  if (booking.tripType !== expectedTripType) {
    throw ApiError.badRequest(
      `This is a '${booking.tripType}' trip — use the matching cancellation endpoint`,
    );
  }

  if (trip.status === 'completed') throw ApiError.conflict('A completed trip cannot be cancelled');
  if (trip.status === 'cancelled') throw ApiError.conflict('Trip is already cancelled');

  /*
   * A ride in progress is not cancellable.
   *
   * The refund policy keys off `scheduledAt`, not trip state, so a passenger already in
   * the car could cancel and collect the 90% "cancelled well in advance" refund for a
   * journey the chauffeur was actively driving. Time-until-pickup stops being the right
   * question the moment the trip starts.
   */
  if (trip.status === 'started') {
    throw ApiError.conflict(
      'This trip is already under way and can no longer be cancelled — contact support',
    );
  }

  /*
   * Notice is measured against the ORIGINAL pickup time.
   *
   * Using the current `scheduledAt` let a customer reschedule a soon-to-depart ride into
   * next week — resetting the fee clock — and then cancel it free. `originalScheduledAt`
   * is written once at creation and never amended. It falls back to `scheduledAt` for
   * bookings made before the field existed.
   */
  const policy = evaluate(
    booking.tripType,
    booking.originalScheduledAt ?? booking.scheduledAt,
  );

  trip.status = 'cancelled';
  trip.cancellation = {
    reason: reason ?? 'Cancelled by customer',
    refundPct: policy.refundPct,
    refundedAt: policy.refundPct > 0 ? toDate(now()) : undefined,
    cancelledBy: 'customer',
  };

  booking.status = 'cancelled';
  // Written to both documents: the refund figures only make sense on the trip, but the
  // console lists bookings and must show the same author and reason either way.
  const record = await recordBookingCancellation(booking, {
    by: 'customer',
    byUserId: customerId,
    reason,
  });
  applyTripCancellationActor(trip, record);

  await trip.save();
  await booking.save();

  // Free the driver again.
  const driver = await Driver.findById(trip.driverId);
  if (driver) {
    driver.status = 'available';
    await driver.save();
  }

  let refundAmount = 0;
  if (policy.refundPct > 0) {
    refundAmount = await issueRefundToWallet(String(trip._id), policy.refundPct);
  }

  await notify.send(booking.customerId, NOTIFICATION_TYPES.TRIP_CANCELLED, {
    message:
      policy.refundPct > 0
        ? `Trip cancelled — ${policy.refundPct}% ($${refundAmount.toFixed(2)}) refunded`
        : `Trip cancelled — cancelled within ${policy.thresholdHours}h of pickup, so no refund applies`,
    tripId: String(trip._id),
    scheduledAt: format(booking.scheduledAt),
    ...policy,
    refundAmount,
  });

  if (driver) {
    await notify.send(driver.userId, NOTIFICATION_TYPES.TRIP_CANCELLED, {
      message: 'The customer cancelled this trip',
      tripId: String(trip._id),
    });
  }

  events.publish({
    topic: 'trip',
    action: 'cancelled',
    id: String(trip._id),
    roles: ['admin', 'company'],
    userIds: [String(booking.customerId), ...(driver ? [String(driver.userId)] : [])],
  });

  return { trip, policy, refundAmount };
}

/**
 * Refunds `refundPct`% of what the customer paid for a trip, each part the way it came:
 *
 *   - a card payment taken at booking goes back to the CARD (Stripe refund);
 *   - wallet credit spent on the ride, and any legacy post-trip charge, go back to the
 *     WALLET with no fee (the 10% fee exists only on withdrawal, wallet.service.ts).
 *
 * Returns the total refunded across both.
 */
export async function issueRefundToWallet(tripId: string, refundPct: number): Promise<number> {
  const trip = await Trip.findById(tripId).lean();
  if (!trip) throw ApiError.notFound('Trip not found');

  const booking = await Booking.findById(trip.bookingId).lean();
  if (!booking) throw ApiError.notFound('Booking not found');

  const toCard = booking.payment
    ? await refundBookingToCard(String(booking._id), refundPct, `trip_cancellation_${refundPct}`)
    : 0;
  return round2(toCard + (await refundWalletPart(trip, booking, refundPct)));
}

async function refundWalletPart(
  trip: { _id: unknown; creditApplied?: number },
  booking: { _id: unknown; customerId: unknown },
  refundPct: number,
): Promise<number> {
  const tripId = String(trip._id);

  /*
   * A refund returns money that was actually taken — never more.
   *
   * This used to refund a percentage of `trip.fareAmount` whether or not the customer
   * had ever paid it, and the fare is only collected after the ride. So booking a trip,
   * cancelling it, and being handed 90% of a fare nobody charged turned the wallet into
   * a money printer: 5.00 of credit came back as 90.00, repeatably.
   *
   * What the customer has actually parted with is the credit they applied plus any
   * gateway charge that was collected. The policy percentage now applies to that.
   */
  const collected = await Transaction.aggregate<{ total: number }>([
    { $match: { 'meta.tripId': trip._id, 'meta.reason': 'trip_payment', type: 'debit' } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);

  const paid = round2((trip.creditApplied ?? 0) + (collected[0]?.total ?? 0));
  const refundAmount = pct(paid, refundPct);

  if (refundAmount <= 0) {
    logger.info(
      `No wallet refund for trip ${tripId}: nothing paid from the wallet (credit ${trip.creditApplied ?? 0}, charged ${collected[0]?.total ?? 0})`,
    );
    return 0;
  }

  const wallet = await walletService.getOrCreateWallet(booking.customerId as string, 'customer');

  // credit() writes feeApplied: 0 — deliberately, see the rule above.
  await walletService.credit(wallet._id, refundAmount, 'refund', {
    reason: 'trip_cancellation_refund',
    tripId: trip._id,
    refundPct,
  });

  logger.info(`Refunded ${refundAmount} (${refundPct}%) to customer wallet for trip ${tripId}`);

  await notify.send(booking.customerId as string, NOTIFICATION_TYPES.REFUND_ISSUED, {
    message: `${refundAmount.toFixed(2)} has been credited to your ABL wallet`,
    tripId,
    refundAmount,
    refundPct,
  });

  return refundAmount;
}
