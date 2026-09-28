import { redis } from '../../config/redis';
import { ACCESS_TOKEN_TTL } from '../../config/constants';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';

/**
 * Immediate session revocation.
 *
 * The refresh-token blacklist in auth.service handles logout, but it only stops the
 * *next* refresh — an access token already in the wild keeps working until it expires.
 * That left a real hole: `deleteOwnAccount` suspends the account, yet the caller's
 * access token stayed valid for the rest of its 15 minutes.
 *
 * Blacklisting individual access tokens is not possible here (their jtis are unknown at
 * suspend time), so this records a per-user cutoff instead: every token issued before
 * the cutoff is rejected. One small key per revoked user, and because any access token
 * older than the cutoff expires within the access-token lifetime anyway, the key only
 * needs to live that long — the set can never grow unbounded.
 */
const PREFIX = 'auth:revoked-before:';

/** '15m' | '2h' | '30d' | '900' -> seconds. Mirrors the formats jsonwebtoken accepts. */
export function parseDurationSeconds(value: string, fallback = 900): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(value.trim());
  if (!match) return fallback;

  const amount = Number(match[1]);
  const unit = match[2] ?? 's';
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[unit] ?? 1;
  return amount * multiplier;
}

/** A little headroom over the access-token lifetime, for clock skew between processes. */
function cutoffTtlSeconds(): number {
  return parseDurationSeconds(ACCESS_TOKEN_TTL) + 60;
}

/**
 * Invalidates every access token issued to this user before now.
 *
 * Never throws: revocation is a hardening measure layered on top of the status checks
 * at login and refresh, so a Redis blip must not fail the suspend/delete that triggered
 * it. It is logged loudly instead.
 */
export async function revokeUserSessions(userId: string): Promise<void> {
  try {
    await redis.set(
      `${PREFIX}${userId}`,
      String(Math.floor(Date.now() / 1000)),
      'EX',
      cutoffTtlSeconds(),
    );
  } catch (err) {
    logger.error(`Could not record session revocation for user ${userId}`, err as Error);
  }
}

/**
 * True when the token was issued before this user's revocation cutoff.
 *
 * A token with no `iat` is treated as revoked when a cutoff exists — failing closed is
 * the only safe reading of "we cannot tell how old this is".
 */
export async function isSessionRevoked(userId: string, issuedAt?: number): Promise<boolean> {
  let cutoff: string | null;

  try {
    cutoff = await redis.get(`${PREFIX}${userId}`);
  } catch (err) {
    // Fail open: Redis being down must not lock every user out of the product.
    // Login and refresh still reject suspended accounts against the database.
    logger.error('Revocation check failed; allowing the request', err as Error);
    return false;
  }

  if (!cutoff) return false;
  if (issuedAt === undefined) return true;

  return issuedAt < Number(cutoff);
}

/** Clears the cutoff — for reinstating an account. */
export async function clearRevocation(userId: string): Promise<void> {
  await redis.del(`${PREFIX}${userId}`);
}
