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
} from '../../services/pipeline.service.js';
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
    await prisma.rpa_pipeline_stage_events.deleteMany({ where: { pipeline_id: { in: createdJourneys } } });
    await prisma.rpa_notifications.deleteMany({ where: { pipeline_id: { in: createdJourneys } } });
    await prisma.rpa_candidate_pipeline.deleteMany({ where: { id: { in: createdJourneys } } });
  }
  if (createdCvs.length) {
    await prisma.rpa_shortlisted_candidates.deleteMany({ where: { cv_id: { in: createdCvs } } });
    await prisma.rpa_cv.deleteMany({ where: { id: { in: createdCvs } } });
  }
  // Leave no MRF closed by this file.
  await prisma.rpa_mrf.updateMany({ where: { id: { in: [mrfSingleId, mrfDoubleId] } }, data: { filled_at: null } });
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

