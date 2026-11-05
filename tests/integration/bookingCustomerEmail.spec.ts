import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { Booking } from '../../src/models/Booking';
import { User } from '../../src/models/User';
import { listen, accessTokenFor, pickupIn, point, resetData, seedCatalogue, startDatabase, stopDatabase } from './harness';

const http = listen(app);
beforeAll(async () => {
  await startDatabase();
  await seedCatalogue();
  await resetData();
});
afterAll(async () => {
  await http.close();
  await stopDatabase();
});

describe('the customer on a booking', () => {
  it('shows the email to an admin, not to the customer reading their own booking', async () => {
    const cust = await User.create({ role: 'customer', name: 'Pat', email: 'pat@example.com', phone: '+12065550111', passwordHash: 'x' });
    const adminUser = await User.create({ role: 'admin', name: 'Ops', email: 'ops@example.com', phone: '+12065550100', passwordHash: 'x' });
    const booking = await Booking.create({
      customerId: cust._id, pickup: point('A'), drop: point('B'), vehicleClass: 'sedan', tripType: 'point2point',
      city: 'seattle', scheduledAt: new Date(pickupIn(5)), originalScheduledAt: new Date(pickupIn(5)), estimatedFare: 140, status: 'pending',
    });
    const asAdmin = await request(http.server).get(`/bookings/${booking._id}`).set('Authorization', await accessTokenFor(String(adminUser._id), 'admin'));
    expect(asAdmin.body.data.customerId.email).toBe('pat@example.com');
    const asCustomer = await request(http.server).get(`/bookings/${booking._id}`).set('Authorization', await accessTokenFor(String(cust._id), 'customer'));
    expect(asCustomer.body.data.customerId.email).toBeUndefined();
  });
});
