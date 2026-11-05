import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { Types, type QueryFilter } from 'mongoose';
import { Booking } from '../../models/Booking';
import { User, type IUser, type UserDocument } from '../../models/User';
import { ApiError } from '../../utils/ApiError';
import { paginated, toSkipLimit } from '../../utils/pagination';
import { format } from '../../config/timezone';
import { formatAddress, joinName } from '../../utils/profile';
import { toCsv, toXlsxBuffer, type Row } from '../../utils/spreadsheet';
import { getOrCreateWallet } from '../wallet/wallet.service';
import { revokeUserSessions } from '../auth/revocation';
import { sendAccountInvite } from '../auth/auth.account.service';
import { applyNameAndAddress } from '../users/users.service';
import { sendContactNumberReset } from '../notifications/notification.emails';
import type {
  CreateCustomerInput,
  ExportCustomersQuery,
  ListCustomersQuery,
  UpdateCustomerInput,
} from './admin.customers.validation';

const BCRYPT_ROUNDS = 12;

/** More than this in one download is a sign the filter is wrong, not a request to honour. */
export const EXPORT_ROW_LIMIT = 20_000;

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The customers a request is about. Accounts the customer deleted are never listed: their
 * personal details were scrubbed, and an empty "Deleted user" row helps nobody.
 */
export function customerFilter(q: { search?: string; status?: string; guest?: boolean }): QueryFilter<IUser> {
  const filter: QueryFilter<IUser> = { role: 'customer', deletedAt: null };
  if (q.status) filter.status = q.status as IUser['status'];
  if (q.guest !== undefined) filter.isGuest = q.guest ? true : { $ne: true };

  const text = q.search?.trim();
  if (text) {
    // Escaped: the box is a search, not a pattern, and a stray "(" must not become a 500.
    const re = new RegExp(escapeRegex(text), 'i');
    filter.$or = [{ name: re }, { email: re }, { phone: re }];
  }
  return filter;
}

/** How many bookings each of these customers has made, and when the last one was for. */
async function bookingStats(ids: Types.ObjectId[]) {
  if (!ids.length) return new Map<string, { bookings: number; lastBookingAt: Date }>();
  const rows = await Booking.aggregate<{ _id: Types.ObjectId; bookings: number; lastBookingAt: Date }>([
    { $match: { customerId: { $in: ids } } },
    { $group: { _id: '$customerId', bookings: { $sum: 1 }, lastBookingAt: { $max: '$scheduledAt' } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), { bookings: r.bookings, lastBookingAt: r.lastBookingAt }]));
}

export async function listCustomers(q: ListCustomersQuery) {
  const filter = customerFilter(q);
  const { skip, limit } = toSkipLimit(q);

  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);
  const stats = await bookingStats(users.map((u) => u._id));

  const items = users.map((u) => ({
    ...u,
    bookings: stats.get(String(u._id))?.bookings ?? 0,
    lastBookingAt: stats.get(String(u._id))?.lastBookingAt ?? null,
  }));
  return paginated(items, total, q);
}

export async function createCustomer(input: CreateCustomerInput) {
  const existing = await User.findOne({ email: input.email }).lean();
  if (existing) throw ApiError.conflict('An account with this email already exists');

  const name = joinName(input.firstName, input.lastName);
  const { line2, ...address } = input.address ?? ({} as NonNullable<CreateCustomerInput['address']>);

  const user = await User.create({
    role: 'customer',
    name,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone,
    // A password nobody knows: the client chooses theirs from the invitation link.
    passwordHash: await bcrypt.hash(crypto.randomBytes(24).toString('base64url'), BCRYPT_ROUNDS),
    status: 'active',
    ...(input.address ? { address: { ...address, ...(line2 ? { line2 } : {}) } } : {}),
  });

  try {
    const wallet = await getOrCreateWallet(user._id, 'customer');
    user.walletId = wallet._id;
    await user.save();
  } catch (err) {
    // Same reason as guest checkout: do not leave a half-made account that blocks a retry.
    await User.deleteOne({ _id: user._id }).catch(() => undefined);
    throw err;
  }

  const inviteSent = input.sendInvite ? await sendAccountInvite(user) : false;
  return { user: user.toJSON(), inviteSent };
}

/**
 * The edit itself, shared by the clients screen and the users screen: name, email, phone,
 * address and status. Nothing here changes the role, and no password is ever seen or set.
 */
async function applyAccountUpdate(user: UserDocument, input: UpdateCustomerInput) {
  applyNameAndAddress(user, input);

  if (input.email !== undefined && input.email !== user.email) {
    const taken = await User.findOne({ email: input.email, _id: { $ne: user._id } }).lean();
    if (taken) throw ApiError.conflict('Another account already uses that email');
    user.email = input.email;
  }

  // A new number has not been verified, whoever typed it — see users.service.updateProfile.
  let phoneChanged = false;
  if (input.phone !== undefined && input.phone !== user.phone) {
    user.phone = input.phone;
    user.phoneVerified = false;
    phoneChanged = true;
  }

  const suspending = input.status === 'suspended' && user.status !== 'suspended';
  if (input.status !== undefined) user.status = input.status;

  await user.save();
  if (phoneChanged) void sendContactNumberReset(user, user.phone);
  // Suspending must take effect now, not when their current tokens happen to expire.
  if (suspending) await revokeUserSessions(String(user._id));

  return user.toJSON();
}

export async function updateCustomer(id: string, input: UpdateCustomerInput) {
  const user = await User.findOne({ _id: id, role: 'customer', deletedAt: null });
  // The same answer for "no such account" and "not a customer": this screen manages
  // clients, and should not confirm what kind of account any other id belongs to.
  if (!user) throw ApiError.notFound('Client not found');
  return applyAccountUpdate(user, input);
}

/**
 * An admin correcting any account's details, whatever its role (customer, driver, company or
 * admin). The same fields and rules as editing a client. An admin cannot suspend their own
 * account: nobody would be left to reinstate it.
 */
export async function updateUser(id: string, input: UpdateCustomerInput, actorId: string) {
  if (id === actorId && input.status === 'suspended') {
    throw ApiError.badRequest('You cannot suspend your own account');
  }
  const user = await User.findOne({ _id: id, deletedAt: null });
  if (!user) throw ApiError.notFound('User not found');
  return applyAccountUpdate(user, input);
}

/** The rows of the clients download, one per customer, in plain spreadsheet-friendly columns. */
export async function customerExportRows(q: Omit<ExportCustomersQuery, 'format'>): Promise<Row[]> {
  const filter = customerFilter(q);

  const total = await User.countDocuments(filter);
  if (total > EXPORT_ROW_LIMIT) {
    throw ApiError.badRequest(
      `That is ${total} clients; a download is limited to ${EXPORT_ROW_LIMIT}. Narrow it with a search or a status.`,
    );
  }

  const users = await User.find(filter).sort({ createdAt: -1, _id: -1 }).lean();
  const stats = await bookingStats(users.map((u) => u._id));

  return users.map((u) => {
    const s = stats.get(String(u._id));
    return {
      Name: u.name,
      'First name': u.firstName ?? '',
      'Last name': u.lastName ?? '',
      Email: u.email,
      Phone: u.phone,
      'Phone verified': u.phoneVerified ? 'Yes' : 'No',
      Address: formatAddress(u.address),
      Status: u.status.replace(/_/g, ' '),
      'Guest account': u.isGuest ? 'Yes' : 'No',
      'Agreement signed': u.agreement ? format(u.agreement.signedAt, 'yyyy-LL-dd') : '',
      Bookings: s?.bookings ?? 0,
      'Last booking': s?.lastBookingAt ? format(s.lastBookingAt, 'yyyy-LL-dd') : '',
      Joined: format(u.createdAt, 'yyyy-LL-dd'),
    };
  });
}

export async function exportCustomers(q: ExportCustomersQuery) {
  const rows = await customerExportRows(q);
  const stamp = format(new Date(), 'yyyy-LL-dd');

  if (q.format === 'csv') {
    return {
      buffer: Buffer.from(toCsv(rows), 'utf8'),
      contentType: 'text/csv; charset=utf-8',
      filename: `abl-clients-${stamp}.csv`,
      rowCount: rows.length,
    };
  }
  return {
    buffer: await toXlsxBuffer('Clients', rows, 'No clients match.'),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    filename: `abl-clients-${stamp}.xlsx`,
    rowCount: rows.length,
  };
}
