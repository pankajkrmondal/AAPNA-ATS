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
  timeToHireFor,
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

// ── Time-to-hire ────────────────────────────────────────────────────────────
//
// A third silent-wrongness class, fixed 2026-08-26. The headline was
// sum(per-stage averages), each average over a DIFFERENT population — a
// candidate rejected at Tech-1 sits in Tech-1's average and no other — published
// as "Average days, shortlist to offer". Adding those together mixes cohorts and
// yields a duration no candidate's journey ever matched.

/** A journey `days` long that closed with `outcome`. */
const hire = (days, outcome = FINAL_OUTCOMES.JOINED) => ({
  final_outcome: outcome,
  created_at: new Date(T0),
  closed_at: new Date(T0 + days * DAY),
  rpa_pipeline_stage_events: [],
});

test('time-to-hire reports null, never 0, when nothing has been hired', () => {
  // The old panel rendered a confident "0 days" over an empty set. A zero that
  // means "no data" is indistinguishable from a zero that means "instant".
  const result = timeToHireFor([], []);
  assert.equal(result.median_days, null);
  assert.equal(result.sample_size, 0);

  // Same when journeys exist but none of them closed as a hire.
  const openOnly = timeToHireFor([
    { final_outcome: null, current_stage_status: null, created_at: new Date(T0), rpa_pipeline_stage_events: [] },
    hire(30, FINAL_OUTCOMES.REJECTED),
  ], []);
  assert.equal(openOnly.median_days, null);
  assert.equal(openOnly.sample_size, 0);
});

test('one slow requisition does not drag the time-to-hire figure', () => {
  // The reason this is a median and not a mean. Hiring sets are small and
  // long-tailed; the mean here is 47.6 days, which describes none of the five.
  const result = timeToHireFor([hire(10), hire(12), hire(14), hire(2), hire(200)], []);
  assert.equal(result.sample_size, 5);
  assert.equal(result.median_days, 12);
});

test('an even number of hires averages the two middle journeys', () => {
  const result = timeToHireFor([hire(10), hire(20), hire(30), hire(40)], []);
  assert.equal(result.median_days, 25);
});

test('only hired journeys count toward time-to-hire', () => {
  // Rejected and withdrawn journeys have no hire date, so including them would
  // measure "time to any outcome" under a label promising something else.
  // joined_and_left is excluded for the same reason bucketFor excludes it.
  const result = timeToHireFor([
    hire(10, FINAL_OUTCOMES.JOINED),
    hire(100, FINAL_OUTCOMES.REJECTED),
    hire(100, FINAL_OUTCOMES.JOINED_AND_LEFT),
    hire(100, FINAL_OUTCOMES.BACKED_OUT),
    hire(20, FINAL_OUTCOMES.APPROVED),
  ], []);
  assert.equal(result.sample_size, 2);
  assert.equal(result.median_days, 15);
});

test('a stage that takes minutes reports 0d instead of disappearing', () => {
  // The old `avg_days > 0` filter deleted exactly the stages performing best:
  // anything averaging under 0.05 days rounded to 0 and was dropped from the
  // list, so a fast stage looked like a stage nobody had ever entered.
  const stages = [
    { stage_key: 'tech1', label: 'Tech 1' },
    { stage_key: 'hr', label: 'HR' },
  ];
  const journeys = [{
    final_outcome: FINAL_OUTCOMES.JOINED,
    created_at: new Date(T0),
    closed_at: new Date(T0 + 5 * DAY),
    rpa_pipeline_stage_events: [
      at(0, EVENT_TYPES.ENTERED, 'tech1'),
      // Approved 10 minutes later — a real duration, just a very small one.
      at(10 / (60 * 24), EVENT_TYPES.ENTERED, 'hr'),
    ],
  }];

  const result = timeToHireFor(journeys, stages);
  const tech1 = result.stages.find((s) => s.stage_key === 'tech1');
  assert.ok(tech1, 'a fast stage must still be listed');
  assert.equal(tech1.avg_days, 0);
  assert.equal(tech1.sample_size, 1);
});

test('every stage row carries the sample size its average rests on', () => {
  // Without it, a stage averaged over one journey reads exactly like a stage
  // averaged over two hundred.
  const stages = [{ stage_key: 'tech1', label: 'Tech 1' }];
  const journeys = [
    {
      final_outcome: FINAL_OUTCOMES.JOINED,
      created_at: new Date(T0),
      closed_at: new Date(T0 + 4 * DAY),
      rpa_pipeline_stage_events: [at(0, EVENT_TYPES.ENTERED, 'tech1'), at(2, EVENT_TYPES.OUTCOME, 'tech1')],
    },
    {
      final_outcome: FINAL_OUTCOMES.REJECTED,
      created_at: new Date(T0),
      closed_at: new Date(T0 + 8 * DAY),
      rpa_pipeline_stage_events: [at(0, EVENT_TYPES.ENTERED, 'tech1'), at(6, EVENT_TYPES.OUTCOME, 'tech1')],
    },
  ];

  const result = timeToHireFor(journeys, stages);
  const tech1 = result.stages.find((s) => s.stage_key === 'tech1');
  // Per-stage rows span ALL closed journeys, hired or not — wider than the
  // headline on purpose, or most stages would have a sample of nearly nothing.
  assert.equal(tech1.sample_size, 2);
  assert.equal(tech1.avg_days, 4); // (2 + 6) / 2

  // ...while the headline still counts only the one hire.
  assert.equal(result.sample_size, 1);
  assert.equal(result.median_days, 4);
});

test('an open journey contributes no stage durations', () => {
  // Its current stage has not ended, so measuring it would report a stage
  // duration that is really "time so far" — and shrink every average.
  const stages = [{ stage_key: 'tech1', label: 'Tech 1' }];
  const result = timeToHireFor([{
    final_outcome: null,
    current_stage_status: null,
    created_at: new Date(T0),
    rpa_pipeline_stage_events: [at(0, EVENT_TYPES.ENTERED, 'tech1')],
  }], stages);
  assert.deepEqual(result.stages, []);
});

// ── Positions tab (N39) ─────────────────────────────────────────────────────

const POS_STAGES = [
  { stage_key: 'zeko_hr', label: 'HR Screening', sort_order: 20 },
  { stage_key: 'assessment', label: 'Assessment', sort_order: 30 },
  { stage_key: 'tech1', label: 'Tech 1', sort_order: 50 },
];
const posMrf = (id, over = {}) => ({
  id: BigInt(id), position_hiring_for: `Role ${id}`, number_of_positions: 2,
  created_at: new Date(T0), decided_at: new Date(T0 + 2 * DAY),
  filled_at: null, closed_at: null, closure_reason: null, paused_at: null, approval_status: 'approved',
  ...over,
});
const posJourney = (mrfId, arrivals, over = {}) => ({
  mrf_id: BigInt(mrfId),
  current_stage_key: arrivals[arrivals.length - 1] || 'zeko_hr',
  current_stage_status: 'in_progress',
  final_outcome: null,
  rpa_offers: null,
  rpa_pipeline_stage_events: arrivals.map((k, i) => at(i, EVENT_TYPES.ENTERED, k)),
  ...over,
});

test('positionsOverview groups journeys by MRF and counts stage arrivals', async () => {
  const { positionsOverview } = await import('../services/pipelineAnalytics.helpers.js');
  const rows = positionsOverview([
    posJourney(1, ['zeko_hr']),
    posJourney(1, ['zeko_hr', 'assessment', 'tech1']),
    posJourney(2, ['zeko_hr', 'assessment']),
  ], [posMrf(1), posMrf(2)], POS_STAGES, T0 + 12 * DAY);
  const [one, two] = rows;
  assert.equal(one.shortlisted, 2);
  assert.deepEqual(one.stage_counts, { zeko_hr: 2, assessment: 1, tech1: 1 });
  assert.equal(one.moved_forward, 1, 'only the journey that got past the first stage');
  assert.equal(one.days_open, 10, 'from decided_at, not created_at');
  assert.equal(one.ref, 'MRF-1');
  assert.equal(two.shortlisted, 1);
  assert.equal(two.moved_forward, 1);
});

test('positionsOverview: joining ratio is joined ÷ accepted, null with no acceptances', async () => {
  const { positionsOverview } = await import('../services/pipelineAnalytics.helpers.js');
  const accepted = { candidate_decision: 'accepted' };
  const [row] = positionsOverview([
    posJourney(1, ['zeko_hr'], { rpa_offers: accepted, final_outcome: FINAL_OUTCOMES.JOINED }),
    posJourney(1, ['zeko_hr'], { rpa_offers: accepted, final_outcome: FINAL_OUTCOMES.DID_NOT_JOIN }),
    posJourney(1, ['zeko_hr'], { rpa_offers: { candidate_decision: 'rejected' } }),
  ], [posMrf(1)], POS_STAGES);
  assert.equal(row.offers_made, 3);
  assert.equal(row.offers_accepted, 2);
  assert.equal(row.joined, 1);
  assert.equal(row.joining_ratio, 50);
  assert.equal(row.in_pipeline, 1);

  const [none] = positionsOverview([posJourney(1, ['zeko_hr'])], [posMrf(1)], POS_STAGES);
  assert.equal(none.joining_ratio, null, 'no acceptances is "no ratio", never 0%');
});

test('positionsOverview: a journey with no arrival events falls back to its current stage', async () => {
  const { positionsOverview } = await import('../services/pipelineAnalytics.helpers.js');
  const [row] = positionsOverview([
    posJourney(1, [], { current_stage_key: 'assessment', rpa_pipeline_stage_events: [] }),
  ], [posMrf(1)], POS_STAGES);
  assert.deepEqual(row.stage_counts, { zeko_hr: 1, assessment: 1, tech1: 0 });
  assert.equal(row.moved_forward, 1);
});

test('positionsOverview: an MRF with no candidates still gets a row of zeros', async () => {
  const { positionsOverview } = await import('../services/pipelineAnalytics.helpers.js');
  const [row] = positionsOverview([], [posMrf(9)], POS_STAGES);
  assert.equal(row.shortlisted, 0);
  assert.equal(row.joining_ratio, null);
  assert.deepEqual(row.stage_counts, { zeko_hr: 0, assessment: 0, tech1: 0 });
});

test('positionStatus: Filled, Closed, Paused, Open; days open stop at closure', async () => {
  const { positionStatus, positionsOverview } = await import('../services/pipelineAnalytics.helpers.js');
  assert.equal(positionStatus(posMrf(1)), 'Open');
  assert.equal(positionStatus(posMrf(1, { paused_at: new Date() })), 'Paused');
  assert.equal(positionStatus(posMrf(1, { filled_at: new Date() })), 'Filled');
  assert.equal(positionStatus(posMrf(1, { closed_at: new Date(), closure_reason: 'all_openings_filled' })), 'Filled');
  assert.equal(positionStatus(posMrf(1, { closed_at: new Date(), closure_reason: 'budget_withdrawn' })), 'Closed');
  const [row] = positionsOverview([], [posMrf(1, { closed_at: new Date(T0 + 7 * DAY), closure_reason: 'budget_withdrawn' })], POS_STAGES, T0 + 100 * DAY);
  assert.equal(row.days_open, 5);
  assert.equal(row.closure_reason, 'budget_withdrawn');
});

test('positions CSV: one column per stage, status filter matches the tab', async () => {
  const { positionsColumns, positionsCsvRows, filterPositions } = await import('../exports/positions.export.js');
  const cols = positionsColumns(POS_STAGES);
  assert.ok(cols.some((c) => c.key === 'stage_tech1' && c.header === 'Reached: Tech 1'));
  const [flat] = positionsCsvRows([{ ref: 'MRF-1', stage_counts: { tech1: 3 }, opened_at: new Date('2026-10-07T10:00:00Z'), closed_at: null }]);
  assert.equal(flat.stage_tech1, 3);
  assert.equal(flat.opened_at, '2026-10-07');
  const rows = [{ status: 'Open' }, { status: 'Paused' }, { status: 'Filled' }, { status: 'Closed' }];
  assert.equal(filterPositions(rows, 'open').length, 2);
  assert.equal(filterPositions(rows, 'closed').length, 2);
  assert.equal(filterPositions(rows, 'all').length, 4);
});
