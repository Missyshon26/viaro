/**
 * Read-only backup of one MongoDB database to disk, in mongodump's own format
 * (<collection>.bson + <collection>.metadata.json), so `mongorestore` can load it later.
 *
 *   SRC_URI='mongodb+srv://…' DB_NAME=all_black_limo_2025_new OUT_DIR=/path/to/folder \
 *     node scripts/mongo-export.mjs
 *
 * It only ever READS: find() and index listing. Documents are copied as the raw BSON bytes
 * the server sent, so nothing is re-encoded, rounded or reordered. After writing, every file
 * is read back and its documents counted, and the totals are compared with the server's.
 * The connection string comes from the environment and is never written to disk or printed.
 */
import { MongoClient } from 'mongodb';
import { EJSON } from 'bson';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const { SRC_URI, DB_NAME, OUT_DIR } = process.env;
if (!SRC_URI || !DB_NAME || !OUT_DIR) {
  console.error('Set SRC_URI, DB_NAME and OUT_DIR.');
  process.exit(2);
}

const client = new MongoClient(SRC_URI, { serverSelectionTimeoutMS: 20_000, appName: 'abl-backup-export' });
const started = new Date();

/** Counts BSON documents in a file by reading each one's 4-byte length prefix. */
function countBsonDocuments(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const head = Buffer.alloc(4);
    let offset = 0;
    let count = 0;
    while (offset < size) {
      if (fs.readSync(fd, head, 0, 4, offset) !== 4) throw new Error(`truncated length prefix at ${offset}`);
      const len = head.readInt32LE(0);
      if (len < 5 || offset + len > size) throw new Error(`corrupt document length ${len} at ${offset}`);
      offset += len;
      count += 1;
    }
    return count;
  } finally {
    fs.closeSync(fd);
  }
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

try {
  await client.connect();
  const db = client.db(DB_NAME);
  fs.mkdirSync(OUT_DIR, { recursive: true, mode: 0o700 });

  const infos = await db.listCollections({}, { nameOnly: false }).toArray();
  const manifest = { database: DB_NAME, startedAt: started.toISOString(), collections: [] };
  let failures = 0;

  for (const info of infos.sort((a, b) => a.name.localeCompare(b.name))) {
    if (info.name.startsWith('system.')) continue;
    if (info.type === 'view') {
      manifest.collections.push({ name: info.name, type: 'view', skipped: 'views hold no data of their own' });
      continue;
    }

    const collection = db.collection(info.name);
    const bsonPath = path.join(OUT_DIR, `${info.name}.bson`);
    const out = fs.openSync(bsonPath, 'w', 0o600);
    let written = 0;
    try {
      // raw: true hands back the exact bytes the server stored, as Buffers.
      for await (const buffer of collection.find({}, { raw: true, batchSize: 500 })) {
        fs.writeSync(out, buffer);
        written += 1;
      }
    } finally {
      fs.closeSync(out);
    }

    const indexes = await collection.indexes();
    const metadata = { options: info.options ?? {}, indexes, uuid: info.info?.uuid ? info.info.uuid.toString('hex') : undefined };
    fs.writeFileSync(path.join(OUT_DIR, `${info.name}.metadata.json`), EJSON.stringify(metadata, { relaxed: false }), { mode: 0o600 });

    // Read the file back; compare with what was written and with what the server now holds.
    const onDisk = countBsonDocuments(bsonPath);
    const onServer = await collection.countDocuments({});
    const entry = {
      name: info.name,
      documents: written,
      readBackFromFile: onDisk,
      serverCountAfter: onServer,
      bytes: fs.statSync(bsonPath).size,
      sha256: sha256(bsonPath),
      indexes: indexes.length,
    };
    if (written !== onDisk) {
      entry.problem = 'file does not contain every document that was written';
      failures += 1;
    } else if (onServer !== written) {
      entry.note = `server count changed while the backup ran (${written} -> ${onServer}): a live write happened`;
    }
    manifest.collections.push(entry);
    console.log(`${info.name.padEnd(30)} ${String(written).padStart(6)} docs  ${String(entry.bytes).padStart(9)} bytes  ${entry.problem ? 'PROBLEM' : 'ok'}`);
  }

  const build = await client.db('admin').command({ buildInfo: 1 }).catch(() => ({}));
  manifest.finishedAt = new Date().toISOString();
  manifest.serverVersion = build.version;
  manifest.totalDocuments = manifest.collections.reduce((n, c) => n + (c.documents ?? 0), 0);
  manifest.tool = 'scripts/mongo-export.mjs (mongodump-compatible BSON; read-only)';
  manifest.pointInTime = false; // collections were read one after another, not from a snapshot
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });

  console.log(`\nTOTAL: ${manifest.totalDocuments} documents in ${manifest.collections.filter((c) => c.documents !== undefined).length} collections${failures ? ` — ${failures} PROBLEM(S)` : ' — every file verified'}`);
  process.exitCode = failures ? 1 : 0;
} catch (err) {
  console.error('EXPORT FAILED:', err.name, '-', String(err.message).slice(0, 200));
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
