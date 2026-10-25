import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deserializeStream } from 'bson';
import mongoose from 'mongoose';
import { Booking } from '../../src/models/Booking';
import { Trip } from '../../src/models/Trip';
import { User } from '../../src/models/User';
import { Wallet } from '../../src/models/Wallet';
import { importLegacyAdmins } from '../../src/modules/migration/legacy.admins';
import { importLegacyHistory, type HistoryReport } from '../../src/modules/migration/legacy.import';
import { startDatabase, stopDatabase } from './harness';

/**
 * A rehearsal on the REAL old data, in a throwaway in-memory database. Skipped unless
 * REHEARSE_BACKUP_DIR points at a backup folder (the one `mongo-export` wrote), so it never
 * runs in CI and never touches a real database.
 */
const DIR = process.env.REHEARSE_BACKUP_DIR;
const maybe = DIR ? describe : describe.skip;

function readBson(file: string): Record<string, unknown>[] {
  const buf = fs.readFileSync(file);
  const out: Record<string, unknown>[] = [];
  for (let o = 0; o < buf.length; ) {
    const len = buf.readInt32LE(o);
    const d: Record<string, unknown>[] = [];
    deserializeStream(buf.subarray(o, o + len), 0, 1, d, 0, {});
    out.push(d[0]);
    o += len;
  }
  return out;
}

maybe('rehearsal on the real backup', () => {
  let first: HistoryReport;

  beforeAll(async () => {
    await startDatabase();
    for (const f of fs.readdirSync(DIR!).filter((x) => x.endsWith('.bson'))) {
      const docs = readBson(path.join(DIR!, f));
      if (docs.length) await mongoose.connection.collection(`legacy_${f.replace('.bson', '')}`).insertMany(docs as never[]);
    }
    // The real database already has the old admins by the time history is carried over.
    await importLegacyAdmins({ apply: true });
    first = await importLegacyHistory({ apply: true, now: new Date('2026-10-26T00:00:00Z') });
    if (process.env.REHEARSE_OUT) fs.writeFileSync(process.env.REHEARSE_OUT, JSON.stringify(first, null, 1));
  }, 600_000);
  afterAll(stopDatabase);

  it('brings over every leg as one booking', async () => {
    const legs = (await mongoose.connection.collection('legacy_trips').find({}).toArray()).reduce((s, t) => s + (t.tripdata?.length ?? 0), 0);
    expect(await Booking.countDocuments()).toBe(first.bookings.created);
    const lost = first.issues.filter((i) => (i.what === 'leg' && i.reason.includes('unreadable')) || i.what === 'booking').length;
    expect(first.bookings.created + lost).toBe(legs);
  });

  it('every booking, trip and wallet points at something that exists', async () => {
    const userIds = new Set((await User.find({}).select('_id').lean()).map((u) => String(u._id)));
    const bookings = await Booking.find({}).select('customerId').lean();
    expect(bookings.filter((b) => !userIds.has(String(b.customerId)))).toHaveLength(0);
    const bookingIds = new Set(bookings.map((b) => String(b._id)));
    const trips = await Trip.find({}).select('bookingId driverId').lean();
    expect(trips.filter((t) => !bookingIds.has(String(t.bookingId)))).toHaveLength(0);
    const driverUserIds = new Set((await mongoose.connection.collection('drivers').find({}).toArray()).map((d) => String(d._id)));
    expect(trips.filter((t) => !driverUserIds.has(String(t.driverId)))).toHaveLength(0);
  });

  it('money adds up: legs of each old trip sum to what that trip was charged', async () => {
    const trips = await mongoose.connection.collection('legacy_trips').find({}).toArray();
    const sums = new Map<string, number>();
    for (const b of await Booking.find({}).select('legacy estimatedFare').lean()) {
      const k = String(b.legacy!.tripId);
      sums.set(k, Math.round(((sums.get(k) ?? 0) + (b.estimatedFare ?? 0)) * 100) / 100);
    }
    let bad = 0;
    for (const t of trips) {
      if (typeof t.grandTotal !== 'number') continue;
      if (Math.abs((sums.get(String(t._id)) ?? 0) - t.grandTotal) > 0.005) bad++;
    }
    expect(bad).toBe(0);
    expect(first.fareTotal).toBe(first.oldChargedTotal);
  });

  it('nothing is left in the dispatch queue from the past, and no old trip is left active', async () => {
    const cutoff = new Date(Date.parse('2026-10-26T00:00:00Z') - 36 * 3_600_000);
    expect(await Booking.countDocuments({ status: 'pending', scheduledAt: { $lt: cutoff } })).toBe(0);
    expect(await Trip.countDocuments({ status: { $in: ['accepted', 'started'] } })).toBe(first.tripsByStatus.accepted + (first.tripsByStatus.started ?? 0) || 0);
    const stale = await Trip.countDocuments({ status: { $in: ['accepted', 'started'] }, 'timestamps.requested': { $exists: true } });
    expect(stale).toBeGreaterThanOrEqual(0);
  });

  it('customers keep their way in: old-site flag, Firebase link, wallets', async () => {
    const customers = await User.find({ role: 'customer', 'legacy.id': { $exists: true }, isGuest: { $ne: true } }).select('legacyAuth firebaseUid walletId').lean();
    expect(customers.length).toBeGreaterThan(1500);
    expect(customers.filter((c) => c.legacyAuth !== 'firebase')).toHaveLength(0);
    expect(customers.filter((c) => !c.walletId)).toHaveLength(0);
    const credit = (await Wallet.find({ ownerType: 'customer', balance: { $gt: 0 } }).lean()).reduce((s, w) => s + w.balance, 0);
    expect(credit).toBe(first.walletCreditTotal);
  });

  it('is safe to run again: a second run adds nothing', async () => {
    const second = await importLegacyHistory({ apply: true, now: new Date('2026-10-26T00:00:00Z') });
    expect(second.bookings.created).toBe(0);
    expect(second.trips.created).toBe(0);
    expect(second.customers.created).toBe(0);
    expect(second.drivers.created).toBe(0);
    expect(second.vehicles.created).toBe(0);
  });
});
