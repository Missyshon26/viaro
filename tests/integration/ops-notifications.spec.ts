import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { Notification } from '../../src/models/Notification';
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

const trip = () => ({
  pickup: point('Sea-Tac Airport'),
  drop: point('Hotel Andra, Seattle'),
  vehicleClass: 'sedan',
  tripType: 'point2point',
  city: 'seattle',
  scheduledAt: pickupIn(5),
  passengers: 2,
});

// The notice is written without the request waiting for it, so give it a moment.
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

const feed = (auth: string, query = '') => request(server).get(`/notifications${query}`).set('Authorization', auth);

describe('operations notifications', () => {
  it('tells every admin about a booking a customer makes, and not the customer or other roles', async () => {
    const adminA = await makeUser('admin');
    const adminB = await makeUser('admin');
    const customer = await makeUser('customer', { name: 'Ann Rider' });

    const made = await request(server).post('/bookings').set('Authorization', customer.auth).send(trip());
    expect(made.status).toBe(201);
    await settle();

    for (const admin of [adminA, adminB]) {
      const res = await feed(admin.auth);
      expect(res.status).toBe(200);
      const notice = res.body.data.items.find((n: { type: string }) => n.type === 'ops.booking_created');
      expect(notice).toBeTruthy();
      expect(notice.payload.bookingId).toBe(made.body.data.booking._id);
      expect(notice.payload.message).toMatch(/^New booking ABL-[0-9A-F]{6}/);
      expect(notice.read).toBe(false);
    }
    // The customer's own feed has their booking confirmation, not the operations notice.
    const mine = await feed(customer.auth);
    expect(mine.body.data.items.some((n: { type: string }) => n.type.startsWith('ops.'))).toBe(false);
  });

  it('does not announce a booking an operator entered themselves', async () => {
    const admin = await makeUser('admin');
    const customer = await makeUser('customer');
    const res = await request(server).post('/admin/bookings').set('Authorization', admin.auth).send({ customerId: customer.id, trip: trip() });
    expect(res.status).toBe(201);
    await settle();
    expect(await Notification.countDocuments({ type: 'ops.booking_created' })).toBe(0);
  });

  it('tells admins when a customer cancels and when a case is opened or answered', async () => {
    const admin = await makeUser('admin');
    const customer = await makeUser('customer');
    const made = await request(server).post('/bookings').set('Authorization', customer.auth).send(trip());
    const id = made.body.data.booking._id;

    await request(server).delete(`/bookings/${id}`).set('Authorization', customer.auth);
    const ticket = await request(server)
      .post('/support/tickets')
      .set('Authorization', customer.auth)
      .send({ category: 'payment', subject: 'Charged twice', message: 'I see two charges on my card.' });
    expect(ticket.status).toBe(201);
    await request(server)
      .post(`/support/tickets/${ticket.body.data._id}/messages`)
      .set('Authorization', customer.auth)
      .send({ message: 'Any update?' });
    await settle();

    const types = (await feed(admin.auth)).body.data.items.map((n: { type: string }) => n.type);
    expect(types).toEqual(expect.arrayContaining(['ops.booking_cancelled', 'ops.support_new', 'ops.support_reply']));
  });

  it('lists unread only, counts unread, and marks one or all as read', async () => {
    const admin = await makeUser('admin');
    const other = await makeUser('admin');
    const customer = await makeUser('customer');
    for (let i = 0; i < 3; i += 1) {
      await request(server).post('/bookings').set('Authorization', customer.auth).send({ ...trip(), scheduledAt: pickupIn(5 + i) });
    }
    await settle();

    const all = await feed(admin.auth);
    expect(all.body.data.unread).toBe(3);
    const first = all.body.data.items[0]._id as string;
    expect((await request(server).patch(`/notifications/${first}/read`).set('Authorization', admin.auth)).status).toBe(200);
    expect((await feed(admin.auth, '?unread=true')).body.data.items).toHaveLength(2);
    expect((await feed(admin.auth)).body.data.unread).toBe(2);

    // Somebody else's notice cannot be touched.
    const theirs = (await feed(other.auth)).body.data.items[0]._id as string;
    expect((await request(server).patch(`/notifications/${theirs}/read`).set('Authorization', admin.auth)).status).toBe(403);

    const done = await request(server).patch('/notifications/read-all').set('Authorization', admin.auth);
    expect(done.status).toBe(200);
    expect(done.body.data.updated).toBe(2);
    expect((await feed(admin.auth)).body.data.unread).toBe(0);
    // Marking all read left the other admin's alone.
    expect((await feed(other.auth)).body.data.unread).toBe(3);
  });
});
