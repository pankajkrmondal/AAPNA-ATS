// Read-only structure comparison of two ATS databases before a legacy-migration production wave.
// docs/Phase 4/PLAN-Legacy-Migration-Stage2-3-Excel-Naukri-Resumes.md, 2.1 principle 1.
// SELECT on the catalog only (information_schema, pg_constraint). No data rows are read. Writes nothing.
//
//   cd backend
//   node scripts/check-schema-parity.mjs --a staging --b production
//
// Compares: the columns of rpa_cv and rpa_legacy_import_rows (name, type, nullability, default),
// the CHECK constraints chk_legacy_import_source_kind, chk_legacy_import_outcome,
// chk_rpa_cv_legacy_source, chk_rpa_cv_legacy_relation, and the unique index uq_legacy_import_source_row.
// Prints MATCH, or each difference, and exits 1 on any difference. The database URLs come from
// backend/.env.<a> and .env.<b>; they are never printed. Each side must be the database its env belongs to.
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { argOf, BACKEND, DB_OF_ENV } from './legacy-migration-excel/lib/env.mjs';

const argv = process.argv; const arg = argOf(argv);
const a = arg('--a'); const b = arg('--b');
if (!DB_OF_ENV[a] || !DB_OF_ENV[b]) { console.error('Usage: node scripts/check-schema-parity.mjs --a staging --b production'); process.exit(2); }

const TABLES = ['rpa_cv', 'rpa_legacy_import_rows'];
const CONSTRAINTS = ['chk_legacy_import_source_kind', 'chk_legacy_import_outcome', 'chk_rpa_cv_legacy_source', 'chk_rpa_cv_legacy_relation'];
const INDEXES = ['uq_legacy_import_source_row'];

async function describe(envName) {
  const url = dotenv.parse(fs.readFileSync(path.join(BACKEND, `.env.${envName}`))).DATABASE_URL;
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    const [{ db }] = await client.$queryRawUnsafe('select current_database() db');
    if (db !== DB_OF_ENV[envName]) throw new Error(`.env.${envName} points at "${db}", expected "${DB_OF_ENV[envName]}"`);
    const cols = await client.$queryRawUnsafe(`select table_name, column_name, data_type, coalesce(character_maximum_length::text, '') len,
        is_nullable, coalesce(column_default, '') def
      from information_schema.columns where table_schema = 'public' and table_name = any($1::text[])`, TABLES);
    const cons = await client.$queryRawUnsafe(`select conname, pg_get_constraintdef(oid) def from pg_constraint where conname = any($1::text[])`, CONSTRAINTS);
    const idx = await client.$queryRawUnsafe(`select indexname, indexdef from pg_indexes where schemaname = 'public' and indexname = any($1::text[])`, INDEXES);
    const m = new Map();
    for (const c of cols) m.set(`column ${c.table_name}.${c.column_name}`, `${c.data_type}${c.len ? `(${c.len})` : ''} ${c.is_nullable === 'YES' ? 'null' : 'not null'} default ${c.def.replace(/nextval\('[^']+'::regclass\)/, 'nextval(seq)')}`);
    for (const c of cons) m.set(`constraint ${c.conname}`, c.def);
    for (const i of idx) m.set(`index ${i.indexname}`, i.indexdef);
    for (const t of TABLES) if (![...m.keys()].some((k) => k.startsWith(`column ${t}.`))) m.set(`table ${t}`, 'MISSING');
    for (const c of CONSTRAINTS) if (!m.has(`constraint ${c}`)) m.set(`constraint ${c}`, 'MISSING');
    for (const i of INDEXES) if (!m.has(`index ${i}`)) m.set(`index ${i}`, 'MISSING');
    return { db, m };
  } finally { await client.$disconnect(); }
}

try {
  const A = await describe(a); const B = await describe(b);
  const keys = [...new Set([...A.m.keys(), ...B.m.keys()])].sort();
  const diffs = keys.filter((k) => A.m.get(k) !== B.m.get(k));
  const missingBoth = keys.filter((k) => A.m.get(k) === 'MISSING' && B.m.get(k) === 'MISSING');
  console.log(`${a} (${A.db}) against ${b} (${B.db}): ${keys.length} items compared.`);
  for (const k of diffs) console.log(`  DIFFERENT  ${k}\n     ${a}: ${A.m.get(k) ?? 'MISSING'}\n     ${b}: ${B.m.get(k) ?? 'MISSING'}`);
  for (const k of missingBoth) console.log(`  MISSING ON BOTH  ${k}`);
  if (diffs.length || missingBoth.length) { console.log('NO MATCH'); process.exit(1); }
  console.log('MATCH');
} catch (e) {
  console.error(`FAILED: ${e.message}`);
  process.exit(2);
}
