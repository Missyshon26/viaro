import 'dotenv/config';
import bcrypt from 'bcrypt';
import { connectMongo, disconnectMongo } from '../config/db';
import { env } from '../config/env';
import { User } from '../models/User';
import { SEED_PASSWORD, TEST_EMAIL_PATTERN } from './seed';

/**
 * Re-hash every test account's password to SEED_PASSWORD, in place.
 *
 * Deliberately separate from `npm run seed`, which deletes and recreates its records:
 * that would take the bookings, trips and wallet history built up while testing with it.
 * This only touches `passwordHash`, so a database mid-test keeps everything else.
 *
 * The email filter is the same TEST_EMAIL_PATTERN the seed uses to decide what it owns,
 * so a real account can never be caught by this even if one exists in the same database.
 *
 *   npx ts-node src/scripts/reset-test-passwords.ts
 */
const BCRYPT_ROUNDS = 12;

async function main() {
  /*
   * Never in production.
   *
   * The TEST_EMAIL_PATTERN filter means this cannot touch a real customer, but it still
   * sets a publicly-documented password on every matching account — and if seed data ever
   * reached a live database, this would hand anyone who read the README a working login.
   */
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to reset test-account passwords with NODE_ENV=production — ' +
        'this sets a known, documented password on every seeded account.',
    );
  }

  await connectMongo();

  const users = await User.find({ email: TEST_EMAIL_PATTERN }).select('email role').lean();

  if (users.length === 0) {
    console.log('No test accounts found. Run `npm run seed` first.');
    return;
  }

  // One hash for all of them: bcrypt salts internally, so the stored hashes still differ.
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, BCRYPT_ROUNDS);

  const result = await User.updateMany(
    { email: TEST_EMAIL_PATTERN },
    { $set: { passwordHash } },
  );

  console.log(`Updated ${result.modifiedCount} of ${users.length} test accounts:`);
  for (const user of users) console.log(`  ${user.role.padEnd(9)} ${user.email}`);
  console.log(`\nEvery one of them now signs in with: ${SEED_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => disconnectMongo());
