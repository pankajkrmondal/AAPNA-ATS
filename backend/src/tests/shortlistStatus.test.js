/**
 * Unit tests for shortlistStatusFor() — the map from a stage or closure outcome
 * onto rpa_shortlisted_candidates.pipeline_status (no network, no DB).
 * Run: npm run test:unit
 *
 * This function acquired the 8 closure outcomes on 2026-08-26
 * (docs/PHASE3-CLOSURE-AUDIT-2026-08-26.md §2.4). Until then setFinalOutcome
 * wrote only rpa_cv.FinalStatus, so a candidate closed as `joined` still read
 * `pipeline_status = 'shortlisted'` forever, inflating the dashboard shortlist
 * tile, the recruiter leaderboard and the screening badges with people whose
 * journey was over.
 *
 * Two failure modes are guarded here, both silent — the numbers still render,
 * they are just wrong:
 *
 *   1. BUCKETS. Three readers switch on this column's values and must sum to
 *      their total (candidateCounts in screening.service.js, groupByRole() in
 *      exports/screening.export.js, the roleStats memo in Analytics.jsx). A
 *      value with no bucket lands in `total` and in none of the others, and the
 *      strip stops adding up. That has already happened once, with
 *      'future_prospect'. All three now end in a catch-all `closed` branch, so
 *      what this file guards is the other half of that contract: that the map
 *      cannot produce a value outside SHORTLIST_STATUSES, and that every
 *      closure value it does produce is one the rollup calls terminal.
 *
 *   2. COOLING-OFF. screening.service.js selects the Q11 6-month
 *      re-application cooldown list on `pipeline_status = 'rejected'`. Routing
 *      a withdrawal or a no-join through 'rejected' would silently bar a
 *      candidate from re-applying for six months on the strength of a decision
 *      they made themselves. Only a real rejection may map there.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FINAL_OUTCOMES,
  STAGE_OUTCOMES,
  HIRED_OUTCOMES,
  VACATING_OUTCOMES,
  SHORTLIST_STATUSES,
  TERMINAL_SHORTLIST_STATUSES,
  shortlistStatusFor,
} from '../config/pipelineStages.js';

const ALL_SHORTLIST_STATUSES = new Set(Object.values(SHORTLIST_STATUSES));

test('every stage outcome still maps as it did before closure was added', () => {
  assert.equal(shortlistStatusFor(STAGE_OUTCOMES.APPROVED), 'shortlisted');
  assert.equal(shortlistStatusFor(STAGE_OUTCOMES.REJECTED), 'rejected');
  assert.equal(shortlistStatusFor(STAGE_OUTCOMES.HOLD), 'on_hold');
  assert.equal(shortlistStatusFor(STAGE_OUTCOMES.FUTURE_PROSPECT), 'future_prospect');
});

test('all 8 closure outcomes map to something — none falls through to null', () => {
  // The §2.4 bug in one assertion: before the fix every one of these returned
  // null, and setFinalOutcome therefore skipped the write entirely.
  for (const outcome of Object.values(FINAL_OUTCOMES)) {
    const status = shortlistStatusFor(outcome);
    assert.notEqual(status, null, `closure outcome ${outcome} maps to nothing`);
  }
});

test('nothing maps outside SHORTLIST_STATUSES — the three count strips stay whole', () => {
  const everyOutcome = [...Object.values(STAGE_OUTCOMES), ...Object.values(FINAL_OUTCOMES)];
  for (const outcome of everyOutcome) {
    const status = shortlistStatusFor(outcome);
    assert.ok(
      ALL_SHORTLIST_STATUSES.has(status),
      `${outcome} maps to "${status}", which has no bucket in the count strips`
    );
  }
});

test('the hire outcomes map to hired, matching HIRED_OUTCOMES exactly', () => {
  // Derived from HIRED_OUTCOMES rather than restated: a third definition of
  // "this was a hire" is how the two MRF-vacating paths drifted apart before.
  for (const outcome of HIRED_OUTCOMES) {
    assert.equal(shortlistStatusFor(outcome), SHORTLIST_STATUSES.HIRED, `${outcome} should read as hired`);
  }
  // JOINED_AND_LEFT is not a hire and must not land in the hired bucket.
  assert.notEqual(shortlistStatusFor(FINAL_OUTCOMES.JOINED_AND_LEFT), SHORTLIST_STATUSES.HIRED);
});

test('only a real rejection maps to "rejected" — withdrawals never enter the Q11 cooldown', () => {
  assert.equal(shortlistStatusFor(FINAL_OUTCOMES.REJECTED), SHORTLIST_STATUSES.REJECTED);

  // The four vacating outcomes are exits, not rejections. Mapping any of them
  // to 'rejected' would enter the candidate into the 6-month re-application
  // cooling-off, which is exactly the harm §2.1 describes recruiters causing
  // by hand when closure was unreachable outside the Offer stage.
  for (const outcome of VACATING_OUTCOMES) {
    assert.notEqual(
      shortlistStatusFor(outcome),
      SHORTLIST_STATUSES.REJECTED,
      `${outcome} must not start a Q11 cooling-off`
    );
  }
});

test('the closure exits stay individually legible rather than rolling into one value', () => {
  // Decision, 2026-08-26 (§6a): distinct values in the column. A report can
  // then tell a backed-out offer from a candidate who never turned up without
  // going back to rpa_candidate_pipeline.final_outcome. The count strips roll
  // them up; the column does not.
  assert.equal(shortlistStatusFor(FINAL_OUTCOMES.CANDIDATE_WITHDRAWN), SHORTLIST_STATUSES.WITHDRAWN);
  assert.equal(shortlistStatusFor(FINAL_OUTCOMES.BACKED_OUT), SHORTLIST_STATUSES.BACKED_OUT);
  assert.equal(shortlistStatusFor(FINAL_OUTCOMES.DID_NOT_JOIN), SHORTLIST_STATUSES.DID_NOT_JOIN);
  assert.equal(shortlistStatusFor(FINAL_OUTCOMES.JOINED_AND_LEFT), SHORTLIST_STATUSES.JOINED_AND_LEFT);

  const exits = [
    shortlistStatusFor(FINAL_OUTCOMES.CANDIDATE_WITHDRAWN),
    shortlistStatusFor(FINAL_OUTCOMES.BACKED_OUT),
    shortlistStatusFor(FINAL_OUTCOMES.DID_NOT_JOIN),
    shortlistStatusFor(FINAL_OUTCOMES.JOINED_AND_LEFT),
  ];
  assert.equal(new Set(exits).size, exits.length, 'the four exits must not collapse onto each other');
});

test('every terminal status is listed in TERMINAL_SHORTLIST_STATUSES', () => {
  // The count strips roll these into one `closed` column via a final else. If a
  // closure outcome ever maps to a value missing from this list, the rollup and
  // the column disagree about what "closed" means.
  for (const outcome of Object.values(FINAL_OUTCOMES)) {
    const status = shortlistStatusFor(outcome);
    if (status === SHORTLIST_STATUSES.REJECTED || status === SHORTLIST_STATUSES.ON_HOLD) continue;
    assert.ok(
      TERMINAL_SHORTLIST_STATUSES.includes(status),
      `${outcome} maps to "${status}", which is not listed as terminal`
    );
  }
});

test('closure_on_hold keeps the existing on_hold vocabulary rather than adding a value', () => {
  assert.equal(shortlistStatusFor(FINAL_OUTCOMES.ON_HOLD), SHORTLIST_STATUSES.ON_HOLD);
});

test('an unrecognised outcome still maps to null rather than inventing a status', () => {
  assert.equal(shortlistStatusFor('not_a_real_outcome'), null);
  assert.equal(shortlistStatusFor(undefined), null);
  assert.equal(shortlistStatusFor(null), null);
});
