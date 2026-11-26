#!/usr/bin/env node
// Create the search entry for resume-imported candidates that have none (a vector that failed during 4-load.mjs).
// Same data and same function as the loader (saveCandidateVector with the transform's vectorData). As Stage 2's 3b.
//
//   cd backend
//   node scripts/legacy-migration-resumes/4d-retry-vectors.mjs --work <work> --env staging --expect-db recruitmentautomationdb            (dry run)
//   node scripts/legacy-migration-resumes/4d-retry-vectors.mjs --work <work> --env staging --expect-db recruitmentautomationdb --apply
//   production: --env production --expect-db recruitmentautomationdbProd --allow-production
import fs from 'node:fs';
import path from 'node:path';
import { argOf, prepareEnv, assertDatabase } from '../legacy-migration-excel/lib/env.mjs';
import { SOURCE_KIND, readLines, noNul } from './lib/constants.mjs';

const argv = process.argv; const arg = argOf(argv);
const work = arg('--work'); const envName = arg('--env'); const expectDb = arg('--expect-db'); const apply = argv.includes('--apply');
if (!work || !envName || !expectDb) { console.error('Usage: node 4d-retry-vectors.mjs --work <folder> --env <staging|production> --expect-db <database> [--apply] [--allow-production]'); process.exit(2); }
prepareEnv({ envName, expectDb, writes: apply, allowProduction: argv.includes('--allow-production'), work, logLevel: 'error' });
const { default: prisma } = await import('../../src/config/database.js');
const { saveCandidateVector } = await import('../../src/services/vectorStore.service.js');

let exitCode = 0;
try {
  const db = await assertDatabase(prisma, expectDb);
  const missing = await prisma.$queryRaw`
    SELECT p.cv_id, p.source_table, p.source_row_id
    FROM rpa_legacy_import_rows p JOIN rpa_cv c ON c.id = p.cv_id
    WHERE p.source_kind = ${SOURCE_KIND} AND p.outcome = 'inserted'
      AND NOT EXISTS (SELECT 1 FROM public.rpa_cv_vectors v WHERE v.candidate_id = p.cv_id)
    ORDER BY p.id`;
  console.log(`${apply ? 'APPLY' : 'DRY RUN (nothing is written)'} on ${db}: ${missing.length} resume-imported candidate(s) with no search entry`);
  const byPrimary = new Map();
  for (const d of ['transform-sample', 'transform']) {
    const p = path.join(work, d, 'candidates.jsonl');
    if (fs.existsSync(p)) for (const c of readLines(fs, p)) byPrimary.set(`${c.primary.sourceTable}\u0000${c.primary.sourceRowId}`, c);
  }
  const count = { created: 0, failed: 0, not_in_transform: 0 };
  for (const m of missing) {
    const c = byPrimary.get(`${m.source_table}\u0000${m.source_row_id}`);
    if (!c) { count.not_in_transform++; continue; }
    if (!apply) continue;
    const metadata = await saveCandidateVector(Number(m.cv_id), noNul(c.vectorData));
    if (metadata) { count.created++; await prisma.rpa_cv.update({ where: { id: m.cv_id }, data: { MetaData: JSON.stringify(metadata) } }); } else { count.failed++; exitCode = 1; }
  }
  console.log(JSON.stringify(count));
  if (count.not_in_transform) exitCode = 1;
} catch (e) {
  console.error(`FAILED: ${e.message}`);
  exitCode = 1;
} finally {
  await prisma.$disconnect();
}
process.exit(exitCode);
