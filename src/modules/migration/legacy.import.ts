import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import mongoose, { Types, type Model } from 'mongoose';
import { MAX_CAR_SEATS, MAX_JOURNEY_LEGS } from '../../config/services';
import { Booking } from '../../models/Booking';
import { Driver } from '../../models/Driver';
import { Transaction } from '../../models/Transaction';
import { Trip } from '../../models/Trip';
import { User } from '../../models/User';
import { VehicleClass } from '../../models/VehicleClass';
import { Wallet } from '../../models/Wallet';
import { planStaff, type LegacyUserDoc } from './legacy.admins';
import {
  hoursOf,
  mapLegState,
  normaliseOccasion,
  isPlausiblePickup,
  parseLegacyWhen,
  planCustomer,
  slugify,
  tripMoney,
  tripTypeOf,
  type LegacyCustomerDoc,
  type LegacyTrip,
} from './legacy.convert';

/**
 * Carries the old system's history into this app's own collections.
 *
 * Reads the `legacy_*` copies that sit in this same database (a byte-identical copy of the
 * old data) and writes only to this app's collections: vehicle classes, drivers, customers,
 * wallets, bookings and trips. Nothing is ever read from or written to the old live database.
 *
 * Safe to run twice: every record carries the id it had before, and anything already carried
 * over is left alone, so a second run only adds what is missing.
 *
 * Not carried into the new collections (they stay readable in `legacy_*`): coordinates,
 * because the old data only has street addresses as text; the old Stripe customers, because
 * they belong to a different Stripe account; abandoned checkouts (`legacy_unpaid_trips`);
 * and the partner-portal, hotel and referral data this app does not have.
 */

export interface Tally {
  existing: number;
  created: number;
}
export interface Issue {
  what: string;
  id: string;
  reason: string;
}
export interface HistoryReport {
  apply: boolean;
  vehicles: Tally;
  drivers: Tally;
  customers: Tally;
  placeholderCustomers: number;
  aliasedCustomerEmails: string[];
  mergedDuplicateCustomers: number;
  wallets: Tally;
  walletCreditTotal: number;
  bookings: Tally;
  trips: Tally;
  bookingsByStatus: Record<string, number>;
  tripsByStatus: Record<string, number>;
  closedOnImport: number;
  withStripePayment: number;
  /** Things done on purpose that a person may want to know about (renames, aliases). */
  notes: string[];
  fareTotal: number;
  /** Sum of what the old trips were charged, to compare against `fareTotal`. */
  oldChargedTotal: number;
  issues: Issue[];
}

const zero = (): Tally => ({ existing: 0, created: 0 });
const BCRYPT_COST = 4;

type Raw = Record<string, unknown>;
const idStr = (v: unknown): string => String(v ?? '');
const asDate = (v: unknown): Date | undefined => (v instanceof Date && !Number.isNaN(v.getTime()) ? v : undefined);
const intIn = (v: unknown, min: number, max: number): number | undefined => {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};
const bump = (m: Record<string, number>, k: string) => {
  m[k] = (m[k] ?? 0) + 1;
};
const unusableHash = (): Promise<string> => bcrypt.hash(crypto.randomBytes(24).toString('base64url'), BCRYPT_COST);

async function readLegacy<T = Raw>(name: string, filter: Raw = {}): Promise<T[]> {
  return (await mongoose.connection.collection(`legacy_${name}`).find(filter).toArray()) as unknown as T[];
}

/**
 * Validates each document and keeps the ones that pass, then inserts those in batches.
 * A document that fails validation is reported and skipped; it never stops the rest.
 */
async function insertAll<T>(model: Model<T>, docs: Raw[], what: string, issues: Issue[], apply: boolean): Promise<number> {
  const valid: InstanceType<typeof model>[] = [];
  for (const raw of docs) {
    const doc = new model(raw);
    const err = await doc.validate().then(
      () => null,
      (e: unknown) => e as Error,
    );
    if (err) issues.push({ what, id: idStr(raw._id), reason: err.message.slice(0, 200) });
    else valid.push(doc);
  }
  if (apply) {
    for (let i = 0; i < valid.length; i += 400) {
      await model.insertMany(valid.slice(i, i + 400), { timestamps: false });
    }
  }
  return valid.length;
}

export async function importLegacyHistory(options: { apply: boolean; now?: Date }): Promise<HistoryReport> {
  const { apply } = options;
  const now = options.now ?? new Date();
  const importedAt = now;
  const issues: Issue[] = [];
  const report: HistoryReport = {
    apply,
    vehicles: zero(),
    drivers: zero(),
    customers: zero(),
    placeholderCustomers: 0,
    aliasedCustomerEmails: [],
    mergedDuplicateCustomers: 0,
    wallets: zero(),
    walletCreditTotal: 0,
    bookings: zero(),
    trips: zero(),
    bookingsByStatus: {},
    tripsByStatus: {},
    closedOnImport: 0,
    withStripePayment: 0,
    notes: [],
    fareTotal: 0,
    oldChargedTotal: 0,
    issues,
  };

  const [legacyVehicles, legacyStaff, legacyCustomers, legacyTrips] = await Promise.all([
    readLegacy('vehicles'),
    readLegacy<LegacyUserDoc & Raw>('users', { designation: 'Driver' }),
    readLegacy<LegacyCustomerDoc & Raw>('customers'),
    readLegacy<LegacyTrip & Raw>('trips'),
  ]);

  /* ------------------------------ vehicle classes ------------------------------ */
  // Imported switched OFF: they exist so old bookings can still name their vehicle, and ops
  // decide which to bring back (and at what price) in the admin.
  const existingClasses = new Map((await VehicleClass.find({ value: /^legacy-/ }).select('value').lean()).map((c) => [c.value, true]));
  const vehicleValue = new Map<string, string>();
  const taken = new Set<string>();
  const classDocs: Raw[] = [];
  for (const v of legacyVehicles) {
    const base = `legacy-${slugify(String(v.vehicleName ?? 'vehicle')) || 'vehicle'}`;
    let value = base;
    for (let n = 2; taken.has(value); n++) value = `${base}-${n}`;
    taken.add(value);
    vehicleValue.set(idStr(v._id), value);
    if (existingClasses.has(value)) {
      report.vehicles.existing++;
      continue;
    }
    const price = (x: unknown): number | null => {
      const n = parseFloat(String(x ?? ''));
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    classDocs.push({
      value,
      label: String(v.vehicleName ?? 'Vehicle').trim(),
      detail: String(v.feature ?? '').trim() || undefined,
      seats: intIn(v.maxPersons, 1, 60) ?? 1,
      bags: intIn(v.maxBags, 0, 60) ?? 0,
      multiplier: 1,
      usage: 'all',
      flatRate: price(v.basePrice),
      hourlyRate: price(v.pricePerUnitHour),
      stopFee: price(v.stopPrice),
      images: [],
      active: false,
      sortOrder: 100 + (typeof v.slNo === 'number' ? v.slNo : 0),
    });
  }
  report.vehicles.created = await insertAll(VehicleClass, classDocs, 'vehicle', issues, apply);
  const fallbackVehicle = vehicleValue.values().next().value as string | undefined;

  /* ------------------------------------ people ------------------------------------ */
  const allUsers = await User.find({}).select('email username role legacy.id').lean();
  const takenEmails = new Map<string, string>(allUsers.map((u) => [u.email, u.role]));
  const takenUsernames = new Set(allUsers.map((u) => u.username).filter(Boolean) as string[]);
  const existingByLegacy = new Map<string, Types.ObjectId>(
    allUsers.filter((u) => u.legacy?.id).map((u) => [idStr(u.legacy!.id), u._id as Types.ObjectId]),
  );

  // Chauffeurs: same username + bcrypt password they had, so they keep signing in.
  const driverByOldId = new Map<string, Types.ObjectId>();
  const vehicleOfDriver = new Map<string, Map<string, number>>();
  for (const t of legacyTrips) {
    for (const l of t.tripdata ?? []) {
      const d = idStr(l.driverId ?? t.driverId);
      const veh = vehicleValue.get(idStr(t.vehicleId));
      if (!d || !veh) continue;
      const m = vehicleOfDriver.get(d) ?? new Map<string, number>();
      m.set(veh, (m.get(veh) ?? 0) + 1);
      vehicleOfDriver.set(d, m);
    }
  }
  const existingDrivers = new Map((await Driver.find({}).select('userId').lean()).map((d) => [idStr(d.userId), d._id as Types.ObjectId]));

  const staffUsers: Raw[] = [];
  const staffWallets: Raw[] = [];
  const driverDocs: Raw[] = [];
  for (const doc of legacyStaff) {
    const oldId = idStr(doc._id);
    const known = existingByLegacy.get(oldId);
    if (known) {
      report.drivers.existing++;
      const d = existingDrivers.get(idStr(known));
      if (d) driverByOldId.set(oldId, d);
      continue;
    }
    const plan = planStaff(doc, 'driver');
    if (!plan.ok) {
      issues.push({ what: 'driver', id: oldId, reason: plan.reason });
      continue;
    }
    const u = { ...plan.user };
    // The same person can have an admin account and a chauffeur account, and the old data has
    // chauffeurs sharing a username. Each keeps their own account: a clash gets a distinct
    // sign-in name and an email alias (which still reaches the same inbox) instead of being dropped.
    const wanted = { username: u.username, email: u.email };
    for (let n = 2; takenUsernames.has(u.username); n++) u.username = `${wanted.username}-${n}`;
    for (let n = 1; takenEmails.has(u.email); n++) {
      const [local, domain] = wanted.email.split('@');
      u.email = `${local}+driver${n > 1 ? n : ''}@${domain}`;
    }
    if (u.username !== wanted.username || u.email !== wanted.email) {
      report.notes.push(`chauffeur "${wanted.username}" signs in as "${u.username}" with ${u.email === wanted.email ? 'the same' : 'an aliased'} email (the original was already taken)`);
    }
    takenEmails.set(u.email, 'driver');
    takenUsernames.add(u.username);
    const userId = new Types.ObjectId();
    const walletId = new Types.ObjectId();
    const driverId = new Types.ObjectId();
    const mine = vehicleOfDriver.get(oldId);
    const vehicleClass = mine ? [...mine.entries()].sort((a, b) => b[1] - a[1])[0][0] : fallbackVehicle ?? 'legacy-unknown';
    const { emailIsPlaceholder: _p, ...fields } = u as typeof u & { emailIsPlaceholder: boolean };
    const created = asDate(doc.created_at) ?? importedAt;
    staffUsers.push({ _id: userId, ...fields, walletId, phoneVerified: false, isGuest: false, legacy: { id: doc._id, importedAt }, createdAt: created, updatedAt: created });
    staffWallets.push({ _id: walletId, ownerId: userId, ownerType: 'driver', balance: 0, createdAt: created, updatedAt: created });
    driverDocs.push({ _id: driverId, userId, vehicleClass, status: 'offline', operatorType: 'independent', createdAt: created, updatedAt: created });
    driverByOldId.set(oldId, driverId);
  }
  report.drivers.created = await insertAll(User, staffUsers, 'driver user', issues, apply);
  await insertAll(Wallet, staffWallets, 'driver wallet', issues, apply);
  await insertAll(Driver, driverDocs, 'driver', issues, apply);

  // Customers. Two old accounts with the same email become ONE account here; the other
  // account's sign-in id is kept on it so nothing is orphaned.
  const sorted = [...legacyCustomers].sort(
    (a, b) => (asDate(a.created_at)?.getTime() ?? 0) - (asDate(b.created_at)?.getTime() ?? 0) || idStr(a._id).localeCompare(idStr(b._id)),
  );
  const groups = new Map<string, (LegacyCustomerDoc & Raw)[]>();
  for (const c of sorted) {
    const key = (c.email ?? '').trim().toLowerCase();
    if (!key) {
      issues.push({ what: 'customer', id: idStr(c._id), reason: 'no email' });
      continue;
    }
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }

  const customerByUid = new Map<string, Types.ObjectId>();
  const customerUsers: Raw[] = [];
  const customerWallets: Raw[] = [];
  const customerCredits: Raw[] = [];
  for (const [, group] of groups) {
    const head = group[0];
    const plan = planCustomer(head);
    const headId = idStr(head._id);
    const known = existingByLegacy.get(headId);
    if (!plan) {
      issues.push({ what: 'customer', id: headId, reason: 'email is not valid' });
      continue;
    }
    let userId: Types.ObjectId;
    if (known) {
      userId = known;
      report.customers.existing++;
    } else {
      let email = plan.email;
      const clash = takenEmails.get(email);
      if (clash) {
        // A staff account already uses this email. Plus-addressing still reaches the same inbox.
        const [local, domain] = email.split('@');
        email = `${local}+customer@${domain}`;
        report.aliasedCustomerEmails.push(plan.email);
      }
      takenEmails.set(email, 'customer');
      userId = new Types.ObjectId();
      const walletId = new Types.ObjectId();
      const created = asDate(head.created_at) ?? importedAt;
      const balance = group.reduce((s, c) => s + (typeof c.wallet_balance === 'number' && c.wallet_balance > 0 ? c.wallet_balance : 0), 0);
      customerUsers.push({
        _id: userId,
        role: 'customer',
        name: plan.name,
        firstName: plan.firstName,
        lastName: plan.lastName,
        email,
        phone: plan.phone,
        ...(plan.address ? { address: plan.address } : {}),
        passwordHash: await unusableHash(),
        ...(head.user_id ? { firebaseUid: head.user_id } : {}),
        legacyAuth: 'firebase',
        walletId,
        status: 'active',
        phoneVerified: false,
        isGuest: group.every((c) => c.isGuest === true),
        legacy: {
          id: head._id,
          ...(head.stripeId ? { stripeId: head.stripeId } : {}),
          ...(head.documentStatus ? { documentStatus: head.documentStatus } : {}),
          ...(group.length > 1 ? { mergedIds: group.slice(1).map((c) => c._id), mergedUids: group.slice(1).map((c) => c.user_id).filter(Boolean) } : {}),
          importedAt,
        },
        createdAt: created,
        updatedAt: created,
      });
      customerWallets.push({ _id: walletId, ownerId: userId, ownerType: 'customer', balance, createdAt: created, updatedAt: created });
      if (balance > 0) {
        customerCredits.push({
          walletId,
          type: 'credit',
          amount: balance,
          feeApplied: 0,
          meta: { reason: 'legacy_balance', note: 'Balance carried over from the old system' },
          createdAt: created,
          updatedAt: created,
        });
        report.walletCreditTotal += balance;
      }
      if (group.length > 1) report.mergedDuplicateCustomers += group.length - 1;
    }
    for (const c of group) if (c.user_id) customerByUid.set(c.user_id, userId);
  }
  report.customers.created = await insertAll(User, customerUsers, 'customer', issues, apply);
  report.wallets.created = await insertAll(Wallet, customerWallets, 'customer wallet', issues, apply);
  await insertAll(Transaction, customerCredits, 'wallet credit', issues, apply);

  /* ----------------------------- bookings and trips ----------------------------- */
  const doneBookings = new Map<string, Types.ObjectId>();
  for (const b of await Booking.find({ 'legacy.tripId': { $exists: true } }).select('legacy.tripId legacy.legIndex').lean()) {
    doneBookings.set(`${idStr(b.legacy!.tripId)}:${b.legacy!.legIndex}`, b._id as Types.ObjectId);
  }
  const haveTrip = new Set((await Trip.find({}).select('bookingId').lean()).map((t) => idStr(t.bookingId)));

  const placeholderUsers: Raw[] = [];
  const placeholderWallets: Raw[] = [];
  const bookingDocs: Raw[] = [];
  const tripDocs: Raw[] = [];

  const ordered = [...legacyTrips].sort((a, b) => Number((a as Raw).no ?? 0) - Number((b as Raw).no ?? 0));
  for (const trip of ordered) {
    const tripId = idStr(trip._id);
    const legs = trip.tripdata ?? [];
    const createdAt = asDate(trip.createdAt);
    const money = tripMoney(trip);
    report.oldChargedTotal += money.reduce((s, m) => s + m.fare, 0);

    // A placeholder made by an earlier run is found again by the trip it was made for.
    let customerId = customerByUid.get(trip.customerId ?? '') ?? existingByLegacy.get(tripId);
    if (!customerId) {
      // A trip whose customer is not in the customer list: keep the trip under a guest placeholder.
      customerId = new Types.ObjectId();
      const walletId = new Types.ObjectId();
      const email = `unknown-${slugify(trip.tripNo ?? tripId) || tripId}@no-email.invalid`;
      placeholderUsers.push({
        _id: customerId,
        role: 'customer',
        name: (trip.customerName ?? '').trim() || 'Unknown customer',
        email,
        phone: 'n/a',
        passwordHash: await unusableHash(),
        walletId,
        status: 'active',
        phoneVerified: false,
        isGuest: true,
        legacy: { id: trip._id, importedAt },
        createdAt: createdAt ?? importedAt,
        updatedAt: createdAt ?? importedAt,
      });
      placeholderWallets.push({ _id: walletId, ownerId: customerId, ownerType: 'customer', balance: 0 });
      report.placeholderCustomers++;
      issues.push({ what: 'trip', id: tripId, reason: `customer ${trip.customerId ?? '(none)'} is not in the customer list; kept under a guest placeholder` });
    }

    const vehicleClass = vehicleValue.get(idStr(trip.vehicleId)) ?? fallbackVehicle ?? 'legacy-unknown';
    const paid = trip.paymentStatus === 'Paid' || trip.paymentStatus === 'Refunded';
    const piRef = /^pi_/.test(trip.paymentReference ?? '') ? (trip.paymentReference as string) : undefined;
    const passenger = (trip.additionalPassengerDetails ?? [])[0];

    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      const key = `${tripId}:${i}`;
      const when = parseLegacyWhen(leg.scheduledDate, leg.scheduledTime, createdAt);
      if (when && !isPlausiblePickup(when)) {
        issues.push({ what: 'leg', id: key, reason: `pickup date ${leg.scheduledDate} looks like a typo (trip ${trip.tripNo ?? tripId}); imported as written` });
      }
      if (!when) {
        issues.push({ what: 'leg', id: key, reason: `unreadable pickup date "${leg.scheduledDate ?? ''}"` });
        continue;
      }
      const driverOld = idStr(leg.driverId ?? trip.driverId);
      const driverId = driverOld ? driverByOldId.get(driverOld) : undefined;
      const state = mapLegState({
        legStatus: leg.status,
        tripStatus: trip.tripStatus,
        rejectionReason: trip.rejectionReason,
        hasDriver: Boolean(driverId),
        scheduledAt: when,
        now,
        paid,
      });
      const m = money[i];
      const existingId = doneBookings.get(key);
      const bookingId = existingId ?? new Types.ObjectId();
      const created = createdAt ?? when;

      if (existingId) {
        report.bookings.existing++;
      } else {
        const stops = (leg.stops ?? []).map((s) => (s.content ?? '').trim()).filter(Boolean).map((address) => ({ lat: 0, lng: 0, address }));
        const seats = (leg.additionalSeats ?? []).reduce((a, s) => a + (parseInt(String(s.count ?? 1), 10) || 0), 0);
        const note = (leg.shortDescription ?? '').trim();
        bookingDocs.push({
          _id: bookingId,
          customerId,
          pickup: { lat: 0, lng: 0, address: (leg.source ?? '').trim() || 'Unknown' },
          drop: { lat: 0, lng: 0, address: (leg.destination ?? '').trim() || 'Unknown' },
          vehicleClass,
          passengers: intIn(trip.noOfPassengers, 1, 60),
          tripType: tripTypeOf(trip),
          ...((leg.flightInformation ?? '').trim() ? { flightDetails: { flightNumber: (leg.flightInformation as string).trim() } } : {}),
          ...(tripTypeOf(trip) === 'hourly' && hoursOf(leg) ? { hours: hoursOf(leg) } : {}),
          meetAndGreet: Boolean(leg.meetAndGreet),
          carSeats: Math.min(seats, MAX_CAR_SEATS),
          isGuest: Boolean(trip.isGuest),
          source: trip.bookingSource === 'Admin' ? 'admin' : 'customer',
          ...(legs.length >= 2 && legs.length <= MAX_JOURNEY_LEGS ? { journey: { index: i, count: legs.length } } : {}),
          ...(stops.length ? { stops } : {}),
          occasion: normaliseOccasion(trip.tripOccasion),
          occasionDetails: (trip.tripOccasionDetails ?? '').trim().slice(0, 200) || undefined,
          carryOnBags: intIn(trip.carryOnBagsCount, 0, 60),
          checkedBags: intIn(trip.checkedBagCount, 0, 60),
          ...(passenger?.passengerName ? { passengerName: passenger.passengerName.trim().slice(0, 120) } : {}),
          ...(passenger?.passengerContactNo ? { passengerPhone: String(passenger.passengerContactNo).trim().slice(0, 30) } : {}),
          serviceNotes: note ? [`Customer note: ${note}`.slice(0, 300)] : [],
          ...(piRef && paid
            ? {
                payment: {
                  provider: 'stripe',
                  intentId: piRef,
                  leg: Math.min(i, MAX_JOURNEY_LEGS - 1),
                  amount: m.fare,
                  currency: 'usd',
                  status: trip.paymentStatus === 'Refunded' ? 'refunded' : 'paid',
                  refundedAmount: trip.paymentStatus === 'Refunded' ? m.fare : 0,
                  refundIds: [],
                  paidAt: asDate(trip.paidAt) ?? created,
                },
              }
            : {}),
          status: state.booking,
          amendments: [],
          ...(state.booking === 'cancelled'
            ? {
                cancellation: {
                  by: 'admin',
                  byName: 'Old system',
                  at: created,
                  ...(state.rejected ? { rejected: true } : {}),
                  ...((state.rejected ? trip.rejectionReason : state.cancelReason)
                    ? { reason: String((state.rejected ? trip.rejectionReason : state.cancelReason) ?? '').slice(0, 300) }
                    : {}),
                },
              }
            : {}),
          scheduledAt: when,
          originalScheduledAt: when,
          city: 'seattle',
          estimatedFare: m.fare,
          fareBreakdown: m.breakdown,
          legacy: {
            tripId: trip._id,
            tripNo: trip.tripNo,
            legIndex: i,
            legCount: legs.length,
            status: (leg.status || trip.tripStatus || '').trim() || undefined,
            rideType: trip.rideType,
            paymentStatus: trip.paymentStatus,
            paymentMethod: trip.paymentMethod,
            bookingSource: trip.bookingSource,
            ...(state.closedOnImport ? { closedOnImport: true } : {}),
            importedAt,
          },
          createdAt: created,
          updatedAt: created,
        });
        bump(report.bookingsByStatus, state.booking);
        report.fareTotal += m.fare;
        if (piRef && paid) report.withStripePayment++;
        if (state.closedOnImport) report.closedOnImport++;
      }

      if (state.trip && driverId && !haveTrip.has(idStr(bookingId))) {
        const t = state.trip;
        tripDocs.push({
          _id: new Types.ObjectId(),
          bookingId,
          driverId,
          status: t,
          fareAmount: m.fare,
          ...(m.breakdown.tax ? { taxAmount: m.breakdown.tax } : {}),
          timestamps: {
            requested: created,
            assigned: created,
            accepted: created,
            ...(state.stages.confirmed ? { confirmed: created } : {}),
            ...(state.stages.enroute ? { enroute: when } : {}),
            ...(state.stages.arrived ? { arrived: when } : {}),
            ...(t === 'started' || t === 'completed' ? { started: when } : {}),
            ...(t === 'completed' ? { completed: when } : {}),
          },
          penaltyApplied: false,
          ...(t === 'cancelled'
            ? { cancellation: { cancelledBy: 'admin', cancelledByName: 'Old system' } }
            : {}),
          creditApplied: 0,
          // Old trips were paid out long ago: nothing here may pay a driver again.
          settled: t === 'completed',
          createdAt: created,
          updatedAt: created,
        });
        bump(report.tripsByStatus, t);
      }
    }
  }

  report.customers.created += await insertAll(User, placeholderUsers, 'placeholder customer', issues, apply);
  await insertAll(Wallet, placeholderWallets, 'placeholder wallet', issues, apply);
  report.bookings.created = await insertAll(Booking, bookingDocs, 'booking', issues, apply);
  report.trips.created = await insertAll(Trip, tripDocs, 'trip', issues, apply);
  report.wallets.created += report.drivers.created;
  report.trips.existing = haveTrip.size;
  report.fareTotal = Math.round(report.fareTotal * 100) / 100;
  report.oldChargedTotal = Math.round(report.oldChargedTotal * 100) / 100;
  return report;
}
