import { describe, expect, it } from 'vitest';
import os from 'node:os';
import { env, uploadDir } from '../src/config/env';

/**
 * A guard on the test environment itself. If a suite ever runs against a real database,
 * a live Stripe account or a real mail server, this fails first and says why.
 */
describe('the test environment is sealed off', () => {
  it('uses only local datastores', () => {
    expect(env.MONGO_URI).toMatch(/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/);
    expect(env.MONGO_URI).not.toContain('mongodb.net');
    expect(env.REDIS_URL).toMatch(/^redis:\/\/(127\.0\.0\.1|localhost)[:/]/);
  });

  it('cannot take a payment, send an email, text, or push, or look up a real flight', () => {
    expect(env.PAYMENT_GATEWAY_PROVIDER || '').toBe('');
    expect(env.PAYMENT_GATEWAY_SECRET_KEY || '').toBe('');
    expect(env.SMTP_HOST || '').toBe('');
    expect(env.SMTP_USER || '').toBe('');
    expect(env.SMS_PUSH_PROVIDER || '').toBe('');
    expect(env.FLIGHT_API_PROVIDER || '').toBe('');
    expect(env.S3_BUCKET || '').toBe('');
  });

  it('writes uploads to a throwaway folder, never into the project', () => {
    expect(uploadDir.startsWith(os.tmpdir())).toBe(true);
    expect(uploadDir).toContain('abl-test-uploads-');
  });

  it('runs as the test environment', () => {
    expect(env.NODE_ENV).toBe('test');
  });
});
