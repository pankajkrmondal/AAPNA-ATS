/**
 * Closure backfill — bring pre-2026-08-26 closed journeys onto the new
 * pipeline_status vocabulary, and stamp the joined_at they never got.
 *
 * WHY
 * ---
 * Until 2026-08-26, setFinalOutcome() wrote only rpa_cv.FinalStatus. The
 * shortlist row was left untouched, so a journey closed as `joined` still read
 * `pipeline_status = 'shortlisted'` forever — and that column feeds the
 * dashboard shortlist tile, the recruiter leaderboard and the screening badges.
 * Audit section 2.4. The fix stops future breakage; it does not repair rows
 * closed before it landed. This script repairs those.
 *
 * It also stamps `joined_at` from `closed_at` where the outcome is `joined` and
 * joined_at is null, matching exactly what setFinalOutcome now does — that
 * column was declared, read by the dashboard, and written by nothing.
 *
 * READ-ONLY BY DEFAULT. Nothing is written unless --apply is passed, and
 * --apply writes only the two columns listed in the report, on only the ids it
 * listed.
 *
 *   node scripts/backfill-closure-pipeline-status.mjs           # report only
 *   node scripts/backfill-closure-pipeline-status.mjs --json    # machine-readable
 *   node scripts/backfill-closure-pipeline-status.mjs --apply   # write (read the report first)
 *   node scripts/backfill-closure-pipeline-status.mjs --skip-rejected --apply
 *
 * THE MAPPING IS NOT RESTATED HERE
 * -------------------------------
 * It calls shortlistStatusFor() — the same function setFinalOutcome uses — so
 * the backfill and the live path cannot drift. Restating the eight-way mapping
 * in a script is precisely how the two writers of this column diverged in the
 * first place.
 *
 * ⚠️ THE --skip-rejected FLAG, AND WHY IT EXISTS
 * ---------------------------------------------
 * A row currently reading 'rejected' whose journey closed as, say, backed_out
 * will be rewritten to 'backed_out'. That is more accurate — but
 * `pipeline_status = 'rejected'` is what drives the Q11 SIX-MONTH re-application
 * cooling-off (screening.service.js), so rewriting it **lets that candidate
 * re-apply immediately**. On staging test data that is harmless. On production
 * it changes a real person's eligibility, and it must be a deliberate decision
 * rather than a side effect of tidying a column.
 *
 * Pass --skip-rejected to leave every currently-'rejected' row alone.
 *
 * SCOPE DECISION, 2026-08-26: applied to STAGING ONLY. Production was
 * deliberately left untouched. If that is revisited, re-ask the --skip-rejected
 * question first and re-read the counts — they are not the staging ones.
 */
import prisma from '../src/config/database.js';
import { shortlistStatusFor } from '../src/config/pipelineStages.js';
import { FINAL_OUTCOMES } from '../src/config/pipelineStages.js';

const APPLY = process.argv.includes('--apply');
const AS_JSON = process.argv.includes('--json');
const SKIP_REJECTED = process.argv.includes('--skip-rejected');

async function main() {
  // Every closed journey that carries a shortlist row. An orphan journey (no
  // shortlist_id) has no legacy layer to repair and is skipped by the join.
  const closed = await prisma.rpa_candidate_pipeline.findMany({
    where: { final_outcome: { not: null }, shortlist_id: { not: null } },
    select: {
      id: true,
      final_outcome: true,
      closed_at: true,
      shortlist_id: true,
      rpa_shortlisted_candidates: {
        select: { id: true, pipeline_status: true, joined_at: true, candidate_name: true },
      },
    },
    orderBy: { closed_at: 'asc' },
  });

  const statusFixes = [];
  const joinedAtFixes = [];
  const skipped = [];

  for (const j of closed) {
    const sl = j.rpa_shortlisted_candidates;
    if (!sl) continue;

    const expected = shortlistStatusFor(j.final_outcome);
    if (expected && sl.pipeline_status !== expected) {
      const row = {
        pipeline_id: Number(j.id),
        shortlist_id: sl.id,
        candidate: sl.candidate_name,
        final_outcome: j.final_outcome,
        from: sl.pipeline_status,
        to: expected,
      };
      // The cooling-off guard. See the header.
      if (SKIP_REJECTED && sl.pipeline_status === 'rejected') {
        skipped.push({ ...row, why: 'currently rejected; --skip-rejected set' });
      } else {
        statusFixes.push(row);
      }
    }

    // joined_at, gated exactly as setFinalOutcome gates it: JOINED only, taken
    // from closed_at so the two reconcile rather than drifting.
    if (j.final_outcome === FINAL_OUTCOMES.JOINED && !sl.joined_at && j.closed_at) {
      joinedAtFixes.push({
        pipeline_id: Number(j.id),
        shortlist_id: sl.id,
        candidate: sl.candidate_name,
        joined_at: j.closed_at,
      });
    }
  }

  if (AS_JSON) {
    console.log(JSON.stringify({
      closed_journeys: closed.length,
      status_fixes: statusFixes,
      joined_at_fixes: joinedAtFixes,
      skipped,
      applied: APPLY,
    }, null, 2));
  } else {
    console.log(`\nClosed journeys with a shortlist row: ${closed.length}`);
    console.log(`pipeline_status corrections needed:    ${statusFixes.length}`);
    console.log(`joined_at stamps needed:               ${joinedAtFixes.length}`);
    if (skipped.length) console.log(`skipped (--skip-rejected):             ${skipped.length}`);

    if (statusFixes.length) {
      console.log('\npipeline_status:');
      for (const f of statusFixes) {
        const flag = f.from === 'rejected' ? '   <-- LEAVES the Q11 cooling-off' : '';
        console.log(`  #${f.pipeline_id}  ${f.final_outcome.padEnd(20)} ${String(f.from).padEnd(14)} -> ${f.to}${flag}`);
      }
    }
    if (joinedAtFixes.length) {
      console.log('\njoined_at:');
      for (const f of joinedAtFixes) {
        console.log(`  #${f.pipeline_id}  ${f.candidate || '(unnamed)'} -> ${new Date(f.joined_at).toISOString()}`);
      }
    }
    if (skipped.length) {
      console.log('\nskipped:');
      for (const f of skipped) console.log(`  #${f.pipeline_id}  ${f.from} (would have become ${f.to}) — ${f.why}`);
    }
    if (!statusFixes.length && !joinedAtFixes.length) {
      console.log('\nNothing to do — every closed journey already agrees with shortlistStatusFor().');
    }
  }

  if (!APPLY) {
    if (statusFixes.length || joinedAtFixes.length) {
      console.log('\nDRY RUN. Nothing was written. Re-run with --apply to make these changes.');
    }
    return;
  }

  // Per-row updates rather than one updateMany: the target value differs per
  // row, and a per-row loop keeps the applied set identical to the reported set.
  let statusWritten = 0;
  for (const f of statusFixes) {
    await prisma.rpa_shortlisted_candidates.update({
      where: { id: f.shortlist_id },
      data: { pipeline_status: f.to },
    });
    statusWritten++;
  }
  let joinedWritten = 0;
  for (const f of joinedAtFixes) {
    // joined_at: null in the filter so a value written between the report and
    // now is never clobbered.
    const res = await prisma.rpa_shortlisted_candidates.updateMany({
      where: { id: f.shortlist_id, joined_at: null },
      data: { joined_at: f.joined_at },
    });
    joinedWritten += res.count;
  }

  console.log(`\nAPPLIED: ${statusWritten} pipeline_status, ${joinedWritten} joined_at.`);
  console.log('Re-run without --apply to confirm nothing is left.');
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
