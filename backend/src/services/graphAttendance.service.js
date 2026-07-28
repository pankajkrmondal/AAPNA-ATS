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

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/** Whether Teams attendance auto-detection is switched on for this environment. */
export const isAttendanceEnabled = () => Boolean(config.microsoft.attendanceEnabled);

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
 * @param {string} onlineMeetingId
 * @returns {Promise<Array<{email: string, seconds: number}>|null>} records, or
 *   null when unreadable (disabled / 403 / no report yet).
 */
async function fetchAttendanceRecords(onlineMeetingId) {
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

    // Newest report (they arrive most-recent first) read in full for records.
    const reportId = reports[0].id;
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
 * "Occurred" = the report exists AND both sides showed up for a meaningful
 * duration: the candidate has a record ≥ min-seconds, and at least one
 * interviewer mailbox does too. That distinguishes the three failure modes —
 * candidate no-show (no candidate record), panel no-show (no interviewer
 * record), and a failed call (nobody / only-brief presence).
 *
 * @param {object} scheduleRow - rpa_interview_schedule row (needs
 *   online_meeting_id | teams_join_url, interviewer_email) plus a
 *   `candidateEmail` the caller resolves from the pipeline.
 * @param {string} candidateEmail
 * @returns {Promise<{decided: boolean, occurred: boolean, records: Array,
 *   candidatePresent?: boolean, anyInterviewerPresent?: boolean,
 *   absentParty?: 'candidate'|'interviewer'|'both'|null}>}
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

  const records = await fetchAttendanceRecords(meetingId);
  // null = unreadable (fall back to human); [] = readable but no report yet
  // (also not decided — try again next sweep).
  if (records === null || records.length === 0) {
    return { decided: false, occurred: false, records: records || [] };
  }

  const minSeconds = config.microsoft.attendanceMinSeconds;
  const present = new Set(records.filter((r) => r.seconds >= minSeconds).map((r) => r.email));

  const candidate = (candidateEmail || '').toLowerCase();
  const candidatePresent = candidate ? present.has(candidate) : false;

  const { emails: interviewerEmails } = parseInterviewerEmails(scheduleRow?.interviewer_email || '');
  const anyInterviewerPresent = interviewerEmails.some((e) => present.has(e.toLowerCase()));

  const occurred = candidatePresent && anyInterviewerPresent;

  // Which side was absent, for the recruiter-facing no-show alert. 'both' when
  // neither joined (e.g. the call never happened at all), otherwise the one
  // side that failed to attend. null when the interview did occur.
  // Values MUST match the manual no-show vocabulary in PipelineDrawer.jsx
  // ('candidate' | 'panel' | 'both' | 'technical') so auto- and human-recorded
  // no-shows render identically in the drawer tag.
  let absentParty = null;
  if (!occurred) {
    if (!candidatePresent && !anyInterviewerPresent) absentParty = 'both';
    else if (!candidatePresent) absentParty = 'candidate';
    else absentParty = 'panel';
  }

  return { decided: true, occurred, records, candidatePresent, anyInterviewerPresent, absentParty };
}
