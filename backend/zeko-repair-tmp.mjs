// Repair: my first verification run executed a partially-edited module and
// recorded OTHER candidates' scores against rows 47/55/56/57/59, marking them
// completed. Revert those rows to 'sent' and delete the mis-attributed result
// rows (ids 6-10). Dry run unless --apply.
import fs from 'node:fs';
const APPLY = process.argv.includes('--apply');
const env = {};
for (const raw of fs.readFileSync('.env.staging', 'utf8').split(/\r?\n/)) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue;
  const e = l.indexOf('='); if (e < 0) continue;
  let v = l.slice(e + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[l.slice(0, e).trim()] = v;
}
const { PrismaClient } = await import('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
const j = (o) => JSON.stringify(o, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 2);

const BAD_RESULTS = [6, 7, 8, 9, 10];   // Kenneth Lobo / Vijay Panchal / Sekhar Yellampati
const BAD_PIPELINE = [47, 55, 56, 57, 59];

console.log('=== result rows to DELETE (mis-attributed) ===');
console.log(j(await p.$queryRawUnsafe(
  `SELECT id, candidate_name, candidate_email, pipeline_id FROM rpa_zeko_interview_results
   WHERE id = ANY($1::bigint[]) ORDER BY id;`, BAD_RESULTS
)));

console.log('\n=== pipeline rows to REVERT to sent ===');
console.log(j(await p.$queryRawUnsafe(
  `SELECT p.id, sc.candidate_name, p.status FROM rpa_zeko_candidate_pipeline p
   JOIN rpa_shortlisted_candidates sc ON sc.id = p.candidate_id
   WHERE p.id = ANY($1::bigint[]) ORDER BY p.id;`, BAD_PIPELINE
)));

// Did any bad score reach rpa_cv? The bad run used cv_id, so check those journeys.
console.log('\n=== rpa_cv rows for the affected candidates (check for stray scores) ===');
console.log(j(await p.$queryRawUnsafe(`
  SELECT cv.id, cv."EmailID", cv."ZekoInterviewScore", cv."ZekoCodingScore", cv."ZekoCommunicationScore"
  FROM rpa_cv cv
  WHERE cv.id IN (
    SELECT cp.cv_id FROM rpa_candidate_pipeline cp
    JOIN rpa_zeko_candidate_pipeline zp ON zp.candidate_id = cp.shortlist_id
    WHERE zp.id = ANY($1::bigint[]) AND cp.cv_id IS NOT NULL
  );
`, BAD_PIPELINE)));

if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply.');
} else {
  const delN = await p.$executeRawUnsafe(
    `DELETE FROM rpa_zeko_interview_results WHERE id = ANY($1::bigint[]);`, BAD_RESULTS
  );
  const revN = await p.$executeRawUnsafe(
    `UPDATE rpa_zeko_candidate_pipeline SET status='sent', completed_at=NULL
     WHERE id = ANY($1::bigint[]) AND status='completed';`, BAD_PIPELINE
  );
  // Clear scores on the affected CVs so no stranger's numbers linger.
  const cvN = await p.$executeRawUnsafe(`
    UPDATE rpa_cv SET "ZekoInterviewScore"=NULL, "ZekoCodingScore"=NULL, "ZekoCommunicationScore"=NULL
    WHERE id IN (
      SELECT cp.cv_id FROM rpa_candidate_pipeline cp
      JOIN rpa_zeko_candidate_pipeline zp ON zp.candidate_id = cp.shortlist_id
      WHERE zp.id = ANY($1::bigint[]) AND cp.cv_id IS NOT NULL
    );
  `, BAD_PIPELINE);
  console.log(`\nDeleted ${delN} result row(s); reverted ${revN} pipeline row(s); cleared ${cvN} rpa_cv row(s).`);

  console.log('\n=== state after repair ===');
  console.log(j(await p.$queryRawUnsafe(
    `SELECT id, status, completed_at::text FROM rpa_zeko_candidate_pipeline
     WHERE id = ANY($1::bigint[]) ORDER BY id;`, BAD_PIPELINE
  )));
  console.log(j(await p.$queryRawUnsafe(
    `SELECT id, candidate_name, pipeline_id FROM rpa_zeko_interview_results ORDER BY id DESC LIMIT 6;`
  )));
}
await p.$disconnect();
