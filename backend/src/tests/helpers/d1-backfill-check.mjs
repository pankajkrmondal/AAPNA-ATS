/**
 * D1 backfill check — which requisitions should already be closed but aren't?
 *
 * Defect D1 (fixed 2026-08-19 in mrfClosure.service.js) meant countAcceptedHires()
 * returned 0 for every in-flight journey, so no requisition EVER auto-closed on
 * acceptance. The fix stops future breakage. It does not repair requisitions that
 * were already left open — those are live rows a client can see in the JD dropdown,
 * on the dashboard active tile, and on the pipeline board.
 *
 * This script finds them. It re-implements the FIXED counting rule (explicit NULL
 * branch, not NOT IN) against every open requisition and reports where
 * accepted >= openings.
 *
 * READ-ONLY BY DEFAULT. Nothing is written unless --apply is passed, and --apply
 * writes exactly one column (filled_at) on exactly the ids listed in the report.
 *
 *   node src/tests/helpers/d1-backfill-check.mjs            # report only
 *   node src/tests/helpers/d1-backfill-check.mjs --json     # machine-readable
 *   node src/tests/helpers/d1-backfill-check.mjs --apply    # close them (asks nothing — read the report first)
 *
 * WHY NOT JUST CALL closeMrfIfFilled() PER MRF
 * --------------------------------------------
 * That path also fires notifications, a socket broadcast and a Redis purge. Running
 * it across a backlog would spray "Requisition closed — all openings filled" into
 * everyone's notification bell for hires that happened weeks ago. --apply therefore
 * writes filled_at directly and clears the role cache, deliberately staying silent.
 * The stranded-candidate count is still reported, because that is the part a human
 * needs to act on.
 */
import prisma from '../../config/database.js';
import redis, { disconnectRedis } from '../../config/redis.js';
import { VACATING_OUTCOMES, isMrfFilled } from '../../config/pipelineStages.js';

const APPLY = process.argv.includes('--apply');
const AS_JSON = process.argv.includes('--json');

/**
 * The seat-holding rule, identical to the FIXED countAcceptedHires(). Kept as a
 * local copy rather than imported so this script reports what the rule *should*
 * be even if run against a checkout where the fix has been reverted.
 */
const HOLDS_A_SEAT = {
  OR: [
    { final_outcome: null },
    { final_outcome: { notIn: [...VACATING_OUTCOMES] } },
  ],
};

async function main() {
  // Every requisition not already marked filled. isMrfFilled() also treats the
  // legacy approval_status='closed' as filled, so those are excluded below rather
  // than in the query — the column is a string and the check belongs in one place.
  const candidates = await prisma.rpa_mrf.findMany({
    where: { filled_at: null },
    select: {
      id: true,
      position_hiring_for: true,
      number_of_positions: true,
      approval_status: true,
      filled_at: true,
      date_of_request: true,
    },
    orderBy: { id: 'asc' },
  });

  const open = candidates.filter((m) => !isMrfFilled(m));
  const legacyClosed = candidates.length - open.length;

  const shouldBeClosed = [];

  for (const mrf of open) {
    const openings =
      mrf.number_of_positions && mrf.number_of_positions > 0 ? mrf.number_of_positions : 1;

    const accepted = await prisma.rpa_offers.count({
      where: {
        candidate_decision: 'accepted',
        rpa_candidate_pipeline: { mrf_id: mrf.id, ...HOLDS_A_SEAT },
      },
    });

    if (accepted < openings) continue;

    // Candidates still running against a requisition that has no opening left.
    // The accepted hires are open journeys too — they are not stranded.
    const openJourneys = await prisma.rpa_candidate_pipeline.count({
      where: { mrf_id: mrf.id, final_outcome: null },
    });

    // When the acceptance happened, so the age of the miss is visible.
    const earliest = await prisma.rpa_offers.findFirst({
      where: {
        candidate_decision: 'accepted',
        rpa_candidate_pipeline: { mrf_id: mrf.id, ...HOLDS_A_SEAT },
      },
      select: { offer_accepted_at: true, updated_at: true },
      orderBy: { id: 'asc' },
    });

    shouldBeClosed.push({
      mrf_id: Number(mrf.id),
      position: mrf.position_hiring_for,
      openings,
      accepted,
      stranded: Math.max(0, openJourneys - accepted),
      approval_status: mrf.approval_status,
      accepted_at: earliest?.offer_accepted_at ?? earliest?.updated_at ?? null,
    });
  }

  return { scanned: open.length, legacyClosed, shouldBeClosed };
}

function report({ scanned, legacyClosed, shouldBeClosed }) {
  const lines = [];
  lines.push('');
  lines.push('D1 BACKFILL CHECK — requisitions that should have auto-closed');
  lines.push('='.repeat(64));
  lines.push(`Open requisitions scanned : ${scanned}`);
  if (legacyClosed) lines.push(`Skipped (legacy 'closed') : ${legacyClosed}`);
  lines.push(`Should be closed          : ${shouldBeClosed.length}`);
  lines.push('');

  if (!shouldBeClosed.length) {
    lines.push('Nothing to repair. Every open requisition still has openings left.');
    lines.push('');
    return lines.join('\n');
  }

  const pad = (s, n) => String(s ?? '').padEnd(n);
  lines.push(
    `${pad('MRF', 7)}${pad('Position', 34)}${pad('Filled', 9)}${pad('Stranded', 10)}${pad('Accepted on', 12)}Status`
  );
  lines.push('-'.repeat(88));
  for (const r of shouldBeClosed) {
    const when = r.accepted_at ? new Date(r.accepted_at).toISOString().slice(0, 10) : 'unknown';
    lines.push(
      pad(r.mrf_id, 7) +
        pad((r.position || '(untitled)').slice(0, 32), 34) +
        pad(`${r.accepted}/${r.openings}`, 9) +
        pad(r.stranded || '—', 10) +
        pad(when, 12) +
        (r.approval_status || '')
    );
  }
  lines.push('');

  const stranded = shouldBeClosed.reduce((n, r) => n + r.stranded, 0);
  if (stranded) {
    lines.push(
      `⚠️  ${stranded} candidate(s) are still in progress against these filled requisitions.`
    );
    lines.push(
      '    They have been interviewed / chased for roles with no opening left. Closing the'
    );
    lines.push('    requisition does not tell them — that is a conversation, not a script.');
    lines.push('');
  }

  lines.push('These are visible to a client: still in the JD dropdown, still on the active tile.');
  lines.push('Re-run with --apply to stamp filled_at (silently — no notification spam).');
  lines.push('');
  return lines.join('\n');
}

async function apply(rows) {
  const done = [];
  for (const r of rows) {
    // Conditional, exactly like closeMrfIfFilled's claim: if something closed it
    // between the scan and now, leave it alone.
    const claim = await prisma.rpa_mrf.updateMany({
      where: { id: BigInt(r.mrf_id), filled_at: null },
      data: { filled_at: r.accepted_at ? new Date(r.accepted_at) : new Date() },
    });
    if (claim.count !== 1) {
      done.push({ ...r, result: 'skipped — closed by something else since the scan' });
      continue;
    }
    // Same cache hygiene as the real closure path, or a stale entry resurrects it.
    try {
      await redis.del(`screening:role:${r.mrf_id}`);
    } catch {
      // Cache miss or Redis down — the column write is what matters.
    }
    done.push({ ...r, result: 'closed' });
  }
  return done;
}

try {
  const result = await main();

  if (APPLY && result.shouldBeClosed.length) {
    const done = await apply(result.shouldBeClosed);
    if (AS_JSON) {
      console.log(JSON.stringify({ ...result, applied: done }, null, 2));
    } else {
      console.log(report(result));
      console.log('APPLIED');
      console.log('-'.repeat(64));
      for (const d of done) console.log(`MRF ${d.mrf_id}: ${d.result}`);
      console.log('');
      console.log('filled_at was backdated to the acceptance date, not today, so the');
      console.log('requisition reads as filled when it actually filled.');
      console.log('');
    }
  } else if (AS_JSON) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(report(result));
  }
} catch (err) {
  console.error(`\nD1 backfill check FAILED: ${err.message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  try {
    await disconnectRedis();
  } catch {
    // Already closed, or never opened.
  }
}
