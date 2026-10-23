/**
 * Open Positions counting rules (L06). Pure — no database.
 * Run: node --test src/tests/unit/openPositions.test.js
 *
 * Cases follow the approved design (22 Oct 2026): range 16–22 Oct, health
 * rules D9, the "This week" sentence W3.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sourceBucket, percent, positionCounts, positionHealth, comparePositions, summaryText, positionMilestones,
  parsePositionTargetDays, DEFAULT_POSITION_TARGET_DAYS,
} from '../../services/openPositions.helpers.js';
import { makeRange } from '../../utils/analyticsRange.js';

const range = makeRange('2026-10-16', '2026-10-22');
const now = new Date('2026-10-22T06:30:00Z').getTime();
const at = (day, hh = '06:30') => new Date(`${day}T${hh}:00Z`);
const ev = (event_type, stage_key, day, outcome = null) => ({ event_type, stage_key, outcome, created_at: at(day) });

test('1 · source buckets: tag source first, then vendor fields, else other', () => {
  assert.equal(sourceBucket('hr_manual_upload'), 'hr_upload');
  assert.equal(sourceBucket('vendor_portal'), 'vendor');
  for (const s of ['shortlist', 'search_candidate', 'change_jd', 'move', 'backfill']) assert.equal(sourceBucket(s), 'recruiter');
  assert.equal(sourceBucket(null, true), 'vendor');
  assert.equal(sourceBucket(null, false), 'other');
});

test('2 · percent is whole and null with nothing to divide by', () => {
  assert.equal(percent(6, 64), 9);
  assert.equal(percent(1, 0), null);
});

test('3 · range counts use each number\'s own date; Now numbers ignore the range', () => {
  const journeys = [
    // shortlisted in range, moved to Tech 1 in range, still open
    { id: 1, created_at: at('2026-10-17'), current_stage_key: 'tech1', current_stage_status: 'in_progress',
      rpa_pipeline_stage_events: [ev('entered', 'shortlist', '2026-10-17'), ev('entered', 'tech1', '2026-10-20')] },
    // shortlisted before the range, stuck in Tech 1 since 1 Oct (21 days), awaiting feedback
    { id: 2, created_at: at('2026-09-28'), current_stage_key: 'tech1', current_stage_status: 'in_progress',
      rpa_pipeline_stage_events: [ev('entered', 'shortlist', '2026-09-28'), ev('entered', 'tech1', '2026-10-01')] },
    // rejected in range at HR round
    { id: 3, created_at: at('2026-10-01'), current_stage_key: 'hr_round', current_stage_status: 'rejected', final_outcome: 'closure_rejected', closed_at: at('2026-10-21'),
      rpa_pipeline_stage_events: [ev('entered', 'shortlist', '2026-10-01'), ev('outcome', 'hr_round', '2026-10-21', 'rejected')] },
    // joined in range, offer requested in range
    { id: 4, created_at: at('2026-09-20'), current_stage_key: 'offer', current_stage_status: 'approved', final_outcome: 'joined', closed_at: at('2026-10-21'),
      rpa_offers: { approval_status: 'approved', approval_requested_at: at('2026-10-16') }, rpa_pipeline_stage_events: [ev('entered', 'offer', '2026-10-10')] },
    // offer awaiting approval now, on hold
    { id: 5, created_at: at('2026-10-02'), current_stage_key: 'offer', current_stage_status: 'hold',
      rpa_offers: { approval_status: 'pending', approval_requested_at: at('2026-10-20') }, rpa_pipeline_stage_events: [ev('entered', 'offer', '2026-10-19')] },
  ];
  const c = positionCounts({
    journeys,
    screeningRejects: [{ shortlisted_at: at('2026-10-18') }, { shortlisted_at: at('2026-09-01') }],
    interviews: [at('2026-10-17'), at('2026-10-05')],
    applicants: { applied: 64, responded: 22, sources: { hr_upload: 38, vendor: 11, other: 12, recruiter: 3 } },
    awaitingIds: new Set(['2']),
    range,
    firstStageKey: 'shortlist',
    now,
  });
  assert.equal(c.applied, 64);
  assert.equal(c.shortlisted, 1, 'only journey 1 started in the range');
  assert.equal(c.moved_forward, 2, 'journey 1 reached Tech 1 (20 Oct) and journey 5 reached Offer (19 Oct); journey 4 reached Offer before the range');
  assert.equal(c.rejected, 2, 'journey 3 + one screening reject in range');
  assert.equal(c.offers, 2, 'offers requested 16 Oct and 20 Oct');
  assert.equal(c.joined, 1);
  assert.equal(c.interviews, 1);
  assert.equal(c.in_pipeline, 3, 'journeys 1, 2, 5 are open');
  assert.equal(c.on_hold, 1);
  assert.equal(c.stuck, 1, 'journey 2: 21 days in Tech 1');
  assert.equal(c.awaiting_feedback, 1);
  assert.equal(c.offers_awaiting_approval, 1);
  assert.equal(c.shortlist_pct, 2);
  assert.equal(c.response_pct, 34);
});

test('4 · All time counts every journey', () => {
  const c = positionCounts({
    journeys: [{ id: 1, created_at: at('2025-01-01'), current_stage_key: 'shortlist', current_stage_status: 'in_progress', rpa_pipeline_stage_events: [] }],
    range: null, firstStageKey: 'shortlist', now,
  });
  assert.equal(c.shortlisted, 1);
});

test('5 · health: At risk, Watch, On track, Paused (D9)', () => {
  const base = { status: 'Open', daysOpen: 20, targetDays: 45, appliedLast7: 10, appliedPrev7: 12, inPipeline: 5, stuck: 0, awaitingFeedback: 0 };
  assert.equal(positionHealth(base).status, 'on_track');
  const late = positionHealth({ ...base, daysOpen: 47 });
  assert.equal(late.status, 'at_risk');
  assert.deepEqual(late.reasons, ['Open 47 days · target 45']);
  const dry = positionHealth({ ...base, appliedLast7: 0, inPipeline: 2 });
  assert.equal(dry.status, 'at_risk');
  assert.ok(dry.reasons.includes('No new applicants in 7 days'));
  assert.equal(positionHealth({ ...base, appliedLast7: 0, inPipeline: 3 }).status, 'watch', 'a full pipeline softens a dry week');
  const down = positionHealth({ ...base, appliedLast7: 31, appliedPrev7: 69 });
  assert.equal(down.status, 'watch');
  assert.deepEqual(down.reasons, ['Applicants down 55% on last week']);
  const stuck = positionHealth({ ...base, stuck: 2, stuckStage: 'Tech 1', awaitingFeedback: 2 });
  assert.deepEqual(stuck.reasons, ['2 stuck in Tech 1', '2 awaiting feedback']);
  assert.equal(positionHealth({ ...base, status: 'Paused' }).status, 'paused');
});

test('6 · board order: worst health first, then longest open', () => {
  const rows = [
    { role: 'a', health: { status: 'on_track' }, days_open: 90 },
    { role: 'b', health: { status: 'watch' }, days_open: 15 },
    { role: 'c', health: { status: 'at_risk' }, days_open: 10 },
    { role: 'd', health: { status: 'watch' }, days_open: 30 },
  ];
  assert.deepEqual(rows.sort(comparePositions).map((r) => r.role), ['c', 'd', 'b', 'a']);
});

test('7 · the "This week" sentence matches the numbers (W3)', () => {
  const now7 = { applied: 64, responded: 22, shortlisted: 6, moved_forward: 4, offers: 1, joined: 0, stuck: 2, awaiting_feedback: 2, offers_awaiting_approval: 0 };
  const text = summaryText({ now: now7, previous: { applied: 43 }, periodWord: 'last week', stuckStage: 'Tech 1', nextInterview: { at: '24 Oct 2026, 11:00 AM', stage: 'Tech 1' } });
  assert.equal(
    text,
    '64 new applicants (21 more than last week), 22 responded, 6 shortlisted, 4 moved forward and 1 offer made. '
    + '2 candidates have waited in Tech 1 for 10 days or more and 2 interviews are waiting for feedback. '
    + 'Next interview: 24 Oct 2026, 11:00 AM (Tech 1).',
  );
  const quiet = summaryText({ now: { applied: 0, responded: 0, shortlisted: 0 }, previous: null });
  assert.equal(quiet, '0 new applicants, 0 responded and 0 shortlisted.');
});

test('8 · milestones carry the days since the previous one; unreached ones have no date', () => {
  const m = positionMilestones({
    requestedAt: '2026-09-18T05:00:00Z', approvedAt: '2026-09-22T05:00:00Z', firstApplicantAt: '2026-09-23T05:00:00Z',
    firstShortlistAt: null, status: 'Open', openings: 3, joined: 1, firstJoinAt: '2026-10-21T05:00:00Z',
  });
  assert.equal(m[1].days_after_previous, 4);
  assert.equal(m[2].days_after_previous, 1);
  assert.equal(m[3].at, null);
  assert.equal(m[6].label, '1 of 3 joined');
  assert.equal(m[6].days_after_previous, 28, 'measured from the last reached milestone');
  assert.equal(m[7].at, null, 'an open position has no end');
});

test('9 · target days setting', () => {
  assert.equal(parsePositionTargetDays('45'), 45);
  assert.equal(parsePositionTargetDays('0'), null);
  assert.equal(parsePositionTargetDays('400'), null);
  assert.equal(DEFAULT_POSITION_TARGET_DAYS, 45);
});
