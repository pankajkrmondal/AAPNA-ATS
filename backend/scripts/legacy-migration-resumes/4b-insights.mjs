#!/usr/bin/env node
// Stage 3 (resumes), step 4b: AI profile insights for the candidates the resume import INSERTED, as HR Upload's
// runPostProcessing() does (preGenerateCandidateInsights, unchanged), but as a separate, resumable pass (plan 5.2).
// Only candidates whose ai_profile_insights is still empty; a re-run continues where it stopped.
// Matched existing candidates are not touched. No e-mail (runPostProcessing's welcome / missing-data mails are NOT copied).
//
//   cd backend
//   node scripts/legacy-migration-resumes/4b-insights.mjs --work <work> --env staging --expect-db recruitmentautomationdb [--batch <id>]            (dry run: counts)
//   node scripts/legacy-migration-resumes/4b-insights.mjs --work <work> --env staging --expect-db recruitmentautomationdb [--batch <id>] --apply
//   production: --env production --expect-db recruitmentautomationdbProd --allow-production
//   Options: --concurrency 3 (1-4), --limit N
import { argOf, prepareEnv, assertDatabase } from '../legacy-migration-excel/lib/env.mjs';
import { SOURCE_KIND, TAG } from './lib/constants.mjs';

const argv = process.argv; const arg = argOf(argv);
const work = arg('--work'); const envName = arg('--env'); const expectDb = arg('--expect-db'); const batch = arg('--batch');
const apply = argv.includes('--apply');
const CONCURRENCY = Math.max(1, Math.min(4, Number(arg('--concurrency') || 3)));
const LIMIT = arg('--limit') ? Number(arg('--limit')) : Infinity;
if (!work || !envName || !expectDb) { console.error('Usage: node 4b-insights.mjs --work <folder> --env <staging|production> --expect-db <database> [--batch <id>] [--apply] [--allow-production] [--concurrency 3] [--limit N]'); process.exit(2); }
prepareEnv({ envName, expectDb, writes: apply, allowProduction: argv.includes('--allow-production'), work, logLevel: 'error' });
const { default: prisma } = await import('../../src/config/database.js');
const { preGenerateCandidateInsights } = await import('../../src/services/hrUpload.service.js');

let exitCode = 0;
try {
  const db = await assertDatabase(prisma, expectDb);
  const todo = (await prisma.$queryRawUnsafe(`
    SELECT DISTINCT p.cv_id FROM rpa_legacy_import_rows p JOIN rpa_cv c ON c.id = p.cv_id
    WHERE p.source_kind = $1 AND p.outcome = 'inserted' AND c.ai_profile_insights IS NULL AND c.last_action_context = $2
      ${batch ? 'AND p.batch_id = $3::uuid' : ''}
    ORDER BY p.cv_id`, SOURCE_KIND, TAG, ...(batch ? [batch] : []))).map((r) => r.cv_id).slice(0, LIMIT);
  console.log(`${apply ? 'APPLY' : 'DRY RUN (nothing is written, no AI call)'} on ${db}: ${todo.length} resume-imported candidate(s) without insights${batch ? ` in batch ${batch}` : ''}`);
  const count = { written: 0, empty_result: 0, failed: 0, changed_meanwhile: 0 };
  if (apply) {
    let next = 0; let n = 0; const t0 = Date.now();
    const worker = async () => {
      while (next < todo.length) {
        const id = todo[next++];
        try {
          const cv = await prisma.rpa_cv.findUnique({ where: { id } });
          const insights = cv ? await preGenerateCandidateInsights(cv) : null;
          if (!insights) count.empty_result++;
          else {
            // Only if nothing else wrote insights meanwhile and the import still owns the record.
            const w = await prisma.$executeRaw`UPDATE rpa_cv SET ai_profile_insights = ${JSON.stringify(insights)}::jsonb
              WHERE id = ${id} AND ai_profile_insights IS NULL AND last_action_context = ${TAG}`;
            if (w === 1) count.written++; else count.changed_meanwhile++;
          }
        } catch { count.failed++; }
        n++;
        if (n % 25 === 0 || n === todo.length) console.log(`  ${n}/${todo.length} (written ${count.written}, empty ${count.empty_result}, failed ${count.failed}) ${Math.round((Date.now() - t0) / 1000)}s`);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }
  console.log(JSON.stringify({ database: db, candidates: todo.length, ...count }, null, 2));
  if (count.failed || count.empty_result) { console.log('Some candidates have no insights yet: run again later (the pass skips those already done).'); exitCode = 1; }
} catch (e) {
  console.error(`FAILED: ${e.message}`);
  exitCode = 1;
} finally {
  await prisma.$disconnect();
}
process.exit(exitCode);
