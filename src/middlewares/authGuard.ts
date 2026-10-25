import type { NextFunction, Request, Response } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { isUserRole, type UserRole } from '../utils/roles';
import { isSessionRevoked } from '../modules/auth/revocation';

/** What every downstream handler can rely on once authGuard has run. */
export interface AuthUser {
  userId: string;
  role: UserRole;
  /** Token id — used by logout to blacklist the matching refresh token in Redis. */
  jti?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      /** Exact request bytes, captured in app.ts for webhook signature verification. */
      rawBody?: string;
    }
  }
}

export interface AccessTokenPayload extends JwtPayload {
  userId: string;
  role: UserRole;
}

/**
 * Verifies an access token and returns the identity it carries.
 * Exported separately so the Socket.io handshake can authenticate with the same rules
 * (namespaces are added in later steps).
 */
export function verifyAccessToken(token: string): AuthUser {
  let decoded: string | JwtPayload;

  try {
    decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
  } catch (err) {
    const message =
      err instanceof jwt.TokenExpiredError ? 'Access token expired' : 'Invalid access token';
    throw ApiError.unauthorized(message);
  }

  if (typeof decoded === 'string') {
    throw ApiError.unauthorized('Invalid access token');
  }

  const payload = decoded as AccessTokenPayload;
  const userId = payload.userId ?? payload.sub;

  if (!userId || !isUserRole(payload.role)) {
    throw ApiError.unauthorized('Malformed access token');
  }

  return { userId: String(userId), role: payload.role, jti: payload.jti };
}

/** Pulls a bearer token out of the Authorization header. */
export function extractBearerToken(header?: string): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!token || scheme.toLowerCase() !== 'bearer') return null;
  return token.trim();
}

/**
 * Requires a valid access token; attaches { userId, role } to req.user.
 *
 * Async because a valid signature is not sufficient on its own: a suspended or deleted
 * account's token stays cryptographically valid until it expires, so the revocation
 * cutoff is checked too (see modules/auth/revocation.ts). One Redis GET per request.
 */
export async function authGuard(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    next(ApiError.unauthorized('Missing Authorization bearer token'));
    return;
  }

  try {
    const user = verifyAccessToken(token);
    const { iat } = jwt.decode(token) as JwtPayload;

    if (await isSessionRevoked(user.userId, iat)) {
      next(ApiError.unauthorized('Session has been revoked'));
      return;
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** Attaches req.user when a valid token is present, but never rejects the request. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractBearerToken(req.headers.authorization);
  if (token) {
    try {
      req.user = verifyAccessToken(token);
    } catch {
      // ignore — the route is public
    }
  }
  next();
}
