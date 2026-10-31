import bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import { User } from '../../models/User';
import { Driver } from '../../models/Driver';
import { Company } from '../../models/Company';
import { Booking } from '../../models/Booking';
import { Subscription } from '../../models/Subscription';
import { PenaltyEvent } from '../../models/PenaltyEvent';
import { ApiError } from '../../utils/ApiError';
import type { AuthUser } from '../../middlewares/authGuard';
import { paginated, toSkipLimit, type PaginationQuery } from '../../utils/pagination';
import { format, nowDate, toAppTime } from '../../config/timezone';
import { round2 } from '../../utils/money';
import { getOrCreateWallet } from '../wallet/wallet.service';
import { driverRosterOwner } from '../../utils/roster';
import type { CreateDriverInput, JourneysQuery, UpdateDriverInput } from './admin.validation';

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

/**
 * The console's stageOf, as a Mongo expression over a booking joined to its `trips` array. A
 * booking with no trip is awaiting a driver (an old 'dispatched' booking, from when bookings were
 * offered to drivers, reads the same way).
 */
const journeyStageExpr = {
  $switch: {
    branches: [
      { case: { $eq: ['$trip.status', 'completed'] }, then: 'completed' },
      { case: { $or: [{ $eq: ['$trip.status', 'cancelled'] }, { $eq: ['$status', 'cancelled'] }] }, then: 'cancelled' },
      { case: { $eq: ['$trip.status', 'started'] }, then: 'in_progress' },
      { case: { $or: [{ $gt: [{ $size: '$trips' }, 0] }, { $eq: ['$status', 'assigned'] }] }, then: 'assigned' },
    ],
    default: 'awaiting',
  },
};


const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One page of the operations pipeline: bookings, each with its trip and customer, filtered,
 * searched and counted in the database.
 *
 * The console used to download every booking and every trip and join them in the browser, which
 * took minutes at a few thousand bookings. A page is now one query. The stage is worked out here
 * with the same rules as the console's stageOf (a booking never reaches 'completed' on its own;
 * the trip decides), so the counts the filter chips show agree with the rows they select.
 */
export async function listJourneys(q: JourneysQuery) {
  const { skip, limit } = toSkipLimit(q);

  /* Filters that only need the booking come first, so the join below runs on fewer documents. */
  const base: Record<string, unknown> = {};
  if (q.customerId) base.customerId = new Types.ObjectId(q.customerId);
  if (q.vehicle) base.vehicleClass = q.vehicle;
  if (q.service) base.tripType = q.service;
  if (q.city) base.city = q.city;
  if (q.payment) {
    if (q.payment === 'unpaid') base.payment = { $exists: false };
    else base['payment.status'] = q.payment;
  }
  if (q.from || q.to) {
    const range: Record<string, Date> = {};
    if (q.from) range.$gte = toAppTime(q.from).startOf('day').toJSDate();
    if (q.to) range.$lte = toAppTime(q.to).endOf('day').toJSDate();
    base.scheduledAt = range;
  }

  const search: Record<string, unknown>[] = [];
  if (q.q) {
    const pattern = new RegExp(escapeRegex(q.q), 'i');
    const hex = q.q.replace(/^abl-?/i, '');
    search.push(
      { 'customer.name': pattern },
      { 'customer.email': pattern },
      { 'pickup.address': pattern },
      { 'drop.address': pattern },
      { city: pattern },
      { vehicleClass: pattern },
      { 'flightDetails.flightNumber': pattern },
    );
    // "ABL-7849B0": the reference is the tail of the booking id.
    if (/^[0-9a-f]{3,24}$/i.test(hex)) {
      search.push({
        $expr: { $regexMatch: { input: { $toString: '$_id' }, regex: `${escapeRegex(hex)}$`, options: 'i' } },
      });
    }
  }

  const overdue = {
    stage: { $nin: ['completed', 'cancelled'] },
    scheduledAt: { $lt: nowDate() },
  };
  const stageGroups: Record<string, string[]> = {
    active: ['assigned', 'in_progress'],
  };
  const stageMatch =
    q.stage === 'overdue'
      ? overdue
      : q.stage && stageGroups[q.stage]
        ? { stage: { $in: stageGroups[q.stage] } }
        : q.stage
          ? { stage: q.stage }
          : {};

  const [result] = await Booking.aggregate([
    { $match: base },
    {
      $lookup: {
        from: 'trips',
        localField: '_id',
        foreignField: 'bookingId',
        as: 'trips',
        pipeline: [{ $project: { status: 1, fareAmount: 1, settled: 1, driverId: 1 } }],
      },
    },
    { $addFields: { trip: { $arrayElemAt: ['$trips', 0] } } },
    { $addFields: { stage: journeyStageExpr } },
    {
      $lookup: {
        from: 'users',
        localField: 'customerId',
        foreignField: '_id',
        as: 'customer',
        pipeline: [{ $project: { name: 1, email: 1, phone: 1 } }],
      },
    },
    { $addFields: { customer: { $first: '$customer' } } },
    ...(search.length ? [{ $match: { $or: search } }] : []),
    {
      $facet: {
        items: [
          { $match: stageMatch },
          { $sort: { createdAt: -1, _id: -1 } },
          { $skip: skip },
          { $limit: limit },
          // The shape the console already reads: customerId populated, or null for a deleted account.
          { $addFields: { customerId: { $ifNull: ['$customer', null] } } },
          { $project: { customer: 0, stage: 0, trips: 0 } },
        ],
        total: [{ $match: stageMatch }, { $count: 'n' }],
        stages: [{ $group: { _id: '$stage', n: { $sum: 1 } } }],
        overdue: [{ $match: overdue }, { $count: 'n' }],
      },
    },
  ]);

  const counts: Record<string, number> = {};
  let all = 0;
  for (const row of result.stages as { _id: string; n: number }[]) {
    counts[row._id] = row.n;
    all += row.n;
  }

  const items = (result.items as (Record<string, unknown> & { scheduledAt: Date })[]).map((b) => ({
    ...b,
    scheduledAtLocal: format(b.scheduledAt),
  }));
  const total = (result.total[0]?.n as number | undefined) ?? 0;

  return {
    ...paginated(items, total, q),
    /** Per stage and overall, under the current filters but ignoring the stage filter itself. */
    counts: { all, overdue: (result.overdue[0]?.n as number | undefined) ?? 0, ...counts },
  };
}

/**
 * Everything the dashboard's headline tiles need, counted in the database. The home page used to
 * download every booking, user, trip and chauffeur just to tally them in the browser.
 */
export async function dashboardSummary() {
  const [stageRows, roleRows, driverRows, topDrivers, penalised] = await Promise.all([
    Booking.aggregate<{ _id: string; n: number }>([
      {
        $lookup: {
          from: 'trips',
          localField: '_id',
          foreignField: 'bookingId',
          as: 'trips',
          pipeline: [{ $project: { status: 1 } }],
        },
      },
      { $addFields: { trip: { $arrayElemAt: ['$trips', 0] } } },
      { $group: { _id: journeyStageExpr, n: { $sum: 1 } } },
    ]),
    User.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$role', n: { $sum: 1 } } }]),
    Driver.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Driver.find({ ratingCount: { $gt: 0 } })
      .sort({ rating: -1, ratingCount: -1 })
      .limit(5)
      .populate({ path: 'userId', select: 'name email phone status' })
      .lean(),
    Driver.countDocuments({ penaltyCount: { $gt: 0 } }),
  ]);

  const tally = (rows: { _id: string; n: number }[]) =>
    Object.fromEntries(rows.map((r) => [r._id, r.n])) as Record<string, number>;
  const stages = tally(stageRows);
  const roles = tally(roleRows);
  const driverStatus = tally(driverRows);

  return {
    bookings: {
      total: Object.values(stages).reduce((a, b) => a + b, 0),
      stages: {
        awaiting: stages.awaiting ?? 0,
        assigned: stages.assigned ?? 0,
        in_progress: stages.in_progress ?? 0,
        completed: stages.completed ?? 0,
        cancelled: stages.cancelled ?? 0,
      },
    },
    users: {
      customer: roles.customer ?? 0,
      driver: roles.driver ?? 0,
      company: roles.company ?? 0,
      admin: roles.admin ?? 0,
    },
    drivers: {
      total: Object.values(driverStatus).reduce((a, b) => a + b, 0),
      available: driverStatus.available ?? 0,
      busy: driverStatus.busy ?? 0,
      offline: driverStatus.offline ?? 0,
      penalised,
      top: topDrivers,
    },
  };
}

export async function listAllUsers(q: PaginationQuery & { role?: string; q?: string }) {
  const { skip, limit } = toSkipLimit(q);
  const filter: Record<string, unknown> = {};
  if (q.role) filter.role = q.role;
  if (q.q) {
    const pattern = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ name: pattern }, { email: pattern }, { phone: pattern }, { username: pattern }];
  }
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);

  return paginated(items, total, q);
}

/** One account, by id, for the console's account page (it used to page through every user to find it). */
export async function getUserById(id: string) {
  const user = await User.findById(id).lean();
  if (!user) throw ApiError.notFound('User not found');
  return user;
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
          at: format(e.createdAt),
        })),
    })),
    totalDrivers: drivers.length,
    totalEvents: events.length,
  };
}
