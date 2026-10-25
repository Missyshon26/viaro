import bcrypt from 'bcrypt';
import { User } from '../../models/User';
import { Driver } from '../../models/Driver';
import { Company } from '../../models/Company';
import { Booking } from '../../models/Booking';
import { Subscription } from '../../models/Subscription';
import { PenaltyEvent } from '../../models/PenaltyEvent';
import { ApiError } from '../../utils/ApiError';
import type { AuthUser } from '../../middlewares/authGuard';
import { paginated, toSkipLimit, type PaginationQuery } from '../../utils/pagination';
import { format, nowDate } from '../../config/timezone';
import { round2 } from '../../utils/money';
import { getOrCreateWallet } from '../wallet/wallet.service';
import { driverRosterOwner } from '../../utils/roster';
import type { CreateDriverInput, UpdateDriverInput } from './admin.validation';

const BCRYPT_ROUNDS = 12;

async function loadCompany(userId: string) {
  const company = await Company.findOne({ userId });
  if (!company) throw ApiError.notFound('Company profile not found');
  return company;
}

/* ------------------------------ driver management ------------------------- */

export async function createDriver(companyUserId: string, input: CreateDriverInput) {
  const company = await loadCompany(companyUserId);

  let user = await User.findOne({ email: input.email });

  if (user) {
    /*
     * The message deliberately does not distinguish "this email is a customer" from
     * "this email is an admin". The old wording confirmed that an address existed and
     * what kind of account it was, which turned this endpoint into a user-enumeration
     * oracle for anyone with a company login.
     */
    if (user.role !== 'driver') {
      throw ApiError.conflict('That email cannot be added as a driver');
    }
  } else {
    if (!input.password) {
      throw ApiError.badRequest('password is required when creating a new driver account');
    }
    user = await User.create({
      role: 'driver',
      name: input.name,
      email: input.email,
      phone: input.phone,
      passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
      status: 'pending_documents',
    });
    const wallet = await getOrCreateWallet(user._id, 'driver');
    user.walletId = wallet._id;
    await user.save();
  }

  let driver = await Driver.findOne({ userId: user._id });
  if (!driver) {
    driver = await Driver.create({
      userId: user._id,
      vehicleClass: input.vehicleClass,
      status: 'offline',
    });
  }

  const alreadyLinked = company.driverIds.some((id) => String(id) === String(driver._id));
  if (alreadyLinked) throw ApiError.conflict('This driver is already on your roster');

  /*
   * A driver already on someone's roster cannot be claimed by another company.
   *
   * Whoever owns a driver sets their payout terms (see updateDriver below), so silently
   * re-rostering an existing driver handed a stranger control of that person's pay with
   * no consent step anywhere. Onboarding someone else's driver is a business
   * relationship, not a POST.
   */
  const existingOwner = await driverRosterOwner(driver._id);
  if (existingOwner && String(existingOwner) !== String(company._id)) {
    throw ApiError.conflict(
      'That chauffeur is already on another operator’s roster and cannot be added here',
    );
  }

  company.driverIds.push(driver._id);
  await company.save();

  return { driver, user: user.toJSON() };
}

/** Company sees only its own roster; admin sees every driver (spec §4.11). */
export async function listDrivers(user: AuthUser, q: PaginationQuery) {
  const { skip, limit } = toSkipLimit(q);

  let filter = {};
  if (user.role === 'company') {
    const company = await loadCompany(user.userId);
    filter = { _id: { $in: company.driverIds } };
  }

  const [items, total] = await Promise.all([
    Driver.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({ path: 'userId', select: 'name email phone status' })
      .lean(),
    Driver.countDocuments(filter),
  ]);

  if (user.role !== 'admin' || items.length === 0) return paginated(items, total, q);

  // The admin may only set terms for drivers on no roster (see updateDriver), and the
  // roster link lives on Company alone — so say up front who owns each one, rather than
  // letting the console offer a form the API is going to refuse.
  const rostered = await Company.find({ driverIds: { $in: items.map((d) => d._id) } })
    .select('driverIds')
    .lean();
  const onRoster = new Set(rostered.flatMap((c) => c.driverIds.map(String)));

  return paginated(
    items.map((d) => ({
      ...d,
      managedBy: onRoster.has(String(d._id)) ? 'company' : 'platform',
    })),
    total,
    q,
  );
}

/**
 * A driver's terms are set by whoever owns them (the money model in wallet.service.ts):
 * a company may only touch its own roster, while the admin owns every driver that is on
 * no roster — and so sets their per-trip charge.
 */
export async function updateDriver(user: AuthUser, driverId: string, input: UpdateDriverInput) {
  const onSomeRoster = await Company.findOne({ driverIds: driverId }).lean();

  if (user.role === 'company') {
    const company = await loadCompany(user.userId);
    const owns = company.driverIds.some((id) => String(id) === driverId);
    if (!owns) throw ApiError.forbidden('That driver is not on your roster');
  } else if (onSomeRoster) {
    // Admin: platform drivers only — a company's roster is that company's to manage.
    throw ApiError.forbidden(
      "This driver belongs to a company's roster — only that company can change their terms",
    );
  }

  const { payout, ...rest } = input;
  const update: Record<string, unknown> = { ...rest };

  if (payout) {
    update.payout = {
      mode: payout.mode,
      value: payout.value,
      setBy: user.role === 'company' ? 'company' : 'admin',
      updatedAt: nowDate(),
    };
  }

  const driver = await Driver.findByIdAndUpdate(
    driverId,
    { $set: update },
    { new: true, runValidators: true },
  );
  if (!driver) throw ApiError.notFound('Driver not found');

  return driver;
}

/* -------------------------------- dashboards ------------------------------ */

export async function listAllBookings(q: PaginationQuery) {
  const { skip, limit } = toSkipLimit(q);
  const [items, total] = await Promise.all([
    Booking.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({ path: 'customerId', select: 'name email phone' })
      .lean(),
    Booking.countDocuments(),
  ]);

  return paginated(
    items.map((b) => ({ ...b, scheduledAtLocal: format(b.scheduledAt) })),
    total,
    q,
  );
}

export async function listAllUsers(q: PaginationQuery) {
  const { skip, limit } = toSkipLimit(q);
  const [items, total] = await Promise.all([
    User.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(),
  ]);

  return paginated(items, total, q);
}

/** Monthly subscription revenue, aggregated in the database rather than in Node. */
export async function subscriptionRevenue() {
  const rows = await Subscription.aggregate<{
    _id: { year: number; month: number };
    activeCount: number;
    revenue: number;
  }>([
    { $match: { status: 'active' } },
    {
      $group: {
        _id: { year: { $year: '$startDate' }, month: { $month: '$startDate' } },
        activeCount: { $sum: 1 },
        revenue: { $sum: '$price' },
      },
    },
    { $sort: { '_id.year': -1, '_id.month': -1 } },
  ]);

  return {
    months: rows.map((r) => ({
      year: r._id.year,
      month: r._id.month,
      activeSubscriptions: r.activeCount,
      revenue: round2(r.revenue),
    })),
    totalActive: rows.reduce((sum, r) => sum + r.activeCount, 0),
    totalRevenue: round2(rows.reduce((sum, r) => sum + r.revenue, 0)),
  };
}

/** Drivers carrying penalties, with the underlying events (spec §4.11, §8 rule 5). */
export async function driverPenalties(user: AuthUser) {
  let driverFilter = {};
  if (user.role === 'company') {
    const company = await loadCompany(user.userId);
    driverFilter = { _id: { $in: company.driverIds } };
  }

  const drivers = await Driver.find({ ...driverFilter, penaltyCount: { $gt: 0 } })
    .populate({ path: 'userId', select: 'name email phone' })
    .sort({ penaltyCount: -1 })
    .lean();

  const events = await PenaltyEvent.find({ driverId: { $in: drivers.map((d) => d._id) } })
    .sort({ createdAt: -1 })
    .lean();

  return {
    drivers: drivers.map((d) => ({
      driverId: d._id,
      user: d.userId,
      vehicleClass: d.vehicleClass,
      status: d.status,
      penaltyCount: d.penaltyCount,
      events: events
        .filter((e) => String(e.driverId) === String(d._id))
        .map((e) => ({
          bookingId: e.bookingId,
          reason: e.reason,
          alertDelayMinutes: e.alertDelayMinutes,
          at: format(e.createdAt),
        })),
    })),
    totalDrivers: drivers.length,
    totalEvents: events.length,
  };
}
