import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  findOne: vi.fn(),
  create: vi.fn(),
  sendGuestWelcome: vi.fn(),
}));

vi.mock('../src/models/User', async (orig) => {
  const actual = await orig<typeof import('../src/models/User')>();
  return { ...actual, User: Object.assign(actual.User, { findOne: mocks.findOne, create: mocks.create }) };
});
vi.mock('../src/modules/auth/auth.account.service', async (orig) => {
  const actual = await orig<typeof import('../src/modules/auth/auth.account.service')>();
  return { ...actual, sendGuestWelcome: mocks.sendGuestWelcome };
});
vi.mock('../src/modules/wallet/wallet.service', async (orig) => {
  const actual = await orig<typeof import('../src/modules/wallet/wallet.service')>();
  return { ...actual, getOrCreateWallet: vi.fn(async () => ({ _id: 'wallet1' })) };
});

import app from '../src/app';
import { useServer } from './server';

const server = useServer(app);

const valid = { name: 'Sam Guest', email: 'Sam@Example.com', phone: '+12065550148' };

describe('POST /auth/guest', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['missing name', { ...valid, name: '' }],
    ['bad email', { ...valid, email: 'nope' }],
    ['short phone', { ...valid, phone: '123' }],
  ])('rejects %s with 400', async (_label, body) => {
    const res = await request(server).post('/auth/guest').send(body);
    expect(res.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('refuses an email that already has an account with 409 ACCOUNT_EXISTS', async () => {
    mocks.findOne.mockReturnValue({ lean: async () => ({ _id: 'u1' }) });
    const res = await request(server).post('/auth/guest').send(valid);
    expect(res.status).toBe(409);
    expect(res.body.details).toMatchObject({ code: 'ACCOUNT_EXISTS' });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('creates a tagged customer, sends the set-password email and returns tokens', async () => {
    mocks.findOne.mockReturnValue({ lean: async () => null });
    const doc = {
      _id: 'u2',
      role: 'customer',
      save: vi.fn(),
      toJSON: () => ({ _id: 'u2', email: 'sam@example.com', isGuest: true }),
    };
    mocks.create.mockResolvedValue(doc);

    const res = await request(server).post('/auth/guest').send(valid);

    expect(res.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'customer', email: 'sam@example.com', isGuest: true }),
    );
    expect(mocks.sendGuestWelcome).toHaveBeenCalledOnce();
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
  });
});
