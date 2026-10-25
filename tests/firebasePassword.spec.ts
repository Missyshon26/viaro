import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/env', () => ({ env: { FIREBASE_WEB_API_KEY: 'web-key' } }));
import { verifyFirebasePassword } from '../src/integrations/firebasePassword';

const reply = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('verifyFirebasePassword', () => {
  it('returns the Firebase uid on success', async () => {
    const f = reply(200, { localId: 'uid-9' });
    expect(await verifyFirebasePassword('a@b.com', 'pw', f)).toEqual({ ok: true, uid: 'uid-9' });
    const [url, init] = vi.mocked(f).mock.calls[0]!;
    expect(String(url)).toContain('key=web-key');
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ email: 'a@b.com', password: 'pw' });
  });

  it.each(['INVALID_PASSWORD', 'INVALID_LOGIN_CREDENTIALS', 'EMAIL_NOT_FOUND', 'USER_DISABLED'])(
    'treats %s as a wrong password',
    async (message) => {
      expect(await verifyFirebasePassword('a@b.com', 'pw', reply(400, { error: { message } }))).toEqual({
        ok: false,
        reason: 'wrong_password',
      });
    },
  );

  it('reports unavailable on server errors, odd replies and network failure', async () => {
    expect(await verifyFirebasePassword('a@b.com', 'pw', reply(503, {}))).toEqual({ ok: false, reason: 'unavailable' });
    expect(await verifyFirebasePassword('a@b.com', 'pw', reply(200, {}))).toEqual({ ok: false, reason: 'unavailable' });
    const boom = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await verifyFirebasePassword('a@b.com', 'pw', boom)).toEqual({ ok: false, reason: 'unavailable' });
  });
});
