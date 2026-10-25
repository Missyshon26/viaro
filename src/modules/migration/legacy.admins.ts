import mongoose from 'mongoose';
import { User } from '../../models/User';
import { joinName } from '../../utils/profile';

/**
 * Carries the old admin console's accounts into this app.
 *
 * The old system signed admins in by username and did not require an email (one admin has
 * none), and kept a bcrypt hash — the same scheme this app uses, so the hash is copied as it
 * is and every admin keeps their password with no reset.
 *
 * Reads `legacy_users` (the byte-identical copy of the old data inside this database) and
 * writes only to `users`. It is safe to run twice: an admin that already exists is skipped.
 */
export interface LegacyUserDoc {
  userName?: string;
  firstName?: string;
  lastName?: string;
  countryCode?: string;
  contactNumber?: string;
  emailId?: string;
  password?: string;
  designation?: string;
  status?: string;
}

const BCRYPT_HASH = /^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Mail to this address can never be delivered (RFC 2606 reserves `.invalid`). */
export const placeholderEmail = (username: string): string => `${username.replace(/[^a-z0-9._-]/g, '-')}@no-email.invalid`;

export type StaffRole = 'admin' | 'driver';

export type AdminPlan =
  | {
      ok: true;
      user: {
        role: StaffRole;
        username: string;
        name: string;
        firstName: string;
        lastName: string;
        email: string;
        emailIsPlaceholder: boolean;
        phone: string;
        passwordHash: string;
        status: 'active';
      };
    }
  | { ok: false; username: string; reason: string };

export function planAdmin(doc: LegacyUserDoc): AdminPlan {
  return planStaff(doc, 'admin');
}

/** Same rules for a chauffeur: signs in by username (or email) with the password they had. */
export function planStaff(doc: LegacyUserDoc, role: StaffRole): AdminPlan {
  const username = (doc.userName ?? '').trim().toLowerCase();
  if (!username) return { ok: false, username: '(none)', reason: 'no username' };
  if ((doc.status ?? '').toLowerCase() !== 'live') return { ok: false, username, reason: `status is ${doc.status ?? 'missing'}` };
  if (!BCRYPT_HASH.test(doc.password ?? '')) return { ok: false, username, reason: 'password is not a bcrypt hash' };

  const rawEmail = (doc.emailId ?? '').trim().toLowerCase();
  const hasEmail = EMAIL.test(rawEmail);
  const firstName = (doc.firstName ?? '').trim();
  const lastName = (doc.lastName ?? '').trim();
  const phone = `${doc.countryCode ?? ''}${doc.contactNumber ?? ''}`.trim();

  return {
    ok: true,
    user: {
      role,
      username,
      name: joinName(firstName, lastName) || (doc.userName ?? username).trim(),
      firstName,
      lastName,
      email: hasEmail ? rawEmail : placeholderEmail(username),
      emailIsPlaceholder: !hasEmail,
      phone: phone.length >= 6 ? phone : 'n/a',
      passwordHash: doc.password as string,
      status: 'active',
    },
  };
}

export interface AdminImportLine {
  username: string;
  outcome: 'created' | 'would-create' | 'skipped';
  note: string;
}

export async function importLegacyAdmins(options: { apply: boolean }): Promise<AdminImportLine[]> {
  const docs = (await mongoose.connection
    .collection('legacy_users')
    .find({ designation: 'Admin' })
    .toArray()) as unknown as LegacyUserDoc[];

  const lines: AdminImportLine[] = [];
  for (const doc of docs) {
    const plan = planAdmin(doc);
    if (!plan.ok) {
      lines.push({ username: plan.username, outcome: 'skipped', note: plan.reason });
      continue;
    }
    const { user } = plan;
    const clash = await User.findOne({ $or: [{ username: user.username }, { email: user.email }] }).lean();
    if (clash) {
      lines.push({ username: user.username, outcome: 'skipped', note: 'an account with this username or email already exists' });
      continue;
    }
    if (options.apply) {
      const { emailIsPlaceholder: _unused, ...fields } = user;
      await User.create({ ...fields, phoneVerified: false, isGuest: false });
    }
    lines.push({
      username: user.username,
      outcome: options.apply ? 'created' : 'would-create',
      note: user.emailIsPlaceholder ? 'no email in the old system: signs in by username only' : 'signs in by username or email',
    });
  }
  return lines;
}
