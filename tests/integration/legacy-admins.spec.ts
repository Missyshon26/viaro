import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import app from '../../src/app';
import { User } from '../../src/models/User';
import { importLegacyAdmins } from '../../src/modules/migration/legacy.admins';
import { listen, resetData, startDatabase, stopDatabase } from './harness';

const http = listen(app);
const server = http.server;

beforeAll(startDatabase);
afterAll(async () => {
  await http.close();
  await stopDatabase();
});

const legacy = () => mongoose.connection.collection('legacy_users');

beforeEach(async () => {
  await resetData();
  await legacy().deleteMany({});
  await legacy().insertMany([
    { userName: 'All_black_admin', emailId: '-', designation: 'Admin', status: 'Live', password: await bcrypt.hash('Old-Admin-Pw1', 4) },
    { userName: 'Mahi', emailId: 'mahi@example.com', designation: 'Admin', status: 'Live', password: await bcrypt.hash('Mahi-Pw-2', 4) },
    { userName: 'Broken', emailId: 'b@example.com', designation: 'Admin', status: 'Live', password: 'not-a-hash' },
    { userName: 'Driver1', emailId: 'd@example.com', designation: 'Driver', status: 'Live', password: await bcrypt.hash('Driver-Pw-3', 4) },
  ]);
});

const login = (identifier: string, password: string) => request(server).post('/auth/login').send({ email: identifier, password });

describe('importing the old admins', () => {
  it('a dry run writes nothing', async () => {
    const lines = await importLegacyAdmins({ apply: false });
    expect(lines.filter((l) => l.outcome === 'would-create').map((l) => l.username).sort()).toEqual(['all_black_admin', 'mahi']);
    expect(await User.countDocuments()).toBe(0);
  });

  it('creates the admins, skips bad rows and drivers, and is safe to run twice', async () => {
    const first = await importLegacyAdmins({ apply: true });
    expect(first.filter((l) => l.outcome === 'created')).toHaveLength(2);
    expect(first.find((l) => l.username === 'broken')).toMatchObject({ outcome: 'skipped' });
    expect(first.find((l) => l.username === 'driver1')).toBeUndefined();
    expect(await User.countDocuments({ role: 'admin' })).toBe(2);

    const second = await importLegacyAdmins({ apply: true });
    expect(second.every((l) => l.outcome === 'skipped')).toBe(true);
    expect(await User.countDocuments({ role: 'admin' })).toBe(2);
  });

  it('lets an admin with no email sign in by username, in any letter case, with the OLD password', async () => {
    await importLegacyAdmins({ apply: true });
    for (const typed of ['All_black_admin', 'all_black_admin', 'ALL_BLACK_ADMIN']) {
      const res = await login(typed, 'Old-Admin-Pw1');
      expect(res.status).toBe(200);
      expect(res.body.data.role).toBe('admin');
      expect(res.body.data.accessToken).toBeTruthy();
    }
    expect((await login('All_black_admin', 'wrong')).status).toBe(401);
  });

  it('lets an admin who has an email sign in by either username or email', async () => {
    await importLegacyAdmins({ apply: true });
    expect((await login('Mahi', 'Mahi-Pw-2')).status).toBe(200);
    expect((await login('mahi@example.com', 'Mahi-Pw-2')).status).toBe(200);
  });

  it('does not let a username be used as a way into a different account', async () => {
    await importLegacyAdmins({ apply: true });
    expect((await login('nobody', 'Old-Admin-Pw1')).status).toBe(401);
    // an identifier containing "@" is only ever matched as an email
    expect((await login('mahi@other.com', 'Mahi-Pw-2')).status).toBe(401);
  });
});
