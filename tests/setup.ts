import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';
import mongoose from 'mongoose';

/**
 * Hermetic test environment: no Mongo, no Redis, no network.
 *
 * The authorization suite exercises the middleware chain — authGuard and roleGuard both
 * run and reject *before* any controller touches a database, so a real datastore would
 * add minutes of setup to prove nothing extra. Requests that get past the guards are
 * allowed to fail on the missing database; the suite asserts "not 403", which is
 * precisely the claim being made.
 */

// Required by config/env's schema validation at import time.
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-chars-long';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-chars-long';


/*
 * Tests must never reach a real service.
 *
 * config/env loads the developer's `.env`, and dotenv only fills in what is not already
 * set — so anything this file does not set is taken from that file. With real credentials
 * there, the suites were running with Stripe switched on and SMTP configured, and a test
 * that sent a welcome email would have sent a REAL one. The datastores were safe only
 * because they happen to be set above.
 *
 * So every integration is set here, unconditionally and BEFORE env is imported: local
 * stand-ins for the datastores (assigned, not defaulted, so a shell variable pointing at
 * a real database cannot win either), and nothing at all for payments, mail, SMS, push,
 * storage and flight data — each of which then behaves as "not configured".
 */
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/abl-test';
// Uploaded images go to a throwaway folder, never into the project's own ./uploads.
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'abl-test-uploads-'));
process.env.PUBLIC_API_URL = 'http://api.test';
// The authorization matrix fires several hundred requests from one caller; the production
// default (300/min) would answer the tail of it with 429. Set here so the suite does not
// depend on whatever a developer's own .env raises it to.
process.env.API_RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '100000';
process.env.REDIS_URL = 'redis://127.0.0.1:6379';
for (const key of [
  'PAYMENT_GATEWAY_PROVIDER',
  'PAYMENT_GATEWAY_SECRET_KEY',
  'PAYMENT_GATEWAY_WEBHOOK_SECRET',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASS',
  'SMS_PUSH_PROVIDER',
  'SMS_PUSH_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_FROM_NUMBER',
  'FCM_PROJECT_ID',
  'FCM_ACCESS_TOKEN',
  'S3_BUCKET',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'FLIGHT_API_PROVIDER',
  'FLIGHT_API_KEY',
  // Never measure a route with a real key in a test.
  'GOOGLE_MAPS_SERVER_KEY',
]) {
  process.env[key] = '';
}
// These two are validated as a number and as 'true' | 'false', so blank is not accepted;
// with no host, user or password above, mail is "not configured" whatever they say.
process.env.SMTP_PORT = '587';
process.env.SMTP_SECURE = 'false';

/**
 * Without this, a query with no connection sits in mongoose's buffer until it times out
 * (10s by default), so every allowed-role request would stall. Failing immediately turns
 * those into a fast 500, which the suite treats as "the guard let me through".
 */
mongoose.set('bufferCommands', false);

/**
 * ioredis stub. Only the handful of commands the request path uses are implemented —
 * `get` returns null so isSessionRevoked() reports "not revoked", which is the correct
 * default for a token that was just minted.
 */
vi.mock('ioredis', () => {
  class RedisMock {
    status = 'ready';
    private store = new Map<string, string>();

    async get(key: string) {
      return this.store.get(key) ?? null;
    }
    async set(key: string, value: string) {
      this.store.set(key, value);
      return 'OK';
    }
    async del(...keys: string[]) {
      let removed = 0;
      for (const key of keys) if (this.store.delete(key)) removed += 1;
      return removed;
    }
    async exists(key: string) {
      return this.store.has(key) ? 1 : 0;
    }
    async incr(key: string) {
      const next = Number(this.store.get(key) ?? 0) + 1;
      this.store.set(key, String(next));
      return next;
    }
    async expire() {
      return 1;
    }
    async pexpire() {
      return 1;
    }
    async quit() {
      return 'OK';
    }
    async connect() {
      return this;
    }
    on() {
      return this;
    }
    async call() {
      return null;
    }

    /**
     * The rate limiter issues `multi().incr(key).pexpire(key, ms).exec()`. Without a
     * working pipeline it waits out its 250ms fail-open timeout on *every* request,
     * which quietly turned the suite into a four-minute run.
     */
    multi() {
      const ops: (() => unknown)[] = [];
      const chain = {
        incr: (key: string) => {
          ops.push(() => this.incr(key));
          return chain;
        },
        pexpire: () => {
          ops.push(() => 1);
          return chain;
        },
        exec: async () => {
          const results: [null, unknown][] = [];
          for (const op of ops) results.push([null, await op()]);
          return results;
        },
      };
      return chain;
    }
  }

  return { Redis: RedisMock, default: RedisMock };
});

/**
 * BullMQ talks to Redis with blocking commands the stub above cannot serve, so the
 * report-export routes would hang until the test timed out. The queue is an external
 * boundary; the guard in front of it is what this suite is testing.
 */
vi.mock('bullmq', () => {
  class Queue {
    async add() {
      return { id: 'test-job-1' };
    }
    async getJob() {
      return null;
    }
    async close() {}
    on() {
      return this;
    }
  }

  class Worker {
    async close() {}
    on() {
      return this;
    }
  }

  class QueueEvents {
    async close() {}
    on() {
      return this;
    }
  }

  return { Queue, Worker, QueueEvents };
});
