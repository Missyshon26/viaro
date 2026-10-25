/**
 * Loads a backup made by scripts/mongo-export.mjs into the NEW database as untouched
 * `legacy_<collection>` copies. Nothing is converted, and nothing is read from or written to
 * any database but the destination.
 *
 *   DEST_URI='mongodb+srv://…' DEST_DB=abl_new BACKUP_DIR=/path/to/backup node scripts/mongo-import-legacy.mjs
 *
 * Safety, in the order it matters:
 *  1. The SOURCE is files on disk. The live database is not contacted.
 *  2. The destination database name must equal DEST_DB and EXPECTED_DEST_DB below; every
 *     write goes through one helper that re-checks the name first.
 *  3. Only collections named legacy_* are ever created, and it refuses to touch one that
 *     already has documents (unless REPLACE=1, which drops only legacy_* here).
 *  4. After loading, every document is read back from the destination and compared, byte
 *     for byte, with the backup.
 */
import { MongoClient } from 'mongodb';
import { deserializeStream } from 'bson';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const EXPECTED_DEST_DB = 'abl_new';
const { DEST_URI, DEST_DB, BACKUP_DIR, REPLACE } = process.env;
if (!DEST_URI || !DEST_DB || !BACKUP_DIR) {
  console.error('Set DEST_URI, DEST_DB and BACKUP_DIR.');
  process.exit(2);
}
if (DEST_DB !== EXPECTED_DEST_DB) {
  console.error(`Refusing: DEST_DB must be "${EXPECTED_DEST_DB}" (got "${DEST_DB}").`);
  process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, 'manifest.json'), 'utf8'));
if (manifest.database === DEST_DB) {
  console.error('Refusing: the backup is of the destination database itself.');
  process.exit(2);
}

/** Splits a .bson file into its documents' raw bytes (each starts with its own length). */
function rawDocuments(file) {
  const buf = fs.readFileSync(file);
  const docs = [];
  for (let offset = 0; offset < buf.length; ) {
    const len = buf.readInt32LE(offset);
    if (len < 5 || offset + len > buf.length) throw new Error(`corrupt document at ${offset} in ${file}`);
    docs.push(buf.subarray(offset, offset + len));
    offset += len;
  }
  return docs;
}
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const client = new MongoClient(DEST_URI, { serverSelectionTimeoutMS: 20_000, appName: 'abl-legacy-import' });
try {
  await client.connect();
  const dest = client.db(DEST_DB);

  /** The only door to a write: re-checks the database before every operation. */
  const write = async (action) => {
    if (dest.databaseName !== EXPECTED_DEST_DB) throw new Error('write blocked: wrong database');
    return action();
  };

  const existing = new Set((await dest.listCollections().toArray()).map((c) => c.name));
  const results = [];
  let problems = 0;

  for (const entry of manifest.collections) {
    if (entry.documents === undefined) continue; // a view: nothing to copy
    const target = `legacy_${entry.name}`;
    const file = path.join(BACKUP_DIR, `${entry.name}.bson`);

    // The backup file must still be the one the manifest describes.
    const fileHash = sha(fs.readFileSync(file));
    if (fileHash !== entry.sha256) throw new Error(`${entry.name}.bson no longer matches the manifest checksum`);

    if (existing.has(target)) {
      const n = await dest.collection(target).estimatedDocumentCount();
      if (n > 0 && REPLACE !== '1') throw new Error(`${target} already has ${n} documents; set REPLACE=1 to reload it`);
      if (REPLACE === '1') await write(() => dest.collection(target).drop());
    }

    const raws = rawDocuments(file);
    if (raws.length !== entry.documents) throw new Error(`${entry.name}: file has ${raws.length}, manifest says ${entry.documents}`);

    const collection = dest.collection(target);
    if (raws.length === 0) {
      await write(() => dest.createCollection(target));
    } else {
      const parsed = raws.map((r) => {
        const out = [];
        deserializeStream(r, 0, 1, out, 0, {});
        return out[0];
      });
      for (let i = 0; i < parsed.length; i += 500) {
        await write(() => collection.insertMany(parsed.slice(i, i + 500), { ordered: true }));
      }
    }

    // Read every document back, as raw bytes, and compare with the backup.
    const want = new Map();
    for (const r of raws) {
      const out = [];
      deserializeStream(r, 0, 1, out, 0, {});
      want.set(String(out[0]._id), sha(r));
    }
    let matched = 0;
    let different = 0;
    const seen = new Set();
    for await (const r of collection.find({}, { raw: true })) {
      const out = [];
      deserializeStream(r, 0, 1, out, 0, {});
      const id = String(out[0]._id);
      seen.add(id);
      if (want.get(id) === sha(r)) matched += 1;
      else different += 1;
    }
    const missing = [...want.keys()].filter((id) => !seen.has(id)).length;
    const ok = matched === raws.length && different === 0 && missing === 0 && seen.size === raws.length;
    if (!ok) problems += 1;
    results.push({ collection: target, from: entry.name, documents: raws.length, byteIdentical: matched, different, missing, ok });
    console.log(`${target.padEnd(34)} ${String(raws.length).padStart(5)} docs  identical: ${String(matched).padStart(5)}  ${ok ? 'ok' : 'PROBLEM'}`);
  }

  // A record of what was loaded, from where, and when — so nobody has to guess later.
  await write(() =>
    dest.collection('legacy_import_log').insertOne({
      importedAt: new Date(),
      sourceDatabase: manifest.database,
      sourceBackupMadeAt: manifest.finishedAt,
      backupFolder: path.basename(BACKUP_DIR),
      sourceServerVersion: manifest.serverVersion,
      totalDocuments: results.reduce((n, r) => n + r.documents, 0),
      collections: results,
      note: 'Untouched copies of the old system data. Not used by the new app. The backup files are the source of truth.',
    }),
  );

  console.log(`\nTOTAL: ${results.reduce((n, r) => n + r.documents, 0)} documents in ${results.length} legacy_ collections — ${problems ? `${problems} PROBLEM(S)` : 'every document read back identical to the backup'}`);
  process.exitCode = problems ? 1 : 0;
} catch (err) {
  console.error('IMPORT STOPPED:', err.name, '-', String(err.message).slice(0, 220));
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
