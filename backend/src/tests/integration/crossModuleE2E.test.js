/**
 * Block F — cross-module end-to-end journeys.
 * Run: node --test src/tests/integration/crossModuleE2E.test.js
 *
 * Covers E2E-01, E2E-02, E2E-03, E2E-04, E2E-05.
 *
 * These retrace a whole candidate journey rather than one endpoint, which is
 * the point: each module already passed its own block, so a failure here is
 * specifically an INTEGRATION failure between modules.
 *
 * Each E2E uses its own single-use MRF — countAcceptedHires() counts every
 * accepted offer against a requisition, so sharing one would make the closure
 * arithmetic depend on test order.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../../config/database.js';
import { disconnectRedis } from '../../config/redis.js';
import {
  createPipelineJourney,
  setStageOutcome,
  setFinalOutcome,
} from '../../services/pipeline.service.js';
import { requestDocuments, getDocumentStatus } from '../../services/documentCollection.service.js';
import { recordOfferShared, recordCandidateDecision } from '../../services/offer.service.js';
import { scheduleInterviewRound } from '../../services/interviewSchedule.service.js';
import { FINAL_OUTCOMES } from '../../config/pipelineStages.js';
import { VENDOR_LOCK_FROZEN } from '../../utils/vendorLock.js';
import { FIXTURE_TAG, CANDIDATE_EMAIL, VENDOR_EMAIL } from '../helpers/fixture.js';

const ACTED_BY = 2;
const createdJourneys = [];
const createdCvs = [];
const createdMrfs = [];

const todayPlus = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

async function makeMrf(openings) {
  const row = await prisma.rpa_mrf.create({
    data: {
      position_hiring_for: `E2E ${openings}-opening ${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      number_of_positions: openings,
      submitter_email: 'pkmondal@aapnainfotech.com',
      date_of_request: new Date(),
      additional_information: FIXTURE_TAG,
      approval_status: 'approved',
    },
  });
  createdMrfs.push(row.id);
  return row.id;
}

async function makeJourney({ name, mrfId, vendor = false }) {
  const cv = await prisma.rpa_cv.create({
    data: {
      Name: `${name} ${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      EmailID: CANDIDATE_EMAIL, PositionApplied: 'RPA Developer',
      statusActive: 'Active', MetaData: FIXTURE_TAG,
      createdAt: new Date(), modifiedAt: new Date(),
      ...(vendor
        ? { VendorEmail: VENDOR_EMAIL, vendorName: 'Phase3 Test Vendor', lockForNinetyDays: todayPlus(45) }
        : {}),
    },
  });
  createdCvs.push(cv.id);
  const shortlist = await prisma.rpa_shortlisted_candidates.create({
    data: {
      cv_id: cv.id, mrf_id: mrfId, candidate_name: cv.Name,
      candidate_email: CANDIDATE_EMAIL, position_applied: 'RPA Developer',
      shortlisted_by: 'phase3-testpass', recruiter_notes: FIXTURE_TAG,
    },
  });
  const journey = await createPipelineJourney({
    cvId: cv.id, mrfId, shortlistId: shortlist.id,
    source: vendor ? 'vendor_upload' : 'screening_shortlist',
  });
  createdJourneys.push(BigInt(journey.id));
  return { cv, shortlist, journey };
}

/** Approves repeatedly until the journey sits on targetStage. */
async function walkTo(journeyId, targetStage) {
  for (let i = 0; i < 12; i++) {
    const row = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: BigInt(journeyId) } });
    if (row.current_stage_key === targetStage) return row;
    await setStageOutcome(journeyId, { outcomeKey: 'approved', actedBy: ACTED_BY });
  }
  throw new Error(`could not reach ${targetStage}`);
}

before(async () => { /* each test makes its own MRF */ });

after(async () => {
  if (createdJourneys.length) {
    const reqs = await prisma.rpa_document_requests.findMany({
      where: { pipeline_id: { in: createdJourneys } }, select: { id: true },
    });
    if (reqs.length) {
      await prisma.rpa_candidate_documents.deleteMany({ where: { request_id: { in: reqs.map((r) => r.id) } } });
    }
    await prisma.rpa_document_requests.deleteMany({ where: { pipeline_id: { in: createdJourneys } } });
    const cards = await prisma.rpa_interview_scorecard.findMany({
      where: { pipeline_id: { in: createdJourneys } }, select: { id: true },
    });
    if (cards.length) {
      await prisma.rpa_interview_scorecard_skill.deleteMany({ where: { scorecard_id: { in: cards.map((c) => c.id) } } });
    }
    await prisma.rpa_interview_scorecard.deleteMany({ where: { pipeline_id: { in: createdJourneys } } });
    await prisma.rpa_interview_schedule.deleteMany({ where: { pipeline_id: { in: createdJourneys } } });
    await prisma.rpa_offers.deleteMany({ where: { pipeline_id: { in: createdJourneys } } });
    await prisma.rpa_pipeline_stage_events.deleteMany({ where: { pipeline_id: { in: createdJourneys } } });
    await prisma.rpa_notifications.deleteMany({ where: { pipeline_id: { in: createdJourneys } } });
    await prisma.rpa_candidate_pipeline.deleteMany({ where: { id: { in: createdJourneys } } });
  }
  if (createdCvs.length) {
    await prisma.rpa_email_messages.deleteMany({ where: { candidate_id: { in: createdCvs } } });
    await prisma.rpa_shortlisted_candidates.deleteMany({ where: { cv_id: { in: createdCvs } } });
    await prisma.rpa_cv.deleteMany({ where: { id: { in: createdCvs } } });
  }
  if (createdMrfs.length) {
    await prisma.rpa_mrf.deleteMany({ where: { id: { in: createdMrfs } } });
  }
  await prisma.$disconnect();
  try { await disconnectRedis(); } catch { /* already closed */ }
});

// ── E2E-01 ────────────────────────────────────────────────────────────

describe('E2E-01 — vendor-sourced journey all the way to JOINED', () => {
  test('every module behaves correctly across one full journey', async () => {
    const mrfId = await makeMrf(1);
    const { cv, shortlist, journey } = await makeJourney({ name: 'E2E01', mrfId, vendor: true });

    // 1) Vendor attribution derived at creation.
    assert.equal(journey.source, 'vendor', 'the journey must be vendor-attributed from the live lock');

    // 2) Walk the rounds to documents.
    await walkTo(journey.id, 'documents');

    // 3) Documents: requested, and the VENDOR HEARS NOTHING (DOC-12 / VEND-02).
    const vendorMsgsBefore = await prisma.rpa_email_messages.count({
      where: { candidate_id: cv.id, subject: { startsWith: 'Candidate update' } },
    });
    await requestDocuments(journey.id, { actedBy: ACTED_BY });
    const { documents } = await getDocumentStatus(journey.id).then((s) => ({ documents: s.request.rpa_candidate_documents }));
    assert.ok(documents.length >= 1, 'a document request seeds checklist rows');
    const vendorMsgsAfter = await prisma.rpa_email_messages.count({
      where: { candidate_id: cv.id, subject: { startsWith: 'Candidate update' } },
    });
    assert.equal(vendorMsgsAfter, vendorMsgsBefore, 'PRIVACY: no vendor mail may leave the documents stage');

    // 4) Offer stage, shared and accepted -> MRF closes.
    await walkTo(journey.id, 'offer');
    await recordOfferShared(journey.id, { joiningDate: todayPlus(30), remarks: 'E2E', actedBy: ACTED_BY });
    await recordCandidateDecision(journey.id, { decision: 'accepted', actedBy: ACTED_BY });

    const mrfClosed = await prisma.rpa_mrf.findUnique({ where: { id: mrfId }, select: { filled_at: true } });
    assert.ok(mrfClosed.filled_at, 'an acceptance on a 1-opening MRF must close it');

    // 5) Close as JOINED -> vendor lock freezes, document link force-closes.
    await setFinalOutcome(journey.id, { finalOutcomeKey: FINAL_OUTCOMES.JOINED, actedBy: ACTED_BY });

    const cvAfter = await prisma.rpa_cv.findUnique({ where: { id: cv.id }, select: { lockForNinetyDays: true, FinalStatus: true } });
    assert.equal(cvAfter.lockForNinetyDays, VENDOR_LOCK_FROZEN, 'JOINED freezes the vendor lock');
    assert.match(cvAfter.FinalStatus, /Joined/i, 'legacy FinalStatus write-back');

    const req = await prisma.rpa_document_requests.findUnique({ where: { pipeline_id: BigInt(journey.id) } });
    assert.equal(req.token_status, 'closed', 'closure force-closes the open upload link');

    const closed = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: BigInt(journey.id) } });
    assert.equal(closed.final_outcome, 'joined');
    assert.ok(closed.closed_at);

    // 6) Closure writes BOTH legacy layers, not just rpa_cv (audit §2.4).
    //
    // setStageOutcome always wrote both; setFinalOutcome — written later, for
    // the terminal case — wrote only rpa_cv.FinalStatus. So a candidate we
    // actually hired went on reading `pipeline_status = 'shortlisted'` forever,
    // and that column feeds the dashboard shortlist tile, the recruiter
    // leaderboard and the screening badges.
    const slAfter = await prisma.rpa_shortlisted_candidates.findUnique({
      where: { id: shortlist.id }, select: { pipeline_status: true, joined_at: true },
    });
    assert.equal(slAfter.pipeline_status, 'hired', 'closure must move the shortlist row off "shortlisted"');
    // joined_at was declared, read by the dashboard and required by the
    // development plan "for reporting continuity" — and written by nothing.
    // The hire COUNT survived on the offer_accepted_at fallback, so nothing
    // looked broken while time-to-hire silently measured to offer acceptance
    // instead of to joining.
    assert.ok(slAfter.joined_at, 'JOINED must stamp joined_at — the column time-to-hire measures to');
    // Stamped FROM closed_at, not a second new Date(), so the two reconcile
    // exactly rather than drifting by however long the best-effort tail took.
    assert.equal(
      slAfter.joined_at.getTime(), closed.closed_at.getTime(),
      'joined_at must be closed_at, not an independently-taken timestamp'
    );
  });
});

// ── E2E-06 ────────────────────────────────────────────────────────────

describe('E2E-06 — a candidate who withdraws mid-flow winds down completely', () => {
  test('closing from a non-Offer stage cancels the pending interview and moves both legacy layers', async () => {
    const mrfId = await makeMrf(1);
    const { cv, shortlist, journey } = await makeJourney({ name: 'E2E06', mrfId });

    // Park the journey on a real interview round — deliberately NOT 'offer'.
    // No test covered closure from a non-Offer stage before 2026-08-26, which
    // is how §2.1 survived: setFinalOutcome has always accepted any
    // current_stage_key, but the drawer only ever offered the closure action
    // inside OfferActions, so a candidate who withdrew at Tech 2 could not be
    // closed at all.
    await walkTo(journey.id, 'tech2');

    const booked = await scheduleInterviewRound(journey.id, {
      stageKey: 'tech2',
      startAt: new Date(Date.now() + 48 * 3600 * 1000),
      durationMinutes: 60,
      interviewerEmail: 'pkmondal@aapnainfotech.com',
      interviewerName: 'Phase3 Test Interviewer',
      actedBy: ACTED_BY,
    });

    await setFinalOutcome(journey.id, {
      finalOutcomeKey: FINAL_OUTCOMES.CANDIDATE_WITHDRAWN, actedBy: ACTED_BY,
    });

    const closed = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: BigInt(journey.id) } });
    assert.equal(closed.final_outcome, 'candidate_withdrawn', 'closure must be reachable from any stage');
    assert.equal(closed.current_stage_key, 'tech2', 'closing does not drag the candidate to the offer stage');
    assert.ok(closed.closed_at);

    // §2.2 / §D — the booking does not outlive the journey. This is the
    // commitment recorded in 04-QUESTIONS.md §D ("withdrawing a candidate
    // auto-cancels their pending calendar invites and scheduled reminders")
    // that was agreed and then never built: a withdrawn candidate kept a live
    // Teams booking and still received the 30-minute reminder mail.
    const sched = await prisma.rpa_interview_schedule.findUnique({ where: { id: BigInt(booked.id) } });
    assert.equal(sched.status, 'cancelled', 'a closed journey must not keep a live interview booking');
    assert.ok(sched.cancelled_at, 'the cancellation is stamped, so the reminder sweep skips it');

    // §2.4 — a withdrawal is NOT a rejection, on either cooling-off surface.
    const sl = await prisma.rpa_shortlisted_candidates.findUnique({
      where: { id: shortlist.id }, select: { pipeline_status: true, joined_at: true },
    });
    assert.equal(sl.pipeline_status, 'withdrawn', 'a withdrawal reads as withdrawn, not shortlisted');
    assert.notEqual(
      sl.pipeline_status, 'rejected',
      'mapping a withdrawal to "rejected" would enter it into the screening cooldown list'
    );
    assert.equal(sl.joined_at, null, 'someone who withdrew never joined');

    // The other cooling-off surface: findRecentRejection() gates re-application
    // on current_stage_status, which a closure does not touch. Asserted end to
    // end because §2.1's real harm was recruiters reaching for Reject to close
    // a withdrawal, which DOES arm this gate for six months.
    const otherMrf = await makeMrf(1);
    const reapplied = await createPipelineJourney({
      cvId: cv.id, mrfId: otherMrf, source: 'screening_shortlist',
    });
    createdJourneys.push(BigInt(reapplied.id));
    assert.ok(reapplied.id, 'a voluntary withdrawal must not bar re-application');
  });
});

// ── E2E-02 ────────────────────────────────────────────────────────────

describe('E2E-02 — non-vendor journey rejected mid-flow', () => {
  test('rejection writes back, sends no vendor mail, and arms the cooling-off gate', async () => {
    const mrfId = await makeMrf(1);
    const { cv, shortlist, journey } = await makeJourney({ name: 'E2E02', mrfId });
    assert.notEqual(journey.source, 'vendor');

    await walkTo(journey.id, 'tech2');
    const reason = await prisma.rpa_outcome_reasons.findFirst({ where: { is_other: true, is_active: true } });
    await setStageOutcome(journey.id, {
      outcomeKey: 'rejected', reasonId: reason.id, otherText: 'E2E-02 rejection', actedBy: ACTED_BY,
    });

    const cvAfter = await prisma.rpa_cv.findUnique({ where: { id: cv.id }, select: { FinalStatus: true } });
    assert.match(cvAfter.FinalStatus, /Rejected/i);

    const sl = await prisma.rpa_shortlisted_candidates.findUnique({
      where: { id: shortlist.id }, select: { pipeline_status: true },
    });
    assert.equal(sl.pipeline_status, 'rejected');

    // No vendor mail on a non-vendor journey.
    const vendorMsgs = await prisma.rpa_email_messages.count({
      where: { candidate_id: cv.id, subject: { startsWith: 'Candidate update' } },
    });
    assert.equal(vendorMsgs, 0, 'a non-vendor journey must never produce vendor mail');

    // The 6-month gate is now armed for this candidate.
    const otherMrf = await makeMrf(1);
    await assert.rejects(
      () => createPipelineJourney({ cvId: cv.id, mrfId: otherMrf, source: 'screening_shortlist' }),
      (err) => {
        assert.equal(err.statusCode, 409);
        assert.match(err.message, /cooling-off period/);
        return true;
      }
    );
  });
});

// ── E2E-03 ────────────────────────────────────────────────────────────

describe('E2E-03 — offer accepted then amended to rejected', () => {
  test('the MRF reopens and the lock does NOT freeze without a joined closure', async () => {
    const mrfId = await makeMrf(1);
    const { cv, journey } = await makeJourney({ name: 'E2E03', mrfId, vendor: true });

    await walkTo(journey.id, 'offer');
    await recordOfferShared(journey.id, { joiningDate: todayPlus(30), actedBy: ACTED_BY });
    await recordCandidateDecision(journey.id, { decision: 'accepted', actedBy: ACTED_BY });

    let mrf = await prisma.rpa_mrf.findUnique({ where: { id: mrfId }, select: { filled_at: true } });
    assert.ok(mrf.filled_at, 'precondition: the acceptance closed the requisition');

    await recordCandidateDecision(journey.id, { decision: 'rejected', amend: true, actedBy: ACTED_BY });

    mrf = await prisma.rpa_mrf.findUnique({ where: { id: mrfId }, select: { filled_at: true } });
    assert.equal(mrf.filled_at, null, 'amending away from accepted reopens the requisition');

    // JOINED never happened, so the lock must still be a real date, not the sentinel.
    const cvAfter = await prisma.rpa_cv.findUnique({ where: { id: cv.id }, select: { lockForNinetyDays: true } });
    assert.notEqual(cvAfter.lockForNinetyDays, VENDOR_LOCK_FROZEN, 'the lock must not freeze without a JOINED closure');
  });
});

// ── E2E-04 ────────────────────────────────────────────────────────────

describe('E2E-04 — two candidates racing the last opening', () => {
  test('both acceptances survive and the requisition closes exactly once', async () => {
    const mrfId = await makeMrf(1);
    const a = await makeJourney({ name: 'E2E04a', mrfId });
    const b = await makeJourney({ name: 'E2E04b', mrfId });

    for (const j of [a, b]) {
      await walkTo(j.journey.id, 'offer');
      await recordOfferShared(j.journey.id, { joiningDate: todayPlus(30), actedBy: ACTED_BY });
    }

    const [ra, rb] = await Promise.allSettled([
      recordCandidateDecision(a.journey.id, { decision: 'accepted', actedBy: ACTED_BY }),
      recordCandidateDecision(b.journey.id, { decision: 'accepted', actedBy: ACTED_BY }),
    ]);
    assert.equal(ra.status, 'fulfilled', 'neither acceptance may be lost');
    assert.equal(rb.status, 'fulfilled');

    const offers = await prisma.rpa_offers.findMany({
      where: { pipeline_id: { in: [BigInt(a.journey.id), BigInt(b.journey.id)] } },
      select: { candidate_decision: true },
    });
    assert.equal(offers.filter((o) => o.candidate_decision === 'accepted').length, 2);

    const mrf = await prisma.rpa_mrf.findUnique({ where: { id: mrfId }, select: { filled_at: true } });
    assert.ok(mrf.filled_at, 'the requisition closes');

    // One MRF_CLOSED notification for one closing event.
    const notes = await prisma.rpa_notifications.count({
      where: { type: 'MRF_CLOSED', meta: { path: ['mrf_id'], equals: Number(mrfId) } },
    });
    assert.ok(notes <= 1, `MRF_CLOSED must not double-fire (found ${notes})`);
  });
});

// ── E2E-05 ────────────────────────────────────────────────────────────

describe('E2E-05 — the manual Client round does not break the chain around it', () => {
  test('the client round is marked, not booked, yet documents still work afterwards', async () => {
    const mrfId = await makeMrf(1);
    const { cv, journey } = await makeJourney({ name: 'E2E05', mrfId });

    await walkTo(journey.id, 'client');
    const before = await prisma.rpa_email_messages.count({ where: { candidate_id: cv.id } });

    // 2026-08-25: the round is arranged offline, so the ATS refuses to book it
    // rather than recording a silent booking as it used to.
    await assert.rejects(
      () => scheduleInterviewRound(journey.id, {
        stageKey: 'client', startAt: new Date(Date.now() + 48 * 3600 * 1000),
        interviewerEmail: CANDIDATE_EMAIL, actedBy: ACTED_BY,
      }),
      (err) => {
        assert.equal(err.statusCode, 400);
        return true;
      }
    );

    const after = await prisma.rpa_email_messages.count({ where: { candidate_id: cv.id } });
    assert.equal(after, before, 'nothing is sent for the client round');

    // HR records the outcome manually; the chain resumes.
    await setStageOutcome(journey.id, { outcomeKey: 'approved', actedBy: ACTED_BY });
    const row = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: BigInt(journey.id) } });
    assert.equal(row.current_stage_key, 'documents', 'approving the client round advances into documents');

    // And M4 behaves exactly as after any other round.
    const status = await requestDocuments(journey.id, { actedBy: ACTED_BY });
    assert.ok(status.request?.token, 'documents work normally after a manual round');
    assert.equal(status.request.token_status, 'active');
  });
});
