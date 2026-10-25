import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { User } from '../../models/User';
import { ApiError } from '../../utils/ApiError';
import { splitName } from '../../utils/profile';
import { verifyGoogleCredential } from '../../integrations/googleAuth';
import { getOrCreateWallet } from '../wallet/wallet.service';
import { sendWelcomeEmail } from '../notifications/notification.emails';
import { issueTokens, sanitise } from './auth.service';
import type { GoogleInput } from './auth.validation';

const BCRYPT_ROUNDS = 12;

/**
 * "Sign in with Google" for passengers.
 *
 *  - Already linked (same Google id)            → signed in.
 *  - Same verified email, no Google link yet    → the account is linked and signed in.
 *    Google has proved the person controls that mailbox, which is the same proof a
 *    password-reset email gives. A guest account found this way becomes a normal one.
 *  - Unknown email                              → a new account, but only once we have a
 *    phone number: dispatch needs one on every booking and Google does not share it. The
 *    first call answers `needsPhone`; the page asks, then calls again with the same token.
 *
 * Only passenger accounts can be reached this way. A chauffeur, company or admin account
 * with the same email keeps its password sign-in — a Google login is not a way into them.
 */
export async function googleSignIn(input: GoogleInput) {
  const google = await verifyGoogleCredential(input.credential);
  if (!google.emailVerified) {
    throw ApiError.unauthorized('That Google account has not verified its email address.');
  }

  const known =
    (await User.findOne({ googleId: google.sub, deletedAt: null })) ??
    (await User.findOne({ email: google.email, deletedAt: null }));

  if (known) {
    if (known.role !== 'customer') {
      throw ApiError.forbidden('This email belongs to a staff account. Sign in with your password.');
    }
    if (known.status === 'suspended') throw ApiError.forbidden('This account is suspended');
    // An account already tied to a different Google identity is not silently re-pointed.
    if (known.googleId && known.googleId !== google.sub) {
      throw ApiError.forbidden('This email is linked to a different Google account.');
    }

    if (!known.googleId || known.isGuest) {
      known.googleId = google.sub;
      known.isGuest = false;
      await known.save();
    }
    const tokens = issueTokens(String(known._id), known.role);
    return { status: 'signed_in' as const, user: sanitise(known), role: known.role, ...tokens };
  }

  if (!input.phone) {
    return { status: 'needs_phone' as const, profile: { name: google.name, email: google.email } };
  }

  const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('base64url'), BCRYPT_ROUNDS);
  const fullName = google.name;
  const user = await User.create({
    role: 'customer',
    name: fullName,
    ...(google.givenName && google.familyName
      ? { firstName: google.givenName, lastName: google.familyName }
      : splitName(fullName)),
    email: google.email,
    phone: input.phone,
    passwordHash,
    googleId: google.sub,
    status: 'active',
  });

  try {
    const wallet = await getOrCreateWallet(user._id, 'customer');
    user.walletId = wallet._id;
    await user.save();
  } catch (err) {
    // A half-made account cannot book and would block a retry as "already registered".
    await User.deleteOne({ _id: user._id }).catch(() => undefined);
    throw err;
  }

  void sendWelcomeEmail({ name: user.name, email: user.email, phone: user.phone });

  const tokens = issueTokens(String(user._id), user.role);
  return { status: 'signed_in' as const, user: sanitise(user), role: user.role, ...tokens };
}
