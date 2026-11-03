import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { Booking } from '../../src/models/Booking';
import { listen, makeUser, pickupIn, point, resetData, seedCatalogue, startDatabase, stopDatabase } from './harness';

vi.mock('../../src/jobs/cancellationWindow.job', () => ({ scheduleCancellationWindowCheck: vi.fn(async () => undefined) }));

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

/** A booking an operator made for a customer. */
async function bookingFor(scheduledAt = pickupIn(5)) {
  const admin = await makeUser('admin');
  const client = await makeUser('customer');
  const made = await request(server)
    .post('/admin/bookings')
    .set('Authorization', admin.auth)
    .send({
      customerId: client.id,
      trip: {
        pickup: point('Sea-Tac Airport'),
        drop: point('Hotel Andra, Seattle'),
        vehicleClass: 'sedan',
        tripType: 'point2point',
        city: 'seattle',
        scheduledAt,
      },
    });
  return { admin, client, id: String(made.body.data.booking._id) };
}

const edit = (auth: string, id: string, body: Record<string, unknown>) =>
  request(server).patch(`/admin/bookings/${id}`).set('Authorization', auth).send(body);

describe('PATCH /admin/bookings/:id', () => {
  it('changes time, route, head count and notes, and records each change as the admin', async () => {
    const { admin, id } = await bookingFor();
    const res = await edit(admin.auth, id, {
      scheduledAt: pickupIn(6, 9),
      drop: point('Bellevue Square, Bellevue'),
      passengers: 3,
      description: 'Two car seats needed',
    });
    expect(res.status).toBe(200);

    const booking = (await Booking.findById(id).lean())!;
    expect(booking.drop.address).toBe('Bellevue Square, Bellevue');
    expect(booking.passengers).toBe(3);
    expect(booking.description).toBe('Two car seats needed');
    const fields = booking.amendments.map((a) => a.field).sort();
    expect(fields).toEqual(['drop', 'notes', 'passengers', 'scheduledAt']);
    expect(booking.amendments.every((a) => a.by === 'admin')).toBe(true);
  });

  it('has no deadline: a pickup under three hours away can still be changed', async () => {
    const { admin, client, id } = await bookingFor();
    await Booking.updateOne({ _id: id }, { $set: { scheduledAt: new Date(Date.now() + 60 * 60 * 1000) } });
    const res = await edit(admin.auth, id, { passengers: 2 });
    expect(res.status).toBe(200);
    // The customer, on the same booking, is held to the deadline.
    const asCustomer = await request(server)
      .patch(`/bookings/${id}`)
      .set('Authorization', client.auth)
      .send({ passengers: 2, checkedBags: 1 });
    expect(asCustomer.status).toBe(409);
  });

  it('is for admins only', async () => {
    const { client, id } = await bookingFor();
    expect((await edit(client.auth, id, { passengers: 2 })).status).toBe(403);
  });

  it('refuses a cancelled booking, an empty change and a missing booking', async () => {
    const { admin, id } = await bookingFor();
    expect((await edit(admin.auth, id, {})).status).toBe(400);
    expect((await edit(admin.auth, id, { notifyCustomer: false })).status).toBe(400);
    expect((await edit(admin.auth, '64b000000000000000000000', { passengers: 2 })).status).toBe(404);
    await Booking.updateOne({ _id: id }, { $set: { status: 'cancelled' } });
    expect((await edit(admin.auth, id, { passengers: 2 })).status).toBe(409);
  });
});
