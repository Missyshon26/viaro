import { describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import { useServer } from './server';
import { env } from '../src/config/env';
import { ROLES, type UserRole } from '../src/utils/roles';
import { MATRIX, PUBLIC, ANY_ROLE, type MatrixEntry } from './authorization.matrix';
import { MOUNTS, discoverRoutes, routeKey } from './routes';

/**
 * The authorization boundary, asserted end to end against the real Express app.
 *
 * Everything runs through the actual middleware chain, so this proves what the app does
 * rather than what the route files appear to say. No database is needed: authGuard and
 * roleGuard both reject before any controller runs, and a request that gets past them is
 * allowed to fail on the absent datastore — "not 403" is exactly the claim being made.
 */

const server = useServer(app);

const FORBIDDEN = 403;
const UNAUTHORIZED = 401;

/** A well-formed token for a role, signed with the same secret the app verifies with. */
function tokenFor(role: UserRole): string {
  return jwt.sign(
    { userId: '5f9d88b8b54764421b7156c9', role },
    env.JWT_ACCESS_SECRET,
    { expiresIn: '5m' },
  );
}

/** Concrete values for path params, so routing reaches the guard rather than 404ing. */
function concrete(path: string): string {
  return path
    .replace(/:driverId/g, '5f9d88b8b54764421b7156c9')
    .replace(/:jobId/g, 'job-1')
    .replace(/:flightNumber/g, 'AS1042')
    .replace(/:key/g, '0b8f7a3e-6d1c-4c52-9a43-1f2e3d4c5b6a.jpg')
    .replace(/:id/g, '5f9d88b8b54764421b7156c9');
}

function send(entry: MatrixEntry, token?: string) {
  const url = concrete(entry.path);
  const method = entry.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
  const req = request(server)[method](url);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req;
}

/**
 * Runs a matrix entry and reports the status the guards produced.
 *
 * A streaming route never ends its response, so awaiting it the ordinary way would hang
 * until the test timed out. For those the status is read off the response headers and
 * the connection is then torn down — by the time headers exist the guard chain has
 * already run, which is the only thing this file asserts.
 */
async function perform(entry: MatrixEntry, token?: string): Promise<{ status: number }> {
  if (!entry.streaming) return send(entry, token);

  const req = send(entry, token).buffer(false);

  return new Promise<{ status: number }>((resolve, reject) => {
    let settled = false;

    req.on('response', (res) => {
      settled = true;
      resolve({ status: res.status });

      /*
       * Tearing down an in-flight response raises ECONNRESET on the underlying socket,
       * and superagent has already handed off by the time 'response' fires — so the
       * error surfaces as an uncaught exception and Vitest reports it against the run.
       * Silencing it on the raw request is the only place it can be caught: aborting is
       * how this function is *supposed* to end, so the error carries no information.
       */
      const raw = (req as unknown as { req?: { on(e: string, cb: () => void): void } }).req;
      raw?.on('error', () => {});
      (res as unknown as { destroy?: () => void }).destroy?.();
      req.abort();
    });

    req.on('error', (err) => {
      if (!settled) reject(err);
    });

    req.end(() => {
      /* Errors and the response both arrive through the listeners above. */
    });
  });
}

const allowedRoles = (entry: MatrixEntry): UserRole[] => {
  if (entry.allowed === PUBLIC || entry.allowed === ANY_ROLE) return [...ROLES];
  return entry.allowed;
};

describe('authorization matrix', () => {
  describe.each(MATRIX)('$method $path', (entry) => {
    const permitted = allowedRoles(entry);
    const denied = ROLES.filter((role) => !permitted.includes(role));

    it.each(denied)('rejects %s with 403', async (role) => {
      const res = await perform(entry, tokenFor(role));
      expect(res.status).toBe(FORBIDDEN);
    });

    it.each(permitted)('lets %s past the guards', async (role) => {
      const res = await perform(entry, tokenFor(role));
      // Past the guard is the assertion — what happens next needs a database.
      expect(res.status).not.toBe(FORBIDDEN);

      // A PUBLIC route may still answer 401 for its own reasons — /payments/webhook
      // rejects an unsigned payload that way — and that is not a role decision.
      if (entry.allowed !== PUBLIC) {
        expect(res.status).not.toBe(UNAUTHORIZED);
      }
    });

    if (entry.allowed !== PUBLIC) {
      it('rejects an anonymous caller with 401', async () => {
        const res = await perform(entry);
        expect(res.status).toBe(UNAUTHORIZED);
      });
    }
  });
});

describe('token integrity', () => {
  const guarded = MATRIX.find((e) => e.allowed !== PUBLIC && e.allowed !== ANY_ROLE)!;

  it('rejects a token signed with the wrong secret', async () => {
    const forged = jwt.sign(
      { userId: '5f9d88b8b54764421b7156c9', role: 'admin' },
      'not-the-real-secret-but-long-enough-to-sign',
    );
    const res = await perform(guarded, forged);
    expect(res.status).toBe(UNAUTHORIZED);
  });

  it('rejects a token whose role claim is not a real role', async () => {
    const bogus = jwt.sign(
      { userId: '5f9d88b8b54764421b7156c9', role: 'superuser' },
      env.JWT_ACCESS_SECRET,
    );
    const res = await perform(guarded, bogus);
    expect(res.status).toBe(UNAUTHORIZED);
  });

  it('rejects an expired token', async () => {
    const expired = jwt.sign(
      { userId: '5f9d88b8b54764421b7156c9', role: 'admin' },
      env.JWT_ACCESS_SECRET,
      { expiresIn: '-1s' },
    );
    const res = await perform(guarded, expired);
    expect(res.status).toBe(UNAUTHORIZED);
  });
});

/**
 * The ratchet. Without these two checks the matrix above rots: a new endpoint would be
 * merged with nobody deciding who may call it, and the suite would still pass.
 */
describe('matrix covers the app exactly', () => {
  const declared = new Set(MATRIX.map((e) => routeKey(e.method, e.path)));
  const served = discoverRoutes();

  it('has an entry for every route the app serves', () => {
    const undeclared = served
      .map((r) => routeKey(r.method, r.path))
      .filter((key) => !declared.has(key))
      .sort();

    expect(
      undeclared,
      `These routes exist but nobody has declared who may call them. Add them to ` +
        `tests/authorization.matrix.ts:\n  ${undeclared.join('\n  ')}`,
    ).toEqual([]);
  });

  it('has no entry for a route that no longer exists', () => {
    const servedKeys = new Set(served.map((r) => routeKey(r.method, r.path)));
    const stale = [...declared].filter((key) => !servedKeys.has(key)).sort();

    expect(
      stale,
      `These matrix entries no longer match a real route:\n  ${stale.join('\n  ')}`,
    ).toEqual([]);
  });

  it('mirrors every router mounted in app.ts', () => {
    // Express 5 does not expose a mounted router's prefix, so tests/routes.ts declares
    // them. Counting the app's router layers catches a mount added without updating it.
    const mounted = (app as unknown as { router: { stack: { name: string }[] } }).router.stack
      .filter((layer) => layer.name === 'router').length;

    expect(
      mounted,
      'A router was mounted in src/app.ts that tests/routes.ts does not know about.',
    ).toBe(MOUNTS.length);
  });
});
