/**
 * graphAttendance.service.js — reads Microsoft Teams attendance reports to
 * decide whether a scheduled interview actually happened, before the
 * interviewer scorecard link is ever released.
 *
 * WHY: a booking whose scheduled_end_at has passed is NOT proof the interview
 * occurred — the candidate may have no-showed, the panel may have been pulled
 * away, or the call may have failed. Teams attendance is the one strong,
 * automatic signal for "did it happen?". See
 * docs/phase3/INTERVIEWER-SCORECARD-PLAN.md.
 *
 * Gated on config.microsoft.attendanceEnabled because this needs consent the
 * rest of the Graph integration does not have:
 *   - OnlineMeetingArtifact.Read.All (application permission), AND
 *   - an application access policy (Set-CsApplicationAccessPolicy) authorizing
 *     the app to read meetings on behalf of the calendar mailbox (attendance
 *     reports are only visible to the organizer).
 *
 * Every export is best-effort and NEVER throws to its caller: when attendance
 * can't be read (disabled, no report yet, 403), the caller falls back to human
 * confirmation, so a scorecard is still never sent for an unconfirmed
 * interview. `getAttendanceOutcome` returns decided:false in that case.
 */
import config from '../config/index.js';
import logger from '../config/logger.js';
import { getAccessToken } from './onedrive.service.js';
import { parseInterviewerEmails } from './interviewSchedule.service.js';
import { resolveUserId } from './graphCalendar.service.js';
import { decideOccurrence, pickAttendanceReport } from './graphAttendance.helpers.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/** Whether Teams attendance auto-detection is switched on for this environment. */
export const isAttendanceEnabled = () => Boolean(config.microsoft.attendanceEnabled);

/** Whether the candidate is expected to join as a guest (no matchable address). */
export const isGuestCandidateMode = () => Boolean(config.microsoft.attendanceGuestCandidate);

/** The organizer mailbox whose onlineMeetings/attendance we query. */
const organizerMailbox = () => config.microsoft.calendarMailbox;

/**
 * Looks up the Teams onlineMeeting id for a booking that stored only a join URL
 * (e.g. an older booking created before online_meeting_id was captured).
 *
 * @param {string} joinUrl - rpa_interview_schedule.teams_join_url
 * @returns {Promise<string|null>} the onlineMeeting id, or null
 */
export async function resolveOnlineMeetingId(joinUrl) {
  if (!isAttendanceEnabled() || !joinUrl) return null;
  try {
    const token = await getAccessToken();
    // onlineMeetings requires the mailbox's object GUID in the path (a UPN 400s).
    const userId = await resolveUserId(organizerMailbox());
    if (!userId) return null;
    // JoinWebUrl must be single-quoted in the OData filter; the value is a
    // Graph-issued URL with no quotes of its own, so no extra escaping needed.
    const url = `${GRAPH_BASE}/users/${encodeURIComponent(userId)}/onlineMeetings?$filter=JoinWebUrl eq '${joinUrl}'`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      logger.warn(`Graph attendance: onlineMeeting lookup failed (${res.status}) — ${body?.error?.message || res.statusText}.`);
      return null;
    }
    const data = await res.json();
    return data?.value?.[0]?.id || null;
  } catch (err) {
    logger.warn(`Graph attendance: onlineMeeting lookup threw — ${err.message}.`);
    return null;
  }
}

/**
 * Fetches the attendance records for a meeting: lists the reports, takes the
 * most recent, then reads it in full (the list endpoint returns empty
 * attendanceRecords by design).
 *
 * Which report is chosen matters: a reschedule reuses the same Teams meeting, so
 * one id can hold several reports. pickAttendanceReport() keeps only ones whose
 * session overlaps this booking's window, so a stale session can never be ruled
 * on as if it were this one.
 *
 * @param {string} onlineMeetingId
 * @param {object} [window] - { windowStart, windowEnd } of the booking
 * @returns {Promise<Array<{email: string, seconds: number}>|null>} records, or
 *   null when unreadable (disabled / 403 / no report yet).
 */
async function fetchAttendanceRecords(onlineMeetingId, window = {}) {
  if (!isAttendanceEnabled() || !onlineMeetingId) return null;
  try {
    const token = await getAccessToken();
    // onlineMeetings requires the mailbox's object GUID in the path (a UPN 400s).
    const userId = await resolveUserId(organizerMailbox());
    if (!userId) return null;
    const base = `${GRAPH_BASE}/users/${encodeURIComponent(userId)}/onlineMeetings/${encodeURIComponent(onlineMeetingId)}/attendanceReports`;

    const listRes = await fetch(base, { headers: { Authorization: `Bearer ${token}` } });
    if (!listRes.ok) {
      const body = await listRes.json().catch(() => ({}));
      // 403 here almost always means OnlineMeetingArtifact.Read.All or the
      // application access policy is missing.
      logger.warn(`Graph attendance: report list failed (${listRes.status}) — ${body?.error?.message || listRes.statusText}.`);
      return null;
    }
    const list = await listRes.json();
    const reports = list?.value || [];
    if (reports.length === 0) {
      // No report yet — the meeting may not have ended, or none was generated.
      return [];
    }

    // The report for THIS booking's session, not simply the newest one.
    const report = pickAttendanceReport(reports, window);
    if (!report) {
      logger.info(`Graph attendance: ${reports.length} report(s) on meeting ${onlineMeetingId}, none covering this booking's window — treating as not yet available.`);
      return [];
    }
    const reportId = report.id;
    const detailRes = await fetch(`${base}/${encodeURIComponent(reportId)}?$expand=attendanceRecords`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!detailRes.ok) {
      const body = await detailRes.json().catch(() => ({}));
      logger.warn(`Graph attendance: report detail failed (${detailRes.status}) — ${body?.error?.message || detailRes.statusText}.`);
      return null;
    }
    const detail = await detailRes.json();
    return (detail?.attendanceRecords || []).map((r) => ({
      email: (r?.emailAddress || '').toLowerCase(),
      seconds: Number(r?.totalAttendanceInSeconds || 0),
    }));
  } catch (err) {
    logger.warn(`Graph attendance: fetch threw — ${err.message}.`);
    return null;
  }
}

/**
 * Decides whether an interview OCCURRED from its Teams attendance report.
 *
 * The rule itself lives in decideOccurrence() (graphAttendance.helpers.js) —
 * pure and unit-tested. In short: candidates join as guests and so carry no
 * matchable address, which makes the interviewer the only reliable identity, so
 * "occurred" is the interviewer plus at least one other participant. See that
 * function for the reasoning and for strict mode.
 *
 * @param {object} scheduleRow - rpa_interview_schedule row (needs
 *   online_meeting_id | teams_join_url, interviewer_email, scheduled_start_at,
 *   scheduled_end_at) plus a `candidateEmail` the caller resolves.
 * @param {string} candidateEmail - the address the invite actually went to
 * @returns {Promise<{decided: boolean, occurred: boolean, records: Array,
 *   interviewerPresent?: boolean, guestPresent?: boolean, candidateMatched?: boolean,
 *   absentParty?: 'candidate'|'panel'|'both'|null}>}
 *   decided:false ⇒ can't tell (disabled / no report / error) → caller must
 *   fall back to human confirmation. When decided and NOT occurred,
 *   `absentParty` names the side that failed to attend, for the no-show alert.
 */
export async function getAttendanceOutcome(scheduleRow, candidateEmail) {
  if (!isAttendanceEnabled()) return { decided: false, occurred: false, records: [] };

  let meetingId = scheduleRow?.online_meeting_id || null;
  if (!meetingId && scheduleRow?.teams_join_url) {
    meetingId = await resolveOnlineMeetingId(scheduleRow.teams_join_url);
  }
  if (!meetingId) return { decided: false, occurred: false, records: [] };

  const records = await fetchAttendanceRecords(meetingId, {
    windowStart: scheduleRow?.scheduled_start_at,
    windowEnd: scheduleRow?.scheduled_end_at,
  });
  // null = unreadable (fall back to human); [] = readable but no report for this
  // booking yet (also not decided — try again next sweep).
  if (records === null || records.length === 0) {
    return { decided: false, occurred: false, records: records || [] };
  }

  const { emails: interviewerEmails } = parseInterviewerEmails(scheduleRow?.interviewer_email || '');
  const guestMode = isGuestCandidateMode();
  const decision = decideOccurrence(records, {
    interviewerEmails,
    candidateEmail,
    organizerEmail: organizerMailbox(),
    minSeconds: config.microsoft.attendanceMinSeconds,
    guestMode,
  });

  // Say WHO was seen against who was expected. Without this a wrong verdict is
  // indistinguishable from an empty meeting, and the only way to tell them apart
  // was reading the database by hand.
  const seen = decision.attendees.map((a) => `${a.email || '<guest>'} (${a.seconds}s)`).join(', ') || 'none';
  logger.info(
    `Graph attendance: schedule ${scheduleRow?.id} → ${decision.occurred ? 'HELD' : `no_show (${decision.absentParty})`}`
    + ` | mode: ${guestMode ? 'guest-candidate' : 'strict'}`
    + ` | present ≥${config.microsoft.attendanceMinSeconds}s: ${seen}`
    + ` | panel expected: ${interviewerEmails.join(', ') || 'none'}`
    + ` | invited candidate: ${candidateEmail || 'none'}`
  );

  return { decided: true, records, ...decision };
}
