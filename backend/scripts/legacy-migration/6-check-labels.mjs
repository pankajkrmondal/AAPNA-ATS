// Read-only check of the legacy-source labels on Search Candidate.
// Scope: docs/Phase 4/SCOPE-Legacy-Source-Label-and-Filter.md, section 9 (runbook).
//
//   cd backend
//   node scripts/legacy-migration/6-check-labels.mjs --env staging    --expect-db recruitmentautomationdb
//   node scripts/legacy-migration/6-check-labels.mjs --env production --expect-db recruitmentautomationdbProd
//
// Prints counts only; no candidate data. Writes nothing. Exit code 1 when a
// cross-check fails (a logged candidate without a label, or a label on a
// candidate the import log does not know).
//
// A candidate whose label the ATS removed (fresh resume after the import) shows
// under "logged but unlabelled" with last action duplicate_merge / email_intake;
// that is expected, not a failure, and is counted separately.
import path from 'path';

const argv = process.argv;
const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const envName = arg('--env'); const expectDb = arg('--expect-db');
if (!envName || !expectDb) { console.error('Usage: node 6-check-labels.mjs --env <staging|production> --expect-db <database>'); process.exit(2); }
process.env.NODE_ENV = envName;
process.env.LOG_LEVEL = 'warn';
if (arg('--work')) process.env.LOG_DIR = path.join(arg('--work'), 'logs');
const { default: prisma } = await import('../../src/config/database.js');

let exitCode = 0;
try {
  const [{ db, has_log: hasLog, has_label: hasLabel }] = await prisma.$queryRawUnsafe(`select current_database() db,
    to_regclass('public.rpa_legacy_import_rows') is not null as has_log,
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'rpa_cv' and column_name = 'legacy_source') as has_label`);
  if (db !== expectDb) { console.error(`REFUSED: connected to "${db}" but --expect-db is "${expectDb}".`); process.exit(1); }
  console.log(`Database ${db}: import log table ${hasLog ? 'present' : 'ABSENT'}, label columns ${hasLabel ? 'present' : 'ABSENT'}`);
  if (!hasLog || !hasLabel) { console.log('Nothing to check yet.'); process.exit(hasLabel ? 0 : 1); }

  const byLabel = await prisma.$queryRawUnsafe(
    'SELECT legacy_source, legacy_relation, count(*)::int AS candidates FROM rpa_cv GROUP BY 1, 2 ORDER BY 1 NULLS LAST, 2');
  console.log('\nCandidates by label:');
  console.table(byLabel);

  const [x] = await prisma.$queryRawUnsafe(`
    WITH logged AS (
      SELECT DISTINCT cv_id FROM rpa_legacy_import_rows
      WHERE outcome IN ('inserted', 'updated_existing') AND cv_id IS NOT NULL)
    SELECT
      (SELECT count(*)::int FROM logged) AS logged_candidates,
      (SELECT count(*)::int FROM logged l JOIN rpa_cv c ON c.id = l.cv_id
         WHERE c.legacy_source IS NULL AND c.last_action_context IN ('duplicate_merge', 'email_intake')) AS label_removed_by_fresh_resume,
      (SELECT count(*)::int FROM logged l JOIN rpa_cv c ON c.id = l.cv_id
         WHERE c.legacy_source IS NULL AND c.last_action_context IS DISTINCT FROM 'duplicate_merge'
           AND c.last_action_context IS DISTINCT FROM 'email_intake') AS logged_but_unlabelled,
      (SELECT count(*)::int FROM rpa_cv c WHERE c.legacy_source IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM logged l WHERE l.cv_id = c.id)) AS labelled_but_not_logged,
      (SELECT count(*)::int FROM logged l WHERE NOT EXISTS (SELECT 1 FROM rpa_cv c WHERE c.id = l.cv_id)) AS logged_candidate_missing`);
  console.log('\nCross-check against the import log:');
  console.table([x]);

  const ok = x.logged_but_unlabelled === 0 && x.labelled_but_not_logged === 0;
  console.log(ok ? '\nCHECK OK' : '\nCHECK FAILED: see logged_but_unlabelled / labelled_but_not_logged above.');
  if (!ok) exitCode = 1;
} catch (e) {
  console.error(`FAILED: ${e.message}`);
  exitCode = 1;
} finally {
  await prisma.$disconnect();
}
process.exit(exitCode);
