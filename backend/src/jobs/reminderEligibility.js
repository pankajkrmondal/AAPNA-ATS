/**
 * Which rpa_email_log rows the reminder cron may remind, and when it must stop.
 *
 * Pure module — no prisma / redis imports — so `node --test` can load it.
 * It is the single source of truth for reminderScheduler.js (the SQL whitelist
 * and the per-row decision) and for handleMrfApproval (which log rows to close
 * the moment an MRF is decided).
 *
 * Why this exists (MRF-Approval-Unified-Fix-Plan.md §1, Defect 2): the cron used
 * to remind ANY log row whose reference_id happened to match an rpa_mrf.id, and
 * nothing closed the approval request once the MRF was decided. Production sent
 * approvers "Reminder (n/2): New MRF Request - Approval Request" — the original
 * email, same still-valid token, live Approve buttons — days after MRFs 6, 7 and
 * 8 were already approved, and also "reminded" outcome, HR-notify and alert
 * emails.
 */

/** Candidate missing-data request (legacy n8n name). reference_id = rpa_cv.id */
export const CANDIDATE_DATA_EMAIL_TYPE = 'missing_jd';

/** "Please fill the MRF" request to the hiring manager. reference_id = rpa_mrf_jd_send.id — NOT rpa_mrf.id. */
export const MRF_HM_EMAIL_TYPE = 'mrf_hm';

/** Approval request to the approvers (Approve / Reject buttons). reference_id = rpa_mrf.id */
export const MRF_APPROVAL_REQUEST_EMAIL_TYPE = 'mrf_approval_request';

/**
 * "MRF Approval Required_<role>" copy of the MRF sent to the hiring manager /
 * submitter. Written by a process OUTSIDE this codebase (likely the legacy n8n
 * workflow). It is not addressed to the approvers, so it is never reminded
 * (plan R4) — but it is closed together with the approval request once the MRF
 * is decided.
 */
export const LEGACY_MRF_APPROVAL_COPY_EMAIL_TYPE = 'mrf_approval';

/** Log rows that belong to an MRF's approval step; all are closed at decision time. */
export const MRF_APPROVAL_LOG_TYPES = Object.freeze([
  MRF_APPROVAL_REQUEST_EMAIL_TYPE,
  LEGACY_MRF_APPROVAL_COPY_EMAIL_TYPE,
]);

/** The ONLY email types the cron may remind. Everything else is never selected. */
export const REMINDABLE_EMAIL_TYPES = Object.freeze([
  CANDIDATE_DATA_EMAIL_TYPE,
  MRF_HM_EMAIL_TYPE,
  MRF_APPROVAL_REQUEST_EMAIL_TYPE,
]);

const norm = (v) => String(v ?? '').trim().toLowerCase();

/** Approval statuses that still await a decision — the same set handleMrfApproval accepts. */
const OPEN_APPROVAL_STATUSES = new Set(['pending', 'waiting']);

/**
 * rpa_mrf_jd_send.mrfstatus values meaning the HM has not submitted yet.
 * Blank counts as pending, mirroring mrfStatusLabel() in exports/mrf.export.js.
 */
const OPEN_HM_REQUEST_STATUSES = new Set(['', 'pending', 'pendingfromleader']);

/** True while an MRF still awaits an approve/reject decision. */
export function isOpenApprovalStatus(status) {
  return OPEN_APPROVAL_STATUSES.has(norm(status));
}

/** True while the hiring manager has not yet submitted the MRF form for this request. */
export function isOpenHmRequest({ mrfstatus, mrf_id } = {}) {
  return (mrf_id === null || mrf_id === undefined) && OPEN_HM_REQUEST_STATUSES.has(norm(mrfstatus));
}

/**
 * Decide whether a selected log row should be reminded.
 *
 * @param {object} row — an rpa_email_log row plus the join columns selected by
 *   reminderScheduler.js: candidate_exists_id, cvMissingToken, mrf_exists_id,
 *   mrf_approval_status, mrf_request_exists_id, mrf_request_status, mrf_request_mrf_id,
 *   and for personal approval links approval_token_id / _revoked_at /
 *   _revoked_reason / _used_at / _expires_at.
 * @param {number} [now] epoch ms, for tests
 * @returns {string|null} null = send the reminder; otherwise the reason the row
 *   is closed without one.
 */
export function reminderSkipReason(row, now = Date.now()) {
  switch (row?.email_type) {
    case CANDIDATE_DATA_EMAIL_TYPE:
      if (!row.candidate_exists_id) return `referenced candidate ID ${row.reference_id} does not exist`;
      // Never build a portal link with an empty token — the portal rejects it.
      if (!row.cvMissingToken) return `candidate ID ${row.reference_id} has no cvMissingToken; cannot build a valid portal link`;
      return null;

    case MRF_HM_EMAIL_TYPE:
      if (!row.mrf_request_exists_id) return `referenced MRF request ID ${row.reference_id} does not exist`;
      if (!isOpenHmRequest({ mrfstatus: row.mrf_request_status, mrf_id: row.mrf_request_mrf_id })) {
        return `hiring manager already submitted (mrfstatus "${row.mrf_request_status ?? ''}", mrf_id ${row.mrf_request_mrf_id ?? 'null'})`;
      }
      return null;

    case MRF_APPROVAL_REQUEST_EMAIL_TYPE:
      if (!row.mrf_exists_id) return `referenced MRF ID ${row.reference_id} does not exist`;
      if (!isOpenApprovalStatus(row.mrf_approval_status)) {
        return `MRF already decided (approval_status "${row.mrf_approval_status}")`;
      }
      // Personal link (audit trail): the reminder re-sends THAT approver's
      // email, so it is only useful while their link can still be used.
      if (row.approval_token_id) {
        if (row.approval_token_revoked_at) return `approval link was revoked${row.approval_token_revoked_reason ? ` (${row.approval_token_revoked_reason})` : ''}`;
        if (row.approval_token_used_at) return 'approval link was already used';
        if (row.approval_token_expires_at && new Date(row.approval_token_expires_at).getTime() <= now) return 'approval link has expired';
      }
      return null;

    default:
      // Backstop only: the SQL whitelist already excludes these.
      return `email type "${row?.email_type}" is never reminded`;
  }
}
