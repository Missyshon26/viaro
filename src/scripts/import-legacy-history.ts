import mongoose from 'mongoose';
import { connectMongo } from '../config/db';
import { importLegacyHistory } from '../modules/migration/legacy.import';

/**
 * Carries the old system's customers, chauffeurs, vehicles, trips and wallet balances into
 * this app's collections, from the `legacy_*` copies in the same database. Shows what it
 * would do unless called with --apply. Safe to run twice.
 *
 *   node dist/scripts/import-legacy-history.js          # dry run
 *   node dist/scripts/import-legacy-history.js --apply  # write
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  await connectMongo();
  const r = await importLegacyHistory({ apply });
  const line = (label: string, v: unknown) => console.log(`  ${label.padEnd(34)} ${v}`);
  console.log(apply ? 'APPLIED' : 'DRY RUN (nothing written)');
  line('vehicle classes (inactive)', `${r.vehicles.created} new, ${r.vehicles.existing} already there`);
  line('chauffeurs', `${r.drivers.created} new, ${r.drivers.existing} already there`);
  line('customers', `${r.customers.created} new, ${r.customers.existing} already there`);
  line('  duplicate accounts merged', r.mergedDuplicateCustomers);
  line('  placeholder guests', r.placeholderCustomers);
  line('  emails given a +customer alias', r.aliasedCustomerEmails.length);
  line('wallets', `${r.wallets.created} new`);
  line('  credit carried over ($)', r.walletCreditTotal);
  line('bookings (one per leg)', `${r.bookings.created} new, ${r.bookings.existing} already there`);
  line('  by status', JSON.stringify(r.bookingsByStatus));
  line('  closed on import (stale)', r.closedOnImport);
  line('  with their Stripe payment', r.withStripePayment);
  line('trips (chauffeur jobs)', `${r.trips.created} new, ${r.trips.existing} already there`);
  line('  by status', JSON.stringify(r.tripsByStatus));
  line('money: new bookings total ($)', r.fareTotal);
  line('money: old trips charged ($)', r.oldChargedTotal);
  line('notes', r.notes.length);
  for (const n of r.notes) console.log(`    - ${n}`);
  line('problems', r.issues.length);
  for (const i of r.issues.slice(0, 25)) console.log(`    - ${i.what} ${i.id}: ${i.reason}`);
  if (r.issues.length > 25) console.log(`    … and ${r.issues.length - 25} more`);
  if (!apply) console.log('Run again with --apply to write.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
