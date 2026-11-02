// Consistent SQLite backup — safe to run while the app is serving.
//
//   node scripts/backup-db.mjs            # keeps 14 daily copies
//   node scripts/backup-db.mjs --keep 30
//
// Uses VACUUM INTO, which writes a transactionally consistent copy of the live database.
// Copying buyback.db with `cp` while the app is running can capture a half-written WAL.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
const DB_FILE = process.env.DB_FILE || join(DATA_DIR, 'buyback.db');
const BACKUP_DIR = process.env.BACKUP_DIR || join(DATA_DIR, 'backups');
const KEEP = Number(process.argv.includes('--keep') ? process.argv[process.argv.indexOf('--keep') + 1] : 14);

if (!existsSync(DB_FILE)) {
  console.error(`No database at ${DB_FILE} — nothing to back up.`);
  process.exit(1);
}
mkdirSync(BACKUP_DIR, { recursive: true });

const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'); // 2026-11-01-21-30-45
const target = join(BACKUP_DIR, `buyback-${stamp}.db`);

const db = new DatabaseSync(DB_FILE, { readOnly: true });
try {
  // VACUUM INTO refuses to overwrite, so the timestamped name matters
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
} finally {
  db.close();
}

const size = statSync(target).size;
console.log(`backup written: ${target} (${(size / 1024).toFixed(0)} KB)`);

// prune the oldest copies
const copies = readdirSync(BACKUP_DIR)
  .filter((f) => /^buyback-.*\.db$/.test(f))
  .map((f) => ({ f, t: statSync(join(BACKUP_DIR, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t);

for (const { f } of copies.slice(KEEP)) {
  unlinkSync(join(BACKUP_DIR, f));
  console.log(`pruned: ${f}`);
}
console.log(`${Math.min(copies.length, KEEP)} backup(s) retained in ${BACKUP_DIR}`);
