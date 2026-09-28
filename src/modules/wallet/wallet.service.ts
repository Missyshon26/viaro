import { Types } from 'mongoose';
import { adjustRate, ratingAdjustment, type RatingPayResult } from './ratingPay';
import {
  getPayoutDefaults,
  getSettingsValues,
  type PayoutDefaults,
} from '../admin/settings.service';
import { Wallet, type WalletDocument, type WalletOwnerType } from '../../models/Wallet';
import { Transaction, type TransactionType } from '../../models/Transaction';
import { PaymentMethod } from '../../models/PaymentMethod';
import { Trip, type TripDocument } from '../../models/Trip';
import { Booking } from '../../models/Booking';
import { Driver } from '../../models/Driver';
import { Company } from '../../models/Company';
import { User } from '../../models/User';
import { env } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { companyOwnsDriver } from '../../utils/roster';
import type { AuthUser } from '../../middlewares/authGuard';
import { pct, round2 } from '../../utils/money';
import type { UserRole } from '../../utils/roles';
import * as events from '../events/events.bus';
import { logger } from '../../utils/logger';
import { paginated, toSkipLimit, type PaginationQuery } from '../../utils/pagination';
import {
  collectPayment as collectFromGateway,
  payoutToBeneficiary as payoutFromGateway,
} from '../../integrations/paymentGateway';
import * as notify from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/notifications.service';

/* -------------------------------------------------------------------------- */
/* Wallet primitives                                                           */
/* -------------------------------------------------------------------------- */

export async function getOrCreateWallet(
  ownerId: Types.ObjectId | string,
  ownerType: WalletOwnerType,
): Promise<WalletDocument> {
  /*
   * Upsert rather than find-then-create: two concurrent settlements for the same owner
   * both saw "no wallet" and both created one, which raced into a duplicate-key error
   * that silently killed one settlement mid-way. `setOnInsert` never touches the balance
   * of an existing wallet.
   */
  return Wallet.findOneAndUpdate(
    { ownerId, ownerType },
    { $setOnInsert: { ownerId, ownerType, balance: 0 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ) as unknown as Promise<WalletDocument>;
}

/**
 * The platform (admin) side of the revenue split.
 *
 * ASSUMPTION: a single designated platform wallet holds the admin's 40%, rather than one
 * wallet per admin user. Admins are operators of one platform, so per-admin wallets would
 * split the same pot arbitrarily. It is identified by ownerType 'platform' with a null
 * ownerId, and created on first use.
 */
export async function getPlatformWallet(): Promise<WalletDocument> {
  // Same upsert reasoning as getOrCreateWallet: every settlement touches this one wallet,
  // so it is the single most contended find-then-create in the service.
  return Wallet.findOneAndUpdate(
    { ownerType: 'platform', ownerId: null },
    { $setOnInsert: { ownerId: null, ownerType: 'platform', balance: 0 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ) as unknown as Promise<WalletDocument>;
}

/** Atomic credit: balance moves and the ledger row is written together. */
export async function credit(
  walletId: Types.ObjectId | string,
  amount: number,
  type: Extract<TransactionType, 'credit' | 'refund'>,
  meta: Record<string, unknown> = {},
): Promise<void> {
  const value = round2(amount);
  if (value <= 0) return;

  await Wallet.updateOne({ _id: walletId }, { $inc: { balance: value } });
  // feeApplied is always 0 here — fees exist only on withdrawal (spec §8 rule 3).
  await Transaction.create({ walletId, type, amount: value, feeApplied: 0, meta });
}

/** Atomic debit guarded by sufficient balance — the filter prevents a negative wallet. */
export async function debit(
  walletId: Types.ObjectId | string,
  amount: number,
  type: Extract<TransactionType, 'debit' | 'withdrawal'>,
  feeApplied: number,
  meta: Record<string, unknown> = {},
): Promise<void> {
  const value = round2(amount);
  if (value <= 0) throw ApiError.badRequest('Amount must be greater than zero');

  const result = await Wallet.updateOne(
    { _id: walletId, balance: { $gte: value } },
    { $inc: { balance: -value } },
  );

  if (result.modifiedCount === 0) throw ApiError.badRequest('Insufficient wallet balance');

  await Transaction.create({ walletId, type, amount: value, feeApplied: round2(feeApplied), meta });
}

/* -------------------------------------------------------------------------- */
/* Revenue split — spec §8, fired on trip completion                           */
/* -------------------------------------------------------------------------- */

/**
 * Who employs this driver, and therefore who pays them.
 *
 * A driver on a company's roster is that company's; everyone else belongs to the
 * admin/platform. Ownership is derived from Company.driverIds rather than duplicated onto
 * the Driver, so the roster stays the single source of truth.
 */
export interface DriverOwner {
  type: 'company' | 'platform';
  walletId: Types.ObjectId;
  /** The company document, when company-owned. */
  companyId?: Types.ObjectId;
  revenueSharePct: number;
}

export async function resolveDriverOwner(driverId: Types.ObjectId | string): Promise<DriverOwner> {
  const company = await Company.findOne({ driverIds: driverId });

  if (company) {
    const wallet = await getOrCreateWallet(company.userId, 'company');
    return {
      type: 'company',
      walletId: wallet._id,
      companyId: company._id,
      revenueSharePct: company.revenueSharePct ?? (await getSettingsValues()).companyRevenuePct,
    };
  }

  const wallet = await getPlatformWallet();
  const { companyRevenuePct } = await getSettingsValues();
  return { type: 'platform', walletId: wallet._id, revenueSharePct: 100 - companyRevenuePct };
}

/**
 * Settlement of a completed trip — the money model, in order:
 *
 *   1. The customer's fare is split between the company and the admin/platform
 *      (COMPANY_REVENUE_PCT / ADMIN_REVENUE_PCT, default 60/40 per the UML).
 *   2. The driver is then paid BY WHOEVER OWNS THEM, OUT OF THAT OWNER'S SHARE —
 *      a company pays its own roster drivers, the admin pays platform drivers.
 *      The driver is never paid straight from the fare.
 *
 * This is what makes the arithmetic close: the fare is allocated exactly once, and the
 * driver's pay is a transfer between two internal wallets, not new money. A public-pool
 * ride taken by a company's driver still splits 60/40, and that company then pays its
 * driver out of its 60.
 *
 * The rate itself is per driver (Driver.payout), set by their owner — a flat charge per
 * trip or a percentage of the owner's share.
 */
export async function applyRevenueSplit(tripId: Types.ObjectId | string): Promise<void> {
  /*
   * Claim the settlement before spending a penny.
   *
   * This used to read `trip.settled`, do all the crediting, and only then set the flag.
   * Concurrent completions all read settled:false in that window and every one of them
   * ran the full split, crediting the same fare several times over. Claiming the flag
   * with a conditional update makes exactly one caller the settler; the rest match
   * nothing and return without touching a wallet.
   *
   * The claim is taken first and released on failure, so a genuine error still leaves the
   * trip re-settleable rather than stranded as "settled" with no money moved.
   */
  const trip = await Trip.findOneAndUpdate(
    { _id: tripId, settled: { $ne: true } },
    { $set: { settled: true } },
    { new: true },
  );

  if (!trip) {
    const exists = await Trip.exists({ _id: tripId });
    if (!exists) throw ApiError.notFound('Trip not found');
    logger.warn(`Revenue split skipped — trip ${String(tripId)} already settled`);
    return;
  }

  try {
    await settleClaimedTrip(trip);
  } catch (err) {
    // Release the claim so the retry path (or a manual re-run) can settle it properly.
    await Trip.updateOne({ _id: trip._id }, { $set: { settled: false } }).catch(() => undefined);
    throw err;
  }
}

/** The actual money movement, once this caller has won the right to settle the trip. */
async function settleClaimedTrip(trip: TripDocument): Promise<void> {
  const fare = round2(trip.fareAmount);
  const driver = await Driver.findById(trip.driverId);
  if (!driver) throw ApiError.notFound('Driver not found');

  const owner = await resolveDriverOwner(driver._id);
  const company = owner.type === 'company' ? await Company.findById(owner.companyId) : null;

  const companyPct = company?.revenueSharePct ?? (await getSettingsValues()).companyRevenuePct;
  const platformPct = 100 - companyPct;

  let ownerShare: number;

  if (company) {
    const companyShare = pct(fare, companyPct);
    const platformShare = round2(fare - companyShare);
    ownerShare = companyShare;

    await credit(owner.walletId, companyShare, 'credit', {
      tripId: trip._id,
      reason: 'revenue_split_company',
      sharePct: companyPct,
    });

    await credit((await getPlatformWallet())._id, platformShare, 'credit', {
      tripId: trip._id,
      reason: 'revenue_split_platform',
      sharePct: platformPct,
    });
  } else {
    // Platform-owned driver: there is no company to take a share, so the whole fare is
    // the platform's — and the platform pays the driver out of it.
    ownerShare = fare;
    await credit(owner.walletId, fare, 'credit', {
      tripId: trip._id,
      reason: 'revenue_split_platform',
      sharePct: 100,
    });
  }

  await creditDriverWallet(trip._id, owner, ownerShare);
  // `settled` was already claimed atomically by applyRevenueSplit before any credit ran.
}

/**
 * Resolves what this driver is owed for one trip, given their owner's share of it.
 *
 * The owner's rate (or the env default) is adjusted by the driver's rating tier —
 * better-rated chauffeurs earn a larger share, poorly rated ones a smaller one
 * (ratingPay.ts). `baseValue` is the rate before that adjustment, kept for the ledger.
 */
export function resolveDriverPayout(
  driver: {
    payout?: { mode: 'percentage' | 'flat'; value: number } | null;
    rating?: number;
    ratingCount?: number;
  },
  ownerShare: number,
  /** The admin-set default (settings.service), for a driver with no rate of their own. */
  defaults: PayoutDefaults,
): {
  amount: number;
  mode: string;
  value: number;
  baseValue: number;
  rating: RatingPayResult;
} {
  const mode = driver.payout?.mode ?? defaults.mode;
  const baseValue = driver.payout?.value ?? defaults.value;
  const rating = ratingAdjustment(driver.rating, driver.ratingCount);
  const value = adjustRate(mode, baseValue, rating.adjustmentPct);

  // A flat rate is capped at the owner's share only in reporting, not here — if an owner
  // agreed a flat charge above what the trip earned, they wear the difference (below).
  const amount = mode === 'flat' ? round2(value) : pct(ownerShare, value);
  return { amount, mode, value, baseValue, rating };
}

/**
 * Moves the driver's pay from their owner's wallet into the driver's wallet.
 *
 * This is a TRANSFER, not a credit out of thin air: the owner is debited and the driver
 * credited, so the two ledgers always reconcile against the fare.
 */
export async function creditDriverWallet(
  tripId: Types.ObjectId | string,
  ownerOverride?: DriverOwner,
  ownerShareOverride?: number,
): Promise<void> {
  const trip = await Trip.findById(tripId);
  if (!trip) throw ApiError.notFound('Trip not found');

  const driver = await Driver.findById(trip.driverId);
  if (!driver) throw ApiError.notFound('Driver not found');

  const owner = ownerOverride ?? (await resolveDriverOwner(driver._id));
  const ownerShare =
    ownerShareOverride ??
    (owner.type === 'company' ? pct(trip.fareAmount, owner.revenueSharePct) : round2(trip.fareAmount));

  const payout = resolveDriverPayout(driver, ownerShare, await getPayoutDefaults());
  if (payout.amount <= 0) return;

  const meta = {
    tripId: trip._id,
    reason: 'driver_earnings',
    paidBy: owner.type,
    payoutMode: payout.mode,
    payoutValue: payout.value,
    payoutBaseValue: payout.baseValue,
    ratingTier: payout.rating.tier,
    ratingAdjustmentPct: payout.rating.adjustmentPct,
    ratingAtSettlement: payout.rating.rating,
    ownerShare,
  };

  /**
   * Deliberately NOT the guarded debit() used for withdrawals: an owner still owes their
   * driver even if a flat rate exceeds what the trip earned them. The shortfall shows up
   * as a negative owner balance — a real debt they can see — rather than a silently
   * skipped payment.
   */
  await Wallet.updateOne({ _id: owner.walletId }, { $inc: { balance: -payout.amount } });
  await Transaction.create({
    walletId: owner.walletId,
    type: 'debit',
    amount: payout.amount,
    feeApplied: 0,
    meta: { ...meta, reason: 'driver_payout_paid' },
  });

  if (payout.amount > ownerShare) {
    logger.warn(
      `Driver payout ${payout.amount} exceeds ${owner.type} share ${ownerShare} on trip ${String(trip._id)}`,
    );
  }

  const driverWallet = await getOrCreateWallet(driver.userId, 'driver');
  await credit(driverWallet._id, payout.amount, 'credit', meta);

  await notify.send(driver.userId, NOTIFICATION_TYPES.TRIP_COMPLETED, {
    message: `You earned ${payout.amount.toFixed(2)} for this trip`,
    tripId: String(trip._id),
    amount: payout.amount,
    paidBy: owner.type,
  });
}

/* -------------------------------------------------------------------------- */
/* Customer / driver facing operations                                         */
/* -------------------------------------------------------------------------- */

export async function getWalletForUser(userId: string, q: PaginationQuery) {
  const user = await User.findById(userId).lean();
  if (!user) throw ApiError.notFound('User not found');

  const ownerType: WalletOwnerType = user.role === 'driver' ? 'driver' : 'customer';
  const wallet = await getOrCreateWallet(userId, ownerType);

  const { skip, limit } = toSkipLimit(q);
  const [items, total] = await Promise.all([
    Transaction.find({ walletId: wallet._id }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Transaction.countDocuments({ walletId: wallet._id }),
  ]);

  return {
    walletId: wallet._id,
    ownerType: wallet.ownerType,
    balance: round2(wallet.balance),
    transactions: paginated(
      items.map((t) => shapeTransaction(t as unknown as TransactionRow, ownerType)),
      total,
      q,
    ),
  };
}

/**
 * Spec §8 rule 2 keeps the trip fare hidden from drivers. `meta.ownerShare` is a
 * percentage of that fare, so leaving it on a driver's ledger row would hand back the
 * number the trip endpoint carefully strips. It is removed here, and `reason` is lifted
 * out of meta so clients do not have to dig for it.
 *
 * Note this cannot be perfect by design: a driver on a percentage contract knows their
 * own rate and their own pay, and can always divide. Only the explicit disclosure is
 * removed. A flat per-trip rate reveals nothing.
 */
type TransactionRow = Record<string, unknown> & { meta?: Record<string, unknown> };

function shapeTransaction(transaction: TransactionRow, ownerType: WalletOwnerType) {
  const meta = { ...(transaction.meta ?? {}) };
  if (ownerType === 'driver') delete meta.ownerShare;

  return { ...transaction, reason: meta.reason ?? null, meta };
}

/**
 * Driver withdrawal — spec §4.7 / §8 rule 3: a 10% fee applies.
 * Kept deliberately separate from useCredit() below: this is the ONLY path that charges a
 * fee, and merging the two would make it far too easy to start charging it on refunds.
 */
export async function withdraw(userId: string, amount: number, destination?: string) {
  const value = round2(amount);
  if (value <= 0) throw ApiError.badRequest('Withdrawal amount must be greater than zero');

  const wallet = await getOrCreateWallet(userId, 'driver');
  // Set by an admin (Settings); charged on withdrawals only, never refunds or credit.
  const { withdrawalFeePct } = await getSettingsValues();
  const feeApplied = pct(value, withdrawalFeePct);
  const netPayout = round2(value - feeApplied);
  const reference = `wd_${String(wallet._id)}_${Date.now()}`;

  // Debit first: the guarded debit() is what enforces sufficient balance and prevents two
  // concurrent withdrawals from both passing the check.
  await debit(wallet._id, value, 'withdrawal', feeApplied, {
    reason: 'driver_withdrawal',
    feePct: withdrawalFeePct,
    netPayout,
    reference,
    payoutStatus: 'pending',
  });

  // UML: "Withdraw Wallet Balance" «include» «system» Payment Gateway / Wallet.
  /*
   * The withdrawal fee is revenue, so it must land somewhere.
   *
   * It was deducted from the driver and then simply ceased to exist: no wallet was
   * credited and no ledger row was written, so the platform's books were short by the fee
   * on every withdrawal and the money could not be reconciled against anything. It
   * belongs to the platform, the same place the admin's revenue share goes.
   */
  if (feeApplied > 0) {
    await credit((await getPlatformWallet())._id, feeApplied, 'credit', {
      reason: 'withdrawal_fee',
      reference,
      fromWalletId: wallet._id,
      feePct: withdrawalFeePct,
    });
  }

  // Only the NET amount leaves the platform — the fee is retained.
  const payout = await payoutFromGateway({
    amount: netPayout,
    reference,
    destination,
    description: 'Viaro driver withdrawal',
  });

  if (!payout.success) {
    // The money never left, so the driver must not be out of pocket. Put it back and
    // record the reversal rather than leaving a silent hole in the ledger.
    await Wallet.updateOne({ _id: wallet._id }, { $inc: { balance: value } });
    await Transaction.create({
      walletId: wallet._id,
      type: 'credit',
      amount: value,
      feeApplied: 0,
      meta: { reason: 'withdrawal_reversed', reference, provider: payout.provider },
    });

    // The fee was taken for a payout that never happened — hand it back too, or the
    // platform keeps a charge for a service it did not render.
    if (feeApplied > 0) {
      await debit((await getPlatformWallet())._id, feeApplied, 'debit', 0, {
        reason: 'withdrawal_fee_reversed',
        reference,
      }).catch((err) => logger.error(`Could not reverse withdrawal fee for ${reference}`, err));
    }
    throw new ApiError(402, 'Payout was declined by the payment gateway — your balance is unchanged');
  }

  await Transaction.updateOne(
    { walletId: wallet._id, 'meta.reference': reference, type: 'withdrawal' },
    {
      $set: {
        'meta.payoutStatus': 'paid',
        'meta.gatewayReference': payout.gatewayReference,
        'meta.provider': payout.provider,
        'meta.placeholder': payout.placeholder,
      },
    },
  );

  const updated = await Wallet.findById(wallet._id).lean();

  return {
    requested: value,
    feeApplied,
    netPayout,
    balance: round2(updated?.balance ?? 0),
    payout: {
      status: payout.status,
      gatewayReference: payout.gatewayReference,
      provider: payout.provider,
      placeholder: payout.placeholder,
    },
  };
}

/**
 * Spends the credit a passenger chose at booking, now that a Trip exists to spend it on.
 *
 * Called from both places a Trip is created — the chauffeur accepting from the pool, and
 * operations assigning one directly — so the choice is honoured whichever way the ride
 * is filled.
 *
 * Everything here is best-effort and clamped. The booking may have been made days ago:
 * the balance can have been spent elsewhere, and the fare can have changed with a
 * vehicle-class amendment. Applying `min(requested, balance, fare)` means a stale
 * intention quietly does less rather than failing the assignment — which is the right
 * trade, because nobody would want a chauffeur assignment to fail over a discount.
 */
export async function applyRequestedCredit(tripId: Types.ObjectId | string): Promise<number> {
  const trip = await Trip.findById(tripId);
  if (!trip) return 0;

  const booking = await Booking.findById(trip.bookingId).lean();
  const requested = booking?.walletCreditRequested ?? 0;
  if (!booking || requested <= 0) return 0;

  /*
   * One booking intent, spent once.
   *
   * This is reachable from every path that creates or confirms a Trip — pool accept,
   * favourite-driver auto-assign, admin dispatch — and none of them knew whether another
   * had already run. A prior `ride_credit` row for this trip means the intent is spent,
   * so re-running is a no-op rather than a second debit.
   */
  const alreadyApplied = await Transaction.findOne({
    'meta.tripId': trip._id,
    'meta.reason': 'ride_credit',
  })
    .select('_id')
    .lean();
  if (alreadyApplied) return 0;

  const wallet = await getOrCreateWallet(booking.customerId, 'customer');
  const outstanding = round2(trip.fareAmount - trip.creditApplied);

  const value = round2(Math.min(requested, round2(wallet.balance), outstanding));
  if (value <= 0) return 0;

  // Same fee-free path as a manual application (spec §8 rule 3).
  await debit(wallet._id, value, 'debit', 0, {
    reason: 'ride_credit',
    tripId: trip._id,
    fromBookingIntent: true,
  });

  trip.creditApplied = round2(trip.creditApplied + value);
  await trip.save();

  logger.info(`Applied ${value} wallet credit to trip ${String(trip._id)} from booking intent`);
  return value;
}

/**
 * Puts wallet credit back that was applied to a ride.
 *
 * The mirror of useCredit(), and deliberately a separate function rather than a negative
 * amount through the same one: releasing has its own rules that applying does not have,
 * and folding them together is how one of them ends up skipped.
 *
 * Two things make this safe to expose:
 *
 *   - it cannot run once the fare has been charged. `collectPayment` bills
 *     `fareAmount - creditApplied`, so releasing credit afterwards would hand the money
 *     back on a trip that was already invoiced at the discounted figure.
 *   - it never returns more than was applied, so it cannot mint balance.
 *
 * Reachable by the customer who applied it and by operations. `actorRole` is trusted
 * from the verified token; a customer still has to own the trip.
 */
export async function releaseCredit(
  actorUserId: string,
  actorRole: UserRole,
  tripId: string,
  /** Omit to release everything currently applied. */
  amount?: number,
) {
  const trip = await Trip.findById(tripId);
  if (!trip) throw ApiError.notFound('Trip not found');

  const booking = await Booking.findById(trip.bookingId).lean();
  if (!booking) throw ApiError.notFound('Booking not found');

  if (actorRole !== 'admin' && String(booking.customerId) !== actorUserId) {
    throw ApiError.forbidden('You can only change credit on your own trip');
  }

  if (trip.creditApplied <= 0) {
    throw ApiError.conflict('No wallet credit has been applied to this trip');
  }

  const charged = await Transaction.findOne({
    'meta.tripId': trip._id,
    'meta.reason': 'trip_payment',
  }).lean();

  if (charged) {
    throw new ApiError(409, 'This fare has already been charged, so its credit cannot be released', {
      code: 'FARE_ALREADY_CHARGED',
    });
  }

  const value = amount === undefined ? trip.creditApplied : round2(amount);
  if (value <= 0) throw ApiError.badRequest('Amount must be greater than zero');
  if (value > trip.creditApplied) {
    throw ApiError.badRequest(
      `Only ${trip.creditApplied.toFixed(2)} of credit is applied to this trip`,
    );
  }

  // The customer's own wallet, not the actor's — an operator releasing credit must
  // return it to the passenger it came from.
  const wallet = await getOrCreateWallet(booking.customerId, 'customer');

  // No fee, matching useCredit(): spec §8 rule 3 keeps credit movements fee-free, and a
  // fee on an undo would quietly charge someone for changing their mind.
  await credit(wallet._id, value, 'refund', {
    reason: 'ride_credit_released',
    tripId: trip._id,
    releasedBy: actorRole,
  });

  trip.creditApplied = round2(trip.creditApplied - value);
  await trip.save();

  const updated = await Wallet.findById(wallet._id).lean();

  events.publish({
    topic: 'wallet',
    action: 'credit_released',
    id: String(trip._id),
    roles: ['admin'],
    userIds: [String(booking.customerId)],
  });

  return {
    tripId: trip._id,
    released: value,
    creditApplied: trip.creditApplied,
    outstandingFare: round2(trip.fareAmount - trip.creditApplied),
    feeApplied: 0,
    balance: round2(updated?.balance ?? 0),
  };
}

/**
 * POST /payments/collect — charge the customer for a completed trip (spec §4.7).
 * Calls the PLACEHOLDER gateway and records the resulting ledger row against the
 * customer's wallet, so the money trail exists before a real provider is wired in.
 */
export async function collectPayment(tripId: string, caller?: AuthUser) {
  const trip = await Trip.findById(tripId);
  if (!trip) throw ApiError.notFound('Trip not found');

  /*
   * A company may only charge for its own roster's trips.
   *
   * The route admits 'admin' and 'company', but the function took a bare tripId and
   * checked nothing — so a company could bill a passenger for a ride run by a rival
   * operator's chauffeur, taking real money on a trip it had no part in. Admin remains
   * unrestricted; every other caller is refused.
   */
  if (caller?.role === 'company' && !(await companyOwnsDriver(caller.userId, trip.driverId))) {
    throw ApiError.forbidden('That trip was not run by a driver on your roster');
  }

  const booking = await Booking.findById(trip.bookingId).lean();
  if (!booking) throw ApiError.notFound('Booking not found');

  const amountDue = round2(trip.fareAmount - trip.creditApplied);
  if (amountDue <= 0) {
    return { charged: 0, reason: 'Fare already covered by wallet credit', gateway: null };
  }

  /*
   * Idempotent, the same way applyRevenueSplit() is.
   *
   * Nothing stopped this running twice: a retried request, a double-clicked Collect
   * button or a gateway timeout that was actually a success would each bill the customer
   * a second time, and the only trace was two ledger rows with different gateway
   * references. Charging money is the one operation here that must never be repeated by
   * accident, so a prior charge is reported rather than a new one made.
   */
  const already = await Transaction.findOne({
    'meta.tripId': trip._id,
    'meta.reason': 'trip_payment',
  }).lean();

  if (already) {
    return {
      charged: 0,
      alreadyCharged: true,
      amount: round2(already.amount),
      reason: 'This fare has already been charged',
      gateway: null,
    };
  }

  const wallet = await getOrCreateWallet(booking.customerId, 'customer');

  /*
   * Claim the right to charge BEFORE calling the gateway.
   *
   * The check above is necessary but not sufficient: two parallel Collect calls both read
   * "not yet charged" and both went on to bill the card. Writing the ledger row first
   * makes the unique partial index on {meta.tripId, reason:'trip_payment'} the arbiter —
   * the loser's insert fails and it never reaches the gateway, so the customer cannot be
   * double-charged no matter how the requests interleave.
   */
  let reservation;
  try {
    reservation = await Transaction.create({
      walletId: wallet._id,
      type: 'debit',
      amount: amountDue,
      feeApplied: 0,
      meta: { reason: 'trip_payment', tripId: trip._id, status: 'pending' },
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      const existing = await Transaction.findOne({
        'meta.tripId': trip._id,
        'meta.reason': 'trip_payment',
      }).lean();
      return {
        charged: 0,
        alreadyCharged: true,
        amount: round2(existing?.amount ?? amountDue),
        reason: 'This fare has already been charged',
        gateway: null,
      };
    }
    throw err;
  }

  let gateway;
  try {
    gateway = await collectFromGateway({
      amount: amountDue,
      reference: String(trip._id),
      description: `Viaro ${booking.tripType} trip`,
    });
  } catch (err) {
    // The charge never happened, so the reservation must not survive to block a retry.
    await Transaction.deleteOne({ _id: reservation._id }).catch(() => undefined);
    throw err;
  }

  if (!gateway.success) {
    await Transaction.deleteOne({ _id: reservation._id }).catch(() => undefined);
    throw new ApiError(402, 'Payment was declined by the gateway');
  }

  // Settle the reservation into the real ledger row.
  await Transaction.updateOne(
    { _id: reservation._id },
    {
      $set: {
        'meta.status': 'settled',
        'meta.gatewayReference': gateway.gatewayReference,
        'meta.provider': gateway.provider,
        'meta.placeholder': gateway.placeholder,
      },
    },
  );

  return { charged: amountDue, gateway };
}

/* -------------------------------------------------------------------------- */
/* Saved cards (customer screen 12 "Payment")                                  */
/* -------------------------------------------------------------------------- */

/**
 * Cards are tokenised by the gateway in the client; only the token and display
 * details reach us. Never accept a raw card number on this API — see PaymentMethod.
 */
export async function savePaymentMethod(
  userId: string,
  input: { gatewayToken: string; brand?: string; last4?: string; expMonth?: number; expYear?: number; makeDefault?: boolean },
) {
  const provider = env.PAYMENT_GATEWAY_PROVIDER || 'mock';
  const existing = await PaymentMethod.countDocuments({ userId });

  if (input.makeDefault || existing === 0) {
    await PaymentMethod.updateMany({ userId }, { $set: { isDefault: false } });
  }

  try {
    return await PaymentMethod.create({
      userId,
      gatewayToken: input.gatewayToken,
      provider,
      brand: input.brand,
      last4: input.last4,
      expMonth: input.expMonth,
      expYear: input.expYear,
      isDefault: input.makeDefault || existing === 0,
    });
  } catch (err) {
    if (typeof err === 'object' && err && 'code' in err && (err as { code: number }).code === 11000) {
      throw ApiError.conflict('That card is already saved');
    }
    throw err;
  }
}

export async function listPaymentMethods(userId: string) {
  return PaymentMethod.find({ userId }).sort({ isDefault: -1, createdAt: -1 }).lean();
}

export async function deletePaymentMethod(userId: string, methodId: string) {
  const method = await PaymentMethod.findOneAndDelete({ _id: methodId, userId });
  if (!method) throw ApiError.notFound('Payment method not found');

  // Never leave the customer without a default card.
  if (method.isDefault) {
    const next = await PaymentMethod.findOne({ userId }).sort({ createdAt: -1 });
    if (next) {
      next.isDefault = true;
      await next.save();
    }
  }

  return { deleted: true };
}

/**
 * Webhook event handler (spec §4.7). Called only after the signature has been verified.
 *
 * Gateways deliver the same event more than once, so every branch must be idempotent —
 * here that means keying off the gateway reference already stored on the Transaction.
 */
export async function handleGatewayEvent(event: {
  type?: string;
  data?: { object?: Record<string, unknown> };
}): Promise<void> {
  const object = event.data?.object ?? {};
  const reference =
    (object.metadata as { reference?: string } | undefined)?.reference ?? (object.id as string | undefined);

  switch (event.type) {
    case 'payment_intent.succeeded':
    case 'charge.succeeded': {
      if (!reference) break;
      /*
       * `meta.tripId` is stored as an ObjectId, and `reference` arrives from the gateway
       * as a string — so this comparison never matched and every legitimate webhook was
       * logged as "no matching transaction". Cast before querying, and ignore a reference
       * that could not be a trip id at all.
       */
      const existing = Types.ObjectId.isValid(reference)
        ? await Transaction.findOne({ 'meta.tripId': new Types.ObjectId(reference) }).lean()
        : null;
      if (existing) {
        logger.info(`Gateway confirmed payment already recorded for trip ${reference}`);
      } else {
        logger.warn(`Gateway reported a payment with no matching transaction: ${reference}`);
      }
      break;
    }

    case 'payment_intent.payment_failed':
    case 'charge.failed': {
      logger.error(`Gateway reported a FAILED payment for ${reference ?? 'unknown reference'}`);
      break;
    }

    case 'charge.refunded': {
      logger.info(`Gateway reported a refund for ${reference ?? 'unknown reference'}`);
      break;
    }

    default:
      logger.info(`Unhandled gateway event '${event.type ?? 'unknown'}'`);
  }
}

/**
 * Customer applies wallet credit to a ride — spec §4.7 / §8 rule 3: NO fee, ever.
 * Separate code path from withdraw() on purpose.
 */
export async function useCredit(userId: string, tripId: string, amount: number) {
  const value = round2(amount);
  if (value <= 0) throw ApiError.badRequest('Credit amount must be greater than zero');

  const trip = await Trip.findById(tripId);
  if (!trip) throw ApiError.notFound('Trip not found');

  const booking = await Booking.findById(trip.bookingId).lean();
  if (!booking) throw ApiError.notFound('Booking not found');
  if (String(booking.customerId) !== userId) {
    throw ApiError.forbidden('You can only apply credit to your own trip');
  }

  /*
   * Credit only goes onto a live, unpaid ride.
   *
   * Nothing checked the trip's state, so credit could be pushed onto a cancelled trip
   * (money into a ride that will never run) or one already invoiced — `collectPayment`
   * bills `fareAmount - creditApplied`, so applying credit after the charge simply
   * destroys the balance without reducing anything.
   */
  if (trip.status === 'cancelled') {
    throw ApiError.conflict('This trip was cancelled — credit cannot be applied to it');
  }

  const charged = await Transaction.findOne({
    'meta.tripId': trip._id,
    'meta.reason': 'trip_payment',
  })
    .select('_id')
    .lean();
  if (charged) {
    throw ApiError.conflict('This fare has already been charged — credit can no longer be applied');
  }

  const outstanding = round2(trip.fareAmount - trip.creditApplied);
  if (outstanding <= 0) throw ApiError.conflict('This trip is already fully covered by credit');
  if (value > outstanding) {
    throw ApiError.badRequest(`Credit exceeds the outstanding fare of ${outstanding.toFixed(2)}`);
  }

  const wallet = await getOrCreateWallet(userId, 'customer');

  // feeApplied is explicitly 0 — see spec §8 rule 3.
  await debit(wallet._id, value, 'debit', 0, {
    reason: 'ride_credit',
    tripId: trip._id,
  });

  trip.creditApplied = round2(trip.creditApplied + value);
  await trip.save();

  const updated = await Wallet.findById(wallet._id).lean();

  return {
    tripId: trip._id,
    creditApplied: trip.creditApplied,
    outstandingFare: round2(trip.fareAmount - trip.creditApplied),
    feeApplied: 0,
    balance: round2(updated?.balance ?? 0),
  };
}
