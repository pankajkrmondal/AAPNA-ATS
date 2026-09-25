/**
 * Unit tests for the reminder cron's eligibility rules (no network, no DB).
 * Run: node --test src/tests/reminderEligibility.test.js
 *
 * These guard the production defect behind "Link inactive or invalid —
 * already processed" (MRF-Approval-Unified-Fix-Plan.md §1, Defect 2): the cron
 * re-sent the MRF approval request, live Approve buttons and all, after the
 * MRF had been decided, and "reminded" outcome / HR-notify / alert emails
 * whose reference_id merely collided with an rpa_mrf id.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Pure module on purpose: importing reminderScheduler.js would pull in prisma
// and the email service, whose connections keep `node --test` alive.
import {
  CANDIDATE_DATA_EMAIL_TYPE,
  MRF_HM_EMAIL_TYPE,
  MRF_APPROVAL_REQUEST_EMAIL_TYPE,
  LEGACY_MRF_APPROVAL_COPY_EMAIL_TYPE,
  MRF_APPROVAL_LOG_TYPES,
  REMINDABLE_EMAIL_TYPES,
  isOpenApprovalStatus,
  isOpenHmRequest,
  reminderSkipReason,
} from '../jobs/reminderEligibility.js';

const approvalRow = (status, extra = {}) => ({
  id: 1,
  email_type: MRF_APPROVAL_REQUEST_EMAIL_TYPE,
  reference_id: 9,
  mrf_exists_id: 9n,
  mrf_approval_status: status,
  ...extra,
});

const hmRow = (mrfstatus, mrfId = null, extra = {}) => ({
  id: 2,
  email_type: MRF_HM_EMAIL_TYPE,
  reference_id: 18,
  mrf_request_exists_id: 18n,
  mrf_request_status: mrfstatus,
  mrf_request_mrf_id: mrfId,
  ...extra,
});

test('the whitelist is exactly: candidate data request, HM request, approval request', () => {
  assert.deepEqual([...REMINDABLE_EMAIL_TYPES].sort(), [
    CANDIDATE_DATA_EMAIL_TYPE,
    MRF_APPROVAL_REQUEST_EMAIL_TYPE,
    MRF_HM_EMAIL_TYPE,
  ].sort());
});

test('approval request is reminded only while the MRF is pending/waiting (case- and space-insensitive)', () => {
  for (const s of ['pending', 'waiting', 'PENDING', ' Waiting ']) {
    assert.equal(reminderSkipReason(approvalRow(s)), null, `should remind for "${s}"`);
    assert.equal(isOpenApprovalStatus(s), true);
  }
});

test('approval request is closed once the MRF is decided — the MRF #9 / #6-8 defect', () => {
  for (const s of ['approved', 'rejected', 'completed', 'closed', 'Approved', '', null]) {
    const reason = reminderSkipReason(approvalRow(s));
    assert.ok(reason, `must NOT remind for status "${s}"`);
    assert.match(reason, /already decided/);
  }
});

test('approval request for a deleted MRF is closed', () => {
  assert.match(reminderSkipReason(approvalRow('pending', { mrf_exists_id: null })), /does not exist/);
});

test('legacy mrf_approval (HM copy, external writer) is never reminded but is closed at decision time', () => {
  assert.ok(!REMINDABLE_EMAIL_TYPES.includes(LEGACY_MRF_APPROVAL_COPY_EMAIL_TYPE));
  assert.ok(reminderSkipReason({ email_type: LEGACY_MRF_APPROVAL_COPY_EMAIL_TYPE, mrf_exists_id: 9n, mrf_approval_status: 'pending' }));
  assert.deepEqual([...MRF_APPROVAL_LOG_TYPES].sort(), [LEGACY_MRF_APPROVAL_COPY_EMAIL_TYPE, MRF_APPROVAL_REQUEST_EMAIL_TYPE].sort());
});

test('HM request is reminded while not yet submitted (blank, null, pending, pendingfromleader)', () => {
  for (const s of ['pending', 'pendingfromleader', '', null, 'PENDING']) {
    assert.equal(reminderSkipReason(hmRow(s)), null, `should remind for mrfstatus "${s}"`);
  }
});

test('HM request is closed once the HM submitted (status moved on, or an MRF is linked)', () => {
  for (const s of ['managersubmitted', 'approved', 'rejected']) {
    assert.match(reminderSkipReason(hmRow(s)), /already submitted/);
  }
  assert.match(reminderSkipReason(hmRow('pending', 9)), /already submitted/);
  assert.equal(isOpenHmRequest({ mrfstatus: 'pending', mrf_id: 9 }), false);
});

test('HM request whose rpa_mrf_jd_send row is missing is closed', () => {
  assert.match(reminderSkipReason(hmRow('pending', null, { mrf_request_exists_id: null })), /does not exist/);
});

test('candidate data request needs an existing candidate AND a portal token', () => {
  const base = { email_type: CANDIDATE_DATA_EMAIL_TYPE, reference_id: 5, candidate_exists_id: 5n, cvMissingToken: 'abc' };
  assert.equal(reminderSkipReason(base), null);
  assert.match(reminderSkipReason({ ...base, candidate_exists_id: null }), /does not exist/);
  assert.match(reminderSkipReason({ ...base, cvMissingToken: null }), /cvMissingToken/);
});

test('notifications and alerts are never remindable, even when a matching MRF exists', () => {
  const neverRemind = [
    'mrf_approved', 'mrf_declined', 'mrf_submit_hr', LEGACY_MRF_APPROVAL_COPY_EMAIL_TYPE,
    'welcome', 'data_collection', 'duplicate_alert', 'user_created', 'user_password_changed',
    'password_reset_request', 'backend_error_alert',
  ];
  for (const type of neverRemind) {
    assert.ok(!REMINDABLE_EMAIL_TYPES.includes(type), `${type} must not be whitelisted`);
    const reason = reminderSkipReason({ email_type: type, reference_id: 9, mrf_exists_id: 9n, mrf_approval_status: 'pending' });
    assert.ok(reason, `${type} must not be reminded`);
  }
});
