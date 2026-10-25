import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import mongoose, { Types } from 'mongoose';
import { Booking } from '../../src/models/Booking';
import { Driver } from '../../src/models/Driver';
import { Trip } from '../../src/models/Trip';
import { User } from '../../src/models/User';
import { VehicleClass } from '../../src/models/VehicleClass';
import { Wallet } from '../../src/models/Wallet';
import { importLegacyAdmins } from '../../src/modules/migration/legacy.admins';
import { importLegacyHistory } from '../../src/modules/migration/legacy.import';
import { resetData, startDatabase, stopDatabase } from './harness';

const NOW = new Date('2026-10-26T12:00:00Z');
const col = (n: string) => mongoose.connection.collection(`legacy_${n}`);

const vehSedan = new Types.ObjectId();
const vehBus = new Types.ObjectId();
const adminId = new Types.ObjectId();
const drvA = new Types.ObjectId();
const drvB = new Types.ObjectId();
const custA = new Types.ObjectId();
const custA2 = new Types.ObjectId();
const custB = new Types.ObjectId();

const leg = (over: Record<string, unknown> = {}) => ({
  source: '1 Pickup St, Seattle, WA',
  destination: 'Sea-Tac Airport',
  scheduledDate: '08-04-2026',
  scheduledTime: '10:30 AM',
  baseRate: 100,
  primeTime: false,
  primeTimeCost: 10,
  meetAndGreet: false,
  meetAndGreetCost: 25,
  additionalSeats: [],
  stops: [],
  gratuity: '0',
  gratuityAmount: 0,
  status: 'Completed',
  ...over,
});

async function load() {
  const hash = await bcrypt.hash('pw', 4);
  await col('vehicles').insertMany([
    { _id: vehSedan, vehicleName: 'Executive Sedan', maxPersons: '3', maxBags: '2', basePrice: '129', pricePerUnitHour: '119', stopPrice: '40', status: 'Live', slNo: 1 },
    { _id: vehBus, vehicleName: 'Executive Sedan', maxPersons: '24', maxBags: '', basePrice: '', pricePerUnitHour: '', stopPrice: '', status: 'Inactive', slNo: 2 },
  ]);
  await col('users').insertMany([
    { _id: adminId, userName: 'Boss', emailId: 'boss@example.com', designation: 'Admin', status: 'Live', password: hash },
    { _id: drvA, userName: 'Boss', emailId: 'driver.a@example.com', designation: 'Driver', status: 'Live', password: hash, firstName: 'Dee', lastName: 'A' },
    { _id: drvB, userName: 'drvb', emailId: 'boss@example.com', designation: 'Driver', status: 'Live', password: hash },
  ]);
  await col('customers').insertMany([
    { _id: custA, user_id: 'uidA', email: 'Rider@Example.com', fullName: 'Rae Rider', contact_no: '+12065550101', wallet_balance: 110, created_at: new Date('2026-01-01'), stripeId: 'cus_old' },
    { _id: custA2, user_id: 'uidA2', email: 'rider@example.com', fullName: 'Rae Rider', contact_no: '+12065550101', wallet_balance: 0, created_at: new Date('2026-02-01') },
    { _id: custB, user_id: 'uidB', email: 'boss@example.com', fullName: 'Bo Ss', contact_no: '', wallet_balance: 0, created_at: new Date('2026-03-01') },
  ]);
  await col('trips').insertMany([
    {
      _id: new Types.ObjectId(), no: 1, tripNo: 'ABL-1', customerId: 'uidA2', vehicleId: vehSedan, rideType: 'round-trip', bookingSource: 'Web',
      tripOccasion: 'Airport transfer', noOfPassengers: '2', subTotal: 200, tax: 0, discount: '20', grandTotal: 181, gratuityFinalAmount: 1,
      tripStatus: 'Completed', paymentStatus: 'Paid', paymentReference: 'pi_OLD1', createdAt: new Date('2026-07-30'),
      tripdata: [leg({ driverId: drvA, flightInformation: 'as306' }), leg({ scheduledDate: '08-06-2026', status: 'Cancelled' })],
    },
    {
      _id: new Types.ObjectId(), no: 2, tripNo: 'ABL-2', customerId: 'uidB', vehicleId: vehBus, rideType: 'oneway-trip', bookingSource: 'Admin',
      tripOccasion: 'Wedding', subTotal: 300, tax: 0, discount: '0', grandTotal: 300, tripStatus: 'Trip Confirmed', paymentStatus: 'Unpaid', paymentReference: '-',
      createdAt: new Date('2026-10-20'), tripdata: [leg({ scheduledDate: '11-05-2026', status: 'Trip Confirmed' })],
    },
    {
      _id: new Types.ObjectId(), no: 3, tripNo: 'ABL-3', customerId: 'uid-nobody', customerName: 'Walk In', vehicleId: vehSedan, rideType: 'hourly-trip', bookingSource: 'Admin',
      subTotal: 400, tax: 0, discount: '0', grandTotal: 400, tripStatus: 'Pending', paymentStatus: 'Refunded', paymentReference: 'pi_OLD3',
      createdAt: new Date('2026-05-01'), rejectionReason: 'No cars that day',
      tripdata: [leg({ scheduledDate: '05-09-2026', time: '4', status: 'Cancelled' })],
    },
  ]);
}

beforeAll(startDatabase);
afterAll(stopDatabase);
beforeEach(async () => {
  await resetData();
  for (const n of ['vehicles', 'users', 'customers', 'trips']) await col(n).deleteMany({});
  await VehicleClass.deleteMany({});
  await Wallet.deleteMany({});
  await load();
  await importLegacyAdmins({ apply: true });
});

describe('carrying the old history over', () => {
  it('a dry run reports everything and writes nothing', async () => {
    const before = await Booking.countDocuments();
    const r = await importLegacyHistory({ apply: false, now: NOW });
    expect(r.bookings.created).toBe(4);
    expect(await Booking.countDocuments()).toBe(before);
    expect(await Trip.countDocuments()).toBe(0);
  });

  it('makes one booking per leg, keeping the old trip number and status', async () => {
    const r = await importLegacyHistory({ apply: true, now: NOW });
    expect(r.bookings.created).toBe(4);
    const legs = await Booking.find({ 'legacy.tripNo': 'ABL-1' }).sort({ 'legacy.legIndex': 1 }).lean();
    expect(legs).toHaveLength(2);
    expect(legs[0].journey).toEqual({ index: 0, count: 2 });
    expect(legs[0].flightDetails?.flightNumber).toBe('AS306');
    expect(legs[0].tripType).toBe('airport');
    expect(legs[1].status).toBe('cancelled');
    expect(legs[0].legacy?.status).toBe('Completed');
    // the old text addresses are kept; coordinates were never recorded
    expect(legs[0].pickup).toMatchObject({ address: '1 Pickup St, Seattle, WA', lat: 0, lng: 0 });
  });

  it("splits a round trip's one payment across its legs, and the legs add up to what was charged", async () => {
    await importLegacyHistory({ apply: true, now: NOW });
    const legs = await Booking.find({ 'legacy.tripNo': 'ABL-1' }).sort({ 'legacy.legIndex': 1 }).lean();
    expect(legs.map((l) => l.payment?.leg)).toEqual([0, 1]);
    expect(new Set(legs.map((l) => l.payment?.intentId))).toEqual(new Set(['pi_OLD1']));
    expect(Math.round(legs.reduce((s, l) => s + (l.estimatedFare ?? 0), 0) * 100) / 100).toBe(181);
    expect(legs.reduce((s, l) => s + (l.payment?.amount ?? 0), 0)).toBeCloseTo(181, 2);
  });

  it('refunded old payments stay refunded; unpaid ones carry no payment', async () => {
    await importLegacyHistory({ apply: true, now: NOW });
    const refunded = await Booking.findOne({ 'legacy.tripNo': 'ABL-3' }).lean();
    expect(refunded?.payment).toMatchObject({ status: 'refunded', refundedAmount: 400, intentId: 'pi_OLD3' });
    expect(refunded?.status).toBe('cancelled');
    expect(refunded?.cancellation).toMatchObject({ rejected: true, reason: 'No cars that day' });
    expect(refunded?.hours).toBe(4);
    const unpaid = await Booking.findOne({ 'legacy.tripNo': 'ABL-2' }).lean();
    expect(unpaid?.payment).toBeUndefined();
    expect(unpaid?.legacy?.paymentStatus).toBe('Unpaid');
  });

  it('an upcoming job without a chauffeur lands in the dispatch queue', async () => {
    await importLegacyHistory({ apply: true, now: NOW });
    const b = await Booking.findOne({ 'legacy.tripNo': 'ABL-2' }).lean();
    expect(b?.status).toBe('pending');
    expect(b?.source).toBe('admin');
  });

  it('creates a completed, already-settled trip for a leg with a chauffeur', async () => {
    await importLegacyHistory({ apply: true, now: NOW });
    const booking = await Booking.findOne({ 'legacy.tripNo': 'ABL-1', 'legacy.legIndex': 0 }).lean();
    const trip = await Trip.findOne({ bookingId: booking!._id }).lean();
    expect(trip).toMatchObject({ status: 'completed', settled: true, creditApplied: 0 });
    const driver = await Driver.findById(trip!.driverId).lean();
    expect(driver?.userId).toBeTruthy();
    // a settled trip can never pay the chauffeur a second time
    expect(await Trip.countDocuments({ settled: false, status: 'completed' })).toBe(0);
  });

  it('merges two old accounts with one email into a single customer and keeps both sign-in ids', async () => {
    const r = await importLegacyHistory({ apply: true, now: NOW });
    expect(r.mergedDuplicateCustomers).toBe(1);
    const rae = await User.find({ email: 'rider@example.com' }).lean();
    expect(rae).toHaveLength(1);
    expect(rae[0]).toMatchObject({ role: 'customer', legacyAuth: 'firebase', firebaseUid: 'uidA', phone: '+12065550101' });
    expect(rae[0].legacy?.mergedUids).toEqual(['uidA2']);
    expect(rae[0].legacy?.stripeId).toBe('cus_old');
    // the trip that belonged to the merged account now belongs to the one customer
    const b = await Booking.findOne({ 'legacy.tripNo': 'ABL-1' }).lean();
    expect(String(b?.customerId)).toBe(String(rae[0]._id));
  });

  it('carries the wallet balance over', async () => {
    const r = await importLegacyHistory({ apply: true, now: NOW });
    expect(r.walletCreditTotal).toBe(110);
    const rae = await User.findOne({ email: 'rider@example.com' }).lean();
    const wallet = await Wallet.findById(rae!.walletId).lean();
    expect(wallet?.balance).toBe(110);
  });

  it('gives clashing staff and customers distinct sign-ins instead of dropping them', async () => {
    const r = await importLegacyHistory({ apply: true, now: NOW });
    // admin "boss" exists; a chauffeur is also called "boss", and another shares its email
    const drivers = await User.find({ role: 'driver' }).select('username email').lean();
    expect(drivers.map((d) => d.username).sort()).toEqual(['boss-2', 'drvb']);
    expect(new Set(drivers.map((d) => d.email)).size).toBe(2);
    expect(r.aliasedCustomerEmails.length).toBeGreaterThan(0);
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it('keeps a trip whose customer is unknown under a guest placeholder', async () => {
    const r = await importLegacyHistory({ apply: true, now: NOW });
    expect(r.placeholderCustomers).toBe(1);
    const b = await Booking.findOne({ 'legacy.tripNo': 'ABL-3' }).lean();
    const u = await User.findById(b!.customerId).lean();
    expect(u).toMatchObject({ isGuest: true, name: 'Walk In' });
    expect(u?.email.endsWith('@no-email.invalid')).toBe(true);
  });

  it('brings the old vehicles over switched off, with unique names', async () => {
    await importLegacyHistory({ apply: true, now: NOW });
    const classes = await VehicleClass.find({ value: /^legacy-/ }).lean();
    expect(classes.map((c) => c.value).sort()).toEqual(['legacy-executive-sedan', 'legacy-executive-sedan-2']);
    expect(classes.every((c) => c.active === false)).toBe(true);
  });

  it('is safe to run again: a second run adds nothing', async () => {
    await importLegacyHistory({ apply: true, now: NOW });
    const counts = async () => [
      await Booking.countDocuments(),
      await Trip.countDocuments(),
      await User.countDocuments(),
      await Wallet.countDocuments(),
      await Driver.countDocuments(),
    ];
    const before = await counts();
    const second = await importLegacyHistory({ apply: true, now: NOW });
    expect(second.bookings.created + second.trips.created + second.customers.created + second.drivers.created + second.vehicles.created).toBe(0);
    expect(await counts()).toEqual(before);
  });
});
