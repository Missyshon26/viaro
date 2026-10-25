import mongoose from 'mongoose';
import { connectMongo } from '../config/db';
import { activateLegacyCatalogue } from '../modules/migration/legacy.catalogue';

/**
 * Switches the old booking site's vehicles on, with their old prices and photos, and
 * switches this app's own default classes off. Shows what it would do unless --apply.
 *
 *   node dist/scripts/import-legacy-catalogue.js          # dry run
 *   node dist/scripts/import-legacy-catalogue.js --apply  # write
 *
 * OLD_IMAGE_BASE overrides where the old photos are fetched from.
 */
const OLD_IMAGE_BASE = process.env.OLD_IMAGE_BASE ?? 'https://services.allblacklimoseattle.com/vehicle_images';

async function fetchImage(file: string): Promise<Buffer | null> {
  try {
    const res = await fetch(`${OLD_IMAGE_BASE}/${encodeURIComponent(file)}`, { signal: AbortSignal.timeout(20_000) });
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  await connectMongo();
  const r = await activateLegacyCatalogue({ apply, fetchImage });
  console.log(apply ? 'APPLIED' : 'DRY RUN (nothing written)');
  console.log('Switched on:');
  for (const v of r.switchedOn) {
    console.log(`  ${v.label.padEnd(38)} flat $${v.flatRate}  hourly ${v.hourlyRate ? '$' + v.hourlyRate : '-'}  stop ${v.stopFee ? '$' + v.stopFee : '-'}  ${v.baseMiles && v.perMileRate ? `$${v.perMileRate}/mile after ${v.baseMiles} mi` : 'flat'}  photos ${v.photos}`);
  }
  console.log(`Switched off (this app's own defaults): ${r.switchedOff.join(', ') || 'none'}`);
  console.log(`Seattle pricing rule: ${r.pricingRule}`);
  for (const n of r.notes) console.log(`  note: ${n}`);
  for (const p of r.problems) console.log(`  problem: ${p}`);
  if (!apply) console.log('Run again with --apply to write.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
