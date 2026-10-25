import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import { useServer } from './server';
import { env } from '../src/config/env';
import {
  clearRevocation,
  parseDurationSeconds,
  revokeUserSessions,
} from '../src/modules/auth/revocation';

const server = useServer(app);

/**
 * Session revocation — the hole this closes: a suspended or deleted account's access
 * token stayed cryptographically valid for the rest of its 15 minutes, because
 * authGuard only verified the signature.
 */
const USER_ID = '5f9d88b8b54764421b7156c9';
const ROUTE = '/users/me';

/** `iat` is in whole seconds, so tokens must be aged explicitly to beat the cutoff. */
function tokenIssuedSecondsAgo(seconds: number): string {
  const iat = Math.floor(Date.now() / 1000) - seconds;
  return jwt.sign({ userId: USER_ID, role: 'customer', iat }, env.JWT_ACCESS_SECRET, {
    expiresIn: '15m',
  });
}

const call = (token: string) =>
  request(server).get(ROUTE).set('Authorization', `Bearer ${token}`);

describe('session revocation', () => {
  beforeEach(async () => {
    await clearRevocation(USER_ID);
  });

  it('accepts a valid token when nothing has been revoked', async () => {
    const res = await call(tokenIssuedSecondsAgo(30));
    expect(res.status).not.toBe(401);
  });

  it('rejects a token issued before the revocation cutoff', async () => {
    const token = tokenIssuedSecondsAgo(30);
    await revokeUserSessions(USER_ID);

    const res = await call(token);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/revoked/i);
  });

  it('accepts a token issued after the cutoff, so signing back in works', async () => {
    await revokeUserSessions(USER_ID);
    // Issued "now", i.e. at or after the cutoff second.
    const res = await call(tokenIssuedSecondsAgo(0));
    expect(res.status).not.toBe(401);
  });

  it('does not revoke a different user', async () => {
    await revokeUserSessions('000000000000000000000000');
    const res = await call(tokenIssuedSecondsAgo(30));
    expect(res.status).not.toBe(401);
  });
});

describe('parseDurationSeconds', () => {
  it.each([
    ['15m', 900],
    ['30d', 2_592_000],
    ['2h', 7200],
    ['45s', 45],
    ['900', 900],
  ])('parses %s', (input, expected) => {
    expect(parseDurationSeconds(input)).toBe(expected);
  });

  it('falls back when the format is not recognised', () => {
    expect(parseDurationSeconds('not-a-duration', 60)).toBe(60);
  });
});
