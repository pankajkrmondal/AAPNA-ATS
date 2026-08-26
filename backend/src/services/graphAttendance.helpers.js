/**
 * graphAttendance.helpers.js — the pure decision logic behind "did this
 * interview actually happen?", kept free of Graph, Prisma and config so it can
 * be unit-tested with `node --test` (importing the service opens Redis and
 * hangs the runner — the same reason pipelineAnalytics.helpers.js exists).
 */

/** How far before the booked start a report may begin and still be this meeting. */
const REPORT_EARLY_SLACK_MS = 60 * 60 * 1000;        // 1 hour
/** How far past the booked end a report may run and still be this meeting. */
const REPORT_LATE_SLACK_MS = 3 * 60 * 60 * 1000;     // 3 hours

const norm = (v) => String(v || '').trim().toLowerCase();

/**
 * Chooses which attendance report belongs to a given booking.
 *
 * A reschedule MOVES the existing Teams meeting rather than minting a new one,
 * so one onlineMeeting id accumulates a report per session. Blindly taking the
 * newest — as this used to — meant a booking could be ruled on using a
 * different session's attendance entirely: a stale report from the earlier slot
 * when the current one had not published yet. Under the guest-candidate rule
 * that is worse than before, because a loose match on the wrong session can
 * manufacture a false "held" and release a scorecard for an interview nobody
 * attended.
 *
 * Returning null means "nothing here matches this booking" — the caller must
 * treat that as undecided and look again next tick, never as a verdict.
 *
 * @param {Array<object>} reports - Graph attendanceReport list
 * @param {object} [window] - { windowStart, windowEnd } of the booking
 * @returns {object|null} the chosen report, or null when none overlaps
 */
export function pickAttendanceReport(reports, { windowStart, windowEnd } = {}) {
  const list = (Array.isArray(reports) ? reports : []).filter(Boolean);
  if (list.length === 0) return null;
  if (!windowStart || !windowEnd) return list[0];

  const lower = new Date(windowStart).getTime() - REPORT_EARLY_SLACK_MS;
  const upper = new Date(windowEnd).getTime() + REPORT_LATE_SLACK_MS;
  if (Number.isNaN(lower) || Number.isNaN(upper)) return list[0];

  const dated = list.filter((r) => !Number.isNaN(Date.parse(r?.meetingStartDateTime)));
  // No report carries usable timestamps (unexpected payload shape): fall back to
  // the newest rather than stalling the booking forever on a technicality.
  if (dated.length === 0) return list[0];

  const overlapping = dated.filter((r) => {
    const start = Date.parse(r.meetingStartDateTime);
    const end = Date.parse(r.meetingEndDateTime);
    // An open-ended report (no end recorded) counts as overlapping if it began
    // before the window closed.
    const finish = Number.isNaN(end) ? start : end;
    return start < upper && finish > lower;
  });
  if (overlapping.length === 0) return null;

  overlapping.sort((a, b) => Date.parse(b.meetingStartDateTime) - Date.parse(a.meetingStartDateTime));
  return overlapping[0];
}

/**
 * Decides whether an interview occurred from its attendance records.
 *
 * GUEST MODE (the default, and how interviews are actually run here): candidates
 * have no Teams account and join as guests, so Teams records them with a BLANK
 * emailAddress — there is no address to match against. Only the interviewer is
 * reliably identifiable, being internal and signed in. So "it happened" means
 * the interviewer was present AND somebody else was too:
 *
 *   occurred = interviewerPresent && guestPresent
 *
 * The old rule required the candidate to match by email as well, which no guest
 * can ever satisfy — every guest-joined interview was auto-recorded as a
 * no-show and its scorecard never sent.
 *
 * STRICT MODE (guestMode:false) keeps that original both-sides-by-email rule for
 * all-internal rounds.
 *
 * @param {Array<{email: string, seconds: number}>} records
 * @param {object} opts
 * @param {string[]} [opts.interviewerEmails] - panel addresses on the booking
 * @param {string} [opts.candidateEmail] - address the invite went to
 * @param {string} [opts.organizerEmail] - calendar mailbox, never counted as the guest
 * @param {number} [opts.minSeconds] - presence below this does not count
 * @param {boolean} [opts.guestMode]
 * @returns {{occurred: boolean, absentParty: 'candidate'|'panel'|'both'|null,
 *   interviewerPresent: boolean, guestPresent: boolean, candidateMatched: boolean,
 *   attendees: Array<{email: string, seconds: number}>}}
 */
export function decideOccurrence(records, {
  interviewerEmails = [],
  candidateEmail = '',
  organizerEmail = '',
  minSeconds = 60,
  guestMode = true,
} = {}) {
  const panel = new Set(interviewerEmails.map(norm).filter(Boolean));
  const organizer = norm(organizerEmail);
  const candidate = norm(candidateEmail);

  const attendees = (records || [])
    .map((r) => ({ email: norm(r?.email), seconds: Number(r?.seconds || 0) }))
    .filter((r) => r.seconds >= minSeconds);

  const interviewerPresent = attendees.some((a) => panel.has(a.email));
  const candidateMatched = candidate ? attendees.some((a) => a.email === candidate) : false;

  // Anyone present who is neither panel nor the organizer mailbox counts as the
  // candidate side. Evaluated over the RECORDS, not a Set of their emails: every
  // anonymous guest carries the same blank address, so a Set would collapse a
  // room full of them into one entry.
  const guestPresent = attendees.some((a) => !panel.has(a.email) && (!organizer || a.email !== organizer));

  const occurred = guestMode
    ? interviewerPresent && guestPresent
    : candidateMatched && interviewerPresent;

  // Vocabulary is fixed by the drawer: auto- and human-recorded no-shows render
  // through the same tag, so these must stay 'candidate' | 'panel' | 'both'.
  let absentParty = null;
  if (!occurred) {
    const candidateSidePresent = guestMode ? guestPresent : candidateMatched;
    if (!interviewerPresent && !candidateSidePresent) absentParty = 'both';
    else if (!candidateSidePresent) absentParty = 'candidate';
    else absentParty = 'panel';
  }

  return { occurred, absentParty, interviewerPresent, guestPresent, candidateMatched, attendees };
}
