/**
 * Unit tests for the pure analytics helpers behind the Recruitment Analytics
 * page (no network, no DB). Run: npm run test:unit
 *
 * These guard the two defect classes that made the page quietly wrong:
 *
 *   1. TIME. Stage durations and "days stuck" were measured from one event to
 *      the NEXT EVENT OF ANY TYPE. M3/M4/M5 write 'note' rows liberally
 *      (scorecard emailed, interview rescheduled, documents requested), so a
 *      note on a stalled journey reset its clock to zero — the alerting
 *      surface went blind exactly when a candidate was most stuck, and it got
 *      worse with every module that shipped.
 *
 *   2. BUCKETS. Source-of-hire counted each column with an independent `if`,
 *      so an open journey was "shortlisted" AND could also appear under
 *      on-hold. Columns could exceed the total, which makes the rate computed
 *      from them not a rate.
 *
 * Both failures are silent: the numbers still render, they are just wrong.
 * That is why the invariants are asserted directly rather than the DB
 * behaviour that produces them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EVENT_TYPES,
  HIRED_OUTCOMES,
  FINAL_OUTCOMES,
  STAGE_OUTCOMES,
  isTransitionEvent,
  isStageArrival,
} from '../config/pipelineStages.js';
// From the dependency-free helpers module, NOT pipeline.service.js: importing
// that service opens a shared Redis connection that never closes, which keeps
// the process alive and hangs `node --test` (same trap noted in mrfClosure.test.js).
import {
  lastTransitionOf,
  stageClockStart,
  stageDurations,
  bucketFor,
} from '../services/pipelineAnalytics.helpers.js';

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date('2026-01-01T00:00:00Z').getTime();
/** An event `d` days after T0. */
const at = (d, event_type, stage_key = 'tech1') => ({
  event_type,
  stage_key,
  created_at: new Date(T0 + d * DAY),
});

// ── Event classification ────────────────────────────────────────────────────

test('entered/skip/outcome are transitions; note is not', () => {
  assert.ok(isTransitionEvent({ event_type: EVENT_TYPES.ENTERED }));
  assert.ok(isTransitionEvent({ event_type: EVENT_TYPES.OUTCOME }));
  assert.ok(isTransitionEvent({ event_type: EVENT_TYPES.SKIP }));
  // The whole bug in one assertion.
  assert.ok(!isTransitionEvent({ event_type: EVENT_TYPES.NOTE }));
  assert.ok(!isTransitionEvent(null));
  assert.ok(!isTransitionEvent({}));
});

test("'skip' is an arrival — it lands a candidate IN a stage", () => {
  // skip is written INSTEAD OF 'entered' when the candidate reached this stage
  // by bypassing an optional one before it. Treating it as a non-arrival would
  // make every skipped-into stage invisible to both clocks.
  assert.ok(isStageArrival({ event_type: EVENT_TYPES.SKIP }));
  assert.ok(isStageArrival({ event_type: EVENT_TYPES.ENTERED }));
  assert.ok(!isStageArrival({ event_type: EVENT_TYPES.OUTCOME }));
  assert.ok(!isStageArrival({ event_type: EVENT_TYPES.NOTE }));
});

test('a stage arrived at via skip still gets a duration', () => {
  const events = [
    at(0, EVENT_TYPES.SKIP, 'hr_round'),
    at(6, EVENT_TYPES.OUTCOME, 'hr_round'),
  ];
  const durations = stageDurations(events, new Date(T0 + 6 * DAY));
  assert.equal(durations.get('hr_round'), 6);
});

test('the stuck clock starts at a skip arrival', () => {
  const journey = {
    current_stage_key: 'hr_round',
    created_at: new Date(T0),
    rpa_pipeline_stage_events: [
      at(0, EVENT_TYPES.ENTERED, 'tech2'),
      at(3, EVENT_TYPES.OUTCOME, 'tech2'),
      at(3, EVENT_TYPES.SKIP, 'hr_round'),
      at(20, EVENT_TYPES.NOTE, 'hr_round'),
    ],
  };
  assert.equal(new Date(stageClockStart(journey)).getTime(), T0 + 3 * DAY);
});

// ── Stage durations ─────────────────────────────────────────────────────────

test('a stage lasts until the next TRANSITION, not the next note', () => {
  // The regression fixture: two notes land inside the stage. The old code
  // paired entered(d0) with note(d0.1) and reported 0.1 days.
  const events = [
    at(0, EVENT_TYPES.ENTERED),
    at(0.1, EVENT_TYPES.NOTE),
    at(3, EVENT_TYPES.NOTE),
    at(7, EVENT_TYPES.OUTCOME),
  ];
  const durations = stageDurations(events, new Date(T0 + 7 * DAY));
  assert.equal(durations.get('tech1'), 7);
});

test('the final open stage runs to the journey close time', () => {
  const events = [at(0, EVENT_TYPES.ENTERED, 'offer')];
  const durations = stageDurations(events, new Date(T0 + 5 * DAY));
  assert.equal(durations.get('offer'), 5);
});

test('a journey that never entered a stage yields no duration', () => {
  // Skipped rather than measured from whatever event happens to be first:
  // attributing a note's timestamp to a stage is a wrong number, and a
  // missing one is honest.
  const durations = stageDurations([at(0, EVENT_TYPES.NOTE)], new Date(T0 + 9 * DAY));
  assert.equal(durations.size, 0);
});

test('durations are never negative when events arrive out of order', () => {
  const events = [at(5, EVENT_TYPES.ENTERED), at(2, EVENT_TYPES.OUTCOME)];
  const durations = stageDurations(events, new Date(T0 + 5 * DAY));
  assert.ok(durations.get('tech1') >= 0);
});

// ── Staleness clock ─────────────────────────────────────────────────────────

test('notes do not reset the stuck clock', () => {
  // A 40-day-stalled candidate who got a scorecard email today must still
  // read as 40 days stuck.
  const journey = {
    current_stage_key: 'tech1',
    created_at: new Date(T0),
    rpa_pipeline_stage_events: [
      at(0, EVENT_TYPES.ENTERED),
      at(40, EVENT_TYPES.NOTE),
    ],
  };
  assert.equal(new Date(stageClockStart(journey)).getTime(), T0);
  assert.equal(lastTransitionOf(journey).event_type, EVENT_TYPES.ENTERED);
});

test('the clock starts at the entry to the CURRENT stage', () => {
  const journey = {
    current_stage_key: 'tech2',
    created_at: new Date(T0),
    rpa_pipeline_stage_events: [
      at(0, EVENT_TYPES.ENTERED, 'tech1'),
      at(4, EVENT_TYPES.OUTCOME, 'tech1'),
      at(4, EVENT_TYPES.ENTERED, 'tech2'),
      at(9, EVENT_TYPES.NOTE, 'tech2'),
    ],
  };
  assert.equal(new Date(stageClockStart(journey)).getTime(), T0 + 4 * DAY);
});

test('a journey with only notes falls back to created_at, never modified_at', () => {
  // modified_at is bumped by non-transition writes, which is the same
  // "activity looks like movement" bug one level down.
  const journey = {
    current_stage_key: 'tech1',
    created_at: new Date(T0),
    modified_at: new Date(T0 + 30 * DAY),
    rpa_pipeline_stage_events: [at(30, EVENT_TYPES.NOTE)],
  };
  assert.equal(new Date(stageClockStart(journey)).getTime(), T0);
});

test('lastTransitionOf returns null when a journey has no transitions', () => {
  assert.equal(lastTransitionOf({ rpa_pipeline_stage_events: [] }), null);
  assert.equal(lastTransitionOf({}), null);
});

// ── Conversion buckets ──────────────────────────────────────────────────────

test('every journey lands in exactly one bucket', () => {
  const journeys = [
    { final_outcome: FINAL_OUTCOMES.JOINED },
    { final_outcome: FINAL_OUTCOMES.APPROVED },
    { final_outcome: FINAL_OUTCOMES.REJECTED },
    { final_outcome: FINAL_OUTCOMES.ON_HOLD },
    { final_outcome: FINAL_OUTCOMES.BACKED_OUT },
    { final_outcome: null, current_stage_status: STAGE_OUTCOMES.HOLD },
    { final_outcome: null, current_stage_status: STAGE_OUTCOMES.REJECTED },
    { final_outcome: null, current_stage_status: STAGE_OUTCOMES.APPROVED },
    { final_outcome: null, current_stage_status: null },
  ];

  const counts = { hired: 0, rejected: 0, on_hold: 0, in_progress: 0, closed_other: 0 };
  for (const j of journeys) {
    const bucket = bucketFor(j);
    assert.ok(bucket in counts, `unexpected bucket "${bucket}"`);
    counts[bucket] += 1;
  }

  // The invariant the source-of-hire rate depends on: the parts sum to the whole.
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  assert.equal(total, journeys.length);

  assert.equal(counts.hired, 2);        // joined + approved
  assert.equal(counts.rejected, 2);     // closed rejection + live rejection
  assert.equal(counts.on_hold, 2);      // closed hold + live hold
  assert.equal(counts.closed_other, 1); // backed out
  assert.equal(counts.in_progress, 2);  // approved-at-stage and untouched are both still live
});

test('a closed journey ignores its live stage status', () => {
  // Once closed, the last stage status is irrelevant — otherwise a rejected
  // journey could be counted as in-progress too.
  assert.equal(
    bucketFor({ final_outcome: FINAL_OUTCOMES.REJECTED, current_stage_status: STAGE_OUTCOMES.APPROVED }),
    'rejected'
  );
});

test('joined_and_left does not count as a hire', () => {
  // Counting it would flatter whoever sourced a candidate who did not stay.
  assert.ok(!HIRED_OUTCOMES.includes(FINAL_OUTCOMES.JOINED_AND_LEFT));
  assert.equal(bucketFor({ final_outcome: FINAL_OUTCOMES.JOINED_AND_LEFT }), 'closed_other');
});

test('every hired outcome is a real final outcome', () => {
  // A typo would silently never match a closed journey, so the hire rate
  // would read 0% forever with no runtime error.
  const all = Object.values(FINAL_OUTCOMES);
  for (const outcome of HIRED_OUTCOMES) {
    assert.ok(all.includes(outcome), `"${outcome}" is not in FINAL_OUTCOMES`);
  }
});
