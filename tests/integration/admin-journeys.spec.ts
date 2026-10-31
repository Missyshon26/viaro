import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { Booking } from '../../src/models/Booking';
import { listen, makeUser, pickupIn, point, resetData, seedCatalogue, startDatabase, stopDatabase } from './harness';

vi.mock('../../src/jobs/cancellationWindow.job', () => ({
  scheduleCancellationWindowCheck: vi.fn(async () => undefined),
}));

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
beforeEach(async () => {
  await resetData();
});

const trip = (over: Record<string, unknown> = {}) => ({
  pickup: point('Sea-Tac Airport'),
  drop: point('Hotel Andra, Seattle'),
  vehicleClass: 'sedan',
  tripType: 'point2point',
  city: 'seattle',
  scheduledAt: pickupIn(5),
  passengers: 2,
  ...over,
});

async function book(adminAuth: string, customerId: string, over: Record<string, unknown> = {}) {
  const res = await request(server).post('/admin/bookings').set('Authorization', adminAuth).send({ customerId, trip: trip(over) });
  expect(res.status).toBe(201);
  return res.body.data.booking._id as string;
}

const get = (auth: string, query: string) =>
  request(server).get(`/admin/dashboard/journeys?${query}`).set('Authorization', auth);

describe('GET /admin/dashboard/journeys', () => {
  it('pages the pipeline with each booking\'s customer, newest first, and counts by stage', async () => {
    const admin = await makeUser('admin');
    const ann = await makeUser('customer', { name: 'Ann Rider' });
    const bob = await makeUser('customer', { name: 'Bob Traveller' });
    const first = await book(admin.auth, ann.id);
    const second = await book(admin.auth, bob.id, { vehicleClass: 'suv', drop: point('Bellevue Square') });
    await book(admin.auth, bob.id);
    await Booking.updateOne({ _id: second }, { status: 'assigned' });
    await Booking.updateOne({ _id: first }, { status: 'cancelled' });

    const res = await get(admin.auth, 'limit=2');
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(3);
    expect(res.body.data.totalPages).toBe(2);
    expect(res.body.data.items).toHaveLength(2);
    // Newest first, with the customer filled in the way the console reads it.
    expect(res.body.data.items[0].customerId.name).toBe('Bob Traveller');
    expect(res.body.data.items[0].scheduledAtLocal).toBeTruthy();
    expect(res.body.data.counts).toMatchObject({ all: 3, awaiting: 1, assigned: 1, cancelled: 1 });

    const page2 = await get(admin.auth, 'limit=2&page=2');
    expect(page2.body.data.items).toHaveLength(1);
  });

  it('filters by stage, and the counts ignore the stage filter so the chips stay honest', async () => {
    const admin = await makeUser('admin');
    const ann = await makeUser('customer', { name: 'Ann Rider' });
    const a = await book(admin.auth, ann.id);
    await book(admin.auth, ann.id);
    await Booking.updateOne({ _id: a }, { status: 'assigned' });

    const res = await get(admin.auth, 'stage=assigned');
    expect(res.body.data.total).toBe(1);
    expect(String(res.body.data.items[0]._id)).toBe(a);
    expect(res.body.data.counts).toMatchObject({ all: 2, assigned: 1, awaiting: 1 });
  });

  it('searches the customer, an address, and the booking reference', async () => {
    const admin = await makeUser('admin');
    const ann = await makeUser('customer', { name: 'Ann Rider' });
    const bob = await makeUser('customer', { name: 'Bob Traveller' });
    await book(admin.auth, ann.id);
    const bobs = await book(admin.auth, bob.id, { drop: point('Bellevue Square') });

    expect((await get(admin.auth, 'q=traveller')).body.data.total).toBe(1);
    expect((await get(admin.auth, 'q=bellevue')).body.data.total).toBe(1);
    const ref = `ABL-${bobs.slice(-6).toUpperCase()}`;
    const byRef = await get(admin.auth, `q=${ref}`);
    expect(byRef.body.data.total).toBe(1);
    expect(String(byRef.body.data.items[0]._id)).toBe(bobs);
    // Characters that mean something in a regex are just text.
    expect((await get(admin.auth, 'q=' + encodeURIComponent('(.*'))).status).toBe(200);
  });

  it('filters by vehicle and by pickup day', async () => {
    const admin = await makeUser('admin');
    const ann = await makeUser('customer');
    await book(admin.auth, ann.id, { vehicleClass: 'suv' });
    await book(admin.auth, ann.id);
    expect((await get(admin.auth, 'vehicle=suv')).body.data.total).toBe(1);
    expect((await get(admin.auth, 'from=2000-01-01&to=2000-01-02')).body.data.total).toBe(0);
    expect((await get(admin.auth, 'from=2000-01-01&to=2100-01-01')).body.data.total).toBe(2);
  });

  it('is for admins only', async () => {
    const customer = await makeUser('customer');
    expect((await get(customer.auth, '')).status).toBe(403);
  });
});

describe('GET /admin/dashboard/users', () => {
  const users = (auth: string, query: string) =>
    request(server).get(`/admin/dashboard/users?${query}`).set('Authorization', auth);

  it('pages accounts and filters by role and search text', async () => {
    const admin = await makeUser('admin');
    await makeUser('customer', { name: 'Ann Rider' });
    await makeUser('customer', { name: 'Bob Traveller' });
    await makeUser('admin', { name: 'Dee Admin' });

    const all = await users(admin.auth, 'limit=2');
    expect(all.body.data.total).toBe(4);
    expect(all.body.data.items).toHaveLength(2);
    expect((await users(admin.auth, 'role=customer')).body.data.total).toBe(2);
    expect((await users(admin.auth, 'role=admin')).body.data.total).toBe(2);
    expect((await users(admin.auth, 'role=customer&q=traveller')).body.data.total).toBe(1);
    expect((await users(admin.auth, 'q=' + encodeURIComponent('(.*'))).status).toBe(200);
  });
});

describe('GET /admin/dashboard/summary', () => {
  it('counts bookings by stage, accounts by role and chauffeurs by status in the database', async () => {
    const admin = await makeUser('admin');
    const ann = await makeUser('customer');
    const a = await book(admin.auth, ann.id);
    await book(admin.auth, ann.id);
    await Booking.updateOne({ _id: a }, { status: 'assigned' });

    const res = await request(server).get('/admin/dashboard/summary').set('Authorization', admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.bookings.total).toBe(2);
    expect(res.body.data.bookings.stages).toMatchObject({ awaiting: 1, assigned: 1, completed: 0 });
    expect(res.body.data.users).toMatchObject({ customer: 1, admin: 1, driver: 0 });
    expect(res.body.data.drivers).toMatchObject({ total: 0, available: 0 });

    const customer = await makeUser('customer');
    expect((await request(server).get('/admin/dashboard/summary').set('Authorization', customer.auth)).status).toBe(403);
  });
});

describe('one account on the console', () => {
  it("filters journeys to one customer's bookings and reads one user by id", async () => {
    const admin = await makeUser('admin');
    const ann = await makeUser('customer', { name: 'Ann Rider' });
    const bob = await makeUser('customer', { name: 'Bob Traveller' });
    await book(admin.auth, ann.id);
    await book(admin.auth, bob.id);
    await book(admin.auth, bob.id);

    const mine = await get(admin.auth, `customerId=${bob.id}`);
    expect(mine.status).toBe(200);
    expect(mine.body.data.total).toBe(2);
    expect(mine.body.data.items.every((b: { customerId: { name: string } }) => b.customerId.name === 'Bob Traveller')).toBe(true);
    expect((await get(admin.auth, 'customerId=nope')).status).toBe(400);

    const one = await request(server).get(`/admin/dashboard/users/${ann.id}`).set('Authorization', admin.auth);
    expect(one.status).toBe(200);
    expect(one.body.data.name).toBe('Ann Rider');
    expect(one.body.data.passwordHash).toBeUndefined();
    expect((await request(server).get(`/admin/dashboard/users/${'a'.repeat(24)}`).set('Authorization', admin.auth)).status).toBe(404);
    expect((await request(server).get(`/admin/dashboard/users/${ann.id}`).set('Authorization', ann.auth)).status).toBe(403);
  });
});

describe('stage groups for the dashboard links', () => {
  it("'active' is assigned plus in progress, and a booking nobody has been put on is awaiting", async () => {
    const admin = await makeUser('admin');
    const ann = await makeUser('customer');
    const a = await book(admin.auth, ann.id); // awaiting
    const b = await book(admin.auth, ann.id);
    const c = await book(admin.auth, ann.id);
    // A booking left 'dispatched' from when bookings were offered to drivers still reads as awaiting.
    await Booking.updateOne({ _id: b }, { status: 'dispatched' });
    await Booking.updateOne({ _id: c }, { status: 'assigned' });

    const ids = async (stage: string) =>
      (await get(admin.auth, `stage=${stage}`)).body.data.items.map((i: { _id: string }) => String(i._id)).sort();
    expect(await ids('awaiting')).toEqual([a, b].sort());
    expect(await ids('active')).toEqual([c]);
    expect((await get(admin.auth, 'stage=nonsense')).status).toBe(400);
    expect((await get(admin.auth, 'stage=pool')).status).toBe(400);
  });
});
