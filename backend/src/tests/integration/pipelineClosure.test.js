/**
 * Block A part 2 â€” closure, guards, filters, and the N negative checks.
 * Run: node --test src/tests/integration/pipelineClosure.test.js
 *
 * Covers PIPE-04, 05, 09, 10, 11, 12, 14, 15 and N1.
 * See the header of pipelineStageEngine.test.js for the safety rules; the same
 * apply â€” fixture-tagged rows only, torn down by explicit id.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../../config/database.js';
import { disconnectRedis } from '../../config/redis.js';
import {
  setStageOutcome,
  setFinalOutcome,
  advanceStage,
  sendAdHocEmail,
  createPipelineJourney,
  listPipeline,
  reopenJourney,
  setJourneyPaused,
  scheduleInterviewRound,
} from '../../services/pipeline.service.js';
import {
  countFilledSeats,
  closeMrfManually,
  reopenMrfManually,
} from '../../services/mrfClosure.service.js';
import { FINAL_OUTCOMES, VACATING_OUTCOMES, STAGE_KEYS } from '../../config/pipelineStages.js';
import { VENDOR_LOCK_FROZEN } from '../../utils/vendorLock.js';
import { FIXTURE_TAG, CANDIDATE_EMAIL, VENDOR_EMAIL } from '../helpers/fixture.js';

const ACTED_BY = 2;
const createdJourneys = [];
const createdCvs = [];
let mrfSingleId;
let mrfDoubleId;

async function makeJourney({ name, vendor = false, mrfId }) {
  const cv = await prisma.rpa_cv.create({
    data: {
      Name: `${name} ${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      EmailID: CANDIDATE_EMAIL,
      PositionApplied: 'RPA Developer',
      statusActive: 'Active',
      MetaData: FIXTURE_TAG,
      createdAt: new Date(),
      modifiedAt: new Date(),
      ...(vendor
        ? { VendorEmail: VENDOR_EMAIL, vendorName: 'Phase3 Test Vendor', lockForNinetyDays: '2026-10-03' }
        : {}),
    },
  });
  createdCvs.push(cv.id);

  const shortlist = await prisma.rpa_shortlisted_candidates.create({
    data: {
      cv_id: cv.id, mrf_id: mrfId ?? mrfSingleId,
      candidate_name: cv.Name, candidate_email: CANDIDATE_EMAIL,
      position_applied: 'RPA Developer', shortlisted_by: 'phase3-testpass',
      recruiter_notes: FIXTURE_TAG,
    },
  });

  const journey = await createPipelineJourney({
    cvId: cv.id, mrfId: mrfId ?? mrfSingleId, shortlistId: shortlist.id,
    source: vendor ? 'vendor_upload' : 'screening_shortlist',
  });
  createdJourneys.push(BigInt(journey.id));
  return { cv, shortlist, journey };
}

before(async () => {
  const [single, dbl] = await Promise.all([
    prisma.rpa_mrf.findFirst({ where: { additional_information: { contains: FIXTURE_TAG }, number_of_positions: 1 }, select: { id: true } }),
    prisma.rpa_mrf.findFirst({ where: { additional_information: { contains: FIXTURE_TAG }, number_of_positions: 2 }, select: { id: true } }),
  ]);
  assert.ok(single && dbl, 'Fixture MRFs missing â€” run: node src/tests/helpers/fixture.js seed');
  mrfSingleId = single.id;
  mrfDoubleId = dbl.id;
});

after(async () => {
  if (createdJourneys.length) {
    await prisma.rpa_document_requests.deleteMany({ where: { pipeline_id: { in: createdJourneys } } });
    await prisma.rpa_interview_schedule.deleteMany({ where: { pipeline_id: { in: createdJourneys } } });
    await prisma.rpa_offers.deleteMany({ where: { pipeline_id: { in: createdJourneys } } });
    await prisma.rpa_pipeline_stage_events.deleteMany({ where: { pipeline_id: { in: createdJourneys } } });
    await prisma.rpa_notifications.deleteMany({ where: { pipeline_id: { in: createdJourneys } } });
    await prisma.rpa_candidate_pipeline.deleteMany({ where: { id: { in: createdJourneys } } });
  }
  if (createdCvs.length) {
    await prisma.rpa_shortlisted_candidates.deleteMany({ where: { cv_id: { in: createdCvs } } });
    await prisma.rpa_cv.deleteMany({ where: { id: { in: createdCvs } } });
  }
  if (createdMrfs.length) {
    await prisma.rpa_mrf.deleteMany({ where: { id: { in: createdMrfs } } });
  }
  // Leave no MRF closed by this file - neither auto-filled nor manually closed.
  await prisma.rpa_mrf.updateMany({
    where: { id: { in: [mrfSingleId, mrfDoubleId] } },
    data: { filled_at: null, closed_at: null, closure_reason: null, closure_note: null },
  });
  await prisma.$disconnect();
  try { await disconnectRedis(); } catch { /* already closed */ }
});

// â”€â”€ PIPE-04 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('PIPE-04 â€” a closed journey refuses every further action', () => {
  test('outcome, advance, closure and email all 409 on a closed journey', async () => {
    const { journey } = await makeJourney({ name: 'PIPE04' });
    await setFinalOutcome(journey.id, { finalOutcomeKey: FINAL_OUTCOMES.REJECTED, actedBy: ACTED_BY });

    const expect409 = async (fn, label) => {
      await assert.rejects(fn, (err) => {
        assert.equal(err.statusCode, 409, `${label} should 409, got ${err.statusCode}`);
        assert.match(err.message, /closed/i, `${label} message should name the closure: "${err.message}"`);
        return true;
      }, label);
    };

    await expect409(() => setStageOutcome(journey.id, { outcomeKey: 'approved', actedBy: ACTED_BY }), 'setStageOutcome');
    await expect409(() => advanceStage(journey.id, { actedBy: ACTED_BY }), 'advanceStage');
    await expect409(() => setFinalOutcome(journey.id, { finalOutcomeKey: FINAL_OUTCOMES.JOINED, actedBy: ACTED_BY }), 'setFinalOutcome');
    await expect409(() => sendAdHocEmail(journey.id, { subject: 'x', body: 'y' }), 'sendAdHocEmail');
  });
});

// â”€â”€ PIPE-05 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('PIPE-05 â€” double-close race', () => {
  test('two simultaneous closures yield one winner and one 409', async () => {
    const { journey } = await makeJourney({ name: 'PIPE05' });

    const [a, b] = await Promise.allSettled([
      setFinalOutcome(journey.id, { finalOutcomeKey: FINAL_OUTCOMES.REJECTED, actedBy: ACTED_BY }),
      setFinalOutcome(journey.id, { finalOutcomeKey: FINAL_OUTCOMES.APPROVED, actedBy: ACTED_BY }),
    ]);

    const ok = [a, b].filter((r) => r.status === 'fulfilled');
    const bad = [a, b].filter((r) => r.status === 'rejected');
    assert.equal(ok.length, 1, `expected 1 winner, got ${ok.length}`);
    assert.equal(bad.length, 1, `expected 1 loser, got ${bad.length}`);
    assert.equal(bad[0].reason.statusCode, 409);
    assert.equal(bad[0].reason.message, "This candidate's record has already been closed.");

    const events = await prisma.rpa_pipeline_stage_events.findMany({
      where: { pipeline_id: BigInt(journey.id), event_type: 'outcome' },
    });
    assert.equal(events.length, 1, 'the losing closure must roll its event back');
  });
});

// â”€â”€ PIPE-09 / N1 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('PIPE-09 â€” all 8 closure outcomes', () => {
  test('every FINAL_OUTCOMES value closes a journey', async () => {
    const keys = Object.values(FINAL_OUTCOMES);
    assert.equal(keys.length, 8, `expected 8 final outcomes, found ${keys.length}: ${keys.join(', ')}`);

    for (const key of keys) {
      const { journey } = await makeJourney({ name: `PIPE09-${key}` });
      // setFinalOutcome returns the updated row itself, not { pipeline }.
      const row = await setFinalOutcome(journey.id, { finalOutcomeKey: key, actedBy: ACTED_BY });
      assert.equal(row.final_outcome, key, `${key} must close the journey`);
      assert.ok(row.closed_at, `${key} must stamp closed_at`);
    }
  });

  test('VACATING_OUTCOMES reopen an MRF that this candidate had filled', async () => {
    const { journey } = await makeJourney({ name: 'PIPE09-vacate', mrfId: mrfDoubleId });
    // Simulate the MRF having been closed by this candidate.
    await prisma.rpa_mrf.update({ where: { id: mrfDoubleId }, data: { filled_at: new Date() } });

    assert.ok(VACATING_OUTCOMES.includes(FINAL_OUTCOMES.BACKED_OUT), 'backed_out must be a vacating outcome');
    await setFinalOutcome(journey.id, { finalOutcomeKey: FINAL_OUTCOMES.BACKED_OUT, actedBy: ACTED_BY });

    const mrf = await prisma.rpa_mrf.findUnique({ where: { id: mrfDoubleId }, select: { filled_at: true } });
    assert.equal(mrf.filled_at, null, 'a vacating closure must reopen the MRF');
  });

  test('N1 â€” an invalid closure key is refused with 400', async () => {
    const { journey } = await makeJourney({ name: 'N1' });
    await assert.rejects(
      () => setFinalOutcome(journey.id, { finalOutcomeKey: 'totally_made_up', actedBy: ACTED_BY }),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /is not a valid closure outcome/);
        return true;
      }
    );
    const row = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: BigInt(journey.id) } });
    assert.equal(row.final_outcome, null, 'a refused closure must not write final_outcome');
  });
});

// â”€â”€ PIPE-10 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('PIPE-10 â€” JOINED freezes the vendor lock', () => {
  test('closing joined sets lockForNinetyDays to the frozen sentinel', async () => {
    const { cv, journey } = await makeJourney({ name: 'PIPE10', vendor: true });
    const before = await prisma.rpa_cv.findUnique({ where: { id: cv.id }, select: { lockForNinetyDays: true } });
    assert.equal(before.lockForNinetyDays, '2026-10-03', 'precondition: a live, non-frozen lock');

    await setFinalOutcome(journey.id, { finalOutcomeKey: FINAL_OUTCOMES.JOINED, actedBy: ACTED_BY });

    const after = await prisma.rpa_cv.findUnique({ where: { id: cv.id }, select: { lockForNinetyDays: true } });
    assert.equal(after.lockForNinetyDays, VENDOR_LOCK_FROZEN);
    assert.equal(after.lockForNinetyDays, '9999-12-31', 'the documented sentinel value');
  });

  test('a NON-joined closure leaves the lock ticking normally', async () => {
    const { cv, journey } = await makeJourney({ name: 'PIPE10b', vendor: true });
    await setFinalOutcome(journey.id, { finalOutcomeKey: FINAL_OUTCOMES.REJECTED, actedBy: ACTED_BY });
    const after = await prisma.rpa_cv.findUnique({ where: { id: cv.id }, select: { lockForNinetyDays: true } });
    assert.equal(after.lockForNinetyDays, '2026-10-03', 'only JOINED freezes; every other closure must not');
  });
});

// â”€â”€ PIPE-11 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('PIPE-11 â€” closure force-closes an open document link', () => {
  test('an active document request flips to closed when the journey closes', async () => {
    const { journey } = await makeJourney({ name: 'PIPE11' });
    const req = await prisma.rpa_document_requests.create({
      data: { pipeline_id: BigInt(journey.id), token_status: 'active', requested_by: ACTED_BY },
    });
    assert.equal(req.token_status, 'active');

    await setFinalOutcome(journey.id, { finalOutcomeKey: FINAL_OUTCOMES.REJECTED, actedBy: ACTED_BY });

    const after = await prisma.rpa_document_requests.findUnique({ where: { id: req.id }, select: { token_status: true } });
    assert.equal(after.token_status, 'closed');
  });
});

// â”€â”€ PIPE-12 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('PIPE-12 â€” concurrent-MRF journeys for one candidate', () => {
  test('the same candidate on two MRFs gets two independent journeys', async () => {
    const { cv, journey: first } = await makeJourney({ name: 'PIPE12', mrfId: mrfSingleId });

    const second = await createPipelineJourney({ cvId: cv.id, mrfId: mrfDoubleId, source: 'screening_shortlist' });
    createdJourneys.push(BigInt(second.id));

    assert.notEqual(String(first.id), String(second.id), 'two different MRFs must give two journeys');
    assert.equal(second.current_stage_key, STAGE_KEYS.ZEKO_HR, 'the second journey starts fresh');
  });

  test('re-shortlisting on the SAME MRF is idempotent', async () => {
    const { cv, journey } = await makeJourney({ name: 'PIPE12b', mrfId: mrfSingleId });
    const again = await createPipelineJourney({ cvId: cv.id, mrfId: mrfSingleId, source: 'screening_shortlist' });
    assert.equal(String(again.id), String(journey.id), 'the existing journey must be returned, not duplicated');

    const count = await prisma.rpa_candidate_pipeline.count({ where: { cv_id: cv.id, mrf_id: mrfSingleId } });
    assert.equal(count, 1, 'no duplicate row');
  });
});

// â”€â”€ PIPE-14 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('PIPE-14 â€” GET /api/pipeline filters', () => {
  test('includeClosed defaults to excluding closed journeys', async () => {
    const { journey } = await makeJourney({ name: 'PIPE14' });
    await setFinalOutcome(journey.id, { finalOutcomeKey: FINAL_OUTCOMES.REJECTED, actedBy: ACTED_BY });

    const idOf = (board) => board.columns.flatMap((c) => c.cards || []).map((c) => String(c.id));

    const defaultBoard = await listPipeline({});
    assert.ok(!idOf(defaultBoard).includes(String(journey.id)), 'a closed journey must not appear by default');

    const withClosed = await listPipeline({ includeClosed: true });
    assert.ok(idOf(withClosed).includes(String(journey.id)), 'includeClosed=true must surface it');
  });

  test('source filter narrows to vendor-sourced journeys only', async () => {
    const { journey: vendorJourney } = await makeJourney({ name: 'PIPE14-vendor', vendor: true });
    const { journey: plainJourney } = await makeJourney({ name: 'PIPE14-plain' });

    const board = await listPipeline({ source: 'vendor' });
    const ids = board.columns.flatMap((c) => c.cards || []).map((c) => String(c.id));
    assert.ok(ids.includes(String(vendorJourney.id)), 'vendor journey must be included');
    assert.ok(!ids.includes(String(plainJourney.id)), 'non-vendor journey must be filtered out');
  });
});

// â”€â”€ PIPE-15 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('PIPE-15 â€” advancing onto a since-deactivated stage', () => {
  test('a candidate on a stage that was deactivated under them cannot advance', async () => {
    const { journey } = await makeJourney({ name: 'PIPE15' });
    // Move to assessment, then deactivate assessment underneath the candidate.
    await setStageOutcome(journey.id, { outcomeKey: 'approved', actedBy: ACTED_BY });

    const restore = await prisma.rpa_pipeline_stages.findUnique({ where: { stage_key: 'assessment' } });
    try {
      await prisma.rpa_pipeline_stages.update({ where: { stage_key: 'assessment' }, data: { is_active: false } });

      await assert.rejects(
        () => advanceStage(journey.id, { actedBy: ACTED_BY }),
        (err) => {
          assert.equal(err.statusCode, 409);
          assert.match(err.message, /is no longer active/);
          return true;
        }
      );
    } finally {
      // GLOBAL CONFIG â€” always put it back, even if the assertion failed.
      await prisma.rpa_pipeline_stages.update({
        where: { stage_key: 'assessment' }, data: { is_active: restore.is_active },
      });
    }

    const check = await prisma.rpa_pipeline_stages.findUnique({ where: { stage_key: 'assessment' } });
    assert.equal(check.is_active, true, 'assessment must be re-activated after this test');
  });
});


// ---------------------------------------------------------------------------
// The 2026-08-26 closure work. Everything below covers behaviour that shipped
// with the graceful-exit change set and its follow-on; see
// docs/PHASE3-CLOSURE-AUDIT-2026-08-26.md and the two changelogs it links.
// ---------------------------------------------------------------------------

const hoursOut = (h) => new Date(Date.now() + h * 3600 * 1000);

const createdMrfs = [];

/**
 * A single-use requisition, for tests that assert on ITS fill state.
 *
 * The shared fixture MRFs cannot be used for that: PIPE-18 and PIPE-21 close
 * journeys as `joined` against them, which legitimately fills them, so a later
 * test asserting "filled_at is null" or "this can be closed by hand" fails on
 * the previous test's leftovers rather than on the behaviour under test. The
 * same reasoning the crossModuleE2E header gives for its per-test MRFs.
 */
async function makeThrowawayMrf(openings = 1) {
  const row = await prisma.rpa_mrf.create({
    data: {
      position_hiring_for: `Closure test ${openings}-opening ${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      number_of_positions: openings,
      submitter_email: 'pkmondal@aapnainfotech.com',
      date_of_request: new Date(),
      approval_status: 'approved',
      additional_information: FIXTURE_TAG,
    },
  });
  createdMrfs.push(row.id);
  return row.id;
}

/** Walks a journey to a target stage by approving repeatedly. */
async function walkTo(journeyId, targetStage) {
  for (let i = 0; i < 12; i++) {
    const row = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: BigInt(journeyId) } });
    if (row.current_stage_key === targetStage) return row;
    await setStageOutcome(journeyId, { outcomeKey: 'approved', actedBy: ACTED_BY });
  }
  throw new Error(`could not reach ${targetStage}`);
}

// -- PIPE-16 ----------------------------------------------------------------

describe('PIPE-16 - closure from a NON-Offer stage, and it cancels the booking', () => {
  test('a candidate who withdraws at Tech 2 can be closed, and their interview is cancelled', async () => {
    // No test covered closure away from the Offer stage before 2026-08-26.
    // That absence is exactly how audit section 2.1 survived: setFinalOutcome
    // always accepted any current_stage_key, but the drawer only offered the
    // action inside OfferActions, so five of the eight outcomes were
    // unreachable and a Tech 2 withdrawal could not be recorded at all.
    const { shortlist, journey } = await makeJourney({ name: 'PIPE16' });
    await walkTo(journey.id, STAGE_KEYS.TECH2);

    const booked = await scheduleInterviewRound(journey.id, {
      stageKey: STAGE_KEYS.TECH2,
      startAt: hoursOut(48),
      durationMinutes: 60,
      interviewerEmail: 'pkmondal@aapnainfotech.com',
      interviewerName: 'Phase3 Test Interviewer',
      actedBy: ACTED_BY,
    });

    await setFinalOutcome(journey.id, {
      finalOutcomeKey: FINAL_OUTCOMES.CANDIDATE_WITHDRAWN, actedBy: ACTED_BY,
    });

    const closed = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: BigInt(journey.id) } });
    assert.equal(closed.final_outcome, FINAL_OUTCOMES.CANDIDATE_WITHDRAWN, 'closure must work at any stage');
    assert.equal(closed.current_stage_key, STAGE_KEYS.TECH2, 'closing must not drag the candidate to Offer');

    // Section 2.2 / the section D commitment that was recorded as settled and
    // never built: a withdrawn candidate kept a live Teams booking and went on
    // receiving the 30-minute reminder.
    const sched = await prisma.rpa_interview_schedule.findUnique({ where: { id: BigInt(booked.id) } });
    assert.equal(sched.status, 'cancelled', 'a closed journey must not keep a live booking');
    assert.ok(sched.cancelled_at, 'cancelled_at is what the reminder sweep keys off');

    // Section 2.4: a withdrawal is not a rejection. Mapping it to 'rejected'
    // would enter the candidate into the Q11 six-month cooling-off, which is
    // the precise harm recruiters caused by hand while 2.1 was unfixed.
    const sl = await prisma.rpa_shortlisted_candidates.findUnique({
      where: { id: shortlist.id }, select: { pipeline_status: true, joined_at: true },
    });
    assert.equal(sl.pipeline_status, 'withdrawn');
    assert.notEqual(sl.pipeline_status, 'rejected', 'a withdrawal must not arm the cooling-off');
    assert.equal(sl.joined_at, null, 'someone who withdrew never joined');
  });
});

// -- PIPE-17 ----------------------------------------------------------------

describe('PIPE-17 - the closure sweep must not touch finished rounds', () => {
  test('only a not-yet-started booking is cancelled; completed and no_show are untouched', async () => {
    // The most important negative in the cancellation work. A round that
    // already happened is a historical fact, and "cancelling" it would rewrite
    // the record. Those rows only needed to stop being CHASED, which is the
    // job-guard half of the fix.
    const { journey } = await makeJourney({ name: 'PIPE17' });
    await walkTo(journey.id, STAGE_KEYS.TECH1);

    // One row per stage: rpa_interview_schedule carries a unique index on
    // (pipeline_id, stage_key), so three bookings for one candidate have to sit
    // on three different rounds. Which stage a row is on is irrelevant to what
    // is being tested - the closure sweep selects on status and start time, not
    // on the candidate's current stage.
    const mk = (stageKey, status, startAt) => prisma.rpa_interview_schedule.create({
      data: {
        pipeline_id: BigInt(journey.id),
        stage_key: stageKey,
        scheduled_start_at: startAt,
        scheduled_end_at: new Date(startAt.getTime() + 3600 * 1000),
        status,
        interviewer_email: 'pkmondal@aapnainfotech.com',
      },
    });
    const future = await mk(STAGE_KEYS.TECH1, 'scheduled', hoursOut(48));
    const done = await mk(STAGE_KEYS.TECH2, 'completed', hoursOut(-72));
    const noShow = await mk(STAGE_KEYS.TECH3, 'no_show', hoursOut(-96));

    await setFinalOutcome(journey.id, { finalOutcomeKey: FINAL_OUTCOMES.REJECTED, actedBy: ACTED_BY });

    const [f, d, n] = await Promise.all([
      prisma.rpa_interview_schedule.findUnique({ where: { id: future.id } }),
      prisma.rpa_interview_schedule.findUnique({ where: { id: done.id } }),
      prisma.rpa_interview_schedule.findUnique({ where: { id: noShow.id } }),
    ]);
    assert.equal(f.status, 'cancelled', 'the pending booking is cancelled');
    assert.equal(d.status, 'completed', 'a completed round is history and must not be rewritten');
    assert.equal(n.status, 'no_show', 'a no_show round is a verdict and must not be rewritten');
    assert.equal(d.cancelled_at, null);
    assert.equal(n.cancelled_at, null);
  });
});

// -- PIPE-18 ----------------------------------------------------------------

describe('PIPE-18 - closure writes BOTH legacy layers', () => {
  test('each outcome lands the right pipeline_status, and only joined stamps joined_at', async () => {
    // setStageOutcome always wrote both legacy layers; setFinalOutcome, written
    // later for the terminal case, wrote only rpa_cv.FinalStatus. So a hired
    // candidate went on reading pipeline_status = 'shortlisted' forever.
    //
    // This test is also the one that would have caught the CHECK-constraint
    // problem: the pure unit tests assert the mapping function and never touch
    // the database, so five of the seven values were being rejected silently
    // until 2026-08-26-shortlist-status-vocabulary.sql widened the constraint.
    const cases = [
      [FINAL_OUTCOMES.JOINED, 'hired', true],
      [FINAL_OUTCOMES.APPROVED, 'hired', false],
      [FINAL_OUTCOMES.REJECTED, 'rejected', false],
      [FINAL_OUTCOMES.ON_HOLD, 'on_hold', false],
      [FINAL_OUTCOMES.CANDIDATE_WITHDRAWN, 'withdrawn', false],
      [FINAL_OUTCOMES.BACKED_OUT, 'backed_out', false],
      [FINAL_OUTCOMES.DID_NOT_JOIN, 'did_not_join', false],
      [FINAL_OUTCOMES.JOINED_AND_LEFT, 'joined_and_left', false],
    ];

    for (const [outcome, expectedStatus, expectJoinedAt] of cases) {
      const { shortlist, journey } = await makeJourney({ name: `PIPE18-${outcome}` });
      await setFinalOutcome(journey.id, { finalOutcomeKey: outcome, actedBy: ACTED_BY });

      const sl = await prisma.rpa_shortlisted_candidates.findUnique({
        where: { id: shortlist.id }, select: { pipeline_status: true, joined_at: true },
      });
      assert.equal(sl.pipeline_status, expectedStatus, `${outcome} should map to ${expectedStatus}`);
      if (expectJoinedAt) {
        assert.ok(sl.joined_at, `${outcome} must stamp joined_at`);
        const pl = await prisma.rpa_candidate_pipeline.findUnique({
          where: { id: BigInt(journey.id) }, select: { closed_at: true },
        });
        assert.equal(
          sl.joined_at.getTime(), pl.closed_at.getTime(),
          'joined_at must be closed_at, not an independently-taken timestamp'
        );
      } else {
        assert.equal(sl.joined_at, null, `${outcome} must NOT stamp joined_at`);
      }
    }
  });
});

// -- N2 ---------------------------------------------------------------------

describe('N2 - closure survives a booking that is already cancelled', () => {
  test('a manually cancelled round does not make the closure fail', async () => {
    // cancelInterviewRound throws 400 on an already-cancelled row. The bulk
    // sweep inside setFinalOutcome tolerates that by design: for a sweep it is
    // a no-op, not a failure. Without the tolerance a recruiter who cancelled
    // by hand first could not close the record at all.
    const { journey } = await makeJourney({ name: 'N2' });
    await walkTo(journey.id, STAGE_KEYS.TECH1);

    const booked = await prisma.rpa_interview_schedule.create({
      data: {
        pipeline_id: BigInt(journey.id),
        stage_key: STAGE_KEYS.TECH1,
        scheduled_start_at: hoursOut(48),
        scheduled_end_at: hoursOut(49),
        status: 'cancelled',
        cancelled_at: new Date(),
        interviewer_email: 'pkmondal@aapnainfotech.com',
      },
    });

    await setFinalOutcome(journey.id, { finalOutcomeKey: FINAL_OUTCOMES.REJECTED, actedBy: ACTED_BY });

    const closed = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: BigInt(journey.id) } });
    assert.equal(closed.final_outcome, FINAL_OUTCOMES.REJECTED, 'the closure must still be recorded');
    const sched = await prisma.rpa_interview_schedule.findUnique({ where: { id: booked.id } });
    assert.equal(sched.status, 'cancelled', 'the already-cancelled row is left as it was');
  });
});

// -- PIPE-19 ----------------------------------------------------------------

describe('PIPE-19 - reopenJourney undoes the whole closure tail', () => {
  test('the flag, both legacy layers and the requisition seat all come back', async () => {
    // Not just "clear the flag": closure writes four other things and every one
    // is still true afterwards. Leaving them would re-create the 2.4 defect in
    // mirror image - a LIVE journey reading 'hired' with a joined_at for
    // someone who never joined.
    const mrfId = await makeThrowawayMrf(1);
    const { shortlist, journey } = await makeJourney({ name: 'PIPE19', mrfId });
    await setFinalOutcome(journey.id, { finalOutcomeKey: FINAL_OUTCOMES.JOINED, actedBy: ACTED_BY });

    const filled = await prisma.rpa_mrf.findUnique({ where: { id: mrfId }, select: { filled_at: true } });
    assert.ok(filled.filled_at, 'a joined closure on a 1-opening MRF fills it (section 2.7)');

    await reopenJourney(journey.id, { reason: 'closed by mistake - wrong candidate', actedBy: ACTED_BY });

    const pl = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: BigInt(journey.id) } });
    assert.equal(pl.final_outcome, null);
    assert.equal(pl.closed_at, null);

    const sl = await prisma.rpa_shortlisted_candidates.findUnique({
      where: { id: shortlist.id }, select: { pipeline_status: true, joined_at: true },
    });
    assert.notEqual(sl.pipeline_status, 'hired', 'a live journey must not read as hired');
    assert.equal(sl.joined_at, null, 'they did not join after all');

    const reopened = await prisma.rpa_mrf.findUnique({ where: { id: mrfId }, select: { filled_at: true } });
    assert.equal(reopened.filled_at, null, 'the seat is free again');

    // A reason is mandatory, and a second re-open has nothing to undo.
    await assert.rejects(() => reopenJourney(journey.id, { reason: '', actedBy: ACTED_BY }));
    await assert.rejects(() => reopenJourney(journey.id, { reason: 'again', actedBy: ACTED_BY }));
  });
});

// -- PIPE-20 ----------------------------------------------------------------

describe('PIPE-20 - a paused journey leaves the sweeps', () => {
  test('pause hides it from the reminder guard and resume brings it back', async () => {
    // is_paused existed in the schema, was read onto every card and exported to
    // CSV, and nothing anywhere wrote it. What makes the flag mean something is
    // that the four sweeps skip a paused journey; otherwise it is decorative.
    const { journey } = await makeJourney({ name: 'PIPE20' });
    await walkTo(journey.id, STAGE_KEYS.TECH1);

    const sched = await prisma.rpa_interview_schedule.create({
      data: {
        pipeline_id: BigInt(journey.id),
        stage_key: STAGE_KEYS.TECH1,
        scheduled_start_at: hoursOut(0.3),
        scheduled_end_at: hoursOut(1.3),
        status: 'scheduled',
        interviewer_email: 'pkmondal@aapnainfotech.com',
      },
    });
    // The exact guard the four sweeps carry.
    const seen = () => prisma.rpa_interview_schedule.count({
      where: { id: sched.id, status: 'scheduled', rpa_candidate_pipeline: { final_outcome: null, is_paused: false } },
    });

    assert.equal(await seen(), 1, 'an open, unpaused journey is in scope');
    await setJourneyPaused(journey.id, { paused: true, reason: 'role filled', actedBy: ACTED_BY });
    assert.equal(await seen(), 0, 'a paused journey is skipped');
    await setJourneyPaused(journey.id, { paused: false, actedBy: ACTED_BY });
    assert.equal(await seen(), 1, 'resuming brings it back');

    // Pausing twice is refused, and a closed journey cannot be paused at all.
    await setJourneyPaused(journey.id, { paused: true, actedBy: ACTED_BY });
    await assert.rejects(() => setJourneyPaused(journey.id, { paused: true, actedBy: ACTED_BY }));
    await setJourneyPaused(journey.id, { paused: false, actedBy: ACTED_BY });
    await setFinalOutcome(journey.id, { finalOutcomeKey: FINAL_OUTCOMES.REJECTED, actedBy: ACTED_BY });
    await assert.rejects(() => setJourneyPaused(journey.id, { paused: true, actedBy: ACTED_BY }));
  });
});

// -- PIPE-21 ----------------------------------------------------------------

describe('PIPE-21 - countFilledSeats counts both ways, and dedupes', () => {
  test('an offer and a joined closure on ONE journey hold ONE seat', async () => {
    // The load-bearing detail of the 2.7 fix. The normal path carries BOTH an
    // accepted offer AND a joined closure on the same journey, so counting the
    // two sources separately would fill a 2-opening requisition on one hire.
    const mrfId = await makeThrowawayMrf(2);
    const before = await countFilledSeats(mrfId);

    const a = await makeJourney({ name: 'PIPE21a', mrfId });
    await prisma.rpa_offers.create({ data: { pipeline_id: BigInt(a.journey.id), candidate_decision: 'accepted' } });
    assert.equal(await countFilledSeats(mrfId), before + 1, 'an accepted offer holds a seat');

    // Same journey, now also closed as joined - it must still be ONE seat.
    await setFinalOutcome(a.journey.id, { finalOutcomeKey: FINAL_OUTCOMES.JOINED, actedBy: ACTED_BY });
    assert.equal(await countFilledSeats(mrfId), before + 1, 'offer + joined on one journey is one seat, not two');

    // A joined closure with NO offer row at all - the whole point of 2.7.
    const b = await makeJourney({ name: 'PIPE21b', mrfId });
    await setFinalOutcome(b.journey.id, { finalOutcomeKey: FINAL_OUTCOMES.JOINED, actedBy: ACTED_BY });
    assert.equal(await countFilledSeats(mrfId), before + 2, 'a joined closure with no offer row holds a seat');

    // A vacating outcome frees the seat again.
    const c = await makeJourney({ name: 'PIPE21c', mrfId });
    await prisma.rpa_offers.create({ data: { pipeline_id: BigInt(c.journey.id), candidate_decision: 'accepted' } });
    await setFinalOutcome(c.journey.id, { finalOutcomeKey: FINAL_OUTCOMES.JOINED_AND_LEFT, actedBy: ACTED_BY });
    assert.equal(await countFilledSeats(mrfId), before + 2, 'joined_and_left frees the seat');
  });
});

// -- MRF-01 -----------------------------------------------------------------

describe('MRF-01 - manual requisition closure', () => {
  test('closing by hand takes the role out of JD filtering without touching approval_status', async () => {
    const { getApprovedRoles } = await import('../../services/screening.service.js');
    // Its own requisition: PIPE-21 fills the shared 2-opening fixture MRF, and
    // closeMrfManually correctly refuses a requisition that is already filled.
    const mrfId = await makeThrowawayMrf(2);
    const beforeStatus = await prisma.rpa_mrf.findUnique({
      where: { id: mrfId }, select: { approval_status: true, filled_at: true },
    });

    await closeMrfManually(mrfId, { reason: 'budget_withdrawn', actedBy: ACTED_BY });

    const closed = await prisma.rpa_mrf.findUnique({
      where: { id: mrfId },
      select: { closed_at: true, closure_reason: true, filled_at: true, approval_status: true },
    });
    assert.ok(closed.closed_at);
    assert.equal(closed.closure_reason, 'budget_withdrawn');
    // The invariant the whole two-column design exists to protect.
    assert.equal(closed.filled_at, beforeStatus.filled_at, 'a manual close must not write filled_at');
    assert.equal(closed.approval_status, beforeStatus.approval_status, 'approval_status must never be overwritten');

    const roles = await getApprovedRoles();
    assert.ok(!roles.some((r) => Number(r.id) === Number(mrfId)), 'a closed role leaves the JD dropdown');

    // Refusals: closing twice, and claiming the automatic-only reason.
    await assert.rejects(() => closeMrfManually(mrfId, { reason: 'role_withdrawn', actedBy: ACTED_BY }));
    await reopenMrfManually(mrfId, { actedBy: ACTED_BY });
    await assert.rejects(
      () => closeMrfManually(mrfId, { reason: 'all_openings_filled', actedBy: ACTED_BY }),
      'all_openings_filled belongs to the automatic path only'
    );
    await assert.rejects(
      () => closeMrfManually(mrfId, { reason: 'other', actedBy: ACTED_BY }),
      'other requires a note'
    );

    const back = await prisma.rpa_mrf.findUnique({ where: { id: mrfId }, select: { closed_at: true, closure_reason: true } });
    assert.equal(back.closed_at, null);
    assert.equal(back.closure_reason, null);
    const rolesAgain = await getApprovedRoles();
    assert.ok(rolesAgain.some((r) => Number(r.id) === Number(mrfId)), 're-opening puts it back');
  });
});
