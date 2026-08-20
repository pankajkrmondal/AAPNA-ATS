/**
 * Block A — M1 Stage Engine, executed against the LIVE staging database.
 * Run: node --test src/tests/integration/pipelineStageEngine.test.js
 *
 * These are NOT unit tests. They call the real service layer against real rows,
 * because the behaviour under test (claim-then-act guards, transaction
 * rollback, legacy write-back) only exists in the interaction between the
 * service and PostgreSQL. A mock would assert our idea of the guard, not the
 * guard.
 *
 * Covers PIPE-01, 02, 03, 06, 13, 16 from
 * docs/test-plans/phase3-m1-m3a-m4-m5-m6-test-plan.md.
 *
 * SAFETY: every row touched here belongs to the fixture (helpers/fixture.js,
 * tagged PHASE3-TESTPASS-FIXTURE). Nothing reads or writes pre-existing
 * staging data. Each test seeds its own journey and deletes it afterwards, so
 * the file is re-runnable and order-independent.
 *
 * EMAIL: config.email.redirectInNonProd is on for staging, so candidate mail
 * goes to EMAIL_STAGING_RECIPIENTS, never to the seeded candidate address.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../../config/database.js';
import { disconnectRedis } from '../../config/redis.js';
import {
  setStageOutcome,
  createPipelineJourney,
} from '../../services/pipeline.service.js';
import { STAGE_KEYS } from '../../config/pipelineStages.js';
import { FIXTURE_TAG, CANDIDATE_EMAIL } from '../helpers/fixture.js';

/** Acting user — the seeded admin (id 2). */
const ACTED_BY = 2;

/** Journeys created by this file, deleted in after(). */
const createdJourneys = [];
const createdCvs = [];
let mrfSingleId;

/** Creates a throwaway candidate + journey for one test. */
async function makeJourney({ name, vendor = false, mrfId = mrfSingleId }) {
  const cv = await prisma.rpa_cv.create({
    data: {
      Name: `${name} ${Date.now()}`,
      EmailID: CANDIDATE_EMAIL,
      PositionApplied: 'RPA Developer',
      statusActive: 'Active',
      MetaData: FIXTURE_TAG,
      createdAt: new Date(),
      modifiedAt: new Date(),
      ...(vendor
        ? { VendorEmail: 'genaiuserpankajmondal@gmail.com', vendorName: 'Phase3 Test Vendor', lockForNinetyDays: '2026-10-03' }
        : {}),
    },
  });
  createdCvs.push(cv.id);

  const shortlist = await prisma.rpa_shortlisted_candidates.create({
    data: {
      cv_id: cv.id,
      mrf_id: mrfId,
      candidate_name: cv.Name,
      candidate_email: CANDIDATE_EMAIL,
      position_applied: 'RPA Developer',
      shortlisted_by: 'phase3-testpass',
      recruiter_notes: FIXTURE_TAG,
    },
  });

  const journey = await createPipelineJourney({
    cvId: cv.id,
    mrfId,
    shortlistId: shortlist.id,
    source: vendor ? 'vendor_upload' : 'screening_shortlist',
  });
  createdJourneys.push(BigInt(journey.id));
  return { cv, shortlist, journey };
}

/** All stage events for a journey, oldest first. */
const eventsFor = (pipelineId) =>
  prisma.rpa_pipeline_stage_events.findMany({
    where: { pipeline_id: BigInt(pipelineId) },
    orderBy: { id: 'asc' },
    select: { stage_key: true, event_type: true, outcome: true, status_label: true, reason_text: true },
  });

before(async () => {
  const mrf = await prisma.rpa_mrf.findFirst({
    where: { additional_information: { contains: FIXTURE_TAG }, number_of_positions: 1 },
    select: { id: true },
  });
  assert.ok(mrf, 'Fixture MRF missing — run: node src/tests/helpers/fixture.js seed');
  mrfSingleId = mrf.id;
});

after(async () => {
  // Explicit ids only — never a time window (shared staging).
  if (createdJourneys.length) {
    await prisma.rpa_pipeline_stage_events.deleteMany({ where: { pipeline_id: { in: createdJourneys } } });
    await prisma.rpa_notifications.deleteMany({ where: { pipeline_id: { in: createdJourneys } } });
    await prisma.rpa_candidate_pipeline.deleteMany({ where: { id: { in: createdJourneys } } });
  }
  if (createdCvs.length) {
    await prisma.rpa_shortlisted_candidates.deleteMany({ where: { cv_id: { in: createdCvs } } });
    await prisma.rpa_cv.deleteMany({ where: { id: { in: createdCvs } } });
  }
  await prisma.$disconnect();
  try { await disconnectRedis(); } catch { /* already closed */ }
});

// ── PIPE-01 ───────────────────────────────────────────────────────────

describe('PIPE-01 — happy-path stage advance (approve)', () => {
  test('approve at zeko_hr advances to the next active stage and logs both events', async () => {
    const { journey } = await makeJourney({ name: 'PIPE01' });
    assert.equal(journey.current_stage_key, STAGE_KEYS.ZEKO_HR, 'journeys must start at zeko_hr');

    const result = await setStageOutcome(journey.id, { outcomeKey: 'approved', actedBy: ACTED_BY });

    // zeko_hr(20) -> assessment(30) is the next ACTIVE stage by sort_order.
    assert.equal(result.pipeline.current_stage_key, 'assessment');
    assert.equal(result.pipeline.current_stage_status, 'in_progress');

    const events = await eventsFor(journey.id);
    const outcome = events.filter((e) => e.event_type === 'outcome');
    const entered = events.filter((e) => e.event_type === 'entered');
    assert.equal(outcome.length, 1, 'exactly one outcome event');
    assert.equal(outcome[0].outcome, 'approved');
    assert.equal(entered.length, 2, 'one entered at creation + one for the new stage');
    assert.equal(entered[1].stage_key, 'assessment');
  });
});

// ── PIPE-02 ───────────────────────────────────────────────────────────

describe('PIPE-02 — reject/hold require a reason', () => {
  test('reject with no reason and no other_text is refused with the documented message', async () => {
    const { journey } = await makeJourney({ name: 'PIPE02a' });
    await assert.rejects(
      () => setStageOutcome(journey.id, { outcomeKey: 'rejected', actedBy: ACTED_BY }),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.equal(err.message, 'A reason is required for Reject/Hold outcomes.');
        return true;
      }
    );
    const stillThere = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: BigInt(journey.id) } });
    assert.equal(stillThere.current_stage_key, STAGE_KEYS.ZEKO_HR, 'a refused outcome must not move the candidate');
  });

  test('an "Other" reason without other_text is refused', async () => {
    const { journey } = await makeJourney({ name: 'PIPE02b' });
    const other = await prisma.rpa_outcome_reasons.findFirst({ where: { is_other: true, is_active: true } });
    assert.ok(other, 'no is_other reason configured');

    await assert.rejects(
      () => setStageOutcome(journey.id, { outcomeKey: 'rejected', reasonId: other.id, actedBy: ACTED_BY }),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Free-text reason is required/);
        return true;
      }
    );
  });

  test('reject WITH a valid reason succeeds and stores the free text', async () => {
    const { journey } = await makeJourney({ name: 'PIPE02c' });
    const other = await prisma.rpa_outcome_reasons.findFirst({ where: { is_other: true, is_active: true } });

    const result = await setStageOutcome(journey.id, {
      outcomeKey: 'rejected',
      reasonId: other.id,
      otherText: 'Automated test — PIPE-02 free text',
      actedBy: ACTED_BY,
    });
    assert.equal(result.pipeline.current_stage_status, 'rejected');

    const events = await eventsFor(journey.id);
    const outcome = events.find((e) => e.event_type === 'outcome');
    assert.equal(outcome.reason_text, 'Automated test — PIPE-02 free text');
  });
});

// ── PIPE-03 ───────────────────────────────────────────────────────────

describe('PIPE-03 — concurrent approval race', () => {
  test('two simultaneous approvals yield exactly one winner and one 409', async () => {
    const { journey } = await makeJourney({ name: 'PIPE03' });

    const [a, b] = await Promise.allSettled([
      setStageOutcome(journey.id, { outcomeKey: 'approved', actedBy: ACTED_BY }),
      setStageOutcome(journey.id, { outcomeKey: 'approved', actedBy: ACTED_BY }),
    ]);

    const fulfilled = [a, b].filter((r) => r.status === 'fulfilled');
    const rejected = [a, b].filter((r) => r.status === 'rejected');

    assert.equal(fulfilled.length, 1, `expected exactly 1 winner, got ${fulfilled.length}`);
    assert.equal(rejected.length, 1, `expected exactly 1 loser, got ${rejected.length}`);
    assert.equal(rejected[0].reason.statusCode, 409);
    assert.equal(
      rejected[0].reason.message,
      'Someone else moved this candidate while you were deciding. Reopen the candidate to see where they are now.'
    );

    // The guard is only real if the LOSER rolled back: one outcome event, and
    // the candidate advanced exactly one stage.
    const events = await eventsFor(journey.id);
    assert.equal(
      events.filter((e) => e.event_type === 'outcome').length, 1,
      'the losing transaction must roll back its outcome event'
    );
    const row = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: BigInt(journey.id) } });
    assert.equal(row.current_stage_key, 'assessment', 'must advance exactly one stage, not two');
  });
});

// ── D3 ────────────────────────────────────────────────────────────────

/**
 * The stale-tab guard. PIPE-03 above fires both approvals at once and so can
 * only ever exercise the CONCURRENT window; this defect lived in the gap that
 * left. Here the first approval is allowed to COMPLETE before the second is
 * sent, which is what a second browser tab actually does.
 *
 * Found manually on 2026-08-20 (the N5 spot-check) after PIPE-03 had been
 * green for a day.
 */
describe('D3 — stale-tab decision must not double-advance', () => {
  test('a decision naming the stage the client SAW is refused once the candidate has moved', async () => {
    const { journey } = await makeJourney({ name: 'D3a' });

    // Tab A: approves from zeko_hr and completes. Not concurrent — awaited.
    const first = await setStageOutcome(journey.id, {
      outcomeKey: 'approved',
      expectedStageKey: 'zeko_hr',
      actedBy: ACTED_BY,
    });
    assert.equal(first.pipeline.current_stage_key, 'assessment');

    // Tab B: still displaying zeko_hr, clicks approve some time later.
    await assert.rejects(
      () => setStageOutcome(journey.id, {
        outcomeKey: 'approved',
        expectedStageKey: 'zeko_hr',
        actedBy: ACTED_BY,
      }),
      (err) => {
        assert.equal(err.statusCode, 409);
        assert.equal(
          err.message,
          'Someone else moved this candidate while you were deciding. Reopen the candidate to see where they are now.'
        );
        return true;
      }
    );

    // The whole point: the candidate must NOT have advanced twice, and the
    // skipped stage must not have been skipped.
    const row = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: BigInt(journey.id) } });
    assert.equal(row.current_stage_key, 'assessment', 'stale approval must not advance a second time');

    const events = await eventsFor(journey.id);
    assert.equal(
      events.filter((e) => e.event_type === 'outcome').length, 1,
      'the refused decision must leave no outcome event'
    );
  });

  test('a decision naming the CURRENT stage still succeeds', async () => {
    const { journey } = await makeJourney({ name: 'D3b' });

    // The ordinary case — a fresh tab, sending the stage it is really showing.
    const result = await setStageOutcome(journey.id, {
      outcomeKey: 'approved',
      expectedStageKey: 'zeko_hr',
      actedBy: ACTED_BY,
    });
    assert.equal(result.pipeline.current_stage_key, 'assessment');
  });

  test('omitting the stage keeps the old behaviour for direct service callers', async () => {
    const { journey } = await makeJourney({ name: 'D3c' });

    // Jobs, scripts and the pre-existing tests never send a stage. They must
    // keep working — the guard is opt-in, driven by whoever has a screen.
    const result = await setStageOutcome(journey.id, { outcomeKey: 'approved', actedBy: ACTED_BY });
    assert.equal(result.pipeline.current_stage_key, 'assessment');
  });

  test('PIPE-03 still holds WITH the stage supplied — both guards coexist', async () => {
    const { journey } = await makeJourney({ name: 'D3d' });

    // Two tabs both correctly showing zeko_hr, clicking at the same instant.
    // The stale check passes for both (neither is stale); the conditional claim
    // is what separates them. This is the case the new guard cannot catch, and
    // it proves the old one was not replaced.
    const [a, b] = await Promise.allSettled([
      setStageOutcome(journey.id, { outcomeKey: 'approved', expectedStageKey: 'zeko_hr', actedBy: ACTED_BY }),
      setStageOutcome(journey.id, { outcomeKey: 'approved', expectedStageKey: 'zeko_hr', actedBy: ACTED_BY }),
    ]);

    assert.equal([a, b].filter((r) => r.status === 'fulfilled').length, 1, 'exactly one winner');
    const loser = [a, b].find((r) => r.status === 'rejected');
    assert.equal(loser.reason.statusCode, 409);

    const row = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: BigInt(journey.id) } });
    assert.equal(row.current_stage_key, 'assessment', 'must advance exactly one stage, not two');
  });
});

// ── PIPE-06 ───────────────────────────────────────────────────────────

describe('PIPE-06 — legacy write-back on outcome', () => {
  test('approving writes FinalStatus to rpa_cv and pipeline_status to the shortlist row', async () => {
    const { cv, shortlist, journey } = await makeJourney({ name: 'PIPE06' });

    await setStageOutcome(journey.id, { outcomeKey: 'approved', actedBy: ACTED_BY });

    const cvRow = await prisma.rpa_cv.findUnique({ where: { id: cv.id }, select: { FinalStatus: true } });
    assert.ok(cvRow.FinalStatus, 'FinalStatus must be written back');
    assert.match(cvRow.FinalStatus, /Approved/i);

    const slRow = await prisma.rpa_shortlisted_candidates.findUnique({
      where: { id: shortlist.id }, select: { pipeline_status: true },
    });
    assert.equal(slRow.pipeline_status, 'shortlisted', 'approved maps to shortlisted');
  });
});

// ── PIPE-13 ───────────────────────────────────────────────────────────

describe('PIPE-13 — 6-month re-application cooling-off', () => {
  test('a fresh journey for a recently-rejected candidate is blocked with 409', async () => {
    const { cv, journey } = await makeJourney({ name: 'PIPE13' });
    const other = await prisma.rpa_outcome_reasons.findFirst({ where: { is_other: true, is_active: true } });

    await setStageOutcome(journey.id, {
      outcomeKey: 'rejected', reasonId: other.id, otherText: 'PIPE-13 setup', actedBy: ACTED_BY,
    });

    // A DIFFERENT MRF, so this is a genuinely new journey rather than the
    // idempotent same-MRF return path.
    const otherMrf = await prisma.rpa_mrf.findFirst({
      where: { additional_information: { contains: FIXTURE_TAG }, number_of_positions: 2 },
      select: { id: true },
    });

    await assert.rejects(
      () => createPipelineJourney({ cvId: cv.id, mrfId: otherMrf.id, source: 'screening_shortlist' }),
      (err) => {
        assert.equal(err.statusCode, 409);
        assert.match(err.message, /6-month re-application cooling-off period/);
        return true;
      }
    );
  });
});

// ── PIPE-16 ───────────────────────────────────────────────────────────

describe('PIPE-16 — skip_optional_next', () => {
  test('approving into an optional stage with skip lands two stages ahead and logs a skip event', async () => {
    const { journey } = await makeJourney({ name: 'PIPE16' });

    // Walk to tech2, whose next active stage (tech3) is optional.
    const path = ['assessment', 'zeko_fn', 'tech1', 'tech2'];
    for (const expected of path) {
      const r = await setStageOutcome(journey.id, { outcomeKey: 'approved', actedBy: ACTED_BY });
      assert.equal(r.pipeline.current_stage_key, expected);
    }

    const tech3 = await prisma.rpa_pipeline_stages.findUnique({ where: { stage_key: 'tech3' } });
    assert.equal(tech3.is_optional, true, 'tech3 must be optional for this case to mean anything');

    const result = await setStageOutcome(journey.id, {
      outcomeKey: 'approved', skipOptionalNext: true, actedBy: ACTED_BY,
    });
    assert.equal(result.pipeline.current_stage_key, 'hr_round', 'must bypass tech3');

    const events = await eventsFor(journey.id);
    const skip = events.filter((e) => e.event_type === 'skip');
    assert.equal(skip.length, 1, 'the bypassed stage gets a skip event, not entered');
    assert.equal(skip[0].stage_key, 'hr_round');
  });
});
