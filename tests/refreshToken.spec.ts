import { beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

const mocks = vi.hoisted(() => ({ findById: vi.fn() }));

vi.mock('../src/models/User', async (orig) => {
  const actual = await orig<typeof import('../src/models/User')>();
  return {
    ...actual,
    User: Object.assign(actual.User, {
      findById: () => ({ lean: async () => mocks.findById() }),
    }),
  };
});

import { env } from '../src/config/env';
import { issueTokens, refresh } from '../src/modules/auth/auth.service';
import { clearRevocation, revokeUserSessions } from '../src/modules/auth/revocation';

const USER_ID = '5f9d88b8b54764421b7156c9';

/** A refresh token as it would have been issued `seconds` ago. */
function refreshTokenIssuedSecondsAgo(seconds: number): string {
  const iat = Math.floor(Date.now() / 1000) - seconds;
  return jwt.sign({ userId: USER_ID, role: 'customer', iat }, env.JWT_REFRESH_SECRET, {
    expiresIn: '7d',
    jwtid: `jti-${Math.random()}`,
  });
}

describe('refresh token rotation', () => {
  beforeEach(async () => {
    mocks.findById.mockReset().mockReturnValue({ _id: USER_ID, role: 'customer', status: 'active' });
    await clearRevocation(USER_ID);
  });

  it('rotates a valid token and refuses a replay of the spent one', async () => {
    const { refreshToken } = issueTokens(USER_ID, 'customer');

    await expect(refresh(refreshToken)).resolves.toHaveProperty('accessToken');
    await expect(refresh(refreshToken)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('lets only one of two concurrent refreshes with the same token succeed', async () => {
    const { refreshToken } = issueTokens(USER_ID, 'customer');

    const results = await Promise.allSettled([refresh(refreshToken), refresh(refreshToken)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('rejects a refresh token issued before the account was revoked', async () => {
    const stale = refreshTokenIssuedSecondsAgo(60);
    await revokeUserSessions(USER_ID);

    await expect(refresh(stale)).rejects.toMatchObject({ statusCode: 401 });
  });
});
