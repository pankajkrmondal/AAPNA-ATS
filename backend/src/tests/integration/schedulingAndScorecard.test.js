/**
 * Block B — M3a Interview Scheduling and Interviewer Scorecards.
 * Run: node --test src/tests/integration/schedulingAndScorecard.test.js
 *
 * Covers SCHED-02, 03, 04, 05, 08, 09, 10, 12, 13, 14, 15, 16, 17, 18.
 *
 * NOT covered here — recorded as Manual in the results doc because they need a
 * real Teams/Outlook round trip or a human reading a mailbox:
 *   SCHED-01 (calendar event + Teams meeting actually created)
 *   SCHED-06/07 (reschedule/cancel email wording, one-email-per-side)
 *   SCHED-11 (occurrence sweep + Graph attendance — also gated on the pending
 *             IT grant; see readiness assessment B4)
 *   SCHED-19 (reminder job timing window)
 *
 * ⚠ PANEL EMAIL IS NOT REDIRECTED. interviewScheduledPanel / scorecardInvite are
 * in OPERATOR_ADDRESSED (emailRecipients.js:159), so whatever interviewer
 * address these tests use receives REAL mail. They use the supplied test
 * mailbox for exactly that reason — never a colleague's address.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../../config/database.js';
import { disconnectRedis } from '../../config/redis.js';
import { createPipelineJourney, setStageOutcome } from '../../services/pipeline.service.js';
import {
  scheduleInterviewRound,
  markInterviewOccurrence,
  getLiveSchedule,
  stageSendsInvites,
  isSchedulableStage,
  parseInterviewerEmails,
  SCHEDULABLE_STAGES,
  OCCURRENCE_STATUS,
} from '../../services/interviewSchedule.service.js';
import {
  dispatchScorecards,
  getScorecardByToken,
  submitScorecardByToken,
  getCandidateScorecardReport,
  SCORECARD_STATUS,
} from '../../services/interviewScorecard.service.js';
import { FIXTURE_TAG, CANDIDATE_EMAIL } from '../helpers/fixture.js';

const ACTED_BY = 2;
/** Panel address — receives REAL mail (see header). */
const INTERVIEWER = 'claudepankajmondal@gmail.com';

const createdJourneys = [];
const createdCvs = [];
let mrfSingleId;

const futureAt = (hoursAhead) => new Date(Date.now() + hoursAhead * 3600 * 1000);

async function makeJourney(name) {
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
      cv_id: cv.id, mrf_id: mrfSingleId, candidate_name: cv.Name,
      candidate_email: CANDIDATE_EMAIL, position_applied: 'RPA Developer',
      shortlisted_by: 'phase3-testpass', recruiter_notes: FIXTURE_TAG,
    },
  });
  const journey = await createPipelineJourney({
    cvId: cv.id, mrfId: mrfSingleId, shortlistId: shortlist.id, source: 'screening_shortlist',
  });
  createdJourneys.push(BigInt(journey.id));
  return journey;
}

/** Walks a journey from zeko_hr up to the requested stage by approving. */
async function advanceTo(journeyId, targetStage) {
  const order = ['assessment', 'zeko_fn', 'tech1', 'tech2', 'tech3', 'hr_round', 'ceo', 'client'];
  for (const stage of order) {
    const row = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: BigInt(journeyId) } });
    if (row.current_stage_key === targetStage) return;
    await setStageOutcome(journeyId, { outcomeKey: 'approved', actedBy: ACTED_BY });
    if (stage === targetStage) return;
  }
}

before(async () => {
  const mrf = await prisma.rpa_mrf.findFirst({
    where: { additional_information: { contains: FIXTURE_TAG }, number_of_positions: 1 }, select: { id: true },
  });
  assert.ok(mrf, 'Fixture MRF missing — run: node src/tests/helpers/fixture.js seed');
  mrfSingleId = mrf.id;
});

after(async () => {
  if (createdJourneys.length) {
    const cards = await prisma.rpa_interview_scorecard.findMany({
      where: { pipeline_id: { in: createdJourneys } }, select: { id: true },
    });
    if (cards.length) {
      await prisma.rpa_interview_scorecard_skill.deleteMany({ where: { scorecard_id: { in: cards.map((c) => c.id) } } });
    }
    await prisma.rpa_interview_scorecard.deleteMany({ where: { pipeline_id: { in: createdJourneys } } });
    await prisma.rpa_interview_schedule.deleteMany({ where: { pipeline_id: { in: createdJourneys } } });
    await prisma.rpa_pipeline_stage_events.deleteMany({ where: { pipeline_id: { in: createdJourneys } } });
    await prisma.rpa_notifications.deleteMany({ where: { pipeline_id: { in: createdJourneys } } });
    await prisma.rpa_candidate_pipeline.deleteMany({ where: { id: { in: createdJourneys } } });
  }
  if (createdCvs.length) {
    await prisma.rpa_email_messages.deleteMany({ where: { candidate_id: { in: createdCvs } } });
    await prisma.rpa_shortlisted_candidates.deleteMany({ where: { cv_id: { in: createdCvs } } });
    await prisma.rpa_cv.deleteMany({ where: { id: { in: createdCvs } } });
  }
  await prisma.$disconnect();
  try { await disconnectRedis(); } catch { /* already closed */ }
});

// ── The six rounds ────────────────────────────────────────────────────

describe('SCHED — the six schedulable rounds and their invite policy', () => {
  test('exactly five rounds auto-invite; Client is manual', async () => {
    const keys = Object.keys(SCHEDULABLE_STAGES);
    assert.deepEqual(keys, ['tech1', 'tech2', 'tech3', 'hr_round', 'ceo', 'client']);
    for (const k of ['tech1', 'tech2', 'tech3', 'hr_round', 'ceo']) {
      assert.equal(stageSendsInvites(k), true, `${k} must auto-invite`);
    }
    assert.equal(stageSendsInvites('client'), false, 'the Client round must never auto-invite (Q14)');
    assert.equal(isSchedulableStage('documents'), false);
    assert.equal(isSchedulableStage('offer'), false);
  });
});

// ── SCHED-04 — input validation ───────────────────────────────────────

describe('SCHED-04 — invalid interviewer email / past date', () => {
  test('a malformed interviewer address is refused', async () => {
    const journey = await makeJourney('SCHED04a');
    await advanceTo(journey.id, 'tech1');

    await assert.rejects(
      () => scheduleInterviewRound(journey.id, {
        stageKey: 'tech1', startAt: futureAt(48), interviewerEmail: 'not-an-email', actedBy: ACTED_BY,
      }),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Not a valid email address/);
        return true;
      }
    );
  });

  test('no interviewer address at all is refused', async () => {
    const journey = await makeJourney('SCHED04b');
    await advanceTo(journey.id, 'tech1');

    await assert.rejects(
      () => scheduleInterviewRound(journey.id, {
        stageKey: 'tech1', startAt: futureAt(48), interviewerEmail: '', actedBy: ACTED_BY,
      }),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /At least one interviewer's email is required/);
        return true;
      }
    );
  });

  test('a start time in the past is refused', async () => {
    const journey = await makeJourney('SCHED04c');
    await advanceTo(journey.id, 'tech1');

    await assert.rejects(
      () => scheduleInterviewRound(journey.id, {
        stageKey: 'tech1', startAt: new Date(Date.now() - 3600 * 1000), interviewerEmail: INTERVIEWER, actedBy: ACTED_BY,
      }),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /in the past/);
        return true;
      }
    );
  });

  test('parseInterviewerEmails splits a comma list and reports the invalid ones', () => {
    const ok = parseInterviewerEmails('a@b.com, c@d.com');
    assert.deepEqual(ok.emails, ['a@b.com', 'c@d.com']);
    assert.deepEqual(ok.invalid, []);

    const bad = parseInterviewerEmails('a@b.com, nope');
    assert.deepEqual(bad.invalid, ['nope']);
  });
});

// ── SCHED-03 — off-stage scheduling ───────────────────────────────────

describe('SCHED-03 — scheduling a round the candidate is not on', () => {
  test('booking tech2 while the candidate sits on tech1 is refused', async () => {
    const journey = await makeJourney('SCHED03');
    await advanceTo(journey.id, 'tech1');

    await assert.rejects(
      () => scheduleInterviewRound(journey.id, {
        stageKey: 'tech2', startAt: futureAt(48), interviewerEmail: INTERVIEWER, actedBy: ACTED_BY,
      }),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /not currently on/);
        return true;
      }
    );
  });
});

// ── SCHED-02 — the Client round sends nothing ─────────────────────────

describe('SCHED-02 — Client round books without any system send', () => {
  test('a client booking creates the row but no calendar event and no email', async () => {
    const journey = await makeJourney('SCHED02');
    await advanceTo(journey.id, 'client');

    const emailsBefore = await prisma.rpa_email_messages.count({ where: { candidate_id: { in: createdCvs } } });

    const booking = await scheduleInterviewRound(journey.id, {
      stageKey: 'client', startAt: futureAt(72), interviewerEmail: INTERVIEWER, actedBy: ACTED_BY,
    });
    assert.equal(booking.status, 'scheduled', 'the booking itself is still recorded');

    // Assert on the STORED row, not the returned object: the serializer omits
    // absent calendar fields rather than returning them as null, so a strict
    // `=== null` on the return value fails on `undefined` without telling us
    // anything about what was actually persisted.
    const stored = await prisma.rpa_interview_schedule.findUnique({ where: { id: BigInt(booking.id) } });
    assert.ok(!stored.calendar_event_id, `no calendar event for the Client round (got ${stored.calendar_event_id})`);
    assert.ok(!stored.teams_join_url, `no Teams meeting for the Client round (got ${stored.teams_join_url})`);

    const emailsAfter = await prisma.rpa_email_messages.count({ where: { candidate_id: { in: createdCvs } } });
    assert.equal(emailsAfter, emailsBefore, 'the Client round must send NO email (Q14)');
  });
});

// ── SCHED-05 — one live booking per stage ─────────────────────────────

describe('SCHED-05 — only one live booking per round', () => {
  test('a second booking on the same round without cancelling is refused', async () => {
    const journey = await makeJourney('SCHED05');
    await advanceTo(journey.id, 'client'); // client = no email noise

    await scheduleInterviewRound(journey.id, {
      stageKey: 'client', startAt: futureAt(48), interviewerEmail: INTERVIEWER, actedBy: ACTED_BY,
    });

    await assert.rejects(
      () => scheduleInterviewRound(journey.id, {
        stageKey: 'client', startAt: futureAt(72), interviewerEmail: INTERVIEWER, actedBy: ACTED_BY,
      }),
      (err) => {
        assert.equal(err.statusCode, 409);
        assert.equal(err.message, 'This round already has a scheduled interview. Cancel it first to rebook.');
        return true;
      }
    );
  });
});

// ── SCHED-08 / 09 / 10 — occurrence ───────────────────────────────────

describe('SCHED-08 / 09 / 10 — occurrence verdicts', () => {
  test('SCHED-08: held completes the booking and dispatches a scorecard', async () => {
    const journey = await makeJourney('SCHED08');
    await advanceTo(journey.id, 'client');
    const booking = await scheduleInterviewRound(journey.id, {
      stageKey: 'client', startAt: futureAt(2), interviewerEmail: INTERVIEWER, actedBy: ACTED_BY,
    });

    await markInterviewOccurrence(booking.id, {
      outcome: OCCURRENCE_STATUS.HELD, source: 'manual', actedBy: ACTED_BY,
    });

    const row = await prisma.rpa_interview_schedule.findUnique({ where: { id: BigInt(booking.id) } });
    assert.equal(row.occurrence_status, 'held');

    const cards = await prisma.rpa_interview_scorecard.findMany({ where: { schedule_id: BigInt(booking.id) } });
    assert.ok(cards.length >= 1, 'a held interview must dispatch at least one scorecard');
    assert.ok(cards[0].token, 'each card carries a unique token');
    const after = await prisma.rpa_interview_schedule.findUnique({ where: { id: BigInt(booking.id) } });
    assert.ok(after.scorecard_dispatched_at, 'scorecard_dispatched_at must be stamped (single-fire marker)');
  });

  test('SCHED-09: a no-show dispatches NO scorecard and does not auto-reject the candidate', async () => {
    const journey = await makeJourney('SCHED09');
    await advanceTo(journey.id, 'client');
    const stageBefore = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: BigInt(journey.id) } });

    const booking = await scheduleInterviewRound(journey.id, {
      stageKey: 'client', startAt: futureAt(2), interviewerEmail: INTERVIEWER, actedBy: ACTED_BY,
    });
    await markInterviewOccurrence(booking.id, {
      outcome: OCCURRENCE_STATUS.NO_SHOW, source: 'manual', party: 'candidate',
      reason: 'Did not join', actedBy: ACTED_BY,
    });

    const row = await prisma.rpa_interview_schedule.findUnique({ where: { id: BigInt(booking.id) } });
    assert.equal(row.occurrence_status, 'no_show');
    assert.equal(row.no_show_party, 'candidate');

    const cards = await prisma.rpa_interview_scorecard.count({ where: { schedule_id: BigInt(booking.id) } });
    assert.equal(cards, 0, 'a no-show must NOT dispatch a scorecard');

    const stageAfter = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: BigInt(journey.id) } });
    assert.equal(stageAfter.current_stage_key, stageBefore.current_stage_key, 'a human must decide — no auto-advance');
    assert.equal(stageAfter.current_stage_status, 'in_progress', 'a no-show must NOT auto-reject or auto-hold (Q9)');
  });

  test('SCHED-10: a repeated occurrence call is idempotent', async () => {
    const journey = await makeJourney('SCHED10');
    await advanceTo(journey.id, 'client');
    const booking = await scheduleInterviewRound(journey.id, {
      stageKey: 'client', startAt: futureAt(2), interviewerEmail: INTERVIEWER, actedBy: ACTED_BY,
    });

    await markInterviewOccurrence(booking.id, { outcome: OCCURRENCE_STATUS.HELD, source: 'manual', actedBy: ACTED_BY });
    const cardsAfterFirst = await prisma.rpa_interview_scorecard.count({ where: { schedule_id: BigInt(booking.id) } });

    const second = await markInterviewOccurrence(booking.id, {
      outcome: OCCURRENCE_STATUS.HELD, source: 'manual', actedBy: ACTED_BY,
    });
    assert.equal(second.alreadyResolved, true, 'the second call reports the existing verdict');

    const cardsAfterSecond = await prisma.rpa_interview_scorecard.count({ where: { schedule_id: BigInt(booking.id) } });
    assert.equal(cardsAfterSecond, cardsAfterFirst, 'scorecards must not be dispatched twice');
  });
});

// ── SCHED-12 / 13 / 14 / 15 / 16 / 17 — scorecards ────────────────────

/** Books a client round, marks it held, and returns its first scorecard token. */
async function heldInterviewWithCard(name) {
  const journey = await makeJourney(name);
  await advanceTo(journey.id, 'client');
  const booking = await scheduleInterviewRound(journey.id, {
    stageKey: 'client', startAt: futureAt(2), interviewerEmail: INTERVIEWER, actedBy: ACTED_BY,
  });
  await markInterviewOccurrence(booking.id, { outcome: OCCURRENCE_STATUS.HELD, source: 'manual', actedBy: ACTED_BY });
  const card = await prisma.rpa_interview_scorecard.findFirst({ where: { schedule_id: BigInt(booking.id) } });
  assert.ok(card, 'precondition: a scorecard was dispatched');
  return { journey, booking, card };
}

describe('SCHED-12 / 13 — submit and double-submit', () => {
  test('SCHED-12: a valid submit stores ratings and computes avg_score', async () => {
    const { card } = await heldInterviewWithCard('SCHED12');

    const fetched = await getScorecardByToken(card.token);
    assert.ok(fetched, 'the public GET must resolve the token');

    const result = await submitScorecardByToken(card.token, {
      communication: 4, attitude: 5, final_rating: 4.5, recommendation: 'approve',
      comments: 'Automated test submission',
    });
    assert.equal(result.status, SCORECARD_STATUS.SUBMITTED);
    // mean of 4, 5, 4.5
    assert.equal(Number(result.avg_score), 4.5);
    assert.equal(result.recommendation, 'approve');
  });

  test('SCHED-13: two simultaneous submits give one 200 and one 409', async () => {
    const { card } = await heldInterviewWithCard('SCHED13');

    const [a, b] = await Promise.allSettled([
      submitScorecardByToken(card.token, { communication: 4, attitude: 4, final_rating: 4 }),
      submitScorecardByToken(card.token, { communication: 2, attitude: 2, final_rating: 2 }),
    ]);

    const ok = [a, b].filter((r) => r.status === 'fulfilled');
    const bad = [a, b].filter((r) => r.status === 'rejected');
    assert.equal(ok.length, 1, `expected 1 winner, got ${ok.length}`);
    assert.equal(bad.length, 1, `expected 1 loser, got ${bad.length}`);
    assert.equal(bad[0].reason.statusCode, 409);
    assert.equal(bad[0].reason.message, 'This scorecard has already been submitted.');

    // Exactly one skill-row write / one card.
    const cards = await prisma.rpa_interview_scorecard.findMany({ where: { id: card.id } });
    assert.equal(cards[0].status, 'submitted');
  });
});

describe('SCHED-14 / 15 / 16 — expiry, no-show gate, rating range', () => {
  test('SCHED-14: an expired token flips to expired on open and refuses submit with 410', async () => {
    const { card } = await heldInterviewWithCard('SCHED14');
    await prisma.rpa_interview_scorecard.update({
      where: { id: card.id },
      data: { token_expires_at: new Date(Date.now() - 24 * 3600 * 1000) },
    });

    const beforeOpen = await prisma.rpa_interview_scorecard.findUnique({ where: { id: card.id } });
    assert.equal(beforeOpen.status, 'pending', 'stays pending in the DB until someone opens it (lazy)');

    await getScorecardByToken(card.token);
    const afterOpen = await prisma.rpa_interview_scorecard.findUnique({ where: { id: card.id } });
    assert.equal(afterOpen.status, 'expired', 'the first open performs the lazy transition');

    await assert.rejects(
      () => submitScorecardByToken(card.token, { communication: 3 }),
      (err) => {
        assert.equal(err.statusCode, 410);
        assert.equal(err.message, 'This scorecard link has expired.');
        return true;
      }
    );
  });

  test('SCHED-15: a scorecard on a no-show interview is refused', async () => {
    const { booking, card } = await heldInterviewWithCard('SCHED15');
    // Force the booking to no_show after the card was issued.
    await prisma.rpa_interview_schedule.update({
      where: { id: BigInt(booking.id) }, data: { occurrence_status: 'no_show' },
    });

    await assert.rejects(
      () => submitScorecardByToken(card.token, { communication: 3 }),
      (err) => {
        assert.equal(err.statusCode, 409);
        assert.equal(err.message, 'This interview was marked as not held, so no scorecard can be submitted.');
        return true;
      }
    );
  });

  test('SCHED-16: out-of-range ratings are refused; a non-0.5 step is ROUNDED not refused', async () => {
    const { card } = await heldInterviewWithCard('SCHED16');

    await assert.rejects(
      () => submitScorecardByToken(card.token, { final_rating: 6 }),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Ratings must be between 0 and 5/);
        return true;
      }
    );
    await assert.rejects(
      () => submitScorecardByToken(card.token, { communication: -1 }),
      (err) => { assert.equal(err.statusCode, 400); return true; }
    );

    // Documented behaviour, recorded rather than asserted as "correct":
    // normalizeRating ROUNDS to the nearest 0.5 instead of rejecting. 2.3 -> 2.5.
    const ok = await submitScorecardByToken(card.token, { communication: 2.3 });
    assert.equal(Number(ok.communication), 2.5, '2.3 is rounded to 2.5, NOT rejected — see results doc');
  });

  test('SCHED-17: HR text fields are silently truncated, not refused', async () => {
    const { card } = await heldInterviewWithCard('SCHED17');
    const long = 'x'.repeat(400);

    const result = await submitScorecardByToken(card.token, {
      hr_notice_period: long, hr_timings: long, communication: 3,
    });
    assert.equal(result.hr_notice_period.length, 100, 'capped at HR_FIELD_MAX (100)');
    assert.equal(result.hr_timings.length, 255, 'capped at HR_FIELD_MAX (255)');
  });
});

// ── SCHED-18 — consolidated report ────────────────────────────────────

describe('SCHED-18 — consolidated feedback report', () => {
  test('only submitted cards appear, grouped by round, with an overall average', async () => {
    const { journey, card } = await heldInterviewWithCard('SCHED18');
    await submitScorecardByToken(card.token, {
      communication: 4, attitude: 4, final_rating: 4, recommendation: 'approve',
      skills: [{ label: 'SQL', rating: 2 }, { label: 'UiPath', rating: 5 }],
    });

    const report = await getCandidateScorecardReport(journey.id);
    assert.ok(report, 'a report must be produced');
    assert.ok(report.overall, 'it carries an overall block');
    assert.ok(Number(report.overall.average) > 0, 'the overall average is computed');

    const rounds = report.rounds || report.by_round || [];
    assert.ok(rounds.length >= 1, 'at least one round is represented');
  });
});
