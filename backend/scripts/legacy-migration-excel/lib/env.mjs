// Environment and database guards for the Stage 2 (Excel) scripts.
//
// Why this file exists: in Stage 1, every script that imported src/config/database.js reached
// the STAGING database even with --env production, because @prisma/client loads the plain
// backend/.env (staging) on import and dotenv never overwrites a variable already set
// (PLAN-MS-Access-Data-Migration-Mapping.md section 9, "Env loading on production"). The
// --expect-db guard caught it, and production runs needed `node --env-file=.env.production`.
// Here the named env file is loaded FIRST, with override, before any ATS module is imported,
// so `--env production` really means production. The --expect-db guard stays as the second lock.
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

export const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const DB_OF_ENV = Object.freeze({ staging: 'recruitmentautomationdb', production: 'recruitmentautomationdbProd' });

export const argOf = (argv) => (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);

/**
 * Check the --env / --expect-db pair and load backend/.env.<env>. Call BEFORE importing any ATS module.
 * @param {{envName:string, expectDb:string, writes:boolean, allowProduction:boolean, work?:string, logLevel?:string}} o
 */
export function prepareEnv({ envName, expectDb, writes, allowProduction, work, logLevel = 'warn' }) {
  if (!DB_OF_ENV[envName]) { console.error(`REFUSED: --env must be staging or production, not "${envName}".`); process.exit(2); }
  if (DB_OF_ENV[envName] !== expectDb) { console.error(`REFUSED: --env ${envName} does not belong with --expect-db "${expectDb}".`); process.exit(1); }
  if (envName === 'production' && writes && !allowProduction) { console.error('REFUSED: a production write needs --allow-production (and Pankaj\'s go-ahead for that step).'); process.exit(1); }
  const file = path.join(BACKEND, `.env.${envName}`);
  if (!fs.existsSync(file)) { console.error(`REFUSED: ${file} not found.`); process.exit(1); }
  dotenv.config({ path: file, override: true, quiet: true });
  process.env.NODE_ENV = envName;
  process.env.LOG_LEVEL = logLevel; // keep candidate data off the console
  if (work) process.env.LOG_DIR = path.join(work, 'logs'); // and out of backend/logs
}

/** Refuse when the connected database is not the expected one. */
export async function assertDatabase(prisma, expectDb) {
  const [{ db }] = await prisma.$queryRawUnsafe('select current_database() db');
  if (db !== expectDb) { console.error(`REFUSED: connected to "${db}" but --expect-db is "${expectDb}". Nothing was run.`); await prisma.$disconnect(); process.exit(1); }
  return db;
}
