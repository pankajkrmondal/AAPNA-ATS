/**
 * Which rpa_email_log rows the reminder cron (reminderScheduler.js) may follow
 * up on, and when it must stop.
 *
 * Kept free of prisma/redis imports on purpose so `node --test` can load it
 * (see tests/reminderEligibility.test.js).
 *
 * WHY THIS EXISTS (2026-09-24)
 * ----------------------------
 * The cron used to pick up EVERY log row with responded_at IS NULL, joined to
 * rpa_mrf for any type other than 'missing_jd', and never looked at the state
 * of the thing it was chasing. Nothing sets responded_at when an MRF is
 * decided or a hiring manager submits, so:
 *
 *   - approvers kept getting "Reminder (1/3): New MRF Request - Approval
 *     Request" — with the original Approve/Reject buttons — after the MRF was
 *     already approved, and landed on "already processed" (MRF #9, reported by
 *     the CEO);
 *   - hiring managers kept getting "please fill the MRF" after submitting;
 *   - outcome / HR-notify / welcome / password mails got "please take action"
 *     reminders whenever their reference_id happened to equal some rpa_mrf.id.
 */

/** Candidate missing-details request (legacy n8n type name). */
export const CANDIDATE_DATA_EMAIL_TYPE = 'missing_jd';

/** MRF form request to the hiring manager. reference_id = rpa_mrf_jd_send.id. */
export const MRF_HM_EMAIL_TYPE = 'mrf_hm';

/**
 * MRF approval request to the approvers. reference_id = rpa_mrf.id.
 * 'mrf_approval' is the legacy n8n name, kept so rows it wrote still resolve.
 */
export const MRF_APPROVAL_EMAIL_TYPES = ['mrf_approval_request', 'mrf_approval'];

/**
 * The only email types that ask the recipient to DO something, and so the only
 * ones worth a reminder. Everything else (notifications, alerts, outcome mails,
 * welcome mails, password mails) is never reminded.
 */
export const REMINDABLE_EMAIL_TYPES = [
  CANDIDATE_DATA_EMAIL_TYPE,
  MRF_HM_EMAIL_TYPE,
  ...MRF_APPROVAL_EMAIL_TYPES,
];

// Same "still awaiting a decision" set handleMrfApproval() accepts.
const OPEN_APPROVAL_STATUSES = ['pending', 'waiting'];

// Same "HM has not submitted yet" set as mrfStatusLabel() in exports/mrf.export.js.
const OPEN_MRF_REQUEST_STATUSES = ['', 'pending', 'pendingfromleader'];

const norm = (v) => String(v ?? '').trim().toLowerCase();

export const isMrfApprovalEmailType = (emailType) => MRF_APPROVAL_EMAIL_TYPES.includes(emailType);

/** True while an rpa_mrf row is still awaiting approve/reject. */
export const isOpenApprovalStatus = (status) => OPEN_APPROVAL_STATUSES.includes(norm(status));

/**
 * Decide whether a pending log row should get its reminder.
 *
 * @param {object} row - one row of the reminder query: the rpa_email_log
 *   columns plus the joined candidate_exists_id / cvMissingToken,
 *   mrf_exists_id / mrf_approval_status, and mrf_request_exists_id /
 *   mrf_request_status / mrf_request_mrf_id.
 * @returns {string|null} null to send the reminder; otherwise why not. The
 *   caller closes the row (sets responded_at) so it is never picked up again.
 */
export function reminderSkipReason(row) {
  const { email_type: type, reference_id: refId } = row;

  if (type === CANDIDATE_DATA_EMAIL_TYPE) {
    if (!row.candidate_exists_id) return `referenced candidate ID ${refId} does not exist`;
    // Never build a portal link with an empty token — the portal rejects it
    // ("Access token is missing").
    if (!row.cvMissingToken) return `candidate ID ${refId} has no cvMissingToken; cannot build a valid portal link`;
    return null;
  }

  if (type === MRF_HM_EMAIL_TYPE) {
    if (!row.mrf_request_exists_id) return `referenced MRF request ID ${refId} does not exist`;
    if (row.mrf_request_mrf_id || !OPEN_MRF_REQUEST_STATUSES.includes(norm(row.mrf_request_status))) {
      return `hiring manager has already submitted MRF request ID ${refId} (mrfstatus=${row.mrf_request_status})`;
    }
    return null;
  }

  if (isMrfApprovalEmailType(type)) {
    if (!row.mrf_exists_id) return `referenced MRF ID ${refId} does not exist`;
    if (!isOpenApprovalStatus(row.mrf_approval_status)) {
      return `MRF ID ${refId} is already decided (approval_status=${row.mrf_approval_status})`;
    }
    return null;
  }

  // The query already filters to REMINDABLE_EMAIL_TYPES; this is the backstop.
  return `email type "${type}" does not ask for a response`;
}
