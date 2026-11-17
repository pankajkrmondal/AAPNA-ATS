/**
 * The rules behind U08's tracked Zeko link (/api/z/<token>) and the Zeko
 * expiry reminder. Pure: no database, no network, so every decision here is
 * unit-tested (tests/unit/zekoLinkModel.test.js).
 *
 * Our Zeko email used to link straight to the JOB's Zeko page, the same URL
 * for every candidate. It now links to /api/z/<link_token>, one token per
 * booking (rpa_zeko_candidate_pipeline.link_token), so we can ask a candidate
 * with no phone on file for one before they go on to Zeko.
 */
import { normalisePhone } from './phone.js';
import { contactKey, prependUnique, splitContacts } from './contactMerge.js';
import { isShareToken } from './recordingShareModel.js';

/**
 * The number hrUpload.service.js writes when an upload has no phone
 * (its PLACEHOLDER_CONTACT, not exported). Never a real number.
 */
export const PHONE_PLACEHOLDER = '9876543210';

/** Zeko attemptStatus values that mean "has not taken the test yet". */
export const REMINDABLE_ATTEMPT_STATUSES = Object.freeze(['scheduled', 'notAttempted']);

/** Our statuses for a round that has a result (analytics also counts passed/failed). */
const DONE_STATUSES = new Set(['completed', 'passed', 'failed']);

/** A link token is a uuid; anything else is refused before the database is asked. */
export const isZekoLinkToken = (token) => isShareToken(token);

/**
 * The candidate's first real mobile number, or null. The upload placeholder
 * counts as no number.
 *
 * @param {string|null|undefined} contactNumber - rpa_cv.ContactNumber (a list)
 * @returns {string|null} 10 digits
 */
export function usablePhone(contactNumber) {
  return normalisePhone(contactNumber).find((p) => p !== PHONE_PLACEHOLDER) || null;
}

/**
 * A number typed on the /zeko-start page, as 10 digits, or null when it is not
 * an Indian mobile number. Accepts "+91 98765 43210", "098765-43210" and the
 * like; refuses a second number, a landline-length value and the placeholder.
 *
 * @param {unknown} input
 * @returns {string|null}
 */
export function parseCandidatePhone(input) {
  const raw = String(input ?? '').trim();
  if (!raw || raw.length > 20 || /[,;/]/.test(raw)) return null;
  let digits = raw.replace(/[^0-9]/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (!/^[6-9][0-9]{9}$/.test(digits)) return null;
  return digits === PHONE_PLACEHOLDER ? null : digits;
}

/**
 * The stored phone list with the new number first and the placeholder dropped
 * (it was only ever standing in for "no number").
 *
 * @param {string|null|undefined} existing - rpa_cv.ContactNumber
 * @param {string} tenDigits - from parseCandidatePhone()
 * @returns {string}
 */
export function mergeCandidatePhone(existing, tenDigits) {
  const kept = splitContacts(existing, 'phone').filter((p) => contactKey(p, 'phone') !== PHONE_PLACEHOLDER);
  return prependUnique(kept.join(', '), tenDigits, 'phone');
}

/**
 * Where one booking's link stands right now.
 *
 * @param {{status?: string|null, cancelled_at?: Date|string|null, completed_at?: Date|string|null,
 *   interview_end_at?: Date|string|null}|null} row - the rpa_zeko_candidate_pipeline row
 * @param {Date} [now]
 * @returns {'open'|'expired'|'cancelled'|'completed'|'not_scheduled'|'not_found'}
 */
export function zekoLinkState(row, now = new Date()) {
  if (!row) return 'not_found';
  const status = String(row.status || '').toLowerCase();
  if (row.cancelled_at || status === 'cancelled') return 'cancelled';
  if (row.completed_at || DONE_STATUSES.has(status)) return 'completed';
  if (status !== 'sent') return 'not_scheduled';
  if (row.interview_end_at && new Date(row.interview_end_at).getTime() <= now.getTime()) return 'expired';
  return 'open';
}

/**
 * What GET /api/z/:token does: straight to Zeko when the window is open and we
 * either have a phone or have no CV to store one on; the /zeko-start page for
 * everything else (it asks for a phone, or explains why the link is closed).
 *
 * @param {{state: string, zekoUrl: string|null, hasCv: boolean, phone: string|null}} input
 * @returns {'zeko'|'page'}
 */
export function decideZekoRedirect({ state, zekoUrl, hasCv, phone }) {
  if (state !== 'open' || !zekoUrl) return 'page';
  return phone || !hasCv ? 'zeko' : 'page';
}

/** The job's own Zeko page (what the email linked to before U08). */
export function zekoJobUrl(slug, interviewLinkBase) {
  return slug && interviewLinkBase ? `${interviewLinkBase}/${slug}` : null;
}

/** Our tracked link, or null when the backend has no public address. */
export function zekoTrackedUrl(token, publicBaseUrl) {
  return token && publicBaseUrl ? `${publicBaseUrl}/api/z/${token}` : null;
}

/**
 * The link a candidate email carries: the tracked one when PUBLIC_BASE_URL is
 * set, otherwise the job's Zeko page as before.
 *
 * @param {{token?: string|null, slug?: string|null, publicBaseUrl?: string, interviewLinkBase?: string}} input
 * @returns {string|null}
 */
export function zekoCandidateLink({ token, slug, publicBaseUrl, interviewLinkBase }) {
  return zekoTrackedUrl(token, publicBaseUrl) || zekoJobUrl(slug, interviewLinkBase);
}

/** "Priya" from "Priya Sharma"; '' when there is no name. */
export function firstName(fullName) {
  return String(fullName ?? '').trim().split(/\s+/)[0] || '';
}

/**
 * Whether a booking is due its expiry reminder, before Zeko is asked whether
 * the candidate has attempted it.
 *
 * @param {object} row - pipeline row plus `final_outcome`, `is_paused` of the latest journey
 * @param {{now?: Date, leadHours: number}} opts
 * @returns {{eligible: boolean, reason: string}}
 */
export function reminderEligibility(row, { now = new Date(), leadHours }) {
  const no = (reason) => ({ eligible: false, reason });
  if (row.reminded_at) return no('already_reminded');
  const state = zekoLinkState(row, now);
  if (state !== 'open') return no(state);
  if (!row.interview_end_at) return no('no_window');
  const end = new Date(row.interview_end_at).getTime();
  const leadMs = leadHours * 3_600_000;
  if (end - now.getTime() > leadMs) return no('not_due');
  const startAt = row.interview_start_at || row.link_sent_at;
  // A window no longer than the lead time would be reminded about the moment it
  // opened, alongside the invite itself.
  if (!startAt || end - new Date(startAt).getTime() <= leadMs) return no('window_too_short');
  if (row.final_outcome) return no('journey_closed');
  if (row.is_paused) return no('journey_paused');
  return { eligible: true, reason: 'due' };
}

/**
 * What Zeko's answer means for the reminder.
 *
 * @param {{found: boolean, attemptStatus?: string|null}} check
 * @returns {'remind'|'attempted'|'not_found'}
 */
export function attemptVerdict(check) {
  if (!check?.found) return 'not_found';
  return REMINDABLE_ATTEMPT_STATUSES.includes(check.attemptStatus) ? 'remind' : 'attempted';
}

/**
 * The Zeko interview id to ask about. A row booked before scheduleInterview()
 * corrected it still holds the JOB id as a placeholder; the job's primary
 * interview is the right one then.
 */
export function reminderInterviewId(row) {
  if (row.pipeline_id && row.pipeline_id !== row.zeko_job_id) return row.pipeline_id;
  return row.primary_interview_id || null;
}

/**
 * A per-run Zeko attempt checker (zeko.service.js createZekoAttemptChecker()
 * wires in the real cookie, fetch and matcher). The cookie is resolved once, on
 * the first call, and each interview's roster is fetched once however many of
 * its candidates are checked.
 *
 * @param {object} deps
 * @param {() => Promise<string>} deps.getCookie
 * @param {(cookie: string, jobId: string, interviewId: string) => Promise<{responses: object[]}>} deps.fetchResponses
 * @param {(responses: object[], email: string) => object|null} deps.findEntry
 * @returns {(q: {jobId: string, interviewId: string, candidateEmail: string}) =>
 *   Promise<{found: boolean, attemptStatus: string|null}>}
 */
export function createAttemptChecker({ getCookie, fetchResponses, findEntry }) {
  let cookie = null;
  const byInterview = new Map();
  return async function checkAttempt({ jobId, interviewId, candidateEmail }) {
    if (!cookie) cookie = getCookie();
    const header = await cookie;
    let fetched = byInterview.get(interviewId);
    if (!fetched) {
      fetched = fetchResponses(header, jobId, interviewId);
      byInterview.set(interviewId, fetched);
    }
    const { responses } = await fetched;
    const entry = findEntry(responses || [], candidateEmail);
    return entry ? { found: true, attemptStatus: entry.attemptStatus ?? null } : { found: false, attemptStatus: null };
  };
}

export default {
  createAttemptChecker,
  PHONE_PLACEHOLDER,
  REMINDABLE_ATTEMPT_STATUSES,
  isZekoLinkToken,
  usablePhone,
  parseCandidatePhone,
  mergeCandidatePhone,
  zekoLinkState,
  decideZekoRedirect,
  zekoJobUrl,
  zekoTrackedUrl,
  zekoCandidateLink,
  firstName,
  reminderEligibility,
  attemptVerdict,
  reminderInterviewId,
};
