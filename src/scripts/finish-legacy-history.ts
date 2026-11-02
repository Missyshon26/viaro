import mongoose from 'mongoose';
import { connectMongo } from '../config/db';
import { finishLegacyHistory } from '../modules/migration/legacy.finish';

/**
 * Marks every past, non-cancelled old-system booking as done (a completed trip), and leaves
 * pickups from today on open. Shows what it would do unless called with --apply. Safe to run twice.
 *
 *   node dist/scripts/finish-legacy-history.js          # dry run
 *   node dist/scripts/finish-legacy-history.js --apply  # write
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  await connectMongo();
  const r = await finishLegacyHistory({ apply });
  const line = (label: string, v: unknown) => console.log(`  ${label.padEnd(38)} ${v}`);
  console.log(apply ? 'APPLIED' : 'DRY RUN (nothing written)');
  line('pickups from (left open)', r.openFrom.toISOString());
  line('past, not cancelled', r.pastBookings);
  line('  of which Refunded in the old system', r.refundedPastBookings);
  line('completed trips created', r.tripsCreated);
  line('open trips marked completed', r.tripsCompleted);
  line('bookings set to assigned', r.bookingsReopenedAsAssigned);
  line('placeholder chauffeur created', r.placeholderDriverCreated);
  line('still open (today or later)', `${r.stillOpen} ${JSON.stringify(r.stillOpenByStatus)}`);
  if (!apply) console.log('Run again with --apply to write.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
