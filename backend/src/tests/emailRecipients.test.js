/**
 * Unit tests for the non-production email guards (no network, no DB writes).
 * Run: npm run test:unit
 *
 * These cover the ONE rule that matters most in this codebase: no candidate is
 * ever emailed — by us or by anything we hand their address to — outside
 * production.
 *
 * Like emailHelpers.test.js, importing these modules loads config from .env, so
 * `redirectInNonProd` is whatever the local environment says. Every assertion
 * branches on it rather than assuming a value, so the suite is meaningful when
 * run against a staging-shaped env AND against a production-shaped one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import config from '../config/index.js';
import { resolveRecipients, nonProdSafeCandidateEmail } from '../config/emailRecipients.js';
import { SILENT_FINAL_OUTCOMES } from '../services/stageNotification.service.js';

const REDIRECTS = config.email.redirectInNonProd;
const TEST_INBOX = config.email.testRecipients;
const FIRST_TEST_INBOX = (TEST_INBOX || '').split(',')[0].trim();

const CANDIDATE = 'a.real.candidate@example.com';

/**
 * Flows that deliberately bypass the redirect. Mirrors NEVER_REDIRECT ∪
 * OPERATOR_ADDRESSED in config/emailRecipients.js — kept as a literal list here
 * on purpose, so that widening either set in the source fails this test and
 * forces a second pair of eyes on it.
 */
const BYPASS_FLOWS = [
  'resumeErrorAlert',
  'rerankApiAlert',
  'backendErrorAlert',
  'userCredentialUpdate',
  'passwordReset',
  'interviewScheduledPanel',
  'interviewCancelledPanel',
  'scorecardInvite',
  'occurrenceNudge',
];

/** Every candidate-facing flow that must be redirected outside production. */
const CANDIDATE_FLOWS = [
  'welcome',
  'missingData',
  'shortlistCc',
  'interviewScheduled',
  'interviewCancelled',
  'documentRequest',
  'rejection',
  'onHold',
  'manualReply',
  'stageOutcome',
];

// ── resolveRecipients: the redirect rule ──────────────────────────────

for (const flow of CANDIDATE_FLOWS) {
  test(`resolveRecipients("${flow}") protects the candidate outside production`, () => {
    const { to, cc } = resolveRecipients(flow, CANDIDATE);
    if (REDIRECTS) {
      assert.equal(to, TEST_INBOX, `${flow} must go to the test inbox in non-prod`);
      assert.equal(cc, '', `${flow} must carry no cc in non-prod`);
      assert.ok(!to.includes(CANDIDATE), `${flow} leaked the candidate address`);
    } else {
      assert.equal(to, CANDIDATE, `${flow} must reach the real candidate in production`);
    }
  });
}

for (const flow of BYPASS_FLOWS) {
  test(`resolveRecipients("${flow}") reaches its real recipient in every environment`, () => {
    const { to } = resolveRecipients(flow, 'someone@aapnainfotech.com');
    assert.notEqual(to, '', `${flow} resolved to an empty recipient`);
    // A bypass flow with a dynamic value must return that value, not the inbox.
    if (REDIRECTS) {
      assert.notEqual(
        to,
        TEST_INBOX,
        `${flow} is in the bypass set but was redirected to the test inbox`
      );
    }
  });
}

test('an unknown flow key falls back to the test inbox rather than a real address', () => {
  const { to, cc } = resolveRecipients('flowThatDoesNotExist', CANDIDATE);
  assert.equal(to, config.email.testRecipients);
  assert.equal(cc, '');
});

test('a dynamic flow with no runtime value does not fall through to the candidate', () => {
  const { to } = resolveRecipients('stageOutcome', '');
  if (REDIRECTS) {
    assert.equal(to, TEST_INBOX);
  } else {
    // In production an empty dynamic value falls back to the static `to`,
    // which for these flows is deliberately blank — callers must skip the send.
    assert.equal(to, '');
  }
});

// ── nonProdSafeCandidateEmail: the hand-off guard ─────────────────────

test('nonProdSafeCandidateEmail substitutes the test inbox outside production', () => {
  const result = nonProdSafeCandidateEmail(CANDIDATE, 'unit-test');
  if (REDIRECTS) {
    assert.equal(result, FIRST_TEST_INBOX);
    assert.notEqual(result, CANDIDATE);
  } else {
    assert.equal(result, CANDIDATE);
  }
});

test('nonProdSafeCandidateEmail returns a single address, never a list', () => {
  const result = nonProdSafeCandidateEmail(CANDIDATE, 'unit-test');
  assert.ok(!result.includes(','), 'a calendar attendee / API payload needs one address');
});

test('nonProdSafeCandidateEmail fails CLOSED when no test inbox is configured', () => {
  // Only meaningful while the redirect is on; in production there is nothing to
  // substitute and the real address is the correct answer.
  if (!REDIRECTS) return;

  const original = config.email.testRecipients;
  try {
    config.email.testRecipients = '';
    assert.throws(
      () => nonProdSafeCandidateEmail(CANDIDATE, 'unit-test'),
      /no safe substitute address/i,
      'a blank test inbox must abort, never fall through to the real candidate'
    );
  } finally {
    config.email.testRecipients = original;
  }
});

test('nonProdSafeCandidateEmail is stable — schedule and cancel resolve alike', () => {
  // The Zeko cancel call must target the same address the schedule call sent,
  // or the booking Zeko actually holds is never cancelled.
  assert.equal(
    nonProdSafeCandidateEmail(CANDIDATE, 'zeko:schedule'),
    nonProdSafeCandidateEmail(CANDIDATE, 'zeko:cancel')
  );
});

// ── Closure-email suppression ─────────────────────────────────────────

test('closure outcomes that record a fact do not email the candidate', () => {
  for (const outcome of ['joined', 'joined_and_left', 'backed_out', 'did_not_join', 'candidate_withdrawn']) {
    assert.ok(SILENT_FINAL_OUTCOMES.has(outcome), `${outcome} must be silent`);
  }
});

test('closure outcomes that are real decisions still email the candidate', () => {
  for (const outcome of ['closure_approved', 'closure_rejected', 'closure_on_hold']) {
    assert.ok(!SILENT_FINAL_OUTCOMES.has(outcome), `${outcome} must not be silenced`);
  }
});

test('per-stage outcomes are never caught by the closure silence list', () => {
  for (const outcome of ['approved', 'rejected', 'hold', 'future_prospect']) {
    assert.ok(!SILENT_FINAL_OUTCOMES.has(outcome), `${outcome} is a stage outcome, not a closure`);
  }
});
