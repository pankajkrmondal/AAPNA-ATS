/**
 * A Zeko round must never show the OTHER Zeko round's score.
 * Run: node --test src/tests/unit/zekoRoundScoreScoping.test.js
 *
 * rpa_cv holds ONE set of Zeko score columns per CANDIDATE ("ZekoInterviewScore"
 * etc.), and both Zeko rounds write to them, so a value there carries no record
 * of which round produced it. Both the drawer (as a fallback) and the board card
 * (directly) used to read it. On 2026-08-25 PANKAJ MONDAL's Functional Screening
 * therefore displayed the HR round's 95 for an interview that had never been
 * scheduled — and because the drawer hides the "Schedule Interview" button once a
 * score is present, the round could not be progressed at all.
 *
 * Both now resolve scores the same two-step way: the round's OWN booking
 * (rpa_zeko_candidate_pipeline, keyed by shortlist_id + 'hr'/'functional') names
 * its external interview id, and the candidate's own address picks their row out
 * of that interview's roster.
 *
 * Pure unit test — no database, no network.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { emailCandidates } from '../../utils/emailMatch.js';
import { normalizeZekoRoundStage } from '../../config/pipelineStages.js';

/**
 * The predicate both fixed call sites encode: this journey's round has a
 * booking of its own, and that booking's interview carries a synced score for
 * this candidate.
 */
function readyForDecision(journey, bookings, results) {
  const round = normalizeZekoRoundStage(journey.current_stage_key);
  const booking = bookings.find(
    (b) => b.candidate_id === journey.shortlist_id && b.stage === round && b.status !== 'cancelled'
  );
  if (!booking) return false;
  const wanted = new Set(emailCandidates(booking.candidate_email));
  if (wanted.size === 0) return false;
  return results.some(
    (r) => r.pipeline_id === booking.pipeline_id
      && emailCandidates(r.candidate_email).some((e) => wanted.has(e))
      && (r.scores_overallscore != null || r.scores_technicalscore != null || r.scores_communicationscore != null)
  );
}

// The real staging shape from the 2026-08-25 report.
const JOURNEY_FN = { shortlist_id: 998, current_stage_key: 'zeko_fn' };
const JOURNEY_HR = { shortlist_id: 998, current_stage_key: 'zeko_hr' };
const HR_BOOKING = {
  candidate_id: 998,
  stage: 'hr',
  status: 'completed',
  pipeline_id: '69c13f5958e23da6db09f270',
  candidate_email: 'pankaj.mondal@example.com,aiuserpankajmondal@gmail.com',
};
const HR_RESULT = {
  pipeline_id: '69c13f5958e23da6db09f270',
  candidate_email: 'aiuserpankajmondal@gmail.com',
  scores_overallscore: 95,
  scores_technicalscore: null,
  scores_communicationscore: null,
};

describe('Zeko per-round score scoping', () => {
  test('the HR round shows its own score', () => {
    assert.equal(readyForDecision(JOURNEY_HR, [HR_BOOKING], [HR_RESULT]), true);
  });

  test('the functional round does NOT inherit the HR score when nothing is booked', () => {
    // The reported bug: one booking, and it is the HR round's.
    assert.equal(readyForDecision(JOURNEY_FN, [HR_BOOKING], [HR_RESULT]), false);
  });

  test('a booked-but-unsynced functional round still shows no score', () => {
    // Why gating on "this round has a booking" alone was not enough: the HR
    // score must not reappear the moment the functional interview is booked.
    const fnBooking = {
      candidate_id: 998, stage: 'functional', status: 'sent',
      pipeline_id: 'FN-INTERVIEW-ID', candidate_email: HR_BOOKING.candidate_email,
    };
    assert.equal(readyForDecision(JOURNEY_FN, [HR_BOOKING, fnBooking], [HR_RESULT]), false);
  });

  test('the functional round shows its own score once one syncs', () => {
    const fnBooking = {
      candidate_id: 998, stage: 'functional', status: 'completed',
      pipeline_id: 'FN-INTERVIEW-ID', candidate_email: HR_BOOKING.candidate_email,
    };
    const fnResult = {
      pipeline_id: 'FN-INTERVIEW-ID', candidate_email: 'aiuserpankajmondal@gmail.com',
      scores_overallscore: 80, scores_technicalscore: 75, scores_communicationscore: 70,
    };
    assert.equal(readyForDecision(JOURNEY_FN, [HR_BOOKING, fnBooking], [HR_RESULT, fnResult]), true);
    // …and the HR round keeps its own, unchanged.
    assert.equal(readyForDecision(JOURNEY_HR, [HR_BOOKING, fnBooking], [HR_RESULT, fnResult]), true);
  });

  test('a cancelled booking for this round does not count', () => {
    const cancelled = { ...HR_BOOKING, stage: 'functional', status: 'cancelled', pipeline_id: 'FN-INTERVIEW-ID' };
    const fnResult = { pipeline_id: 'FN-INTERVIEW-ID', candidate_email: 'aiuserpankajmondal@gmail.com', scores_overallscore: 80 };
    assert.equal(readyForDecision(JOURNEY_FN, [cancelled], [fnResult]), false);
  });

  test("another candidate's row on the same shared interview is never picked up", () => {
    // One Zeko interview id is shared by every candidate booked against the job.
    const stranger = { ...HR_RESULT, candidate_email: 'someone.else@example.com' };
    assert.equal(readyForDecision(JOURNEY_HR, [HR_BOOKING], [stranger]), false);
  });

  test('a result row with no numeric scores is not "ready for decision"', () => {
    const empty = { ...HR_RESULT, scores_overallscore: null, scores_technicalscore: null, scores_communicationscore: null };
    assert.equal(readyForDecision(JOURNEY_HR, [HR_BOOKING], [empty]), false);
  });

  test('no address on file means no guess', () => {
    const noEmail = { ...HR_BOOKING, candidate_email: null };
    assert.equal(readyForDecision(JOURNEY_HR, [noEmail], [HR_RESULT]), false);
  });
});
