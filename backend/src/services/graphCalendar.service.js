/**
 * graphCalendar.service.js — Outlook calendar events + Teams meetings for
 * scheduled interview rounds (Microsoft Graph).
 *
 * Gated on config.microsoft.calendarEnabled because this needs consent the
 * rest of the Graph integration does not have: Calendars.ReadWrite (event
 * CRUD) and, for a join link, OnlineMeetings.ReadWrite. Both are application
 * permissions requiring tenant-admin grant on the app registration.
 *
 * Every export is best-effort and NEVER throws to its caller: a booking that
 * is saved and emailed is still a usable booking, so a calendar failure
 * degrades to "no event / no Teams link" rather than failing the schedule.
 * Callers detect this by the returned eventId being null.
 */
import config from '../config/index.js';
import logger from '../config/logger.js';
import { nonProdSafeCandidateEmail } from '../config/emailRecipients.js';
import { getAccessToken } from './onedrive.service.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/** Whether Outlook/Teams event creation is switched on for this environment. */
export const isCalendarEnabled = () => Boolean(config.microsoft.calendarEnabled);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const _userIdCache = new Map();

/**
 * Resolves a mailbox UPN/email to its Entra object GUID. The cloud-comms
 * (onlineMeetings) endpoints reject a UPN in the URL — they require the GUID —
 * whereas the calendar endpoints accept either. Cached per process.
 *
 * @param {string} upnOrId
 * @returns {Promise<string|null>} the object id (GUID), or null on failure
 */
export async function resolveUserId(upnOrId) {
  if (!upnOrId) return null;
  if (UUID_RE.test(upnOrId)) return upnOrId;
  if (_userIdCache.has(upnOrId)) return _userIdCache.get(upnOrId);
  try {
    const token = await getAccessToken();
    const res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(upnOrId)}?$select=id`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      logger.warn(`Graph calendar: could not resolve user id for ${upnOrId} (${res.status}).`);
      return null;
    }
    const data = await res.json();
    const id = data?.id || null;
    if (id) _userIdCache.set(upnOrId, id);
    return id;
  } catch (err) {
    logger.warn(`Graph calendar: user id resolution threw for ${upnOrId} — ${err.message}.`);
    return null;
  }
}

/**
 * The non-production net for calendar attendees.
 *
 * OUTLOOK sends the invite, not us, so it bypasses sendGraphEmail()'s gate
 * entirely — an address on this list gets a real meeting request wherever the
 * code runs. Callers are expected to substitute the candidate themselves
 * (interviewSchedule.service.js does), but relying on that alone is what let
 * real candidates be invited from staging: one branch missing the call-site
 * guard is enough. So the substitution is repeated HERE, under every call
 * site, mirroring the global gate inside sendGraphEmail(). Idempotent, so
 * doing it in both places is harmless.
 *
 * `role: 'panel'` is the ONE exemption: interviewer addresses are typed in
 * per booking by whoever is scheduling and are meant to be reached (same
 * reasoning as OPERATOR_ADDRESSED in config/emailRecipients.js).
 *
 * Anything NOT explicitly marked 'panel' — including an unmarked attendee —
 * is substituted. A future call site that forgets to label its attendees
 * therefore fails safe (nobody real is invited) rather than failing open.
 */
export function nonProdSafeAttendees(attendees) {
  const seen = new Set();
  return attendees.reduce((acc, a) => {
    const email = a.role === 'panel'
      ? a.email
      : nonProdSafeCandidateEmail(a.email, 'calendar:invite');
    // Substitution can collapse the candidate onto a panel member who already
    // IS the test inbox — Graph would otherwise get the same address twice.
    const key = email.toLowerCase();
    if (seen.has(key)) return acc;
    seen.add(key);
    acc.push({ ...a, email });
    return acc;
  }, []);
}

/**
 * Our attendee shape -> Graph's, with the non-prod substitution applied. Used by
 * BOTH the create and the patch path so an event can never be written with a
 * guarded list on one and an unguarded one on the other.
 */
function toGraphAttendees(attendees) {
  return nonProdSafeAttendees(attendees.filter((a) => a?.email)).map((a) => ({
    emailAddress: { address: a.email, name: a.name || a.email },
    type: 'required',
  }));
}

/**
 * Creates an Outlook event (with a Teams meeting when the tenant allows it) on
 * the recruitment mailbox, inviting the candidate and the interviewer.
 *
 * @param {object} params
 * @param {string} params.subject
 * @param {string} params.bodyHtml
 * @param {Date}   params.start
 * @param {Date}   params.end
 * @param {Array<{email: string, name?: string, role?: 'candidate'|'panel'}>} params.attendees
 *   Mark interviewers `role: 'panel'` so they are not redirected outside
 *   production; everything else is (see nonProdSafeAttendees above).
 * @returns {Promise<{eventId: string|null, joinUrl: string|null, onlineMeetingId: string|null, skipped: boolean, error: string|null}>}
 *   `onlineMeetingId` is the Teams onlineMeeting id (distinct from the Outlook
 *   `eventId`) — the path segment the Graph attendanceReports endpoint needs to
 *   later tell whether the interview actually happened. Null when the tenant
 *   returns an event without an online meeting.
 */
export async function createInterviewEvent({ subject, bodyHtml, start, end, attendees = [] }) {
  if (!isCalendarEnabled()) {
    return { eventId: null, joinUrl: null, onlineMeetingId: null, meetingId: null, passcode: null, skipped: true, error: null };
  }

  const mailbox = config.microsoft.calendarMailbox;

  const event = {
    subject,
    body: { contentType: 'HTML', content: bodyHtml },
    start: { dateTime: start.toISOString(), timeZone: 'UTC' },
    end: { dateTime: end.toISOString(), timeZone: 'UTC' },
    attendees: toGraphAttendees(attendees),
    isOnlineMeeting: true,
    onlineMeetingProvider: 'teamsForBusiness',
    allowNewTimeProposals: false,
  };

  try {
    const token = await getAccessToken();
    const res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(mailbox)}/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = body?.error?.message || res.statusText;
      // 403 here almost always means Calendars.ReadWrite was never granted.
      logger.error(`Graph calendar: event creation failed (${res.status}) — ${detail}. Booking saved without a calendar event.`);
      return { eventId: null, joinUrl: null, onlineMeetingId: null, meetingId: null, passcode: null, skipped: false, error: detail };
    }

    const created = await res.json();
    logger.info(`Graph calendar: created event ${created.id} for "${subject}".`);

    const joinUrl = created.onlineMeeting?.joinUrl || null;
    // The EVENT response gives us the Join URL but NOT the onlineMeeting id, the
    // dial-in Meeting ID, or the passcode. Resolve the onlineMeeting from the
    // join URL, then read those details, so the invite email can show the same
    // Join / Meeting ID / Passcode block Outlook renders (and so attendance can
    // be read later). Best-effort: a failure just omits the extra lines.
    const meeting = await getOnlineMeetingDetails(joinUrl);

    return {
      eventId: created.id || null,
      joinUrl,
      onlineMeetingId: meeting.onlineMeetingId,
      meetingId: meeting.meetingId,
      passcode: meeting.passcode,
      skipped: false,
      error: null,
    };
  } catch (err) {
    logger.error(`Graph calendar: event creation threw — ${err.message}. Booking saved without a calendar event.`);
    return { eventId: null, joinUrl: null, onlineMeetingId: null, meetingId: null, passcode: null, skipped: false, error: err.message };
  }
}

/**
 * Resolves the onlineMeeting behind a Teams join URL and returns its id plus the
 * dial-in Meeting ID + passcode. The Outlook event-create response returns only
 * the Join URL — none of these — so we look the meeting up by its JoinWebUrl.
 *
 * Needs OnlineMeetings.Read.All (application) + an application access policy on
 * the calendar mailbox. Best-effort: returns nulls on any failure so the invite
 * still goes out with just the Join link.
 *
 * @param {string|null} joinUrl - onlineMeeting.joinUrl from the created event
 * @returns {Promise<{onlineMeetingId: string|null, meetingId: string|null, passcode: string|null}>}
 */
export async function getOnlineMeetingDetails(joinUrl) {
  const empty = { onlineMeetingId: null, meetingId: null, passcode: null };
  if (!isCalendarEnabled() || !joinUrl) return empty;
  const mailbox = config.microsoft.calendarMailbox;
  try {
    const token = await getAccessToken();
    // onlineMeetings requires the mailbox's object GUID in the path (a UPN 400s).
    const userId = await resolveUserId(mailbox);
    if (!userId) return empty;
    // The event only hands back the join URL, so resolve the meeting by it.
    const res = await fetch(
      `${GRAPH_BASE}/users/${encodeURIComponent(userId)}/onlineMeetings?$filter=JoinWebUrl eq '${joinUrl}'`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      // 403 here means OnlineMeetings.Read.All / the app access policy is missing.
      logger.warn(`Graph calendar: onlineMeeting lookup unavailable (${res.status}) — ${body?.error?.message || res.statusText}. Invite will show the Join link only.`);
      return empty;
    }
    const data = await res.json();
    const meeting = data?.value?.[0];
    if (!meeting) return empty;
    const s = meeting.joinMeetingIdSettings || {};
    return {
      onlineMeetingId: meeting.id || null,
      meetingId: s.joinMeetingId || null,
      passcode: s.passcode || null,
    };
  } catch (err) {
    logger.warn(`Graph calendar: onlineMeeting lookup threw — ${err.message}. Invite will show the Join link only.`);
    return empty;
  }
}

/**
 * Presenter modes Graph accepts for onlineMeeting.allowedPresenters.
 *
 * 'roleIsPresenter' is deliberately absent: Graph requires the full attendee
 * list with per-attendee roles alongside it, which this endpoint does not send.
 * Configuring it would fail every call, so it is treated as invalid input.
 */
const PRESENTER_MODES = new Set(['everyone', 'organization', 'organizer']);

/** Whether automatic Teams recording is switched on for this environment. */
export const isMeetingRecordAuto = () => Boolean(config.microsoft.meetingRecordAuto);

/**
 * Turns the Teams meeting behind a booking into a self-recording one.
 *
 * WHY this is a separate call: the meeting is created as a side effect of
 * POSTing an Outlook EVENT (isOnlineMeeting: true), and the event payload has
 * nowhere to put meeting options. `recordAutomatically` lives on the
 * onlineMeeting resource, so it takes a second round trip against the
 * cloud-comms endpoint — the same one getOnlineMeetingDetails() already uses,
 * with the same GUID-not-UPN requirement.
 *
 * What it sets, and why each one:
 *   recordAutomatically  — the whole point: the interview records itself, so a
 *                          panel that forgets to press Record still produces the
 *                          recording the final decision-makers are promised.
 *   allowedPresenters    — Teams cannot lock a recording ON. Only presenters can
 *                          stop one, so demoting the candidate to attendee is
 *                          the only mechanism that stops the person with the
 *                          most reason to object from ending the recording.
 *                          Interviewers stay presenters and keep screen sharing.
 *   allowTranscription   — a transcript is ~300 KB against ~400 MB of video, and
 *                          it is what makes a round searchable later.
 *
 * Needs OnlineMeetings.ReadWrite.All (application) + the application access
 * policy on the calendar mailbox. Both were confirmed in place on 2026-09-01.
 *
 * Best-effort like everything else here: a failure NEVER costs the recruiter
 * their booking. It returns the reason instead, which the caller stores on the
 * row so "this round is not actually being recorded" is visible in the drawer
 * rather than discovered when someone goes looking for the recording.
 *
 * @param {string|null} onlineMeetingId - rpa_interview_schedule.online_meeting_id
 * @returns {Promise<{applied: boolean, skipped: boolean, error: string|null}>}
 *   skipped:true means the feature is off, not that anything went wrong.
 */
export async function applyMeetingOptions(onlineMeetingId) {
  const skip = () => ({ applied: false, skipped: true, error: null });
  const fail = (error) => ({ applied: false, skipped: false, error });

  if (!isCalendarEnabled() || !isMeetingRecordAuto()) return skip();
  // No meeting id means the tenant returned an event without an online meeting,
  // or the onlineMeeting lookup was refused. Either way there is nothing to
  // patch, and the caller needs to know the round is unrecorded.
  if (!onlineMeetingId) return fail('no online meeting id — the booking has no Teams meeting to record');

  let presenters = config.microsoft.meetingPresenters;
  if (!PRESENTER_MODES.has(presenters)) {
    logger.warn(`Graph calendar: MS_MEETING_PRESENTERS="${presenters}" is not one of ${[...PRESENTER_MODES].join('/')} — falling back to "organization".`);
    presenters = 'organization';
  }

  try {
    const token = await getAccessToken();
    // onlineMeetings requires the mailbox's object GUID in the path (a UPN 400s).
    const userId = await resolveUserId(config.microsoft.calendarMailbox);
    if (!userId) return fail('could not resolve the calendar mailbox to an object id');

    const res = await fetch(
      `${GRAPH_BASE}/users/${encodeURIComponent(userId)}/onlineMeetings/${encodeURIComponent(onlineMeetingId)}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordAutomatically: true,
          allowedPresenters: presenters,
          allowTranscription: Boolean(config.microsoft.meetingTranscribe),
        }),
      }
    );

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = body?.error?.message || res.statusText;
      // 403 here means either OnlineMeetings.ReadWrite.All is missing (Read.All
      // alone cannot PATCH) or the application access policy does not cover this
      // mailbox — the two things §8 of the plan tells IT to check.
      logger.error(`Graph calendar: meeting options PATCH failed (${res.status}) — ${detail}. This round will NOT record automatically.`);
      return fail(detail);
    }

    logger.info(`Graph calendar: meeting ${onlineMeetingId} set to auto-record (presenters: ${presenters}).`);
    return { applied: true, skipped: false, error: null };
  } catch (err) {
    logger.error(`Graph calendar: meeting options PATCH threw — ${err.message}. This round will NOT record automatically.`);
    return fail(err.message);
  }
}

/**
 * Moves an existing event to a new time, KEEPING its Teams meeting.
 *
 * This is what a reschedule should do. The previous implementation cancelled
 * the event and created a replacement, which minted a new Teams meeting every
 * time: everyone holding the original invite was left with a dead join link,
 * and Outlook mailed the candidate a "Canceled:" notice for the destroyed
 * meeting at the same moment the app told them the interview had merely moved
 * (defect D4, 2026-08-20).
 *
 * PATCHing start/end leaves `onlineMeeting` untouched, so the join URL, meeting
 * id and passcode all survive, and Outlook sends attendees a normal "Updated:"
 * notice instead of a cancellation.
 *
 * Returns the same shape as createInterviewEvent() so callers can treat the two
 * interchangeably — including `ok: false` on failure, which lets the caller
 * fall back to cancel-and-recreate rather than losing the booking.
 *
 * @param {string|null} eventId
 * @param {object} params
 * @param {Date} params.start
 * @param {Date} params.end
 * @param {string} [params.subject] - omitted leaves the existing subject alone
 * @param {Array<{email: string, name?: string, role?: 'candidate'|'panel'}>} [params.attendees]
 *   Re-states the guest list on the event. Omitted leaves the existing one
 *   alone; passing it is what lets a reschedule pick up a changed panel AND
 *   heal an event booked before the non-prod attendee guard existed, whose
 *   real candidate address would otherwise ride along forever (see below).
 * @returns {Promise<{ok: boolean, eventId: string|null, joinUrl: string|null, onlineMeetingId: string|null, meetingId: string|null, passcode: string|null, error: string|null}>}
 */
export async function updateInterviewEventTime(eventId, { start, end, subject, attendees } = {}) {
  const failed = (error) => ({
    ok: false, eventId: null, joinUrl: null, onlineMeetingId: null, meetingId: null, passcode: null, error,
  });
  if (!eventId || !isCalendarEnabled()) return failed('no event id, or calendar disabled');

  const mailbox = config.microsoft.calendarMailbox;
  try {
    const token = await getAccessToken();
    const patch = {
      start: { dateTime: start.toISOString(), timeZone: 'UTC' },
      end: { dateTime: end.toISOString(), timeZone: 'UTC' },
      ...(subject ? { subject } : {}),
      // Graph replaces the whole collection, so this re-asserts the guarded list
      // over whatever is on the event. That matters most for events created
      // BEFORE nonProdSafeAttendees existed: the patch path used to move only
      // start/end, so a real candidate address written back then stayed on the
      // event and Outlook kept mailing them an "Updated:" notice from staging on
      // every reschedule. Re-stating the list drops them once and for all.
      ...(Array.isArray(attendees) && attendees.length
        ? { attendees: toGraphAttendees(attendees) }
        : {}),
    };
    const res = await fetch(
      `${GRAPH_BASE}/users/${encodeURIComponent(mailbox)}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }
    );

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = body?.error?.message || res.statusText;
      logger.warn(`Graph calendar: event patch failed (${res.status}) — ${detail}. Falling back to cancel-and-recreate.`);
      return failed(detail);
    }

    const updated = await res.json();
    const joinUrl = updated.onlineMeeting?.joinUrl || null;
    // Same lookup the create path does — the event payload carries the join URL
    // but not the dial-in id or passcode.
    const meeting = await getOnlineMeetingDetails(joinUrl);

    logger.info(`Graph calendar: patched event ${eventId} to ${start.toISOString()} — Teams meeting preserved.`);
    return {
      ok: true,
      eventId: updated.id || eventId,
      joinUrl,
      onlineMeetingId: meeting.onlineMeetingId,
      meetingId: meeting.meetingId,
      passcode: meeting.passcode,
      error: null,
    };
  } catch (err) {
    logger.warn(`Graph calendar: event patch threw — ${err.message}. Falling back to cancel-and-recreate.`);
    return failed(err.message);
  }
}

/**
 * Cancels a previously created event. No-op when there is no event id (the
 * booking was made while the calendar integration was off).
 *
 * @param {string|null} eventId
 * @param {string} [comment] - Cancellation note sent to attendees by Outlook
 * @returns {Promise<boolean>} true when Graph confirmed the cancellation
 */
export async function cancelInterviewEvent(eventId, comment = 'This interview has been cancelled.') {
  if (!eventId || !isCalendarEnabled()) return false;

  const mailbox = config.microsoft.calendarMailbox;
  try {
    const token = await getAccessToken();
    const res = await fetch(
      `${GRAPH_BASE}/users/${encodeURIComponent(mailbox)}/events/${encodeURIComponent(eventId)}/cancel`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ Comment: comment }),
      }
    );

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      logger.warn(`Graph calendar: cancel failed (${res.status}) — ${body?.error?.message || res.statusText}. Booking still marked cancelled locally.`);
      return false;
    }
    logger.info(`Graph calendar: cancelled event ${eventId}.`);
    return true;
  } catch (err) {
    logger.warn(`Graph calendar: cancel threw — ${err.message}. Booking still marked cancelled locally.`);
    return false;
  }
}
