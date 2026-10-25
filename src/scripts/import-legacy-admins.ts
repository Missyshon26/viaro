import mongoose from 'mongoose';
import { connectMongo } from '../config/db';
import { importLegacyAdmins } from '../modules/migration/legacy.admins';

/**
 * Creates this app's admin accounts from the old console's admins (read from
 * `legacy_users`). Shows what it would do unless called with --apply.
 *
 *   node dist/scripts/import-legacy-admins.js          # dry run
 *   node dist/scripts/import-legacy-admins.js --apply  # write
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  await connectMongo();
  const lines = await importLegacyAdmins({ apply });
  console.log(apply ? 'Applied:' : 'Dry run (nothing written):');
  for (const l of lines) console.log(`  ${l.username.padEnd(20)} ${l.outcome.padEnd(13)} ${l.note}`);
  if (!apply) console.log('Run again with --apply to write these.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
