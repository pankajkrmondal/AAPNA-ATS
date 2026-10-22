/**
 * Shortlist identity backfill (N29) — bring the pipeline's copy of each
 * candidate's name and email in line with the candidate record.
 *
 * WHY
 * ---
 * rpa_shortlisted_candidates.candidate_name / candidate_email are copied from
 * rpa_cv at shortlist time, and the pipeline board, the drawer, Analytics and
 * every pipeline email read the copy. Until N29 nothing updated it afterwards,
 * so a name or email corrected in Search Candidate, the missing-details form,
 * an upload merge or Outlook intake never reached the pipeline. N29 keeps them
 * in step from now on (services/candidateSync.service.js); this repairs rows
 * that drifted before it landed.
 *
 * READ-ONLY BY DEFAULT. Nothing is written unless --apply is passed, and
 * --apply writes only the columns shown in the report, on only the rows listed.
 *
 *   NODE_ENV=staging node scripts/backfill-shortlist-identity.mjs          # report only
 *   NODE_ENV=staging node scripts/backfill-shortlist-identity.mjs --json   # machine-readable
 *   NODE_ENV=staging node scripts/backfill-shortlist-identity.mjs --apply --expect-db recruitmentautomationdb
 *
 * --apply also needs --expect-db naming the database it is connected to:
 * staging and production share one server, so a write never goes to whichever
 * database the env file happens to name.
 *
 * THE RULE IS NOT RESTATED HERE
 * -----------------------------
 * It calls shortlistIdentityPatch() — the same function the live sync uses —
 * so the backfill and the live path cannot drift. That includes keeping a
 * replaced address in candidate_email_all, so the drawer's inbox still finds
 * threads filed under it, and never blanking the copy from an empty record.
 *
 * Release: run on dev, then staging; production in the final release.
 */
import prisma from '../src/config/database.js';
import { shortlistIdentityPatch } from '../src/utils/candidateSync.js';

const APPLY = process.argv.includes('--apply');
const AS_JSON = process.argv.includes('--json');
const expectIdx = process.argv.indexOf('--expect-db');
const EXPECT_DB = expectIdx > -1 ? process.argv[expectIdx + 1] : null;

async function main() {
  const [{ db }] = await prisma.$queryRawUnsafe('SELECT current_database() AS db');
  if (!AS_JSON) console.log(`Database: ${db}`);
  if (APPLY && db !== EXPECT_DB) {
    throw new Error(`Refusing to write: connected to "${db}", --expect-db is "${EXPECT_DB ?? '(missing)'}".`);
  }

  const rows = await prisma.rpa_shortlisted_candidates.findMany({
    where: { cv_id: { not: null } },
    select: {
      id: true,
      cv_id: true,
      candidate_name: true,
      candidate_email: true,
      candidate_email_all: true,
      cv: { select: { Name: true, EmailID: true } },
    },
    orderBy: { id: 'asc' },
  });

  const changes = [];
  for (const row of rows) {
    if (!row.cv) continue;
    const patch = shortlistIdentityPatch(row, row.cv);
    if (Object.keys(patch).length === 0) continue;
    changes.push({
      id: row.id,
      cv_id: String(row.cv_id),
      before: { candidate_name: row.candidate_name, candidate_email: row.candidate_email, candidate_email_all: row.candidate_email_all },
      patch,
    });
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ scanned: rows.length, toChange: changes.length, changes }, null, 2));
  } else {
    console.log(`Scanned ${rows.length} shortlist rows; ${changes.length} differ from the candidate record.`);
    for (const c of changes) {
      const parts = Object.entries(c.patch).map(([k, v]) => `${k}: "${c.before[k] ?? ''}" -> "${v ?? ''}"`);
      console.log(`  #${c.id} (cv ${c.cv_id})  ${parts.join('  |  ')}`);
    }
  }

  if (!APPLY) {
    if (!AS_JSON) console.log('\nReport only. Re-run with --apply to write these changes.');
    return;
  }

  let written = 0;
  for (const c of changes) {
    await prisma.rpa_shortlisted_candidates.update({
      where: { id: c.id },
      data: { ...c.patch, modified_at: new Date() },
    });
    written += 1;
  }
  console.log(`\nApplied: ${written} shortlist row(s) updated. Clear the screening cache (or wait 1 h) so lists refetch.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
