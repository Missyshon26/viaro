import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { Booking } from '../../src/models/Booking';
import { Driver } from '../../src/models/Driver';
import { Trip } from '../../src/models/Trip';
import { User } from '../../src/models/User';
import { listen, makeUser, pickupIn, point, resetData, seedCatalogue, startDatabase, stopDatabase } from './harness';

vi.mock('../../src/jobs/cancellationWindow.job', () => ({
  scheduleCancellationWindowCheck: vi.fn(async () => undefined),
}));

const http = listen(app);
const server = http.server;

let admin: { id: string; auth: string };
let bookingId: string;

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
  admin = await makeUser('admin');
  const customer = await makeUser('customer');
  const res = await request(server)
    .post('/admin/bookings')
    .set('Authorization', admin.auth)
    .send({
      customerId: customer.id,
      trip: {
        pickup: point('Sea-Tac Airport'),
        drop: point('Hotel Andra, Seattle'),
        vehicleClass: 'sedan',
        tripType: 'point2point',
        city: 'seattle',
        scheduledAt: pickupIn(5),
        passengers: 2,
      },
    });
  bookingId = res.body.data.booking._id;
});

const driverWith = async (status: 'available' | 'offline' | 'busy', account: Record<string, unknown> = {}) => {
  const user = await User.create({
    role: 'driver',
    name: 'Dana Driver',
    email: `driver-${Math.random().toString(36).slice(2, 8)}@example.com`,
    phone: '+12065550111',
    passwordHash: 'x',
    ...account,
  });
  return Driver.create({ userId: user._id, vehicleClass: 'sedan', status });
};

const assign = (driverId: string, id = bookingId) =>
  request(server).post(`/admin/dispatch/${id}/assign`).set('Authorization', admin.auth).send({ driverId });

describe('an operator assigning a driver', () => {
  it('puts a driver who is offline on the booking: the booking is assigned, a trip exists, the driver is busy', async () => {
    const driver = await driverWith('offline');
    const res = await assign(String(driver._id));
    expect(res.status).toBe(200);
    expect(res.body.data.booking.status).toBe('assigned');

    expect((await Booking.findById(bookingId))!.status).toBe('assigned');
    const trip = await Trip.findOne({ bookingId });
    expect(trip).toMatchObject({ status: 'accepted' });
    expect(String(trip!.driverId)).toBe(String(driver._id));
    expect((await Driver.findById(driver._id))!.status).toBe('busy');
  });

  it('also works for a driver marked available', async () => {
    const driver = await driverWith('available');
    expect((await assign(String(driver._id))).status).toBe(200);
  });

  it('refuses a driver already on a trip, a suspended account, a second driver, a missing driver and a cancelled booking', async () => {
    const busy = await driverWith('busy');
    const busyRes = await assign(String(busy._id));
    expect(busyRes.status).toBe(409);
    expect(busyRes.body.details?.code ?? busyRes.body.code).toBeTruthy();

    const suspended = await driverWith('offline', { status: 'suspended' });
    expect((await assign(String(suspended._id))).status).toBe(409);

    expect((await assign('a'.repeat(24))).status).toBe(404);

    const first = await driverWith('offline');
    expect((await assign(String(first._id))).status).toBe(200);
    const second = await driverWith('offline');
    expect((await assign(String(second._id))).status).toBe(409);

    const other = await driverWith('offline');
    await Booking.updateOne({ _id: bookingId }, { status: 'cancelled' });
    expect((await assign(String(other._id))).status).toBe(409);
  });

  it('is for admins only', async () => {
    const driver = await driverWith('offline');
    const customer = await makeUser('customer');
    const res = await request(server)
      .post(`/admin/dispatch/${bookingId}/assign`)
      .set('Authorization', customer.auth)
      .send({ driverId: String(driver._id) });
    expect(res.status).toBe(403);
  });
});
