import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { User } from '../../models/User';
import { redis } from '../../config/redis';
import { appWebUrl } from '../../config/env';
import { revokeUserSessions } from './revocation';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../utils/logger';
import { sendSmsOrPush } from '../../integrations/smsPush';
import { sendEmail } from '../../integrations/email';
import { passwordResetEmail } from '../../integrations/emailTemplates';

/**
 * Phone verification and password reset.
 *
 * Both keep their short-lived secrets in Redis rather than Mongo: they expire on their
 * own, they are never meant to be queried, and leaving spent tokens in the database is
 * how reset links end up being reusable months later.
 */
const OTP_PREFIX = 'auth:otp:';
const OTP_ATTEMPTS_PREFIX = 'auth:otp:attempts:';
const RESET_PREFIX = 'auth:reset:';

export const OTP_TTL_SECONDS = 10 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const RESET_TTL_SECONDS = 30 * 60;
const BCRYPT_ROUNDS = 12;

/* ------------------------------ phone verification ------------------------ */

export async function sendPhoneCode(userId: string) {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('User not found');
  if (user.phoneVerified) throw ApiError.conflict('Your phone is already verified');

  // 6 digits, generated with a CSPRNG rather than Math.random.
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

  await redis.set(`${OTP_PREFIX}${userId}`, code, 'EX', OTP_TTL_SECONDS);
  await redis.del(`${OTP_ATTEMPTS_PREFIX}${userId}`);

  await sendSmsOrPush({
    to: user.phone,
    title: 'Viaro verification code',
    body: `${code} is your Viaro verification code. It expires in 10 minutes.`,
  });

  return { sent: true, expiresInSeconds: OTP_TTL_SECONDS };
}

export async function verifyPhoneCode(userId: string, code: string) {
  const key = `${OTP_PREFIX}${userId}`;
  const stored = await redis.get(key);
  if (!stored) throw ApiError.badRequest('That code has expired — request a new one');

  // Rate limit guesses: 6 digits is only a million combinations.
  const attempts = await redis.incr(`${OTP_ATTEMPTS_PREFIX}${userId}`);
  await redis.expire(`${OTP_ATTEMPTS_PREFIX}${userId}`, OTP_TTL_SECONDS);

  if (attempts > OTP_MAX_ATTEMPTS) {
    await redis.del(key);
    throw ApiError.tooManyRequests('Too many attempts — request a new code');
  }

  if (stored !== code) throw ApiError.badRequest('That code is not correct');

  await redis.del(key, `${OTP_ATTEMPTS_PREFIX}${userId}`);

  const user = await User.findByIdAndUpdate(
    userId,
    { $set: { phoneVerified: true } },
    { new: true },
  );

  return { phoneVerified: true, user };
}

/* -------------------------------- password reset -------------------------- */

/**
 * Emails a reset link to an existing account.
 *
 * This used to answer "sent" for every address so the form could not be used to learn
 * which emails have accounts. The product now prefers telling a customer plainly that
 * no account exists (they usually mistyped, or signed up with another address); the
 * auth rate limiter on this route keeps bulk probing slow.
 *
 * A failed delivery is also reported instead of being swallowed — otherwise the customer
 * waits for an email that is never coming.
 */
export async function requestPasswordReset(email: string) {
  const user = await User.findOne({ email: email.toLowerCase(), deletedAt: null }).lean();
  if (!user) throw ApiError.notFound('No account exists with this email address');

  const token = crypto.randomBytes(32).toString('hex');
  // Only the hash is stored: a leaked Redis dump then yields nothing usable.
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const key = `${RESET_PREFIX}${tokenHash}`;
  await redis.set(key, String(user._id), 'EX', RESET_TTL_SECONDS);

  // Straight to the form; /reset-password/confirm still forwards for links already sent.
  const link = `${appWebUrl}/reset-password?token=${token}`;
  const message = passwordResetEmail({
    name: user.name,
    link,
    expiresInMinutes: RESET_TTL_SECONDS / 60,
  });
  const result = await sendEmail({ to: user.email, ...message });

  if (!result.sent) {
    // An undelivered token is useless to the customer and should not stay redeemable.
    await redis.del(key);
    throw new ApiError(503, "We couldn't send the reset email right now. Please try again in a few minutes.");
  }

  logger.info(`Password reset issued for ${user.email}`);
  return { sent: true };
}

export async function resetPassword(token: string, newPassword: string) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const key = `${RESET_PREFIX}${tokenHash}`;

  const userId = await redis.get(key);
  if (!userId) throw ApiError.badRequest('This reset link is invalid or has expired');

  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('Account no longer exists');

  user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await user.save();

  // Single use.
  await redis.del(key);

  /*
   * A reset must end every existing session.
   *
   * The usual reason someone resets a password is that somebody else knows it. Without
   * this, whoever was already signed in kept a valid refresh token for its full 30-day
   * life — so the reset locked nobody out, which is the opposite of the point.
   */
  await revokeUserSessions(String(user._id));

  return { reset: true };
}

/* -------------------------------- delete account -------------------------- */

/**
 * Soft delete (customer/driver screen 27).
 *
 * The row survives because wallets, trips and transactions reference it and the
 * financial record has to remain auditable. Identifying fields are scrubbed and the
 * account is suspended so it can no longer sign in.
 */
export async function deleteOwnAccount(userId: string) {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('User not found');
  if (user.deletedAt) throw ApiError.conflict('This account is already deleted');

  const stamp = Date.now();
  user.name = 'Deleted user';
  user.email = `deleted+${stamp}@viaro.invalid`;
  user.phone = `deleted-${stamp}`;
  user.status = 'suspended';
  user.deletedAt = new Date(stamp);
  user.passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), BCRYPT_ROUNDS);
  await user.save();

  // Without this the caller's own access token keeps working for the rest of its life,
  // against an account that no longer exists as far as the product is concerned.
  await revokeUserSessions(String(user._id));

  return { deleted: true, deletedAt: user.deletedAt };
}
