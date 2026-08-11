/**
 * Unit tests for the MRF close/re-open outcome rules (no network, no DB).
 * Run: npm run test:unit
 *
 * These guard ONE invariant: which journey closures free the opening a
 * candidate was holding. Getting that list wrong is silent and expensive in
 * both directions —
 *   too narrow  -> a requisition stays closed after a hire falls through, and
 *                  the role disappears from JD filtering with no in-app way back;
 *   too wide    -> a successful hire re-opens its own requisition.
 *
 * The list itself is asserted rather than the DB behaviour because the risk is
 * a future edit adding a fifth outcome and wiring it into only one of the two
 * paths that consume it (offer.service.js's decision reversal and
 * pipeline.service.js's setFinalOutcome) — which is exactly how these drifted
 * apart before.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Both come from pure config on purpose: importing the closure SERVICE here
// would pull in Redis and the socket layer, whose module-level connections
// keep the process alive and hang `node --test`.
import {
  FINAL_OUTCOMES,
  VACATING_OUTCOMES,
  isMrfFilled,
  LEGACY_MRF_CLOSED_STATUS,
} from '../config/pipelineStages.js';

const ALL_FINAL = Object.values(FINAL_OUTCOMES);

test('every vacating outcome is a real final outcome', () => {
  // A typo here would never match a stored final_outcome, so the seat would
  // silently never be freed — the failure is invisible at runtime.
  for (const outcome of VACATING_OUTCOMES) {
    assert.ok(
      ALL_FINAL.includes(outcome),
      `"${outcome}" is not a value in FINAL_OUTCOMES — it can never match a closed journey`
    );
  }
});

test('the four fall-through closures free the opening', () => {
  for (const outcome of [
    FINAL_OUTCOMES.BACKED_OUT,
    FINAL_OUTCOMES.DID_NOT_JOIN,
    FINAL_OUTCOMES.JOINED_AND_LEFT,
    FINAL_OUTCOMES.CANDIDATE_WITHDRAWN,
  ]) {
    assert.ok(
      VACATING_OUTCOMES.includes(outcome),
      `${outcome} means the candidate is not in the seat — it must free the opening`
    );
  }
});

test('a successful hire does NOT free the opening', () => {
  // offerSweep.js's 90-day auto-close records JOINED. If that ever became a
  // vacating outcome, every hire who actually started would silently re-open
  // the requisition they filled.
  assert.ok(
    !VACATING_OUTCOMES.includes(FINAL_OUTCOMES.JOINED),
    'JOINED must keep holding the opening — the person is in the job'
  );
});

test('generic stage closures do not free an opening', () => {
  // These close a single candidate's journey; they say nothing about whether
  // an accepted offer is still standing, so they must not disturb the count.
  for (const outcome of [
    FINAL_OUTCOMES.APPROVED,
    FINAL_OUTCOMES.REJECTED,
    FINAL_OUTCOMES.ON_HOLD,
  ]) {
    assert.ok(
      !VACATING_OUTCOMES.includes(outcome),
      `${outcome} is a per-candidate closure and must not free a requisition opening`
    );
  }
});

test('the vacating list has no duplicates and is frozen', () => {
  assert.equal(new Set(VACATING_OUTCOMES).size, VACATING_OUTCOMES.length);
  assert.ok(Object.isFrozen(VACATING_OUTCOMES), 'the list is shared across services — it must not be mutable');
});

// ── isMrfFilled: "approved" and "filled" are independent ──────────────
//
// Fill state used to be expressed by overwriting approval_status to 'closed'
// and restoring a hardcoded 'approved' on re-open. That destroyed the real
// value: 'completed' is the most common status and getApprovedRoles() gates it
// on approved_by_abhijit, so a completed requisition came back as plain
// 'approved' and escaped that gate permanently. Fill state now lives in
// rpa_mrf.filled_at and these assert the two never get conflated again.

test('a requisition with filled_at set is filled', () => {
  assert.equal(isMrfFilled({ approval_status: 'completed', filled_at: new Date() }), true);
  assert.equal(isMrfFilled({ approval_status: 'approved', filled_at: '2026-08-11T00:00:00Z' }), true);
});

test('an approved or completed requisition is NOT filled just by its status', () => {
  // The whole point: status says nothing about whether the openings are gone.
  for (const status of ['approved', 'completed', 'waiting', 'pending', 'rejected']) {
    assert.equal(
      isMrfFilled({ approval_status: status, filled_at: null }),
      false,
      `${status} with filled_at null must read as still hiring`
    );
  }
});

test('legacy rows closed by the old lossy path still read as filled', () => {
  // Pre-migration rows carry approval_status='closed' and (after backfill) a
  // filled_at. Either signal alone must be enough, or they would silently
  // return to JD filtering.
  assert.equal(isMrfFilled({ approval_status: LEGACY_MRF_CLOSED_STATUS, filled_at: null }), true);
  assert.equal(isMrfFilled({ approval_status: LEGACY_MRF_CLOSED_STATUS, filled_at: new Date() }), true);
});

test('isMrfFilled is null-safe', () => {
  // Keyword shortlists carry no MRF at all.
  assert.equal(isMrfFilled(null), false);
  assert.equal(isMrfFilled(undefined), false);
  assert.equal(isMrfFilled({}), false);
});
