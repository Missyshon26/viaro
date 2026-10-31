/**
 * Seeds a realistic slice of ABL data for manual testing (Postman, Compass).
 *
 *   npm run seed        populate
 *   npm run seed:clean  remove everything this script created
 *
 * Every account uses the same password so the Postman collection can log in as anyone.
 * Safe to re-run: it clears its own records first.
 */
import { connectMongo, disconnectMongo } from '../config/db';
import { connectRedis, disconnectRedis } from '../config/redis';
import { User } from '../models/User';
import { Driver } from '../models/Driver';
import { Company } from '../models/Company';
import { PricingRule } from '../models/PricingRule';
import { Subscription } from '../models/Subscription';
import { Booking } from '../models/Booking';
import { Trip } from '../models/Trip';
import { Rating } from '../models/Rating';
import { Wallet } from '../models/Wallet';
import { Transaction } from '../models/Transaction';
import { ChatMessage } from '../models/ChatMessage';
import { Notification } from '../models/Notification';
import { PenaltyEvent } from '../models/PenaltyEvent';
import { SupportTicket } from '../models/SupportTicket';
import { PaymentMethod } from '../models/PaymentMethod';
import * as authService from '../modules/auth/auth.service';
import * as walletService from '../modules/wallet/wallet.service';
import { now, toDate } from '../config/timezone';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Test-account password.
 *
 * It must satisfy the SAME 8-character minimum auth.validation.ts enforces on
 * POST /auth/register. It used to be 7 characters, which worked here (the seed calls
 * authService.register() directly, bypassing the route middleware that carries the rule)
 * but broke every consumer that signed in through the real endpoint — it was the direct
 * cause of 10 of the 11 failing Postman assertions. Seed data that cannot log in through
 * the public API is seed data that tests nothing.
 */
export const SEED_PASSWORD = 'test1234';
export const SEED_CITY = 'los angeles';

/**
 * The cities the *design* serves, priced the way the design prices them.
 *
 * SEED_CITY above stays Los Angeles because the Postman collection is generated
 * against it (scripts/generate-postman.js). But every route in the Figma file is
 * Puget Sound, so without these rules `calculateFare` throws
 * "No pricing rule configured for city 'Seattle'" and the whole web booking flow
 * 404s on GET /pricing/fare-estimate.
 *
 * baseFare 129 / peakMultiplier 1.18 are the design's own numbers: with the 8.9% tax
 * the frontend applies, 129 × 1.18 × 1.089 = $165.77, which is the total printed on
 * "04 · Step 3 · Review and pay". Every other fare in the file follows from them.
 */
export const DESIGN_CITIES = ['seattle', 'bellevue', 'tacoma', 'kirkland', 'everett'];
const DESIGN_BASE_FARE = 129;
const DESIGN_PEAK_MULTIPLIER = 1.18;
/** Every seeded account uses this domain, which is also how cleanup finds them. */
export const SEED_DOMAIN = '@abl.test';

/**
 * Accounts cleanup will remove: the seeded ones, plus the throwaway accounts the Postman
 * collection registers (Postman's $randomExampleEmail produces example.com/org/net).
 * Deliberately narrow — it can never match a real customer's address.
 *
 * `viaro.test` is the domain seeded accounts used before the rename to ABL. It stays in the
 * pattern so a development database seeded back then can still be cleaned up.
 */
export const TEST_EMAIL_PATTERN = /@(abl\.test|viaro\.test|example\.(com|org|net))$/i;

const accounts = {
  admin: { role: 'admin' as const, name: 'Ava Admin', email: `admin${SEED_DOMAIN}`, phone: '+15550100001' },
  company: { role: 'company' as const, name: 'Sunset Fleet Ltd', email: `company${SEED_DOMAIN}`, phone: '+15550100002' },
  driverCompany: { role: 'driver' as const, name: 'Diego Fleet-Driver', email: `driver.company${SEED_DOMAIN}`, phone: '+15550100003', vehicleClass: 'suv' },
  driverPlatform: { role: 'driver' as const, name: 'Priya Platform-Driver', email: `driver.platform${SEED_DOMAIN}`, phone: '+15550100004', vehicleClass: 'sedan' },
  customer1: { role: 'customer' as const, name: 'Carla Customer', email: `customer1${SEED_DOMAIN}`, phone: '+15550100005' },
  customer2: { role: 'customer' as const, name: 'Sam Subscriber', email: `customer2${SEED_DOMAIN}`, phone: '+15550100006' },
  customer3: { role: 'customer' as const, name: 'Elena Expired', email: `customer3${SEED_DOMAIN}`, phone: '+15550100007' },
};

export async function clean(): Promise<void> {
  const users = await User.find({ email: TEST_EMAIL_PATTERN }).lean();
  const userIds = users.map((u) => u._id);

  const drivers = await Driver.find({ userId: { $in: userIds } }).lean();
  const driverIds = drivers.map((d) => d._id);
  const bookings = await Booking.find({ customerId: { $in: userIds } }).lean();
  const bookingIds = bookings.map((b) => b._id);
  const trips = await Trip.find({ bookingId: { $in: bookingIds } }).lean();
  const tripIds = trips.map((t) => t._id);
  const wallets = await Wallet.find({ ownerId: { $in: userIds } }).lean();
  const walletIds = wallets.map((w) => w._id);

  await Promise.all([
    ChatMessage.deleteMany({ tripId: { $in: tripIds } }),
    Rating.deleteMany({ tripId: { $in: tripIds } }),
    PenaltyEvent.deleteMany({ driverId: { $in: driverIds } }),
    Transaction.deleteMany({ walletId: { $in: walletIds } }),
    Notification.deleteMany({ userId: { $in: userIds } }),
    Subscription.deleteMany({ userId: { $in: userIds } }),
    SupportTicket.deleteMany({ userId: { $in: userIds } }),
    PaymentMethod.deleteMany({ userId: { $in: userIds } }),
  ]);

  await Promise.all([
    Trip.deleteMany({ _id: { $in: tripIds } }),
    Booking.deleteMany({ _id: { $in: bookingIds } }),
    Wallet.deleteMany({ _id: { $in: walletIds } }),
    Company.deleteMany({ userId: { $in: userIds } }),
    Driver.deleteMany({ _id: { $in: driverIds } }),
    PricingRule.deleteMany({ city: { $in: [SEED_CITY, ...DESIGN_CITIES] } }),
  ]);

  await User.deleteMany({ _id: { $in: userIds } });
  logger.info(`Seed cleanup removed ${users.length} account(s) and everything attached to them`);
}

export async function seed(): Promise<void> {
  await clean();

  // --- accounts (registered through the real service so hashing + wallets are identical)
  const created: Record<string, { userId: string; email: string }> = {};
  for (const [key, account] of Object.entries(accounts)) {
    const result = await authService.register({ ...account, password: SEED_PASSWORD });
    created[key] = { userId: String((result.user as { _id: unknown })._id), email: account.email };
  }

  // --- city pricing
  await PricingRule.create({ city: SEED_CITY, baseFare: 100, peakMultiplier: 2 });

  // The Puget Sound cities the web booking flow actually quotes against.
  await PricingRule.insertMany(
    DESIGN_CITIES.map((city) => ({
      city,
      baseFare: DESIGN_BASE_FARE,
      peakMultiplier: DESIGN_PEAK_MULTIPLIER,
    })),
  );

  // --- company roster + per-trip terms
  const company = await Company.findOne({ userId: created.company.userId });
  const fleetDriver = await Driver.findOne({ userId: created.driverCompany.userId });
  const platformDriver = await Driver.findOne({ userId: created.driverPlatform.userId });
  if (!company || !fleetDriver || !platformDriver) throw new Error('Seed: expected profiles missing');

  company.driverIds.push(fleetDriver._id);
  await company.save();

  // The company pays its own driver a flat charge; the admin pays the platform driver a share.
  fleetDriver.payout = { mode: 'flat', value: 30, setBy: 'company', updatedAt: toDate(now()) };
  fleetDriver.status = 'available';
  fleetDriver.documents = ['https://abl-placeholder-bucket.s3.amazonaws.com/licence.jpg'];
  await fleetDriver.save();

  platformDriver.payout = { mode: 'percentage', value: 70, setBy: 'admin', updatedAt: toDate(now()) };
  platformDriver.status = 'available';
  platformDriver.documents = ['https://abl-placeholder-bucket.s3.amazonaws.com/insurance.pdf'];
  await platformDriver.save();

  await User.updateMany(
    { _id: { $in: [created.driverCompany.userId, created.driverPlatform.userId] } },
    { $set: { status: 'active' } },
  );

  // --- customer2 subscribes; customer1 favourites the fleet driver
  await Subscription.create({
    userId: created.customer2.userId,
    plan: 'monthly',
    price: 49.99,
    status: 'active',
    startDate: toDate(now()),
    renewalDate: toDate(now().plus({ months: 1 })),
  });

  // A lapsed subscriber: pays the peak surcharge again, and the account screens must
  // show the expired state rather than treating them as a subscriber.
  await Subscription.create({
    userId: created.customer3.userId,
    plan: 'monthly',
    price: 49.99,
    status: 'expired',
    startDate: toDate(now().minus({ months: 2 })),
    renewalDate: toDate(now().minus({ months: 1 })),
  });

  await User.updateOne({ _id: created.customer1.userId }, { $addToSet: { favorites: fleetDriver._id } });

  // --- a COMPLETED trip, fully settled (revenue split + driver payout + rating + chat)
  const completedBooking = await Booking.create({
    customerId: created.customer1.userId,
    pickup: { lat: 34.0522, lng: -118.2437, address: '500 S Main St, Los Angeles' },
    drop: { lat: 33.9416, lng: -118.4085, address: 'LAX Terminal 4' },
    vehicleClass: 'sedan',
    tripType: 'airport',
    city: SEED_CITY,
    flightDetails: { flightNumber: 'AA100', scheduledArrival: toDate(now().plus({ hours: 3 })) },
    status: 'assigned',
    scheduledAt: toDate(now().minus({ hours: 4 })),
    estimatedFare: 100,
  });

  const completedTrip = await Trip.create({
    bookingId: completedBooking._id,
    driverId: platformDriver._id,
    status: 'completed',
    fareAmount: 100,
    timestamps: {
      requested: toDate(now().minus({ hours: 5 })),
      assigned: toDate(now().minus({ hours: 4, minutes: 50 })),
      accepted: toDate(now().minus({ hours: 4, minutes: 45 })),
      started: toDate(now().minus({ hours: 4 })),
      completed: toDate(now().minus({ hours: 3 })),
    },
  });

  await walletService.applyRevenueSplit(String(completedTrip._id));

  await Rating.create({
    tripId: completedTrip._id,
    customerId: created.customer1.userId,
    driverId: platformDriver._id,
    score: 5,
    comment: 'Smooth airport run, arrived early.',
  });
  platformDriver.rating = 5;
  platformDriver.ratingCount = 1;
  await platformDriver.save();

  await ChatMessage.create([
    { tripId: completedTrip._id, senderId: created.customer1.userId, senderRole: 'customer', message: 'I am at door 3.' },
    { tripId: completedTrip._id, senderId: created.driverPlatform.userId, senderRole: 'driver', message: 'On my way, 4 minutes.' },
  ]);

  // --- a CANCELLED trip with a 90% refund already issued
  const cancelledBooking = await Booking.create({
    customerId: created.customer1.userId,
    pickup: { lat: 34.0407, lng: -118.2468, address: '1200 Getty Center Dr, Los Angeles' },
    drop: { lat: 34.1381, lng: -118.3534, address: 'Universal Studios' },
    vehicleClass: 'suv',
    tripType: 'point2point',
    city: SEED_CITY,
    status: 'cancelled',
    scheduledAt: toDate(now().plus({ days: 3 })),
    estimatedFare: 100,
  });

  const cancelledTrip = await Trip.create({
    bookingId: cancelledBooking._id,
    driverId: fleetDriver._id,
    status: 'cancelled',
    fareAmount: 100,
    timestamps: { requested: toDate(now().minus({ days: 1 })), assigned: toDate(now().minus({ days: 1 })) },
    cancellation: { reason: 'Plans changed', refundPct: 90, refundedAt: toDate(now()), cancelledBy: 'customer' },
  });

  const customerWallet = await walletService.getOrCreateWallet(created.customer1.userId, 'customer');
  await walletService.credit(customerWallet._id, 90, 'refund', {
    reason: 'trip_cancellation_refund',
    tripId: cancelledTrip._id,
    refundPct: 90,
  });

  // --- a PENDING booking, still open for dispatch/accept in Postman
  const pendingBooking = await Booking.create({
    customerId: created.customer2.userId,
    pickup: { lat: 34.0522, lng: -118.2437, address: '900 Wilshire Blvd, Los Angeles' },
    drop: { lat: 34.0195, lng: -118.4912, address: 'Santa Monica Pier' },
    vehicleClass: 'sedan',
    tripType: 'point2point',
    city: SEED_CITY,
    status: 'pending',
    scheduledAt: toDate(now().plus({ days: 2 })),
    estimatedFare: 100,
  });

  // --- a penalty event so the admin/company dashboards are not empty
  await PenaltyEvent.create({
    bookingId: pendingBooking._id,
    driverId: fleetDriver._id,
    reason: 'Driver cancelled a ride they had already accepted',
  });
  fleetDriver.penaltyCount = 1;
  await fleetDriver.save();

  /* eslint-disable no-console */
  console.log('\nSeed complete — every account password is:', SEED_PASSWORD);
  console.table(
    Object.entries(accounts).map(([key, a]) => ({ key, role: a.role, email: a.email })),
  );
  console.log('IDs for Postman:');
  console.log('  completedTripId :', String(completedTrip._id));
  console.log('  cancelledTripId :', String(cancelledTrip._id));
  console.log('  dispatchedBooking:', String(pendingBooking._id));
  console.log('  fleetDriverId   :', String(fleetDriver._id));
  console.log('  platformDriverId:', String(platformDriver._id));
}

/**
 * Refuses to run against a production database.
 *
 * Both modes are destructive — `seed` calls `clean()` first, and `clean` issues
 * deleteMany across users, bookings, trips, wallets and pricing. Nothing stopped this
 * being pointed at a live deployment with the wrong MONGO_URI in the shell, and the
 * damage would be immediate and unrecoverable. ABL_ALLOW_DESTRUCTIVE_SEED=yes exists
 * as a deliberate, hard-to-type escape hatch for restoring a staging box.
 */
function assertNotProduction(mode: string): void {
  if (env.NODE_ENV !== 'production') return;
  if (process.env.ABL_ALLOW_DESTRUCTIVE_SEED === 'yes') {
    logger.warn(`Running destructive '${mode}' against a PRODUCTION environment — override set`);
    return;
  }

  throw new Error(
    `Refusing to run '${mode}' with NODE_ENV=production: this deletes accounts, bookings, ` +
      'trips and wallets. Set ABL_ALLOW_DESTRUCTIVE_SEED=yes only if that is genuinely intended.',
  );
}

async function main(): Promise<void> {
  const requestedMode = process.argv[2] === 'clean' ? 'clean' : 'seed';
  assertNotProduction(requestedMode);

  await connectMongo();
  await connectRedis();

  const mode = requestedMode;
  if (mode === 'clean') await clean();
  else await seed();

  await disconnectMongo();
  await disconnectRedis();
  process.exit(0);
}

/**
 * Entry-point guard.
 *
 * Without it, `main()` ran on import — so `import { SEED_PASSWORD } from './seed'`
 * silently re-seeded the database as a side effect of reading a constant. This file
 * exports SEED_PASSWORD, TEST_EMAIL_PATTERN and helpers that other scripts legitimately
 * want, and importing a constant must never rewrite data.
 *
 * `require.main === module` is true only when node was pointed at this file directly,
 * which is exactly the `npm run seed` / `npm run seed:clean` case.
 */
if (require.main === module) {
  main().catch((err) => {
    logger.error('Seed failed', err);
    process.exit(1);
  });
}
