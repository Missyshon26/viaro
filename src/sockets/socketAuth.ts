// Both come from the package root — socket.io's "exports" map does not expose ./dist/*,
// so a deep import breaks under node16 module resolution.
import type { ExtendedError, Socket } from 'socket.io';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { verifyAccessToken, type AuthUser } from '../middlewares/authGuard';
import { isSessionRevoked } from '../modules/auth/revocation';

/**
 * Socket handshake authentication — the same JWT rules as the REST authGuard, reusing
 * verifyAccessToken so the two can never drift apart.
 *
 * Clients send the token either as `auth: { token }` (preferred) or `?token=` on the
 * connection URL.
 */
declare module 'socket.io' {
  interface Socket {
    user?: AuthUser;
  }
}

export function extractSocketToken(socket: Socket): string | null {
  const auth = socket.handshake.auth as { token?: unknown } | undefined;
  if (typeof auth?.token === 'string' && auth.token) return stripBearer(auth.token);

  const header = socket.handshake.headers.authorization;
  if (typeof header === 'string' && header) return stripBearer(header);

  /*
   * `?token=` is deliberately NOT accepted.
   *
   * Query strings are written to proxy access logs, browser history and referrer headers,
   * so a token passed that way outlives the connection in places nobody is guarding. The
   * handshake auth payload and the Authorization header above both keep it out of the
   * URL, and every ABL client already uses one of them.
   */
  return null;
}

function stripBearer(value: string): string {
  return value.replace(/^Bearer\s+/i, '').trim();
}

/**
 * Namespace middleware: rejects the connection unless a valid access token is present
 * and that session has not been revoked.
 *
 * The revocation check matters more here than on HTTP: a socket authenticates once and
 * then stays open, so without it a deleted account could hold a live connection until
 * the process restarted.
 */
export async function socketAuthMiddleware(
  socket: Socket,
  next: (err?: ExtendedError) => void,
): Promise<void> {
  const token = extractSocketToken(socket);
  if (!token) {
    next(new Error('Authentication required'));
    return;
  }

  try {
    const user = verifyAccessToken(token);
    const { iat } = jwt.decode(token) as JwtPayload;

    if (await isSessionRevoked(user.userId, iat)) {
      next(new Error('Session has been revoked'));
      return;
    }

    socket.user = user;
    next();
  } catch {
    next(new Error('Invalid or expired token'));
  }
}
