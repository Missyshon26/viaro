/**
 * REPORT VISIBILITY — named business rule from the spec (§8 rule 7), not an incidental
 * default:
 *
 *   driver   -> sees ONLY their own trips, earnings and penalties
 *   company  -> sees only the drivers on its OWN roster
 *   admin    -> sees the full/aggregate picture
 *
 * Every query in this file goes through buildScope() so that rule is applied in exactly
 * one place. If a new report is added, it must use buildScope() too.
 *
 * The company branch used to return an unrestricted scope, on the reading that the spec
 * granted operators full visibility. That is no longer tenable: the platform hosts
 * competing operators, so it meant any company could pull every rival's completed trips,
 * fares, earnings and penalties out of the reports endpoints — and export them to CSV.
 * It also contradicted the roster scoping this codebase already enforces on the driver
 * list, the trip list and live tracking. A company's reports now cover its own roster.
 */
// Mongoose 9 renamed FilterQuery -> QueryFilter.
import { Types, type QueryFilter } from 'mongoose';
import { Trip, type ITrip } from '../../models/Trip';
import { canSeeTripFare } from '../../utils/visibility';
import { Driver } from '../../models/Driver';
import { Transaction, type ITransaction } from '../../models/Transaction';
import { Wallet } from '../../models/Wallet';
import { PenaltyEvent } from '../../models/PenaltyEvent';
import type { AuthUser } from '../../middlewares/authGuard';
import { ApiError } from '../../utils/ApiError';
import { companyDriverIds } from '../../utils/roster';
import { endOfDay, startOfDay, toDate, format } from '../../config/timezone';
import { round2 } from '../../utils/money';

export interface ReportRange {
  from?: string;
  to?: string;
}

export interface ReportScope {
  /** A single driver (driver role), or null when not restricted to one. */
  driverId: Types.ObjectId | null;
  /** The roster a company is limited to; null for driver and admin. */
  driverIds: Types.ObjectId[] | null;
  userId: string;
}

export async function buildScope(user: AuthUser): Promise<ReportScope> {
  if (user.role === 'driver') {
    const driver = await Driver.findOne({ userId: user.userId }).lean();
    if (!driver) throw ApiError.notFound('Driver profile not found');
    return { driverId: driver._id, driverIds: null, userId: user.userId };
  }

  if (user.role === 'company') {
    return {
      driverId: null,
      driverIds: await companyDriverIds(user.userId),
      userId: user.userId,
    };
  }

  return { driverId: null, driverIds: null, userId: user.userId };
}

/**
 * The `driverId` clause for a scope — one driver, a roster, or unrestricted.
 *
 * An empty roster must still match nothing rather than everything, which is exactly the
 * mistake the old `...(scope.driverId ? {...} : {})` spread made for companies.
 */
function driverFilter(scope: ReportScope): Record<string, unknown> {
  if (scope.driverId) return { driverId: scope.driverId };
  if (scope.driverIds) return { driverId: { $in: scope.driverIds } };
  return {};
}

/** Date-range filter, with both boundaries interpreted in America/Los_Angeles. */
function dateFilter(range: ReportRange, field: string): QueryFilter<unknown> {
  const filter: Record<string, Date> = {};
  if (range.from) filter.$gte = toDate(startOfDay(range.from));
  if (range.to) filter.$lte = toDate(endOfDay(range.to));
  return Object.keys(filter).length ? { [field]: filter } : {};
}

/* ------------------------------ trips completed --------------------------- */

export async function tripsCompleted(user: AuthUser, range: ReportRange) {
  const scope = await buildScope(user);

  const filter: QueryFilter<ITrip> = {
    status: 'completed',
    ...dateFilter(range, 'timestamps.completed'),
    ...driverFilter(scope),
  };

  const trips = await Trip.find(filter).sort({ 'timestamps.completed': -1 }).lean();

  // Spec §8 rule 2 — the predicate lives in utils/visibility so this endpoint and
  // GET /trips/:id can never drift apart on who may see a fare.
  const showFare = canSeeTripFare(user.role);

  const rows = trips.map((t) => ({
    tripId: String(t._id),
    bookingId: String(t.bookingId),
    driverId: String(t.driverId),
    ...(showFare ? { fareAmount: round2(t.fareAmount) } : {}),
    completedAt: t.timestamps.completed ? format(t.timestamps.completed) : null,
  }));

  return {
    scope: scope.driverId ? 'own' : scope.driverIds ? 'company' : 'all',
    count: rows.length,
    ...(showFare ? { totalFare: round2(trips.reduce((sum, t) => sum + t.fareAmount, 0)) } : {}),
    rows,
  };
}

/* ----------------------------- earnings / payout -------------------------- */

export async function earningsPayout(user: AuthUser, range: ReportRange) {
  const scope = await buildScope(user);

  if (scope.driverId) {
    // Driver: their own wallet's credit and withdrawal rows.
    const wallet = await Wallet.findOne({ ownerId: user.userId, ownerType: 'driver' }).lean();
    if (!wallet) return { scope: 'own', count: 0, totalCredited: 0, totalWithdrawn: 0, rows: [] };

    const filter: QueryFilter<ITransaction> = {
      walletId: wallet._id,
      type: { $in: ['credit', 'withdrawal'] },
      ...dateFilter(range, 'createdAt'),
    };

    const rows = await Transaction.find(filter).sort({ createdAt: -1 }).lean();
    return {
      scope: 'own',
      count: rows.length,
      balance: round2(wallet.balance),
      totalCredited: round2(sumOf(rows, 'credit')),
      totalWithdrawn: round2(sumOf(rows, 'withdrawal')),
      rows: rows.map(mapTransaction),
    };
  }

  /*
   * A company's earnings are its OWN wallet's revenue-split credits.
   *
   * This branch aggregated every revenue-split transaction across every wallet on the
   * platform, so a company operator reading "Earnings and payout" was shown each rival
   * operator's takings and the platform's own share — and could export it. Admin keeps
   * the unrestricted aggregate; a company is narrowed to the wallet it owns.
   */
  if (scope.driverIds) {
    const companyWallet = await Wallet.findOne({
      ownerId: scope.userId,
      ownerType: 'company',
    }).lean();

    if (!companyWallet) {
      return { scope: 'company', count: 0, totals: {}, grandTotal: 0, rows: [] };
    }

    const companyFilter: QueryFilter<ITransaction> = {
      walletId: companyWallet._id,
      type: 'credit',
      ...dateFilter(range, 'createdAt'),
    };

    const companyRows = await Transaction.find(companyFilter).sort({ createdAt: -1 }).lean();

    return {
      scope: 'company',
      count: companyRows.length,
      balance: round2(companyWallet.balance),
      totals: companyRows.reduce<Record<string, number>>((acc, t) => {
        const reason = String(t.meta?.reason ?? 'unknown');
        acc[reason] = round2((acc[reason] ?? 0) + t.amount);
        return acc;
      }, {}),
      grandTotal: round2(companyRows.reduce((sum, t) => sum + t.amount, 0)),
      rows: companyRows.map(mapTransaction),
    };
  }

  // Admin: aggregate revenue-split transactions across all wallets.
  const filter: QueryFilter<ITransaction> = {
    type: 'credit',
    'meta.reason': { $in: ['revenue_split_company', 'revenue_split_platform', 'driver_earnings'] },
    ...dateFilter(range, 'createdAt'),
  };

  const rows = await Transaction.find(filter).sort({ createdAt: -1 }).lean();

  const byReason = rows.reduce<Record<string, number>>((acc, t) => {
    const reason = String(t.meta?.reason ?? 'unknown');
    acc[reason] = round2((acc[reason] ?? 0) + t.amount);
    return acc;
  }, {});

  return {
    scope: 'all',
    count: rows.length,
    totals: byReason,
    grandTotal: round2(rows.reduce((sum, t) => sum + t.amount, 0)),
    rows: rows.map(mapTransaction),
  };
}

/* ------------------------ cancellations and penalties --------------------- */

export async function cancellationsPenalties(user: AuthUser, range: ReportRange) {
  const scope = await buildScope(user);

  const tripFilter: QueryFilter<ITrip> = {
    $or: [{ status: 'cancelled' }, { penaltyApplied: true }],
    ...dateFilter(range, 'updatedAt'),
    ...driverFilter(scope),
  };

  const [trips, penalties] = await Promise.all([
    Trip.find(tripFilter).sort({ updatedAt: -1 }).lean(),
    PenaltyEvent.find({
      ...dateFilter(range, 'createdAt'),
      ...driverFilter(scope),
    })
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  return {
    scope: scope.driverId ? 'own' : scope.driverIds ? 'company' : 'all',
    cancellations: trips.map((t) => ({
      tripId: String(t._id),
      driverId: String(t.driverId),
      status: t.status,
      cancelledBy: t.cancellation?.cancelledBy ?? null,
      reason: t.cancellation?.reason ?? null,
      refundPct: t.cancellation?.refundPct ?? 0,
      refundedAt: t.cancellation?.refundedAt ? format(t.cancellation.refundedAt) : null,
    })),
    penalties: penalties.map((p) => ({
      penaltyId: String(p._id),
      bookingId: String(p.bookingId),
      driverId: String(p.driverId),
      reason: p.reason,
      alertDelayMinutes: p.alertDelayMinutes,
      at: format(p.createdAt),
    })),
    counts: { cancellations: trips.length, penalties: penalties.length },
  };
}

/* --------------------------------- export --------------------------------- */

export const REPORT_TYPES = ['trips-completed', 'earnings-payout', 'cancellations-penalties'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

/** Reuses whichever of the three reports the client asked for — no duplicated queries. */
export async function runReport(type: ReportType, user: AuthUser, range: ReportRange) {
  switch (type) {
    case 'trips-completed':
      return tripsCompleted(user, range);
    case 'earnings-payout':
      return earningsPayout(user, range);
    case 'cancellations-penalties':
      return cancellationsPenalties(user, range);
    default:
      throw ApiError.badRequest(`Unknown report type '${String(type)}'`);
  }
}

/** Flattens a report result into tabular rows for CSV/PDF rendering. */
export function toTabular(type: ReportType, result: Record<string, unknown>): Record<string, unknown>[] {
  if (type === 'cancellations-penalties') {
    const cancellations = (result.cancellations as Record<string, unknown>[]) ?? [];
    const penalties = (result.penalties as Record<string, unknown>[]) ?? [];
    return [
      ...cancellations.map((r) => ({ kind: 'cancellation', ...r })),
      ...penalties.map((r) => ({ kind: 'penalty', ...r })),
    ];
  }
  return (result.rows as Record<string, unknown>[]) ?? [];
}

/* -------------------------------- helpers --------------------------------- */

function sumOf(rows: ITransaction[], type: string): number {
  return rows.filter((r) => r.type === type).reduce((sum, r) => sum + r.amount, 0);
}

function mapTransaction(t: ITransaction & { _id?: unknown }) {
  return {
    transactionId: String(t._id),
    type: t.type,
    amount: round2(t.amount),
    feeApplied: round2(t.feeApplied),
    reason: t.meta?.reason ?? null,
    at: format(t.createdAt),
  };
}
