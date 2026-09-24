/**
 * Unit tests for the reminder cron's eligibility rules (no network, no DB).
 * Run: npm run test:unit
 *
 * These guard the MRF #9 bug (2026-09-24): the cron re-sent the approval
 * request — Approve/Reject buttons included — after the MRF was already
 * approved, so the CEO landed on "already processed". It also reminded
 * hiring managers who had already submitted, and "reminded" pure
 * notifications whose reference_id happened to equal an rpa_mrf id.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  REMINDABLE_EMAIL_TYPES,
  isOpenApprovalStatus,
  reminderSkipReason,
} from '../jobs/reminderEligibility.js';

const approvalRow = (status, extra = {}) => ({
  id: 1,
  email_type: 'mrf_approval_request',
  reference_id: 9,
  mrf_exists_id: 9n,
  mrf_approval_status: status,
  ...extra,
});

const hmRow = (mrfstatus, extra = {}) => ({
  id: 2,
  email_type: 'mrf_hm',
  reference_id: 14,
  mrf_request_exists_id: 14n,
  mrf_request_status: mrfstatus,
  mrf_request_mrf_id: null,
  ...extra,
});

test('approval reminder is sent only while the MRF is still awaiting a decision', () => {
  for (const status of ['pending', 'waiting', 'Pending', ' WAITING ']) {
    assert.equal(reminderSkipReason(approvalRow(status)), null, `"${status}" should still be reminded`);
  }
  for (const status of ['approved', 'rejected', 'completed', 'closed', 'APPROVED']) {
    assert.match(reminderSkipReason(approvalRow(status)), /already decided/, `"${status}" must not be reminded`);
  }
});

test('legacy n8n "mrf_approval" rows follow the same rule', () => {
  assert.equal(reminderSkipReason(approvalRow('pending', { email_type: 'mrf_approval' })), null);
  assert.match(reminderSkipReason(approvalRow('approved', { email_type: 'mrf_approval' })), /already decided/);
});

test('approval reminder for a deleted MRF is closed', () => {
  assert.match(reminderSkipReason(approvalRow('pending', { mrf_exists_id: null })), /does not exist/);
});

test('isOpenApprovalStatus matches the set handleMrfApproval accepts', () => {
  assert.equal(isOpenApprovalStatus('pending'), true);
  assert.equal(isOpenApprovalStatus('waiting'), true);
  assert.equal(isOpenApprovalStatus('approved'), false);
  assert.equal(isOpenApprovalStatus(null), false);
});

test('hiring-manager reminder stops once the MRF form is submitted', () => {
  for (const status of ['pending', 'pendingfromleader', '', null]) {
    assert.equal(reminderSkipReason(hmRow(status)), null, `mrfstatus "${status}" should still be reminded`);
  }
  for (const status of ['managersubmitted', 'manager submitted', 'approved', 'rejected', 'closed']) {
    assert.match(reminderSkipReason(hmRow(status)), /already submitted/, `mrfstatus "${status}" must not be reminded`);
  }
  // A linked rpa_mrf means the HM submitted, whatever the status column says.
  assert.match(reminderSkipReason(hmRow('pending', { mrf_request_mrf_id: 9 })), /already submitted/);
});

test('hiring-manager reminder for a deleted request is closed', () => {
  assert.match(reminderSkipReason(hmRow('pending', { mrf_request_exists_id: null })), /does not exist/);
});

test('candidate missing-details reminder needs the candidate and a portal token', () => {
  const row = { id: 3, email_type: 'missing_jd', reference_id: 5, candidate_exists_id: 5n, cvMissingToken: 'tok' };
  assert.equal(reminderSkipReason(row), null);
  assert.match(reminderSkipReason({ ...row, candidate_exists_id: null }), /does not exist/);
  assert.match(reminderSkipReason({ ...row, cvMissingToken: null }), /no cvMissingToken/);
});

test('notifications and alerts are never reminded', () => {
  const neverRemind = [
    'mrf_approved', 'mrf_declined', 'mrf_submit_hr', 'welcome', 'data_collection',
    'password_reset_request', 'user_created', 'duplicate_alert', 'backend_error_alert',
  ];
  for (const type of neverRemind) {
    assert.ok(!REMINDABLE_EMAIL_TYPES.includes(type), `"${type}" must not be in REMINDABLE_EMAIL_TYPES`);
    // Even with a matching MRF row (the old reference_id collision), the backstop refuses it.
    assert.match(
      reminderSkipReason({ id: 4, email_type: type, reference_id: 9, mrf_exists_id: 9n, mrf_approval_status: 'pending' }),
      /does not ask for a response/
    );
  }
});
