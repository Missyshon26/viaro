import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { User } from '../../src/models/User';
import { Wallet } from '../../src/models/Wallet';
import { ApiError } from '../../src/utils/ApiError';
import * as google from '../../src/integrations/googleAuth';
import { listen, makeUser, resetData, seedCatalogue, startDatabase, stopDatabase } from './harness';

vi.mock('../../src/integrations/googleAuth', () => ({
  verifyGoogleCredential: vi.fn(),
  isGoogleSignInEnabled: () => true,
}));
vi.mock('../../src/modules/notifications/notification.emails', async (orig) => ({
  ...(await orig<typeof import('../../src/modules/notifications/notification.emails')>()),
  sendWelcomeEmail: vi.fn(async () => undefined),
}));

const http = listen(app);
const server = http.server;
const verify = vi.mocked(google.verifyGoogleCredential);

beforeAll(async () => {
  await startDatabase();
  await seedCatalogue();
});
afterAll(async () => {
  await http.close();
  await stopDatabase();
});
beforeEach(async () => {
  await resetData();
  verify.mockReset();
});

const CREDENTIAL = 'x'.repeat(40);
const profile = (over: Record<string, unknown> = {}) => ({
  sub: 'google-sub-1',
  email: 'rider@gmail.com',
  emailVerified: true,
  name: 'Riley Rider',
  givenName: 'Riley',
  familyName: 'Rider',
  ...over,
});
const signIn = (body: Record<string, unknown> = {}) =>
  request(server).post('/auth/google').send({ credential: CREDENTIAL, ...body });

describe('POST /auth/google', () => {
  it('asks for a phone number before creating an account for a new Google user', async () => {
    verify.mockResolvedValue(profile());
    const res = await signIn();
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'needs_phone', profile: { email: 'rider@gmail.com', name: 'Riley Rider' } });
    expect(res.body.data.accessToken).toBeUndefined();
    expect(await User.countDocuments()).toBe(0);
  });

  it('creates the account once a phone is given, with a wallet and working tokens', async () => {
    verify.mockResolvedValue(profile());
    const res = await signIn({ phone: '+12065550123' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('signed_in');
    expect(res.body.data.role).toBe('customer');

    const user = await User.findOne({ email: 'rider@gmail.com' });
    expect(user).toMatchObject({ googleId: 'google-sub-1', firstName: 'Riley', lastName: 'Rider', phone: '+12065550123', isGuest: false });
    expect(await Wallet.countDocuments({ ownerId: user!._id })).toBe(1);

    const me = await request(server).get('/users/me').set('Authorization', `Bearer ${res.body.data.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe('rider@gmail.com');
  });

  it('signs in again with the same Google account, even if the email changed', async () => {
    verify.mockResolvedValue(profile());
    await signIn({ phone: '+12065550123' });
    verify.mockResolvedValue(profile({ email: 'new-address@gmail.com' }));
    const res = await signIn();
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('signed_in');
    expect(await User.countDocuments()).toBe(1);
  });

  it('links an existing account that has the same verified email', async () => {
    const existing = await makeUser('customer', { email: 'rider@gmail.com' });
    verify.mockResolvedValue(profile());
    const res = await signIn();
    expect(res.status).toBe(200);
    expect(res.body.data.user._id ?? res.body.data.user.id).toBe(existing.id);
    expect((await User.findById(existing.id))!.googleId).toBe('google-sub-1');
    expect(await User.countDocuments()).toBe(1);
  });

  it('turns a guest account into a normal one when its owner proves the email', async () => {
    const guest = await makeUser('customer', { email: 'rider@gmail.com', isGuest: true });
    verify.mockResolvedValue(profile());
    expect((await signIn()).status).toBe(200);
    expect((await User.findById(guest.id))!.isGuest).toBe(false);
  });

  it('refuses an unverified Google email', async () => {
    verify.mockResolvedValue(profile({ emailVerified: false }));
    expect((await signIn({ phone: '+12065550123' })).status).toBe(401);
    expect(await User.countDocuments()).toBe(0);
  });

  it('does not open staff accounts, suspended accounts or another Google identity', async () => {
    await makeUser('admin', { email: 'staff@gmail.com' });
    verify.mockResolvedValue(profile({ email: 'staff@gmail.com' }));
    expect((await signIn()).status).toBe(403);

    await makeUser('customer', { email: 'banned@gmail.com', status: 'suspended' });
    verify.mockResolvedValue(profile({ sub: 's2', email: 'banned@gmail.com' }));
    expect((await signIn()).status).toBe(403);

    await makeUser('customer', { email: 'taken@gmail.com', googleId: 'someone-else' });
    verify.mockResolvedValue(profile({ sub: 's3', email: 'taken@gmail.com' }));
    expect((await signIn()).status).toBe(403);
  });

  it('passes a failed token check straight back', async () => {
    verify.mockRejectedValue(ApiError.unauthorized('Google could not confirm that sign-in. Please try again.'));
    const res = await signIn();
    expect(res.status).toBe(401);
    expect(await User.countDocuments()).toBe(0);
  });

  it('rejects a malformed request', async () => {
    expect((await request(server).post('/auth/google').send({})).status).toBe(400);
    expect((await signIn({ phone: '12' })).status).toBe(400);
  });
});
