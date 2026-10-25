import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../src/app';
import { PricingRule } from '../../src/models/PricingRule';
import { VehicleClass } from '../../src/models/VehicleClass';
import { activateLegacyCatalogue } from '../../src/modules/migration/legacy.catalogue';
import { listen, makeUser, pickupIn, point, resetData, seedCatalogue, startDatabase, stopDatabase } from './harness';

vi.mock('../../src/jobs/cancellationWindow.job', () => ({
  scheduleCancellationWindowCheck: vi.fn(async () => undefined),
}));
vi.mock('../../src/modules/dispatch/dispatch.service', () => ({
  receiveBookingRequest: vi.fn(async () => undefined),
}));

const http = listen(app);
const server = http.server;
const col = (n: string) => mongoose.connection.collection(`legacy_${n}`);

/** A real 1x1 PNG, so the photo passes the same checks an upload does. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const OLD = [
  { vehicleName: 'Executive Sedan (SEA Region)', status: 'Live', slNo: 1, maxPersons: '2', maxBags: '2', basePrice: '129', baseDistance: '18', pricePerUnitDistance: '3', pricePerUnitHour: '119', stopPrice: '40', feature: 'Mid-Size Sedan', images: ['a.png'] },
  { vehicleName: 'First Class SUV', status: 'Live', slNo: 4, banner: 'Most Popular', maxPersons: '6', maxBags: '5', basePrice: '199', pricePerUnitHour: '179', stopPrice: '40', feature: 'Long Distance', images: ['b.png'] },
  { vehicleName: 'Passenger Bus', status: 'Live', slNo: 0, maxPersons: '24', maxBags: '24', basePrice: '599', pricePerUnitHour: '499', stopPrice: '40', feature: '24 Passenger Bus', images: [] },
  { vehicleName: 'Test Reservation', status: 'Inactive', slNo: 0, maxPersons: '2', maxBags: '5', basePrice: '1', pricePerUnitHour: '1', stopPrice: '1', images: [] },
];
const valueOf = (label: string) => `legacy-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

beforeAll(startDatabase);
afterAll(async () => {
  await http.close();
  await stopDatabase();
});
beforeEach(async () => {
  await resetData();
  await VehicleClass.deleteMany({});
  await PricingRule.deleteMany({});
  await seedCatalogue(); // the app's own default classes and a pricing rule
  await PricingRule.deleteMany({}); // ...but start with no rule, as abl_new does
  await col('vehicles').deleteMany({});
  await col('taxes').deleteMany({});
  await col('vehicles').insertMany(OLD);
  await col('taxes').insertOne({ meetGreetCost: 25, primeTimeCost: 20, stopCost: 5 });
  // what the history import leaves behind: the old vehicles, switched off
  await VehicleClass.insertMany(
    OLD.map((v) => ({ value: valueOf(v.vehicleName), label: v.vehicleName, seats: Number(v.maxPersons), bags: Number(v.maxBags), multiplier: 1, active: false, flatRate: Number(v.basePrice), images: [] })),
  );
});

const fetchImage = vi.fn(async () => PNG);

describe('bringing the old vehicle lineup into service', () => {
  it('a dry run changes nothing', async () => {
    const r = await activateLegacyCatalogue({ apply: false, fetchImage });
    expect(r.switchedOn.map((v) => v.label)).toEqual(['Executive Sedan (SEA Region)', 'First Class SUV', 'Passenger Bus']);
    expect(await VehicleClass.countDocuments({ value: /^legacy-/, active: true })).toBe(0);
    expect(await PricingRule.countDocuments()).toBe(0);
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it('switches the live old vehicles on with their old prices, photos and order', async () => {
    const r = await activateLegacyCatalogue({ apply: true, fetchImage });
    expect(r.problems).toEqual([]);
    const sedan = await VehicleClass.findOne({ label: 'Executive Sedan (SEA Region)' }).lean();
    expect(sedan).toMatchObject({ active: true, flatRate: 129, hourlyRate: 119, stopFee: 40, baseMiles: 18, perMileRate: 3, detail: 'Mid-Size Sedan', sortOrder: 1 });
    expect(sedan?.images).toHaveLength(1);
    expect(sedan?.images[0].key).toBeTruthy();
    expect(sedan?.images[0].src).toMatch(/^\/uploads\/vehicles\//);
    expect((await VehicleClass.findOne({ value: valueOf('First Class SUV') }).lean())?.badge).toBe('Most Popular');
    expect(sedan?.badge).toBeUndefined();
    const bus = await VehicleClass.findOne({ label: 'Passenger Bus' }).lean();
    expect(bus).toMatchObject({ active: true, flatRate: 599, hourlyRate: 499 });
    expect(bus!.sortOrder).toBeGreaterThan(sedan!.sortOrder); // slNo 0 means "no position": last
    // a vehicle the old site had switched off stays off
    expect((await VehicleClass.findOne({ label: 'Test Reservation' }).lean())?.active).toBe(false);
  });

  it("switches off this app's own default vehicles, and adds the Seattle rule", async () => {
    const r = await activateLegacyCatalogue({ apply: true, fetchImage });
    expect(r.switchedOff.length).toBeGreaterThan(0);
    expect(await VehicleClass.countDocuments({ value: { $not: /^legacy-/ }, active: true })).toBe(0);
    expect(r.pricingRule).toBe('created');
    expect(await PricingRule.findOne({ city: 'seattle' }).lean()).toMatchObject({ baseFare: 129, peakMultiplier: 1 });
  });

  it('is safe to run again: no second rule, no duplicate photos', async () => {
    await activateLegacyCatalogue({ apply: true, fetchImage });
    const again = await activateLegacyCatalogue({ apply: true, fetchImage });
    expect(again.pricingRule).toBe('already there');
    expect(await PricingRule.countDocuments()).toBe(1);
    expect((await VehicleClass.findOne({ label: 'Executive Sedan (SEA Region)' }).lean())?.images).toHaveLength(1);
  });

  it('a photo that cannot be fetched is reported, and the vehicle is still switched on', async () => {
    const r = await activateLegacyCatalogue({ apply: true, fetchImage: async () => null });
    expect(r.problems.join(' ')).toMatch(/could not fetch the photo/);
    expect((await VehicleClass.findOne({ value: valueOf('First Class SUV') }).lean())?.active).toBe(true);
  });

  it('now quotes the old price for a transfer, and the old hourly rate', async () => {
    await activateLegacyCatalogue({ apply: true, fetchImage });
    const q = (over: Record<string, unknown>) =>
      request(server).get('/pricing/fare-estimate').query({ city: 'seattle', requestedAt: '2026-11-20T10:00:00', ...over });
    const transfer = await q({ tripType: 'point2point', vehicleClass: valueOf('First Class SUV') });
    expect(transfer.status).toBe(200);
    expect(transfer.body.data.fare).toBe(199);
    const hourly = await q({ tripType: 'hourly', hours: 3, vehicleClass: valueOf('Executive Sedan (SEA Region)') });
    expect(hourly.body.data.fare).toBe(119 * 3);
    // a stop is $40, as on the old site
    const stop = await q({ tripType: 'point2point', vehicleClass: valueOf('First Class SUV'), stops: 1 });
    expect(stop.body.data.fare).toBe(199 + 40);
  });

  it('weddings can use the old First Class SUV and nothing else', async () => {
    await activateLegacyCatalogue({ apply: true, fetchImage });
    const { auth } = await makeUser('customer');
    const book = (vehicleClass: string) =>
      request(server)
        .post('/bookings')
        .set('Authorization', auth)
        .send({ pickup: point('1 Pine St'), drop: point('2 Pike St'), vehicleClass, tripType: 'point2point', city: 'seattle', scheduledAt: pickupIn(10), occasion: 'Wedding' });
    expect((await book(valueOf('Executive Sedan (SEA Region)'))).status).toBe(400);
    expect((await book(valueOf('First Class SUV'))).status).toBe(201);
  });
});
