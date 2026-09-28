import crypto from 'node:crypto';
import { getSettingsValues } from '../admin/settings.service';
import { ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL } from '../../config/constants';
import bcrypt from 'bcrypt';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { User, type UserDocument } from '../../models/User';
import { Driver } from '../../models/Driver';
import { Company } from '../../models/Company';
import { env } from '../../config/env';
import { redis } from '../../config/redis';
import { ApiError } from '../../utils/ApiError';
import type { UserRole } from '../../utils/roles';
import { getOrCreateWallet } from '../wallet/wallet.service';
import type { LoginInput, RegisterInput } from './auth.validation';
import { revokeUserSessions } from './revocation';

const BCRYPT_ROUNDS = 12;
const BLACKLIST_PREFIX = 'auth:blacklist:refresh:';

/**
 * A real bcrypt hash of a value nobody can log in with, compared against when the email
 * is unknown so that path costs the same as a genuine password check. Generated once at
 * module load rather than hardcoded, so it always matches the current cost factor.
 */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  `viaro-nonexistent-account-${crypto.randomUUID()}`,
  BCRYPT_ROUNDS,
);

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/* -------------------------------------------------------------------------- */
/* Tokens                                                                      */
/* -------------------------------------------------------------------------- */

function signAccessToken(userId: string, role: UserRole): string {
  const options: SignOptions = {
    expiresIn: ACCESS_TOKEN_TTL as SignOptions['expiresIn'],
    jwtid: crypto.randomUUID(),
  };
  return jwt.sign({ userId, role }, env.JWT_ACCESS_SECRET, options);
}

function signRefreshToken(userId: string, role: UserRole): string {
  const options: SignOptions = {
    expiresIn: REFRESH_TOKEN_TTL as SignOptions['expiresIn'],
    // jti is what logout blacklists; without it a refresh token could not be revoked.
    jwtid: crypto.randomUUID(),
  };
  return jwt.sign({ userId, role }, env.JWT_REFRESH_SECRET, options);
}

function issueTokens(userId: string, role: UserRole): TokenPair {
  return {
    accessToken: signAccessToken(userId, role),
    refreshToken: signRefreshToken(userId, role),
  };
}

interface RefreshPayload extends JwtPayload {
  userId: string;
  role: UserRole;
}

function verifyRefreshToken(token: string): RefreshPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET);
    if (typeof decoded === 'string') throw new Error('unexpected payload');
    return decoded as RefreshPayload;
  } catch (err) {
    const expired = err instanceof jwt.TokenExpiredError;
    throw ApiError.unauthorized(expired ? 'Refresh token expired' : 'Invalid refresh token');
  }
}

/**
 * Blacklist lives in Redis keyed by the token's jti, with a TTL equal to the token's own
 * remaining life — so the entry disappears exactly when the token would have expired
 * anyway and the set never grows unbounded.
 */
async function blacklistRefreshToken(payload: RefreshPayload): Promise<void> {
  if (!payload.jti || !payload.exp) return;
  const ttlSeconds = payload.exp - Math.floor(Date.now() / 1000);
  if (ttlSeconds <= 0) return;
  await redis.set(`${BLACKLIST_PREFIX}${payload.jti}`, '1', 'EX', ttlSeconds);
}

async function isRefreshTokenBlacklisted(jti?: string): Promise<boolean> {
  if (!jti) return false;
  return (await redis.exists(`${BLACKLIST_PREFIX}${jti}`)) === 1;
}

/* -------------------------------------------------------------------------- */
/* Use cases                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What `register()` can create internally.
 *
 * The PUBLIC surface is narrower on purpose: `registerSchema` (and therefore
 * POST /auth/register) accepts only 'customer' | 'driver', because accepting a
 * privileged role there let anyone mint themselves an admin. This wider type exists for
 * the trusted in-process callers — the seed script — that legitimately create the
 * admin and company accounts, without reopening the HTTP hole.
 */
export type InternalRegisterInput = Omit<RegisterInput, 'role'> & { role: UserRole };

export async function register(input: InternalRegisterInput) {
  const existing = await User.findOne({ email: input.email }).lean();
  if (existing) throw ApiError.conflict('An account with this email already exists');

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  // Drivers cannot operate until their licence/insurance documents are uploaded.
  const status = input.role === 'driver' ? 'pending_documents' : 'active';

  const user = await User.create({
    role: input.role,
    name: input.name,
    email: input.email,
    phone: input.phone,
    passwordHash,
    status,
  });

  if (input.role === 'driver') {
    await Driver.create({
      userId: user._id,
      vehicleClass: input.vehicleClass,
      status: 'offline',
    });
  }

  if (input.role === 'company') {
    // The admin-set default split (Settings), not a literal: a new company starts on
    // whatever share operations currently offer, and can be given its own later.
    await Company.create({
      userId: user._id,
      driverIds: [],
      revenueSharePct: (await getSettingsValues()).companyRevenuePct,
    });
  }

  // Customers and drivers both hold balances (ride credit / earnings).
  if (input.role === 'customer' || input.role === 'driver') {
    const wallet = await getOrCreateWallet(user._id, input.role);
    user.walletId = wallet._id;
    await user.save();
  }

  const tokens = issueTokens(String(user._id), user.role);
  return { user: sanitise(user), role: user.role, ...tokens };
}

export async function login(input: LoginInput) {
  // passwordHash is select:false on the schema, so it must be requested explicitly.
  const user = await User.findOne({ email: input.email }).select('+passwordHash');

  /*
   * Constant-ish work on both paths.
   *
   * Returning early for an unknown email skipped the bcrypt comparison entirely, making
   * those responses measurably faster than a known email with a wrong password — an
   * account-enumeration oracle that needs no error-message difference to exploit. Hashing
   * against a dummy value keeps the timing of the two paths comparable.
   */
  const matches = user
    ? await bcrypt.compare(input.password, user.passwordHash)
    : await bcrypt.compare(input.password, DUMMY_PASSWORD_HASH);

  if (!user || !matches) throw ApiError.unauthorized('Invalid email or password');

  if (user.status === 'suspended') throw ApiError.forbidden('This account is suspended');

  const tokens = issueTokens(String(user._id), user.role);
  return { user: sanitise(user), role: user.role, ...tokens };
}

/**
 * Refresh with rotation.
 *
 * This used to hand back a new access token and leave the refresh token untouched, so a
 * single stolen refresh token could be replayed for its whole 30-day life with nothing to
 * notice. Now every call retires the presented token and issues a fresh pair: a token can
 * be spent exactly once, and a second use of an already-spent token is a strong signal it
 * was captured — so that revokes the user's sessions outright rather than merely failing.
 */
export async function refresh(refreshToken: string) {
  const payload = verifyRefreshToken(refreshToken);

  if (await isRefreshTokenBlacklisted(payload.jti)) {
    /*
     * Reuse detection: this token was already spent (or explicitly logged out). Either
     * the legitimate holder is replaying, or an attacker is — and we cannot tell which,
     * so the safe move is to end every session for the account and make both parties
     * sign in again.
     */
    await revokeUserSessions(payload.userId);
    throw ApiError.unauthorized('Refresh token has been revoked');
  }

  const user = await User.findById(payload.userId).lean();
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  if (user.status === 'suspended') throw ApiError.forbidden('This account is suspended');

  // Retire the presented token before issuing its replacement.
  await blacklistRefreshToken(payload);

  const tokens = issueTokens(String(user._id), user.role);
  return { ...tokens, role: user.role };
}

export async function logout(refreshToken: string): Promise<void> {
  // Verify first: blacklisting an unverified string would let anyone flood Redis.
  const payload = verifyRefreshToken(refreshToken);
  await blacklistRefreshToken(payload);
}

function sanitise(user: UserDocument) {
  const obj = user.toJSON() as unknown as Record<string, unknown>;
  delete obj.passwordHash;
  return obj;
}
