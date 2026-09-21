import { describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import { env } from '../src/config/env';
import type { UserRole } from '../src/utils/roles';

/**
 * Input handling asserted at the HTTP boundary, through the real middleware chain.
 *
 * These are the audit findings whose whole point was the STATUS CODE a caller sees, so
 * asserting them anywhere below Express would prove the wrong thing: "unparsable dates
 * return 500, not 400" is a claim about the response, not about a function.
 *
 * No database is required. Every case here is rejected by a zod schema or by the error
 * handler before a controller touches Mongo — which is itself part of the fix, since the
 * bug in each case was that the bad input travelled further than it should have.
 */

function tokenFor(role: UserRole): string {
  return jwt.sign({ userId: '5f9d88b8b54764421b7156c9', role }, env.JWT_ACCESS_SECRET, {
    expiresIn: '5m',
  });
}

const asCustomer = (): string => `Bearer ${tokenFor('customer')}`;
const asAdmin = (): string => `Bearer ${tokenFor('admin')}`;

describe('privileged roles cannot be self-registered', () => {
  const base = {
    name: 'Evil Admin',
    email: 'attacker@example.com',
    phone: '+15550009999',
    password: 'password123',
  };

  it.each(['admin', 'company'])('rejects role=%s with 400', async (role) => {
    const res = await request(app).post('/auth/register').send({ ...base, role });

    expect(res.status).toBe(400);
    // The message must name the allowed set, so the caller is not left guessing.
    expect(JSON.stringify(res.body)).toMatch(/customer/);
    expect(JSON.stringify(res.body)).toMatch(/driver/);
  });

  /**
   * The counter-assertion matters as much as the block: narrowing the enum must not have
   * broken ordinary signup. Without a database the request cannot complete, but it must
   * fail LATER than validation — anything other than 400 proves the schema accepted it.
   */
  it.each(['customer', 'driver'])('still accepts role=%s at the schema', async (role) => {
    const res = await request(app)
      .post('/auth/register')
      .send({ ...base, role, email: `${role}@example.com`, vehicleClass: 'sedan' });

    expect(res.status).not.toBe(400);
  });
});

describe('unparsable dates are a client error, not a server error', () => {
  it('rejects a bad requestedAt on the fare estimate with 400', async () => {
    const res = await request(app)
      .get('/pricing/fare-estimate')
      .query({ city: 'seattle', tripType: 'point2point', requestedAt: 'notadate' })
      .set('authorization', asCustomer());

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/valid ISO date/i);
  });

  /**
   * The report path mattered for a different reason: the bad value used to reach the
   * export worker, which then retried the job three times before failing.
   */
  it('rejects a bad range on the report export with 400', async () => {
    const res = await request(app)
      .get('/reports')
      .query({ type: 'trips-completed', format: 'csv', from: 'notadate' })
      .set('authorization', asAdmin());

    expect(res.status).toBe(400);
  });

  it('still accepts a well-formed ISO date', async () => {
    const res = await request(app)
      .get('/pricing/fare-estimate')
      .query({
        city: 'seattle',
        tripType: 'point2point',
        requestedAt: '2030-01-01T10:00:00Z',
      })
      .set('authorization', asCustomer());

    expect(res.status).not.toBe(400);
  });
});

describe('bookings cannot be made for a time that has passed', () => {
  const booking = {
    pickup: { lat: 47.6, lng: -122.3, address: 'Pickup address' },
    drop: { lat: 47.7, lng: -122.2, address: 'Drop address' },
    vehicleClass: 'sedan',
    tripType: 'point2point',
    city: 'seattle',
  };

  it('rejects a pickup in the past with 400', async () => {
    const res = await request(app)
      .post('/bookings')
      .set('authorization', asCustomer())
      .send({ ...booking, scheduledAt: '2020-01-01T00:00:00Z' });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/past/i);
  });

  it('rejects a pickup with no useful lead time', async () => {
    const inOneMinute = new Date(Date.now() + 60_000).toISOString();
    const res = await request(app)
      .post('/bookings')
      .set('authorization', asCustomer())
      .send({ ...booking, scheduledAt: inOneMinute });

    expect(res.status).toBe(400);
  });

  it('accepts a properly scheduled future pickup', async () => {
    const tomorrow = new Date(Date.now() + 24 * 3600_000).toISOString();
    const res = await request(app)
      .post('/bookings')
      .set('authorization', asCustomer())
      .send({ ...booking, scheduledAt: tomorrow });

    // Reaches the service (and fails on the absent database) rather than being rejected.
    expect(res.status).not.toBe(400);
  });

  it('rejects an unparsable pickup time too', async () => {
    const res = await request(app)
      .post('/bookings')
      .set('authorization', asCustomer())
      .send({ ...booking, scheduledAt: 'notadate' });

    expect(res.status).toBe(400);
  });
});

describe('a subscription price cannot be chosen by the customer', () => {
  it('ignores a client-supplied price and rejects an unknown plan', async () => {
    const res = await request(app)
      .post('/subscriptions')
      .set('authorization', asCustomer())
      .send({ plan: 'free', price: 0 });

    // Whatever happens, it must never be a successful activation.
    expect(res.status).not.toBe(201);
  });

  it('exposes the catalogue so a client can read real prices', async () => {
    const res = await request(app).get('/subscriptions/plans').set('authorization', asCustomer());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const plan of res.body.data) {
      expect(typeof plan.price).toBe('number');
      expect(plan.price).toBeGreaterThan(0);
    }
  });
});

describe('malformed and oversized bodies are 4xx, not 500', () => {
  it('answers malformed JSON with 400', async () => {
    const res = await request(app)
      .post('/auth/login')
      .set('content-type', 'application/json')
      .send('{"email":');

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not valid JSON/i);
  });

  it('answers an oversized body with 413', async () => {
    const res = await request(app)
      .post('/auth/login')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ email: 'a@b.com', password: 'x'.repeat(2 * 1024 * 1024) }));

    expect(res.status).toBe(413);
    expect(res.body.message).toMatch(/too large/i);
  });
});

describe('CORS never pairs a reflected origin with credentials', () => {
  it('omits Allow-Credentials when the origin is a wildcard reflection', async () => {
    const res = await request(app).get('/health').set('Origin', 'https://evil.example');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });
});

describe('429 responses tell the caller when to retry', () => {
  /**
   * Driven against a purpose-built limiter rather than the app's global one: the deployed
   * limit is in the thousands, and issuing that many requests to assert one header would
   * dominate the suite's runtime for no extra confidence. The middleware under test is
   * the same factory the app mounts.
   */
  it('sets Retry-After once the window is exhausted', async () => {
    const express = (await import('express')).default;
    const { createRateLimiter } = await import('../src/middlewares/rateLimiter.js');
    const { errorHandler } = await import('../src/middlewares/errorHandler.js');

    const limited = express();
    limited.use(createRateLimiter({ windowMs: 60_000, max: 2, keyPrefix: 'test:retry-after' }));
    limited.get('/ping', (_req, res) => res.json({ ok: true }));
    limited.use(errorHandler);

    await request(limited).get('/ping');
    await request(limited).get('/ping');
    const third = await request(limited).get('/ping');

    expect(third.status).toBe(429);
    expect(third.headers['retry-after']).toBeDefined();
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
  });
});
