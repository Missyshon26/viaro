import { describe, expect, it, beforeEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { createRateLimiter } from '../src/middlewares/rateLimiter';
import { redis } from '../src/config/redis';
import { ApiError } from '../src/utils/ApiError';

/**
 * What the limiter does when Redis cannot answer.
 *
 * The general limiter is a guard rail and fails open on purpose — a Redis blip must not
 * take the API down. The auth limiter is the brute-force control, and failing open there
 * hands an attacker unlimited password attempts for as long as Redis is slow. This
 * asserts the difference, because it is invisible on the healthy path.
 */

function call(handler: ReturnType<typeof createRateLimiter>, ip = '203.0.113.9') {
  const req = { ip, headers: {}, user: undefined } as unknown as Request;
  const res = { setHeader() {} } as unknown as Response;

  return new Promise<unknown>((resolve) => {
    const next: NextFunction = (err?: unknown) => resolve(err);
    void handler(req, res, next);
  });
}

/** Puts the stubbed client into a state the limiter treats as unavailable. */
function withRedisDown(run: () => Promise<void>) {
  const client = redis as unknown as { status: string };
  const original = client.status;
  client.status = 'connecting';
  return run().finally(() => {
    client.status = original;
  });
}

describe('rate limiter with Redis unavailable', () => {
  it('lets everything through when no fallback is configured', async () => {
    const limiter = createRateLimiter({ max: 2, keyPrefix: 'test:open', windowMs: 60_000 });

    await withRedisDown(async () => {
      for (let i = 0; i < 6; i += 1) {
        expect(await call(limiter, '198.51.100.1')).toBeUndefined();
      }
    });
  });

  it('still enforces a limit when the fallback is on', async () => {
    const limiter = createRateLimiter({
      max: 3,
      keyPrefix: 'test:auth',
      windowMs: 60_000,
      fallbackWhenUnavailable: true,
    });

    await withRedisDown(async () => {
      const ip = '198.51.100.2';
      for (let i = 0; i < 3; i += 1) {
        expect(await call(limiter, ip)).toBeUndefined();
      }

      const blocked = await call(limiter, ip);
      expect(blocked).toBeInstanceOf(ApiError);
      expect((blocked as ApiError).statusCode).toBe(429);
    });
  });

  it('counts each caller separately', async () => {
    const limiter = createRateLimiter({
      max: 1,
      keyPrefix: 'test:perkey',
      windowMs: 60_000,
      fallbackWhenUnavailable: true,
    });

    await withRedisDown(async () => {
      expect(await call(limiter, '198.51.100.3')).toBeUndefined();
      expect(await call(limiter, '198.51.100.4')).toBeUndefined();

      // Second attempt from the first caller, not the second, is what trips.
      expect(await call(limiter, '198.51.100.3')).toBeInstanceOf(ApiError);
    });
  });

  it('forgets a caller once their window has passed', async () => {
    const limiter = createRateLimiter({
      max: 1,
      keyPrefix: 'test:window',
      // Expires between the two calls below without needing a timer.
      windowMs: 1,
      fallbackWhenUnavailable: true,
    });

    await withRedisDown(async () => {
      const ip = '198.51.100.5';
      expect(await call(limiter, ip)).toBeUndefined();
      await new Promise((r) => setTimeout(r, 5));
      expect(await call(limiter, ip)).toBeUndefined();
    });
  });
});
