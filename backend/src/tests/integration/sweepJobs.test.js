/**
 * The three scheduled sweeps — DOC-11, OFFER-14, OFFER-15.
 * Run: node --test src/tests/integration/sweepJobs.test.js
 *
 * These were left as "not attempted" in the first pass because they are cron
 * jobs. They do not need cron: all three are pure DB polling, so BACKDATING the
 * timestamps they select on puts a row into the state the sweep is looking for,
 * and the exported run*() functions can then be called directly. That is what
 * this file does — the real job function runs, against real rows, with nothing
 * stubbed.
 *
 * What each case is really asking:
 *   DOC-11    — does the sweep pick the RIGHT requests? (the selection query is
 *               the whole feature; sending mail is the easy part)
 *   OFFER-14  — does the approval nudge fire once per day, not once per run?
 *   OFFER-15  — does a joined candidate auto-close after the retention window,
 *               and does a recruiter's own closure still win?
 *
 * ⚠️ THESE TESTS SEND REAL EMAIL. Every send is redirected to the staging test
 * inbox (EMAIL_STAGING_RECIPIENTS), same as every other integration file here —
 * expect a handful of "document reminder" and "offer approval" mails per run.
 *
 * Same shared-staging safety rules as the rest: fixture-tagged rows only, torn
 * down by explicit id, never a time window.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../../config/database.js';
import config from '../../config/index.js';
import { disconnectRedis } from '../../config/redis.js';
import { createPipelineJourney } from '../../services/pipeline.service.js';
import { requestDocuments } from '../../services/documentCollection.service.js';
import { recordOfferShared, recordCandidateDecision, requestApproval } from '../../services/offer.service.js';
import { runDocumentReminders } from '../../jobs/documentReminder.js';
import { runApprovalNudges, runPostJoiningAutoClose } from '../../jobs/offerSweep.js';
import { FINAL_OUTCOMES } from '../../config/pipelineStages.js';
import { FIXTURE_TAG, CANDIDATE_EMAIL } from '../helpers/fixture.js';

const ACTED_BY = 2;
const createdJourneys = [];
const createdCvs = [];
const createdMrfs = [];

const daysAgo = (n) => new Date(Date.now() - n * 86400000);

async function makeMrf() {
  const row = await prisma.rpa_mrf.create({
    data: {
      position_hiring_for: `Phase3 sweep ${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      number_of_positions: 1,
      submitter_email: 'pkmondal@aapnainfotech.com',
      date_of_request: new Date(),
      additional_information: FIXTURE_TAG,
      approval_status: 'approved',
    },
  });
  createdMrfs.push(row.id);
  return row.id;
}

async function makeJourney({ name, mrfId }) {
  const id = mrfId ?? (await makeMrf());
  const cv = await prisma.rpa_cv.create({
    data: {
      Name: `${name} ${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      EmailID: CANDIDATE_EMAIL, PositionApplied: 'RPA Developer',
      statusActive: 'Active', MetaData: FIXTURE_TAG,
      createdAt: new Date(), modifiedAt: new Date(),
    },
  });
  createdCvs.push(cv.id);
  const shortlist = await prisma.rpa_shortlisted_candidates.create({
    data: {
      cv_id: cv.id, mrf_id: id, candidate_name: cv.Name,
      candidate_email: CANDIDATE_EMAIL, position_applied: 'RPA Developer',
      shortlisted_by: 'phase3-testpass', recruiter_notes: FIXTURE_TAG,
    },
  });
  const journey = await createPipelineJourney({
    cvId: cv.id, mrfId: id, shortlistId: shortlist.id, source: 'screening_shortlist',
  });
  createdJourneys.push(BigInt(journey.id));
  return { cv, shortlist, journey };
}

/** Walks a journey to a stage by writing the stage key directly. */
async function putOnStage(journeyId, stageKey) {
  await prisma.rpa_candidate_pipeline.update({
    where: { id: BigInt(journeyId) },
    data: { current_stage_key: stageKey, current_stage_status: 'in_progress' },
  });
}

after(async () => {
  if (createdJourneys.length) {
    const reqs = await prisma.rpa_document_requests.findMany({
      where: { pipeline_id: { in: createdJourneys } }, select: { id: true },
    });
    if (reqs.length) {
      await prisma.rpa_candidate_documents.deleteMany({ where: { request_id: { in: reqs.map((r) => r.id) } } });
    }
    await prisma.rpa_document_requests.deleteMany({ where: { pipeline_id: { in: createdJourneys } } });
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

// ══════════════════════ DOC-11 — reminder sweep selection ══════════════════════

/**
 * The plan asks for "four request states aged across days". The point is not
 * that mail goes out — DOC-10 already proved the send path — but that the
 * SELECTION QUERY discriminates correctly. A sweep that reminds everybody, or
 * nobody, would still pass a "did it send" assertion.
 *
 * Each case below is asserted by whether its own request id appears in the
 * sweep's due set, so other rows on shared staging cannot affect the result.
 */
describe('DOC-11 — the reminder sweep selects the right requests', () => {
  const { afterDays, maxCount } = config.document.reminder;

  /** Did the sweep bump THIS request's counter? Reads the row, not the return value. */
  async function reminderCountFor(journeyId) {
    const row = await prisma.rpa_document_requests.findUnique({
      where: { pipeline_id: BigInt(journeyId) },
      select: { reminder_count: true, last_reminded_at: true },
    });
    return row;
  }

  test('a request older than the threshold IS reminded', async () => {
    const { journey } = await makeJourney({ name: 'DOC11a' });
    await putOnStage(journey.id, 'documents');
    await requestDocuments(journey.id, { actedBy: ACTED_BY });

    // Age it past the first-reminder cutoff. Never reminded, so the sweep
    // measures from requested_at.
    await prisma.rpa_document_requests.update({
      where: { pipeline_id: BigInt(journey.id) },
      data: { requested_at: daysAgo(afterDays + 1), last_reminded_at: null, reminder_count: 0 },
    });

    await runDocumentReminders();

    const after1 = await reminderCountFor(journey.id);
    assert.equal(after1.reminder_count, 1, 'an aged, unreminded request must be picked up');
    assert.ok(after1.last_reminded_at, 'last_reminded_at must be stamped');
  });

  test('a request NEWER than the threshold is left alone', async () => {
    const { journey } = await makeJourney({ name: 'DOC11b' });
    await putOnStage(journey.id, 'documents');
    await requestDocuments(journey.id, { actedBy: ACTED_BY });

    // Requested just now — inside the quiet window.
    await prisma.rpa_document_requests.update({
      where: { pipeline_id: BigInt(journey.id) },
      data: { requested_at: new Date(), last_reminded_at: null, reminder_count: 0 },
    });

    await runDocumentReminders();

    const row = await reminderCountFor(journey.id);
    assert.equal(row.reminder_count, 0, 'a fresh request must NOT be chased yet');
    assert.equal(row.last_reminded_at, null);
  });

  test('a request that has exhausted its reminder budget is left alone', async () => {
    const { journey } = await makeJourney({ name: 'DOC11c' });
    await putOnStage(journey.id, 'documents');
    await requestDocuments(journey.id, { actedBy: ACTED_BY });

    // Aged, but already at maxCount — the sweep must give up and leave it to a
    // human rather than chasing forever.
    await prisma.rpa_document_requests.update({
      where: { pipeline_id: BigInt(journey.id) },
      data: { requested_at: daysAgo(30), last_reminded_at: daysAgo(5), reminder_count: maxCount },
    });

    await runDocumentReminders();

    const row = await reminderCountFor(journey.id);
    assert.equal(row.reminder_count, maxCount, `must stop at DOCUMENT_REMINDER_MAX_COUNT (${maxCount})`);
  });

  test('a request whose documents are ALL verified is left alone', async () => {
    const { journey } = await makeJourney({ name: 'DOC11d' });
    await putOnStage(journey.id, 'documents');
    const { request } = await requestDocuments(journey.id, { actedBy: ACTED_BY });

    // Mark every item verified — there is nothing left to chase.
    const docs = await prisma.rpa_candidate_documents.findMany({
      where: { request_id: request.id }, select: { checklist_item_id: true },
    });
    for (const d of docs) {
      await prisma.rpa_candidate_documents.updateMany({
        where: { request_id: request.id, checklist_item_id: d.checklist_item_id },
        data: { status: 'verified', uploaded_at: new Date(), verified_at: new Date() },
      });
    }
    await prisma.rpa_document_requests.update({
      where: { pipeline_id: BigInt(journey.id) },
      data: { requested_at: daysAgo(afterDays + 5), last_reminded_at: null, reminder_count: 0 },
    });

    await runDocumentReminders();

    const row = await reminderCountFor(journey.id);
    assert.equal(row.reminder_count, 0, 'a fully-verified request must never be chased');
  });

  test('a request on a CLOSED journey is left alone', async () => {
    const { journey } = await makeJourney({ name: 'DOC11e' });
    await putOnStage(journey.id, 'documents');
    await requestDocuments(journey.id, { actedBy: ACTED_BY });
    await prisma.rpa_document_requests.update({
      where: { pipeline_id: BigInt(journey.id) },
      data: { requested_at: daysAgo(afterDays + 5), last_reminded_at: null, reminder_count: 0 },
    });

    // Close the journey underneath the open request — chasing someone whose
    // record has been closed is the specific thing the guard exists to stop.
    await prisma.rpa_candidate_pipeline.update({
      where: { id: BigInt(journey.id) },
      data: { final_outcome: FINAL_OUTCOMES.REJECTED, closed_at: new Date() },
    });

    await runDocumentReminders();

    const row = await reminderCountFor(journey.id);
    assert.equal(row.reminder_count, 0, 'a closed journey must never be chased');
  });
});

// ══════════════════════ OFFER-14 — approval nudge ══════════════════════

describe('OFFER-14 — the approval nudge fires once a day, per pending offer', () => {
  test('a pending approval request is nudged, and NOT nudged twice the same day', async () => {
    const { journey } = await makeJourney({ name: 'OFFER14a' });
    await putOnStage(journey.id, 'offer');
    await requestApproval(journey.id, { actedBy: ACTED_BY });

    // Requested a few days ago, never nudged.
    await prisma.rpa_offers.updateMany({
      where: { pipeline_id: BigInt(journey.id) },
      data: { approval_requested_at: daysAgo(3), approval_nudged_at: null },
    });

    await runApprovalNudges();
    const first = await prisma.rpa_offers.findFirst({
      where: { pipeline_id: BigInt(journey.id) }, select: { approval_nudged_at: true },
    });
    assert.ok(first.approval_nudged_at, 'a pending offer must be nudged');

    // Second run the same day: the OR clause is
    // (nudged IS NULL OR nudged < startOfToday), so today's stamp excludes it.
    await runApprovalNudges();
    const second = await prisma.rpa_offers.findFirst({
      where: { pipeline_id: BigInt(journey.id) }, select: { approval_nudged_at: true },
    });
    assert.equal(
      second.approval_nudged_at.getTime(), first.approval_nudged_at.getTime(),
      'a second run on the same day must NOT re-nudge — daily, not per-run'
    );
  });

  test('an offer nudged YESTERDAY is nudged again today', async () => {
    const { journey } = await makeJourney({ name: 'OFFER14b' });
    await putOnStage(journey.id, 'offer');
    await requestApproval(journey.id, { actedBy: ACTED_BY });
    await prisma.rpa_offers.updateMany({
      where: { pipeline_id: BigInt(journey.id) },
      data: { approval_requested_at: daysAgo(5), approval_nudged_at: daysAgo(1) },
    });

    await runApprovalNudges();

    const row = await prisma.rpa_offers.findFirst({
      where: { pipeline_id: BigInt(journey.id) }, select: { approval_nudged_at: true },
    });
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    assert.ok(row.approval_nudged_at >= startOfToday, 'yesterday\'s nudge must not suppress today\'s');
  });

  test('an already-APPROVED offer is never nudged', async () => {
    const { journey } = await makeJourney({ name: 'OFFER14c' });
    await putOnStage(journey.id, 'offer');
    await requestApproval(journey.id, { actedBy: ACTED_BY });
    await prisma.rpa_offers.updateMany({
      where: { pipeline_id: BigInt(journey.id) },
      data: { approval_status: 'approved', approval_requested_at: daysAgo(5), approval_nudged_at: null },
    });

    await runApprovalNudges();

    const row = await prisma.rpa_offers.findFirst({
      where: { pipeline_id: BigInt(journey.id) }, select: { approval_nudged_at: true },
    });
    assert.equal(row.approval_nudged_at, null, 'only PENDING approvals are chased');
  });
});

// ══════════════════════ OFFER-15 — post-joining auto-close ══════════════════════

describe('OFFER-15 — post-joining auto-close', () => {
  const { autoCloseAfterDays } = config.offer;

  /** An accepted offer with a joining date, ready to be aged. */
  async function acceptedJourney(name) {
    const { journey } = await makeJourney({ name });
    await putOnStage(journey.id, 'offer');
    await recordOfferShared(journey.id, { actedBy: ACTED_BY });
    await recordCandidateDecision(journey.id, { decision: 'accepted', actedBy: ACTED_BY });
    return journey;
  }

  test('a journey joined LONGER ago than the window auto-closes as joined', async () => {
    const journey = await acceptedJourney('OFFER15a');
    await prisma.rpa_offers.updateMany({
      where: { pipeline_id: BigInt(journey.id) },
      data: { joining_date: daysAgo(autoCloseAfterDays + 5) },
    });

    const closed = await runPostJoiningAutoClose();
    assert.ok(closed >= 1, 'at least this journey must have closed');

    const row = await prisma.rpa_candidate_pipeline.findUnique({
      where: { id: BigInt(journey.id) },
      select: { final_outcome: true, closed_at: true },
    });
    assert.equal(row.final_outcome, FINAL_OUTCOMES.JOINED);
    assert.ok(row.closed_at, 'closed_at must be stamped');
  });

  test('a journey joined RECENTLY stays open', async () => {
    const journey = await acceptedJourney('OFFER15b');
    await prisma.rpa_offers.updateMany({
      where: { pipeline_id: BigInt(journey.id) },
      data: { joining_date: daysAgo(1) },
    });

    await runPostJoiningAutoClose();

    const row = await prisma.rpa_candidate_pipeline.findUnique({
      where: { id: BigInt(journey.id) }, select: { final_outcome: true },
    });
    assert.equal(row.final_outcome, null, 'inside the retention window it must stay open');
  });

  test("a recruiter's own closure WINS — the sweep does not overwrite it", async () => {
    const journey = await acceptedJourney('OFFER15c');
    await prisma.rpa_offers.updateMany({
      where: { pipeline_id: BigInt(journey.id) },
      data: { joining_date: daysAgo(autoCloseAfterDays + 30) },
    });
    // The candidate joined and then left. That is a DIFFERENT outcome, set by a
    // human, and an automated tidy-up must never relabel it 'joined'.
    await prisma.rpa_candidate_pipeline.update({
      where: { id: BigInt(journey.id) },
      data: { final_outcome: FINAL_OUTCOMES.JOINED_AND_LEFT, closed_at: new Date() },
    });

    await runPostJoiningAutoClose();

    const row = await prisma.rpa_candidate_pipeline.findUnique({
      where: { id: BigInt(journey.id) }, select: { final_outcome: true },
    });
    assert.equal(
      row.final_outcome, FINAL_OUTCOMES.JOINED_AND_LEFT,
      "the sweep must not overwrite a recruiter's closure"
    );
  });

  test('an accepted offer with NO joining date is never auto-closed', async () => {
    const journey = await acceptedJourney('OFFER15d');
    await prisma.rpa_offers.updateMany({
      where: { pipeline_id: BigInt(journey.id) },
      data: { joining_date: null },
    });

    await runPostJoiningAutoClose();

    const row = await prisma.rpa_candidate_pipeline.findUnique({
      where: { id: BigInt(journey.id) }, select: { final_outcome: true },
    });
    assert.equal(row.final_outcome, null, 'no joining date means the clock never started');
  });
});
