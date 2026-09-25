// Guarded runner for the hand-written DDL files in prisma/ddl/.
//
//   node scripts/run-ddl.mjs --env .env.staging --expect-db recruitmentautomationdb --file prisma/ddl/<file>.sql [--dry-run]
//
// Why a runner instead of pasting SQL into a tool:
//   - staging and production live on the SAME server, so a wrong connection is
//     an easy mistake. The run is refused unless current_database() equals
//     --expect-db.
//   - the whole file runs in ONE transaction: any failing statement rolls every
//     earlier one back (Postgres DDL is transactional), so there is no
//     half-applied state.
//   - --dry-run executes everything and then rolls back on purpose, so each
//     script can be rehearsed against the real database first.
// Every run should be recorded in the DB change log of the plan it belongs to.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { splitSql } from '../src/utils/splitSql.js';

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const envFile = arg('--env');
const expectDb = arg('--expect-db');
const sqlFile = arg('--file');
const dryRun = process.argv.includes('--dry-run');
if (!envFile || !expectDb || !sqlFile) {
  console.error('Usage: node scripts/run-ddl.mjs --env <.env file> --expect-db <database> --file <sql file> [--dry-run]');
  process.exit(2);
}

const envText = fs.readFileSync(path.resolve(BACKEND, envFile), 'utf8');
const url = envText.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
if (!url) throw new Error(`No DATABASE_URL in ${envFile}`);
const sql = fs.readFileSync(path.resolve(BACKEND, sqlFile), 'utf8');

const statements = splitSql(sql);
const label = (s) => s.replace(/--[^\n]*\n/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);
const prisma = new PrismaClient({ datasources: { db: { url } } });
const ROLLBACK = Symbol('dry-run');

try {
  const [{ db }] = await prisma.$queryRawUnsafe('select current_database() db');
  if (db !== expectDb) {
    console.error(`REFUSED: connected to "${db}" but --expect-db is "${expectDb}". Nothing was run.`);
    process.exit(1);
  }
  console.log(`${dryRun ? 'DRY RUN' : 'RUN'} ${sqlFile} on ${db}: ${statements.length} statement(s)`);
  await prisma.$transaction(async (tx) => {
    for (const [n, s] of statements.entries()) {
      const count = await tx.$executeRawUnsafe(s);
      console.log(`  ${String(n + 1).padStart(2)}. ${label(s)}${typeof count === 'number' ? `  -> ${count}` : ''}`);
    }
    if (dryRun) throw ROLLBACK;
  }, { timeout: 120000, maxWait: 20000 });
  console.log('COMMITTED.');
} catch (e) {
  if (e === ROLLBACK) console.log('DRY RUN OK: every statement succeeded; rolled back on purpose.');
  else { console.error(`FAILED, whole file rolled back: ${e.message}`); process.exitCode = 1; }
} finally {
  await prisma.$disconnect();
}
