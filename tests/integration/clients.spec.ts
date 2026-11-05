import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import jwt from 'jsonwebtoken';
import app from '../../src/app';
import { env } from '../../src/config/env';
import { Booking } from '../../src/models/Booking';
import { User } from '../../src/models/User';
import { getOrCreateWallet } from '../../src/modules/wallet/wallet.service';
import { listen, makeUser, pickupIn, point, resetData, seedCatalogue, startDatabase, stopDatabase } from './harness';

vi.mock('../../src/jobs/cancellationWindow.job', () => ({
  scheduleCancellationWindowCheck: vi.fn(async () => undefined),
}));
// The real wallet service, wrapped so a test can make it fail.
vi.mock('../../src/modules/wallet/wallet.service', async (orig) => {
  const actual = await orig<typeof import('../../src/modules/wallet/wallet.service')>();
  return { ...actual, getOrCreateWallet: vi.fn(actual.getOrCreateWallet) };
});

const http = listen(app);
const server = http.server;

beforeAll(async () => {
  await startDatabase();
  await seedCatalogue();
});
afterAll(async () => {
  await http.close();
  await stopDatabase();
});
beforeEach(resetData);

const address = { line1: '123 Pine Street', line2: 'Apt 4', city: 'Seattle', state: 'WA', postalCode: '98101' };

const bytes = (res: request.Response) => Buffer.from(res.body as Buffer);

describe('the customer\'s own profile: names and address', () => {
  const put = (auth: string, data: Record<string, unknown>) =>
    request(server).patch('/users/me').set('Authorization', auth).send(data);

  it('rebuilds the full name from the first and last name', async () => {
    const { auth } = await makeUser('customer', { name: 'Old Name' });
    const res = await put(auth, { firstName: 'Mary', lastName: 'Jane Watson' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Mary Jane Watson', firstName: 'Mary', lastName: 'Jane Watson' });
  });

  it('changes one half and keeps the other', async () => {
    const { auth } = await makeUser('customer', { name: 'Sam Rider', firstName: 'Sam', lastName: 'Rider' });
    const res = await put(auth, { lastName: 'Riders' });
    expect(res.body.data).toMatchObject({ name: 'Sam Riders', firstName: 'Sam', lastName: 'Riders' });
  });

  it('works out the halves for an older account that only has a full name', async () => {
    const { auth } = await makeUser('customer', { name: 'Sam Rider' });
    const res = await put(auth, { firstName: 'Samuel' });
    expect(res.body.data).toMatchObject({ name: 'Samuel Rider', firstName: 'Samuel', lastName: 'Rider' });
  });

  it('still accepts a plain full name (older clients), and keeps the halves in step', async () => {
    const { auth } = await makeUser('customer');
    const res = await put(auth, { name: 'Alex Q Public' });
    expect(res.body.data).toMatchObject({ name: 'Alex Q Public', firstName: 'Alex', lastName: 'Q Public' });
  });

  it('lets a single-name customer be saved', async () => {
    const { auth } = await makeUser('customer');
    const res = await put(auth, { firstName: 'Madonna', lastName: '' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Madonna');
  });

  it('saves an address, and replaces it whole', async () => {
    const { auth } = await makeUser('customer');
    const saved = await put(auth, { address });
    expect(saved.status).toBe(200);
    expect(saved.body.data.address).toEqual(address);

    const replaced = await put(auth, { address: { line1: '9 Elm Road', city: 'Tacoma', state: 'WA', postalCode: '98402' } });
    expect(replaced.body.data.address).toEqual({ line1: '9 Elm Road', city: 'Tacoma', state: 'WA', postalCode: '98402' });
    expect(replaced.body.data.address.line2).toBeUndefined();
  });

  it('removes the address with null', async () => {
    const { auth } = await makeUser('customer', { address });
    const res = await put(auth, { address: null });
    expect(res.status).toBe(200);
    expect(res.body.data.address).toBeUndefined();
  });

  it('refuses half an address, and rubbish in it', async () => {
    const { auth } = await makeUser('customer');
    expect((await put(auth, { address: { line1: '123 Pine Street' } })).status).toBe(400);
    expect((await put(auth, { address: { ...address, postalCode: '<script>' } })).status).toBe(400);
    expect((await put(auth, { address: { ...address, line1: 'ab' } })).status).toBe(400);
    expect((await put(auth, { firstName: '' })).status).toBe(400);
  });

  it('changes nothing else when only the address is sent', async () => {
    const { auth } = await makeUser('customer', { name: 'Sam Rider', phone: '+12065550100' });
    const res = await put(auth, { address });
    expect(res.body.data).toMatchObject({ name: 'Sam Rider', phone: '+12065550100' });
  });

  it('puts the address on the customer\'s invoice', async () => {
    const { auth } = await makeUser('customer', { address });
    const made = await request(server)
      .post('/bookings')
      .set('Authorization', auth)
      .send({
        pickup: point('123 Pine St, Seattle'),
        drop: point('Sea-Tac Airport'),
        vehicleClass: 'sedan',
        tripType: 'point2point',
        city: 'seattle',
        scheduledAt: pickupIn(10),
      });
    const id = made.body.data.booking._id;
    const pdf = await request(server).get(`/bookings/${id}/documents/invoice`).set('Authorization', auth).buffer(true);
    expect(pdf.status).toBe(200);
    expect(bytes(pdf).subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('the admin clients screen', () => {
  const clients = async () => {
    await makeUser('customer', { name: 'Alice Archer', email: 'alice@example.com', phone: '+12065550001' });
    await makeUser('customer', { name: 'Bob Baker', email: 'bob@example.com', phone: '+12065550002', isGuest: true });
    await makeUser('customer', { name: 'Cara Cole', email: 'cara@corp.example', phone: '+12065550003', status: 'suspended' });
    await makeUser('customer', { name: 'Deleted user', email: 'deleted+1@abl.invalid', phone: 'x', deletedAt: new Date() });
  };

  describe('listing', () => {
    it('shows customers only — never admins, drivers, or deleted accounts', async () => {
      const admin = await makeUser('admin');
      await clients();
      const res = await request(server).get('/admin/customers').set('Authorization', admin.auth);
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(3);
      expect(res.body.data.items.map((u: { email: string }) => u.email).sort()).toEqual([
        'alice@example.com',
        'bob@example.com',
        'cara@corp.example',
      ]);
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    });

    it('searches name, email and phone, case-insensitively, and survives awkward text', async () => {
      const admin = await makeUser('admin');
      await clients();
      const find = async (search: string) =>
        (await request(server).get('/admin/customers').query({ search }).set('Authorization', admin.auth)).body.data;

      expect((await find('ARCHER')).total).toBe(1);
      expect((await find('corp.example')).items[0].name).toBe('Cara Cole');
      expect((await find('0002')).items[0].name).toBe('Bob Baker');
      expect((await find('nobody')).total).toBe(0);
      // A regex special character is just text.
      expect((await request(server).get('/admin/customers').query({ search: '(' }).set('Authorization', admin.auth)).status).toBe(200);
      expect((await request(server).get('/admin/customers').query({ search: '.*' }).set('Authorization', admin.auth)).body.data.total).toBe(0);
    });

    it('filters by status and by guest accounts, and pages', async () => {
      const admin = await makeUser('admin');
      await clients();
      const get = async (query: Record<string, unknown>) =>
        (await request(server).get('/admin/customers').query(query).set('Authorization', admin.auth)).body.data;

      expect((await get({ status: 'suspended' })).items.map((u: { name: string }) => u.name)).toEqual(['Cara Cole']);
      expect((await get({ guest: 'true' })).items.map((u: { name: string }) => u.name)).toEqual(['Bob Baker']);
      expect((await get({ guest: 'false' })).total).toBe(2);

      const first = await get({ limit: 2, page: 1 });
      const second = await get({ limit: 2, page: 2 });
      expect(first.items).toHaveLength(2);
      expect(second.items).toHaveLength(1);
      expect(first.totalPages).toBe(2);
      const ids = [...first.items, ...second.items].map((u: { _id: string }) => u._id);
      expect(new Set(ids).size).toBe(3);
    });

    it('shows how many bookings each client has made', async () => {
      const admin = await makeUser('admin');
      const alice = await makeUser('customer', { name: 'Alice Archer', email: 'alice@example.com' });
      await makeUser('customer', { name: 'Bob Baker', email: 'bob@example.com' });
      for (let i = 0; i < 2; i += 1) {
        await request(server)
          .post('/bookings')
          .set('Authorization', alice.auth)
          .send({
            pickup: point('123 Pine St, Seattle'),
            drop: point('Sea-Tac Airport'),
            vehicleClass: 'sedan',
            tripType: 'point2point',
            city: 'seattle',
            scheduledAt: pickupIn(10 + i),
          });
      }
      const res = await request(server).get('/admin/customers').set('Authorization', admin.auth);
      const byName = Object.fromEntries(res.body.data.items.map((u: { name: string; bookings: number }) => [u.name, u.bookings]));
      expect(byName).toEqual({ 'Alice Archer': 2, 'Bob Baker': 0 });
      expect(res.body.data.items.find((u: { name: string }) => u.name === 'Alice Archer').lastBookingAt).toBeTruthy();
    });

    it('is for admins only', async () => {
      const customer = await makeUser('customer');
      expect((await request(server).get('/admin/customers').set('Authorization', customer.auth)).status).toBe(403);
      expect((await request(server).get('/admin/customers')).status).toBe(401);
    });
  });

  describe('adding a client', () => {
    const add = (auth: string, data: Record<string, unknown>) =>
      request(server).post('/admin/customers').set('Authorization', auth).send(data);
    const valid = { firstName: 'Dana', lastName: 'Diaz', email: 'Dana@Example.com', phone: '+12065550123' };

    it('creates a customer account with a wallet, and no usable password', async () => {
      const admin = await makeUser('admin');
      const res = await add(admin.auth, { ...valid, address });
      expect(res.status).toBe(201);

      const user = res.body.data.user;
      expect(user).toMatchObject({
        role: 'customer',
        name: 'Dana Diaz',
        firstName: 'Dana',
        lastName: 'Diaz',
        email: 'dana@example.com',
        isGuest: false,
        status: 'active',
        address,
      });
      expect(user.walletId).toBeTruthy();
      expect(user).not.toHaveProperty('passwordHash');
      // No email server in the test environment, so the invitation honestly reports it did not go.
      expect(res.body.data.inviteSent).toBe(false);

      const stored = await User.findById(user._id).select('+passwordHash');
      expect(stored?.passwordHash).toMatch(/^\$2[aby]\$/);
    });

    it('can skip the invitation', async () => {
      const admin = await makeUser('admin');
      const res = await add(admin.auth, { ...valid, sendInvite: false });
      expect(res.status).toBe(201);
      expect(res.body.data.inviteSent).toBe(false);
    });

    it('leaves no half-made account behind when the wallet cannot be set up, so a retry works', async () => {
      const admin = await makeUser('admin');
      vi.mocked(getOrCreateWallet).mockRejectedValueOnce(new Error('wallet store down'));

      const failed = await add(admin.auth, valid);
      expect(failed.status).toBe(500);
      expect(await User.countDocuments({ email: 'dana@example.com' })).toBe(0);

      // Not "already registered": the failed attempt left nothing to collide with.
      const retry = await add(admin.auth, valid);
      expect(retry.status).toBe(201);
      expect(retry.body.data.user.walletId).toBeTruthy();
    });

    it('refuses an email that is already taken, in any letter case', async () => {
      const admin = await makeUser('admin');
      await add(admin.auth, valid);
      const again = await add(admin.auth, { ...valid, email: 'DANA@example.com' });
      expect(again.status).toBe(409);
      expect(await User.countDocuments({ email: 'dana@example.com' })).toBe(1);
    });

    it('refuses incomplete details and half an address', async () => {
      const admin = await makeUser('admin');
      expect((await add(admin.auth, { ...valid, firstName: '' })).status).toBe(400);
      expect((await add(admin.auth, { ...valid, email: 'nope' })).status).toBe(400);
      expect((await add(admin.auth, { ...valid, phone: '1' })).status).toBe(400);
      expect((await add(admin.auth, { ...valid, address: { line1: '123 Pine Street' } })).status).toBe(400);
    });

    it('cannot create an admin, whatever the body says', async () => {
      const admin = await makeUser('admin');
      const res = await add(admin.auth, { ...valid, role: 'admin' });
      expect(res.status).toBe(201);
      expect(res.body.data.user.role).toBe('customer');
    });

    it('is for admins only', async () => {
      const customer = await makeUser('customer');
      const res = await add(customer.auth, valid);
      expect(res.status, `${res.status} text=${res.text} body=${JSON.stringify(res.body)} headers=${JSON.stringify(res.headers)}`).toBe(403);
    });
  });

  describe('editing a client', () => {
    const edit = (auth: string, id: string, data: Record<string, unknown>) =>
      request(server).patch(`/admin/customers/${id}`).set('Authorization', auth).send(data);

    it('changes the name, phone and address, and un-verifies a new number', async () => {
      const admin = await makeUser('admin');
      const client = await makeUser('customer', { name: 'Sam Rider', phone: '+12065550100', phoneVerified: true });
      const res = await edit(admin.auth, client.id, { firstName: 'Samuel', phone: '+12065550999', address });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({ name: 'Samuel Rider', phone: '+12065550999', phoneVerified: false, address });
    });

    it('keeps the verified flag when the phone is unchanged', async () => {
      const admin = await makeUser('admin');
      const client = await makeUser('customer', { phone: '+12065550100', phoneVerified: true });
      const res = await edit(admin.auth, client.id, { phone: '+12065550100', firstName: 'Pat' });
      expect(res.body.data.phoneVerified).toBe(true);
    });

    it('changes the email, but not to one that someone else has', async () => {
      const admin = await makeUser('admin');
      const a = await makeUser('customer', { email: 'a@example.com' });
      await makeUser('customer', { email: 'b@example.com' });

      expect((await edit(admin.auth, a.id, { email: 'B@example.com' })).status).toBe(409);
      const ok = await edit(admin.auth, a.id, { email: 'A2@Example.com' });
      expect(ok.status).toBe(200);
      expect(ok.body.data.email).toBe('a2@example.com');
      // Saving its own email again is not a clash with itself.
      expect((await edit(admin.auth, a.id, { email: 'a2@example.com' })).status).toBe(200);
    });

    it('removes an address', async () => {
      const admin = await makeUser('admin');
      const client = await makeUser('customer', { address });
      const res = await edit(admin.auth, client.id, { address: null });
      expect(res.body.data.address).toBeUndefined();
    });

    it('suspends a client and signs them out at once, and reinstates them', async () => {
      const admin = await makeUser('admin');
      const client = await makeUser('customer');
      // A token issued a minute ago, i.e. before the suspension.
      const old = `Bearer ${jwt.sign({ userId: client.id, role: 'customer', iat: Math.floor(Date.now() / 1000) - 60 }, env.JWT_ACCESS_SECRET, { expiresIn: '10m' })}`;
      expect((await request(server).get('/users/me').set('Authorization', old)).status).toBe(200);

      const suspended = await edit(admin.auth, client.id, { status: 'suspended' });
      expect(suspended.status).toBe(200);
      expect(suspended.body.data.status).toBe('suspended');
      expect((await request(server).get('/users/me').set('Authorization', old)).status).toBe(401);

      const back = await edit(admin.auth, client.id, { status: 'active' });
      expect(back.body.data.status).toBe('active');
    });

    it('will not touch anyone who is not a client', async () => {
      const admin = await makeUser('admin');
      const other = await makeUser('admin');
      expect((await edit(admin.auth, other.id, { firstName: 'Hacked' })).status).toBe(404);
      expect((await edit(admin.auth, '5f9d88b8b54764421b7156c9', { firstName: 'Nobody' })).status).toBe(404);
      expect((await User.findById(other.id))!.name).toBe('Ops');
    });

    it('refuses an empty edit and a bad id, and is for admins only', async () => {
      const admin = await makeUser('admin');
      const client = await makeUser('customer');
      expect((await edit(admin.auth, client.id, {})).status).toBe(400);
      expect((await edit(admin.auth, 'not-an-id', { firstName: 'X' })).status).toBe(400);
      expect((await edit(client.auth, client.id, { firstName: 'Self' })).status).toBe(403);
    });
  });

  describe('editing any user from the users screen', () => {
    const edit = (auth: string, id: string, data: Record<string, unknown>) =>
      request(server).patch(`/admin/users/${id}`).set('Authorization', auth).send(data);

    it('corrects a driver\'s name, email, phone and address, and un-verifies a new number', async () => {
      const admin = await makeUser('admin');
      const driver = await makeUser('customer', { role: 'driver', name: 'Dee Driver', phone: '+12065550100', phoneVerified: true });
      const res = await edit(admin.auth, driver.id, { firstName: 'Dena', lastName: 'Driver', email: 'Dena@Example.com', phone: '+12065550777', address });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ name: 'Dena Driver', email: 'dena@example.com', phone: '+12065550777', phoneVerified: false, role: 'driver', address });
    });

    it('edits an admin and a company account the same way', async () => {
      const admin = await makeUser('admin');
      const other = await makeUser('admin', { name: 'Old Ops' });
      const company = await makeUser('customer', { role: 'company', name: 'Fleet Co' });
      expect((await edit(admin.auth, other.id, { firstName: 'New', lastName: 'Ops' })).body.data.name).toBe('New Ops');
      expect((await edit(admin.auth, company.id, { phone: '+12065550888' })).body.data.phone).toBe('+12065550888');
    });

    it('never changes the role, even if one is sent', async () => {
      const admin = await makeUser('admin');
      const driver = await makeUser('customer', { role: 'driver' });
      const res = await edit(admin.auth, driver.id, { firstName: 'Sam', role: 'admin' });
      expect(res.status).toBe(200);
      expect((await User.findById(driver.id))!.role).toBe('driver');
    });

    it('refuses an email another account already has, and keeps the old one', async () => {
      const admin = await makeUser('admin');
      const a = await makeUser('customer', { role: 'driver', email: 'a@example.com' });
      await makeUser('customer', { email: 'b@example.com' });
      expect((await edit(admin.auth, a.id, { email: 'B@example.com' })).status).toBe(409);
      expect((await User.findById(a.id))!.email).toBe('a@example.com');
    });

    it('suspends another user and signs them out, but not the admin\'s own account', async () => {
      const admin = await makeUser('admin');
      const driver = await makeUser('customer', { role: 'driver' });
      const old = `Bearer ${jwt.sign({ userId: driver.id, role: 'driver', iat: Math.floor(Date.now() / 1000) - 60 }, env.JWT_ACCESS_SECRET, { expiresIn: '10m' })}`;
      expect((await request(server).get('/users/me').set('Authorization', old)).status).toBe(200);

      expect((await edit(admin.auth, driver.id, { status: 'suspended' })).body.data.status).toBe('suspended');
      expect((await request(server).get('/users/me').set('Authorization', old)).status).toBe(401);

      const self = await edit(admin.auth, admin.id, { status: 'suspended' });
      expect(self.status).toBe(400);
      expect((await User.findById(admin.id))!.status).toBe('active');
    });

    it('can still edit the admin\'s own name', async () => {
      const admin = await makeUser('admin');
      expect((await edit(admin.auth, admin.id, { firstName: 'Ada', lastName: 'Admin' })).body.data.name).toBe('Ada Admin');
    });

    it('does not find an unknown or deleted account, refuses an empty edit, and is for admins only', async () => {
      const admin = await makeUser('admin');
      const gone = await makeUser('customer', { role: 'driver', deletedAt: new Date() });
      const driver = await makeUser('customer', { role: 'driver' });
      expect((await edit(admin.auth, '5f9d88b8b54764421b7156c9', { firstName: 'Nobody' })).status).toBe(404);
      expect((await edit(admin.auth, gone.id, { firstName: 'Ghost' })).status).toBe(404);
      expect((await edit(admin.auth, driver.id, {})).status).toBe(400);
      expect((await edit(driver.auth, driver.id, { firstName: 'Self' })).status).toBe(403);
    });
  });

  describe('downloading the list', () => {
    // Read the body as raw bytes: supertest only buffers a few content types by default.
    const download = (auth: string, query: Record<string, unknown> = {}) =>
      request(server)
        .get('/admin/customers/export')
        .query(query)
        .set('Authorization', auth)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        });

    it('is an Excel file with one row per client and the details an operator needs', async () => {
      const admin = await makeUser('admin');
      await makeUser('customer', {
        name: 'Alice Archer', firstName: 'Alice', lastName: 'Archer', email: 'alice@example.com',
        phone: '+12065550001', phoneVerified: true, address,
      });
      await makeUser('customer', { name: 'Bob Baker', email: 'bob@example.com', phone: '+12065550002', isGuest: true });
      await makeUser('customer', { name: 'Gone', email: 'gone@example.com', deletedAt: new Date() });

      const res = await download(admin.auth);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml.sheet');
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename="abl-clients-\d{4}-\d{2}-\d{2}\.xlsx"$/);
      expect(res.headers['cache-control']).toContain('no-store');

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(bytes(res) as unknown as ArrayBuffer);
      const sheet = wb.worksheets[0];
      const header = (sheet.getRow(1).values as unknown[]).slice(1);
      expect(header).toEqual([
        'Name', 'First name', 'Last name', 'Email', 'Phone', 'Phone verified', 'Address', 'Status',
        'Guest account', 'Agreement signed', 'Bookings', 'Last booking', 'Joined',
      ]);
      expect(sheet.rowCount).toBe(3); // header + two clients; the deleted one is not there

      const rows = [2, 3].map((n) => Object.fromEntries(header.map((h, i) => [h as string, sheet.getRow(n).getCell(i + 1).value])));
      const alice = rows.find((r) => r.Name === 'Alice Archer')!;
      expect(alice).toMatchObject({
        Email: 'alice@example.com',
        'Phone verified': 'Yes',
        Address: '123 Pine Street, Apt 4, Seattle, WA 98101',
        Status: 'active',
        'Guest account': 'No',
        Bookings: 0,
      });
      expect(typeof alice.Bookings).toBe('number');
      expect(rows.find((r) => r.Name === 'Bob Baker')!['Guest account']).toBe('Yes');
    });

    it('is a CSV on request', async () => {
      const admin = await makeUser('admin');
      await makeUser('customer', { name: 'Alice Archer', email: 'alice@example.com' });
      const res = await download(admin.auth, { format: 'csv' });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      const text = bytes(res).toString('utf8');
      expect(text.split('\n')[0]).toContain('Name,First name,Last name,Email');
      expect(text).toContain('Alice Archer');
    });

    it('honours the same search and filters as the screen', async () => {
      const admin = await makeUser('admin');
      await makeUser('customer', { name: 'Alice Archer', email: 'alice@example.com' });
      await makeUser('customer', { name: 'Bob Baker', email: 'bob@example.com', isGuest: true });

      const searched = bytes(await download(admin.auth, { format: 'csv', search: 'baker' })).toString('utf8');
      expect(searched).toContain('Bob Baker');
      expect(searched).not.toContain('Alice');

      const guests = bytes(await download(admin.auth, { format: 'csv', guest: 'true' })).toString('utf8');
      expect(guests).toContain('Bob Baker');
      expect(guests).not.toContain('Alice');
    });

    it('does not let a name run as a formula in the spreadsheet', async () => {
      const admin = await makeUser('admin');
      await makeUser('customer', { name: '=HYPERLINK("http://evil","click")', email: 'evil@example.com' });

      const csv = bytes(await download(admin.auth, { format: 'csv' })).toString('utf8');
      expect(csv).toContain(`"'=HYPERLINK(""http://evil"",""click"")"`);

      const xlsx = await download(admin.auth);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(bytes(xlsx) as unknown as ArrayBuffer);
      const cell = wb.worksheets[0].getRow(2).getCell(1);
      expect(cell.type).toBe(ExcelJS.ValueType.String);
      expect(cell.value).toBe('=HYPERLINK("http://evil","click")');
    });

    it('still gives a valid, empty file when no client matches', async () => {
      const admin = await makeUser('admin');
      const res = await download(admin.auth, { search: 'nobody-here' });
      expect(res.status).toBe(200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(bytes(res) as unknown as ArrayBuffer);
      expect(String(wb.worksheets[0].getRow(1).getCell(1).value)).toBe('No clients match.');
    });

    it('is not mistaken for a client called "export", and is for admins only', async () => {
      const customer = await makeUser('customer');
      expect((await download(customer.auth)).status).toBe(403);
      const admin = await makeUser('admin');
      expect((await download(admin.auth, { format: 'pdf' })).status).toBe(400);
    });
  });
});

describe('registration and guest checkout keep the name halves in step', () => {
  it('splits the name on sign-up and as a guest', async () => {
    const reg = await request(server).post('/auth/register').send({
      role: 'customer', name: 'Mary Jane Watson', email: 'mary@example.com', phone: '+12065550150', password: 'password123',
    });
    expect(reg.status).toBe(201);
    expect(reg.body.data.user).toMatchObject({ firstName: 'Mary', lastName: 'Jane Watson' });

    const guest = await request(server).post('/auth/guest').send({ name: 'Sam Guest', email: 'sam@example.com', phone: '+12065550148' });
    expect(guest.body.data.user).toMatchObject({ firstName: 'Sam', lastName: 'Guest' });
  });
});
