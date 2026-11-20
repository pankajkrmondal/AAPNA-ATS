// Create the search entry for Excel-imported candidates that have none (a vector that failed
// during 3-load.mjs, for example on a database timeout). Same data and same existing function as
// the loader. Candidates without an email are skipped, as in the loader. As Stage 1's 3b.
//
//   cd backend
//   node scripts/legacy-migration-excel/3b-retry-vectors.mjs --work <work folder> --env staging --expect-db recruitmentautomationdb            (dry run)
//   node scripts/legacy-migration-excel/3b-retry-vectors.mjs --work <work folder> --env staging --expect-db recruitmentautomationdb --apply
import fs from 'fs';
import path from 'path';
import { argOf, prepareEnv, assertDatabase } from './lib/env.mjs';
import { SOURCE_KIND } from './lib/layouts.mjs';

const argv = process.argv; const arg = argOf(argv);
const work = arg('--work'); const envName = arg('--env'); const expectDb = arg('--expect-db'); const apply = argv.includes('--apply');
if (!work || !envName || !expectDb) { console.error('Usage: node 3b-retry-vectors.mjs --work <folder> --env <staging|production> --expect-db <database> [--apply] [--allow-production]'); process.exit(2); }
prepareEnv({ envName, expectDb, writes: apply, allowProduction: argv.includes('--allow-production'), work });
const { default: prisma } = await import('../../src/config/database.js');
const { sanitizeMatchEmails } = await import('../../src/services/hrUpload.service.js');
const { saveCandidateVector } = await import('../../src/services/vectorStore.service.js');

let exitCode = 0;
try {
  const db = await assertDatabase(prisma, expectDb);
  const missing = await prisma.$queryRaw`
    SELECT p.cv_id, p.source_file, p.source_table, p.source_row_id
    FROM rpa_legacy_import_rows p JOIN rpa_cv c ON c.id = p.cv_id
    WHERE p.source_kind = ${SOURCE_KIND} AND p.outcome = 'inserted'
      AND coalesce(trim(c."EmailID"), '') <> ''
      AND NOT EXISTS (SELECT 1 FROM public.rpa_cv_vectors v WHERE v.candidate_id = p.cv_id)
    ORDER BY p.id`;
  console.log(`${apply ? 'APPLY' : 'DRY RUN (nothing is written)'} on ${db}: ${missing.length} Excel-imported candidate(s) with an email and no search entry`);
  const units = JSON.parse(fs.readFileSync(path.join(work, 'transform', 'units.json'), 'utf8'));
  const unitByN = new Map(units.map((u) => [u.n, u]));
  const byBase = new Map();
  for (const l of fs.readFileSync(path.join(work, 'transform', 'candidates.jsonl'), 'utf8').split('\n').filter(Boolean)) {
    const c = JSON.parse(l); const u = unitByN.get(c.base.unit);
    byBase.set(`${u.file}\u0000${u.sheet}\u0000${c.base.id}`, c);
  }
  const count = { created: 0, failed: 0, not_in_transform: 0 };
  for (const m of missing) {
    const c = byBase.get(`${m.source_file}\u0000${m.source_table}\u0000${m.source_row_id}`);
    if (!c) { count.not_in_transform++; console.log(`  cv ${m.cv_id}: row ${m.source_row_id} is not a base row in the transform output; skipped`); continue; }
    console.log(`  cv ${m.cv_id}: ${m.source_table} row ${m.source_row_id}`);
    if (!apply) continue;
    const f = c.fields;
    const vectorData = { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), unique_key: sanitizeMatchEmails(f.EmailID)[0] };
    const metadata = await saveCandidateVector(Number(m.cv_id), vectorData);
    if (metadata) { count.created++; await prisma.rpa_cv.update({ where: { id: m.cv_id }, data: { MetaData: JSON.stringify(metadata) } }); } else { count.failed++; exitCode = 1; }
  }
  console.log(JSON.stringify(count));
} catch (e) {
  console.error(`FAILED: ${e.message}`);
  exitCode = 1;
} finally {
  await prisma.$disconnect();
}
process.exit(exitCode);
