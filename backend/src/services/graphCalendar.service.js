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
 * Creates an Outlook event (with a Teams meeting when the tenant allows it) on
 * the recruitment mailbox, inviting the candidate and the interviewer.
 *
 * @param {object} params
 * @param {string} params.subject
 * @param {string} params.bodyHtml
 * @param {Date}   params.start
 * @param {Date}   params.end
 * @param {Array<{email: string, name?: string}>} params.attendees
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
  const validAttendees = attendees.filter((a) => a?.email);

  const event = {
    subject,
    body: { contentType: 'HTML', content: bodyHtml },
    start: { dateTime: start.toISOString(), timeZone: 'UTC' },
    end: { dateTime: end.toISOString(), timeZone: 'UTC' },
    attendees: validAttendees.map((a) => ({
      emailAddress: { address: a.email, name: a.name || a.email },
      type: 'required',
    })),
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
