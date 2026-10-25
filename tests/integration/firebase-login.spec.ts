import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import app from '../../src/app';
import { User } from '../../src/models/User';
import * as firebase from '../../src/integrations/firebasePassword';
import { listen, resetData, startDatabase, stopDatabase } from './harness';

vi.mock('../../src/integrations/firebasePassword', () => ({
  verifyFirebasePassword: vi.fn(),
  isFirebaseLoginEnabled: () => true,
}));

const http = listen(app);
const server = http.server;
const verify = vi.mocked(firebase.verifyFirebasePassword);

beforeAll(startDatabase);
afterAll(async () => {
  await http.close();
  await stopDatabase();
});
beforeEach(async () => {
  await resetData();
  verify.mockReset();
});

/** A customer as the history import leaves them: no usable password here yet. */
async function legacyCustomer(over: Record<string, unknown> = {}) {
  return User.create({
    role: 'customer',
    name: 'Old Customer',
    email: 'old@example.com',
    phone: '+12065550100',
    passwordHash: await bcrypt.hash('unusable-random-value', 4),
    firebaseUid: 'fb-uid-1',
    legacyAuth: 'firebase',
    ...over,
  });
}
const login = (password: string, email = 'old@example.com') =>
  request(server).post('/auth/login').send({ email, password });

describe('login for customers carried over from the old Firebase project', () => {
  it('accepts the old password once Firebase confirms it, and stores it here', async () => {
    await legacyCustomer();
    verify.mockResolvedValue({ ok: true, uid: 'fb-uid-1' });

    const res = await login('OldPassw0rd!');
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();

    const stored = await User.findOne({ email: 'old@example.com' }).select('+passwordHash');
    expect(stored?.legacyAuth).toBeUndefined();
    expect(await bcrypt.compare('OldPassw0rd!', stored!.passwordHash)).toBe(true);
  });

  it('never asks Firebase again after the first login', async () => {
    await legacyCustomer();
    verify.mockResolvedValue({ ok: true, uid: 'fb-uid-1' });
    await login('OldPassw0rd!');
    verify.mockClear();

    expect((await login('OldPassw0rd!')).status).toBe(200);
    expect(verify).not.toHaveBeenCalled();
  });

  it('refuses a wrong password and leaves the account flagged', async () => {
    await legacyCustomer();
    verify.mockResolvedValue({ ok: false, reason: 'wrong_password' });

    expect((await login('nope')).status).toBe(401);
    expect((await User.findOne({ email: 'old@example.com' }))?.legacyAuth).toBe('firebase');
  });

  it('refuses sign-in (not a crash) when Firebase cannot be reached', async () => {
    await legacyCustomer();
    verify.mockResolvedValue({ ok: false, reason: 'unavailable' });
    expect((await login('OldPassw0rd!')).status).toBe(401);
  });

  it('does not consult Firebase for ordinary accounts', async () => {
    await legacyCustomer({ email: 'new@example.com', legacyAuth: undefined, firebaseUid: undefined });
    expect((await login('whatever', 'new@example.com')).status).toBe(401);
    expect(verify).not.toHaveBeenCalled();
  });

  it('still blocks a suspended account even when Firebase agrees', async () => {
    await legacyCustomer({ status: 'suspended' });
    verify.mockResolvedValue({ ok: true, uid: 'fb-uid-1' });
    expect((await login('OldPassw0rd!')).status).toBe(403);
  });
});
