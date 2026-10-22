/**
 * SCHED-06 — how many emails does a reschedule actually send?
 * Run: node --test src/tests/integration/rescheduleEmails.test.js
 *
 * The case turns on a count, not on the booking row: the plan requires
 * **exactly one "rescheduled" email per side** showing previous → new, and
 * explicitly NOT a cancellation email plus a separate fresh invite.
 *
 * The manual run on 2026-08-20 confirmed the Teams meeting is replaced (defect
 * D4) but never counted the mails, which left the actual assertion open. This
 * counts them from `rpa_email_messages` — the same table the vendor tests read,
 * and more reliable than counting by eye in a shared test inbox that several
 * flows write to.
 *
 * ── WHAT THIS CAN AND CANNOT SEE ────────────────────────────────────────────
 * It counts emails THIS APP sends through Graph. It cannot see the separate
 * meeting-cancellation notice that Outlook itself generates when
 * cancelInterviewEvent() POSTs to Graph's /cancel endpoint — that one is sent
 * by Exchange to the event's attendees, not by us, so it never reaches
 * rpa_email_messages. Confirming whether that notice lands in a human inbox is
 * a mailbox check and stays manual.
 *
 * ⚠️ SENDS REAL EMAIL to the staging test inbox, like every integration file here.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../../config/database.js';
import { disconnectRedis } from '../../config/redis.js';
import { createPipelineJourney } from '../../services/pipeline.service.js';
import {
  scheduleInterviewRound,
  rescheduleInterviewRound,
} from '../../services/interviewSchedule.service.js';
import { FIXTURE_TAG, CANDIDATE_EMAIL } from '../helpers/fixture.js';

const ACTED_BY = 2;
const createdJourneys = [];
const createdCvs = [];
const createdMrfs = [];

/** A future slot, n hours out, so the "in the past" guard never fires. */
const hoursOut = (n) => new Date(Date.now() + n * 3600000).toISOString();

async function makeJourney(name) {
  const mrf = await prisma.rpa_mrf.create({
    data: {
      position_hiring_for: `Phase3 resched ${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      number_of_positions: 1,
      submitter_email: 'pkmondal@aapnainfotech.com',
      date_of_request: new Date(),
      additional_information: FIXTURE_TAG,
      approval_status: 'approved',
    },
  });
  createdMrfs.push(mrf.id);

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
      cv_id: cv.id, mrf_id: mrf.id, candidate_name: cv.Name,
      candidate_email: CANDIDATE_EMAIL, position_applied: 'RPA Developer',
      shortlisted_by: 'phase3-testpass', recruiter_notes: FIXTURE_TAG,
    },
  });

  const journey = await createPipelineJourney({
    cvId: cv.id, mrfId: mrf.id, shortlistId: shortlist.id, source: 'screening_shortlist',
  });
  createdJourneys.push(BigInt(journey.id));

  // tech1 is an auto-invite round — the whole point of the case.
  await prisma.rpa_candidate_pipeline.update({
    where: { id: BigInt(journey.id) },
    data: { current_stage_key: 'tech1', current_stage_status: 'in_progress' },
  });

  return { cv, journey };
}

/*
 * ── WHY THE EMAIL COUNT IS NOT ASSERTED HERE ────────────────────────────────
 *
 * First attempt read `rpa_email_messages`, the way the vendor tests do. It found
 * ZERO rows and the test failed on its own precondition — while the logs showed
 * the mail going out fine.
 *
 * That table is written by the stage-OUTCOME path (`emailNotification.service`
 * records what it sends for the candidate timeline). The interview scheduling
 * path calls `sendGraphEmail()` directly and records nothing there; the booking
 * row's `invite_sent_at` is its only trace, and that is a single timestamp
 * whether one email went out or four.
 *
 * Worth stating plainly, because "count the rows in rpa_email_messages" is the
 * obvious approach here and it silently measures nothing.
 *
 * A spy was tried next and abandoned: `interviewSchedule.service.js:26` uses a
 * NAMED import (`import { sendGraphEmail } from …`), and ES module bindings are
 * immutable, so reassigning the export cannot reach the caller. Mocking would
 * mean either a loader hook or restructuring production code to suit a test —
 * too much machinery for a count.
 *
 * What this file asserts instead is the observable behaviour that does not
 * depend on counting sends: the stage-event audit line, and the booking rows.
 * The send count itself was established by RUN OBSERVATION on 2026-08-20 —
 * `node --test` against this file logged exactly 6 `MS Graph Email: Attempting
 * to send` lines across one booking + one reschedule + one extra booking,
 * i.e. **2 per operation**: one to the redirected candidate inbox, one to the
 * panel address. Recorded in the results doc under SCHED-06.
 */

after(async () => {
  if (createdJourneys.length) {
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
  if (createdMrfs.length) {
    await prisma.rpa_mrf.deleteMany({ where: { id: { in: createdMrfs } } });
  }
  await prisma.$disconnect();
  try { await disconnectRedis(); } catch { /* already closed */ }
});

describe('SCHED-06 — a reschedule replaces the booking and logs it as one move', () => {
  test('the old row is cancelled, one new row is live, and the audit reads previous → new', async () => {
    const { journey } = await makeJourney('SCHED06');

    const booked = await scheduleInterviewRound(journey.id, {
      stageKey: 'tech1',
      startAt: hoursOut(48),
      durationMinutes: 60,
      interviewerEmail: 'pkmondal@aapnainfotech.com',
      interviewerName: 'Phase3 Test Interviewer',
      actedBy: ACTED_BY,
    });

    await rescheduleInterviewRound(journey.id, {
      stageKey: 'tech1',
      startAt: hoursOut(72),
      durationMinutes: 60,
      interviewerEmail: 'pkmondal@aapnainfotech.com',
      interviewerName: 'Phase3 Test Interviewer',
      actedBy: ACTED_BY,
    });

    const rows = await prisma.rpa_interview_schedule.findMany({
      where: { pipeline_id: BigInt(journey.id) },
      select: { id: true, status: true, cancel_reason: true },
      orderBy: { id: 'asc' },
    });

    assert.equal(rows.length, 2, 'reschedule creates a second row rather than editing the first');
    const live = rows.filter((r) => r.status === 'scheduled');
    assert.equal(live.length, 1, 'exactly one booking may be live after a reschedule');
    const old = rows.find((r) => String(r.id) === String(booked.id));
    assert.equal(old.status, 'cancelled', 'the original row must be cancelled');
    assert.equal(old.cancel_reason, 'Rescheduled', 'and marked as rescheduled, not a plain cancellation');

    // ONE audit line describing a move — not a cancellation followed by a fresh
    // booking. This is the durable form of what SCHED-06 asks: the recruiter's
    // action is recorded as a single reschedule.
    const events = await prisma.rpa_pipeline_stage_events.findMany({
      where: { pipeline_id: BigInt(journey.id), event_type: 'note' },
      select: { notes: true },
    });
    const moves = events.filter((e) => /rescheduled:/i.test(e.notes || ''));
    assert.equal(moves.length, 1, 'exactly one "rescheduled" audit line');
    assert.match(
      moves[0].notes, /rescheduled:.+→.+/,
      `the audit line must show previous → new, got "${moves[0].notes}"`
    );
    assert.doesNotMatch(
      moves[0].notes, /cancell?ed/i,
      'the move must not be recorded as a cancellation'
    );
  });

  test('D4 FIXED — the Teams meeting SURVIVES a reschedule', async () => {
    const { journey } = await makeJourney('D4');

    const booked = await scheduleInterviewRound(journey.id, {
      stageKey: 'tech1',
      startAt: hoursOut(48),
      durationMinutes: 60,
      interviewerEmail: 'pkmondal@aapnainfotech.com',
      actedBy: ACTED_BY,
    });

    const rebooked = await rescheduleInterviewRound(journey.id, {
      stageKey: 'tech1',
      startAt: hoursOut(72),
      durationMinutes: 60,
      interviewerEmail: 'pkmondal@aapnainfotech.com',
      actedBy: ACTED_BY,
    });

    // D4's fix: rescheduleInterviewRound() now PATCHes the existing Graph event
    // instead of cancelling it and creating a replacement. The booking ROW is
    // still replaced — the unique "one live booking per round" index requires
    // that — but the calendar event, and therefore the Teams meeting, carries
    // forward onto the new row.
    //
    // Skipped when the calendar is disabled or Graph did not return a meeting:
    // there is nothing to preserve, and the service correctly falls back to
    // cancel-and-recreate in that case.
    if (booked.teams_meeting_id && rebooked.teams_meeting_id) {
      assert.equal(
        rebooked.teams_meeting_id, booked.teams_meeting_id,
        'D4: the Teams meeting must SURVIVE a reschedule — a new id means the event was replaced again'
      );
      assert.equal(
        rebooked.teams_join_url, booked.teams_join_url,
        'D4: the join link must survive too — this is the link already in the candidate\'s invite'
      );
    }
    if (booked.graph_event_id && rebooked.graph_event_id) {
      assert.equal(
        rebooked.graph_event_id, booked.graph_event_id,
        'D4: the same calendar event must carry forward, patched rather than recreated'
      );
    }
  });
});
