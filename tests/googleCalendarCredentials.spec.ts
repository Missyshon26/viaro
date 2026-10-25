import { describe, expect, it } from 'vitest';
import { readCredentials } from '../src/integrations/googleCalendar';

const key = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'service_account', client_email: 'abl-calendar@proj.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n', ...over });

describe('reading the service account key', () => {
  it('accepts the downloaded key as it is', () => {
    const r = readCredentials(key());
    expect(r).toMatchObject({ ok: true, value: { client_email: 'abl-calendar@proj.iam.gserviceaccount.com' } });
  });

  it('repairs a private key whose line breaks arrived as the two characters \\n', () => {
    const pasted = key({ private_key: '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n' }).replace(/\\\\n/g, '\\\\n');
    const r = readCredentials(pasted);
    expect(r.ok && r.value.private_key).toContain('\n');
    expect(r.ok && r.value.private_key.startsWith('-----BEGIN PRIVATE KEY-----\nABC')).toBe(true);
  });

  it('says what is wrong rather than failing quietly', () => {
    expect(readCredentials(undefined)).toEqual({ ok: false, reason: 'GOOGLE_SERVICE_ACCOUNT_JSON is not set' });
    expect(readCredentials('   ')).toMatchObject({ ok: false });
    expect(readCredentials('{not json')).toEqual({ ok: false, reason: 'GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON' });
    expect(readCredentials(key({ client_email: undefined }))).toMatchObject({ ok: false, reason: expect.stringContaining('client_email') });
    expect(readCredentials(key({ private_key: '' }))).toMatchObject({ ok: false });
  });
});
