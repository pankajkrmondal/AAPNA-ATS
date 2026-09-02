/**
 * interviewSchedule.service.js — booking for the human interview rounds
 * (Technical Rounds 1-3, HR Round, CEO/Final Round) in the Pipeline Tracker.
 * The Client Interview is arranged offline and is only marked, not booked.
 *
 * WHO interviews is defined on the MRF, not on a separate panel table:
 *   tech1    -> rpa_mrf.first_technical_round  + first_round_interview_slot
 *   tech2    -> rpa_mrf.second_technical_round + second_round_interview_slot
 *   hr_round -> rpa_mrf.hr_round
 *   ceo      -> rpa_mrf.ceo_management_round
 *   tech3    -> (no MRF column exists for a third technical round)
 * Those columns are free text ("Naveen", "Harish M", "11 AM- 12 PM", "NA"),
 * so they are surfaced to the recruiter as read-only hints while the
 * interviewer's actual mailbox is entered per booking.
 *
 * A booking always saves + emails; the Outlook/Teams event is best-effort on
 * top (see graphCalendar.service.js), so the flow works before the tenant
 * grants Calendars.ReadWrite.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import AppError from '../utils/AppError.js';
import { resolveRecipients, nonProdSafeCandidateEmail } from '../config/emailRecipients.js';
import { sendGraphEmail, compileTemplate } from './emailNotification.service.js';
import { wrapBrandedEmail, brandedWrapperParts } from './emailLayout.service.js';
import { interviewerGreeting } from '../utils/emailGreeting.js';
import { createInterviewEvent, updateInterviewEventTime, cancelInterviewEvent, isCalendarEnabled, applyMeetingOptions, isMeetingRecordAuto } from './graphCalendar.service.js';
import { notifyVendor, VENDOR_EVENTS } from './vendorNotification.service.js';
// From pure config, not pipeline.service.js: that module imports THIS one, so
// reaching back for its assertJourneyOpen would close an import cycle.
import { finalStatusLabelFor } from '../config/pipelineStages.js';

/** Template names seeded by prisma/seed-email-templates.js for this flow. */
const TEMPLATE_NAMES = Object.freeze({
  scheduleCandidate: 'Interview Scheduled — Candidate',
  schedulePanel: 'Interview Scheduled — Panel',
  cancelCandidate: 'Interview Cancelled — Candidate',
  cancelPanel: 'Interview Cancelled — Panel',
  rescheduleCandidate: 'Interview Rescheduled — Candidate',
  reschedulePanel: 'Interview Rescheduled — Panel',
});

/**
 * Rounds the ATS never generates anything outward for — no calendar meeting,
 * no invite/cancel email to either side, no reminder, no scorecard link.
 *
 * The Client Interview is the only member, per Q14 (RT, 2026-07-13): the client
 * is external and *"the system must not generate anything for the client"*.
 *
 * This is deliberately its OWN set rather than an `autoInvite: false` flag on
 * SCHEDULABLE_STAGES below. The round is no longer schedulable at all (see the
 * commented-out entry there), and a flag on a commented-out entry would read as
 * `undefined !== false` → true, i.e. silently re-enable outward mail on exactly
 * the round that must never send any. Keeping the rule here means it holds for
 * historical `rpa_interview_schedule` rows too.
 */
export const MANUALLY_COORDINATED_STAGES = Object.freeze(['client']);

/**
 * Stage keys this service can book, mapped to their MRF columns.
 */
export const SCHEDULABLE_STAGES = Object.freeze({
  tech1: { ownerField: 'first_technical_round', slotField: 'first_round_interview_slot', label: 'Technical Round 1' },
  tech2: { ownerField: 'second_technical_round', slotField: 'second_round_interview_slot', label: 'Technical Round 2' },
  // Tech 3 has no dedicated MRF interviewer/slot column — mrfRoundHints() below
  // already handles a null ownerField/slotField gracefully ("not specified").
  tech3: { ownerField: null, slotField: null, label: 'Technical Round 3' },
  hr_round: { ownerField: 'hr_round', slotField: null, label: 'HR Round' },
  ceo: { ownerField: 'ceo_management_round', slotField: null, label: 'CEO / Final Round' },
  // Disabled 2026-08-25 — RT: the Client Interview is arranged entirely offline
  // and the app only marks the round. Booking it in-app was beyond that scope,
  // and the booking's interviewer address was what the scorecard link got sent
  // to. Uncomment (and drop 'client' from MANUALLY_COORDINATED_STAGES) to bring
  // in-app booking back.
  // client: { ownerField: 'client_round_coordinator', slotField: null, label: 'Client Interview' },
});

/**
 * True when booking this round may create a calendar meeting and email the
 * candidate + panel. False for manually-coordinated rounds (Client Interview).
 * @param {string} stageKey
 * @returns {boolean}
 */
export const stageSendsInvites = (stageKey) => !MANUALLY_COORDINATED_STAGES.includes(stageKey);

/**
 * rpa_interview_schedule.occurrence_status — did the interview actually happen?
 *
 * NULL means "not yet resolved", which is why this is a two-value set rather
 * than three: the unresolved state is the absence of a value, not a member.
 * HELD is the gate the scorecard is released under (see dispatchScorecards),
 * so anything counting outstanding feedback must filter on it.
 *
 * These two are the only valid OUTCOMES a caller may record. OCCURRENCE_UNCONFIRMED
 * below is deliberately not a member: it is a bookkeeping marker, not a verdict.
 */
export const OCCURRENCE_STATUS = Object.freeze({
  HELD: 'held',
  NO_SHOW: 'no_show',
});

/**
 * Terminal marker for an interview nobody ever confirmed.
 *
 * The occurrence sweep writes this after ATTENDANCE_RECHECK_DAYS so the row stops
 * being re-examined and stops reading as pending in the drawer. It is NOT an
 * outcome: markInterviewOccurrence still accepts a real held/no_show verdict on
 * top of it, and dispatchScorecards stays closed against it (that gate only ever
 * opens for 'held').
 *
 * Lives here rather than in the job so the service can reference it without a
 * circular import — jobs/interviewOccurrence.js imports this module.
 */
export const OCCURRENCE_UNCONFIRMED = 'unconfirmed';

/** The shape createInterviewEvent() returns when no meeting was created. */
const NO_CALENDAR = Object.freeze({
  eventId: null, joinUrl: null, onlineMeetingId: null, meetingId: null, passcode: null, skipped: true, error: null,
});

/** True when the drawer should offer a "Schedule Interview" action for a stage. */
export const isSchedulableStage = (stageKey) => Object.hasOwn(SCHEDULABLE_STAGES, stageKey || '');

/**
 * True when this round's Teams meeting should record itself.
 *
 * Driven by config rather than "every schedulable stage" so the set stays an
 * explicit decision (plan §0.2: tech1-3, hr_round, ceo). The Client Interview is
 * absent from both this list and SCHEDULABLE_STAGES today, but stating it here
 * means re-enabling that round for booking cannot silently start recording a
 * meeting with an external client in it.
 */
export const stageIsRecorded = (stageKey) =>
  config.microsoft.recordedStages.includes(stageKey || '');

/**
 * Applies the auto-record meeting options to a freshly created or rescheduled
 * booking, and maps the outcome onto the two columns the drawer reads.
 *
 * Shared by the schedule and reschedule paths so the two can never diverge on
 * which rounds record. Re-asserting on reschedule is deliberate and idempotent:
 * a reschedule PATCHes the same Teams meeting, so the options are usually
 * already there — but re-applying also heals a booking made before this feature
 * existed, and covers the cancel-and-recreate fallback, which mints a brand-new
 * meeting with Teams' defaults.
 *
 * @param {string} stageKey
 * @param {string|null} onlineMeetingId
 * @returns {Promise<{appliedAt: Date|null, error: string|null}>}
 *   Both null = not attempted (round not recorded, or the feature is off).
 */
/**
 * Undoes a booking that died between its INSERT and its final UPDATE.
 *
 * THE PROBLEM THIS SOLVES: a booking is written first (so it survives a Graph
 * outage), then enriched with the event id, join URL and invite timestamp in a
 * second statement minutes later. Anything that throws in between — a Graph
 * failure, a template error, a Prisma mismatch after a schema change — leaves a
 * row with status='scheduled' and nothing else. getLiveSchedule() then reports
 * the round as already booked, so every retry is rejected with "This round
 * already has a scheduled interview", and the only cure is a human cancelling a
 * booking that never really existed. That is exactly what happened on
 * 2026-09-01 when the Prisma client was a migration behind.
 *
 * A database transaction cannot fix this: the window spans several Graph calls
 * that have taken 100+ seconds in practice, and holding a transaction open
 * across them would be far worse than the bug. So this is a compensating action
 * instead — undo what the failed attempt created.
 *
 * ONLY safe when nothing was communicated. Once an invitation has reached the
 * candidate or the panel, the round genuinely IS booked; erasing it would leave
 * people holding an invitation to a meeting the ATS denies exists. The caller
 * decides that and passes it in.
 *
 * @param {bigint} scheduleId
 * @param {object} calendar - the createInterviewEvent() result, if we got one
 * @param {Error} err - what went wrong, recorded on the row for diagnosis
 */
export async function rollbackFailedBooking(scheduleId, calendar, err) {
  // Cancel the Teams meeting first: leaving it would put a live invitation on
  // the panel's calendar for a booking the ATS has just disowned.
  if (calendar?.eventId) {
    try {
      await cancelInterviewEvent(calendar.eventId, 'This booking could not be completed.');
    } catch (e) {
      logger.error(`Booking rollback: could not cancel event ${calendar.eventId} — ${e.message}. A stray meeting may remain on the calendar.`);
    }
  }
  try {
    // Cancelled rather than deleted: getLiveSchedule() ignores cancelled rows,
    // so the round is immediately bookable again, and the failed attempt stays
    // visible with its reason instead of vanishing.
    await prisma.rpa_interview_schedule.update({
      where: { id: scheduleId },
      data: {
        status: 'cancelled',
        cancelled_at: new Date(),
        cancel_reason: `Booking failed before it completed: ${err.message}`.slice(0, 500),
        modified_at: new Date(),
      },
    });
    logger.warn(`Booking rollback: schedule ${scheduleId} rolled back after "${err.message}". The round is bookable again.`);
  } catch (e) {
    // Both statements failing means the database itself is unreachable; say so
    // loudly, because this is the one path that still leaves a phantom.
    logger.error(`Booking rollback FAILED for schedule ${scheduleId} — ${e.message}. A phantom booking may block this round until someone cancels it by hand.`);
  }
}

async function applyRecordingOptions(stageKey, onlineMeetingId) {
  if (!stageIsRecorded(stageKey) || !isMeetingRecordAuto()) return { appliedAt: null, error: null };
  const result = await applyMeetingOptions(onlineMeetingId);
  if (result.skipped) return { appliedAt: null, error: null };
  return { appliedAt: result.applied ? new Date() : null, error: result.error };
}

/**
 * Placeholder values recruiters typed into the MRF's interviewer/slot columns
 * that carry no information — treated as "not specified" rather than shown.
 */
const EMPTY_HINTS = new Set(['na', 'n/a', 'no', 'none', '-', '']);
const cleanHint = (value) => {
  const trimmed = (value || '').trim();
  return EMPTY_HINTS.has(trimmed.toLowerCase()) ? null : trimmed;
};

// Exact placeholder/non-person values seen in the real interviewer column.
const NON_NAME_TOKENS = new Set(['dev', 'demo', 'xxx', 'xx', 'abc', 'asdf', 'tbd', 'todo', 'null', 'none']);

/**
 * Decides whether an MRF interviewer value looks like an actual human name,
 * so the UI can show it rather than a confusing "Interviewer: 1".
 *
 * Deliberately CONSERVATIVE (RT choice, 2026-07-24): it hides only values that
 * clearly are not a person, so a real but terse entry is never suppressed.
 * In particular bare initials like "HM"/"PK" are KEPT — they may be how a
 * recruiter abbreviated a real interviewer, and showing them beats hiding a
 * real name. What it rejects:
 *   - pure non-letter noise: "1", "12", "-", "?!"
 *   - known placeholders: "dev", "tbd", … (NON_NAME_TOKENS)
 *   - anything that is (or starts with) the test marker "test": "TEST",
 *     "TESTWeb", "TEST RPA", "TESTDecsions"
 *
 * @param {string} value
 * @returns {boolean}
 */
export function looksLikeHumanName(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) return false;

  // Collapse to letters-only for the marker checks so "TEST RPA" -> "testrpa".
  const lettersOnly = trimmed.toLowerCase().replace(/[^a-z]/g, '');
  if (!lettersOnly || lettersOnly.length < 2) return false; // "1", "12", "-", "P."
  if (NON_NAME_TOKENS.has(lettersOnly)) return false;
  if (lettersOnly.startsWith('test')) return false; // TEST, TESTWeb, TEST RPA, …

  // Letters must dominate — a mostly-symbol/number blob isn't a name.
  const letters = (trimmed.match(/[a-z]/gi) || []).length;
  const nonSpace = trimmed.replace(/\s/g, '').length;
  return letters / nonSpace >= 0.5;
}

/** Returns the interviewer name only when it looks human; otherwise null. */
const cleanInterviewerName = (value) => {
  const cleaned = cleanHint(value);
  return cleaned && looksLikeHumanName(cleaned) ? cleaned : null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The candidate's address for a calendar invite. Outlook — not us — sends that
 * invite, so it bypasses every mail guard we own; outside production the shared
 * hand-off helper substitutes the internal test inbox. See
 * nonProdSafeCandidateEmail() in config/emailRecipients.js.
 *
 * @param {string} candidateEmail
 * @returns {string} the address to put on the event
 */
const calendarCandidateEmail = (candidateEmail) =>
  nonProdSafeCandidateEmail(candidateEmail, 'calendar:invite');

/**
 * The candidate's CURRENT address for a shortlist row.
 *
 * `rpa_shortlisted_candidates.candidate_email` is a denormalised copy taken when
 * the candidate was shortlisted. Editing the candidate record does not update
 * it, and no UI path corrects it on a live journey, so invites kept going to
 * whatever address was true at shortlist time (defect D5, 2026-08-20).
 *
 * The CV row is the record of truth, so prefer it and fall back to the copy —
 * a shortlist can exist without a cv_id (keyword shortlists), and an empty CV
 * address must not blank out an address we do have.
 *
 * Callers must include `cv: { select: { EmailID: true } }` on the shortlist for
 * this to see anything; without it the fallback keeps the previous behaviour.
 *
 * @param {{candidate_email?: string|null, cv?: {EmailID?: string|null}|null}|null} candidate
 * @returns {string}
 */
function liveCandidateEmail(candidate) {
  return (candidate?.cv?.EmailID || '').trim() || candidate?.candidate_email || '';
}

/**
 * Parses the interviewer field into a clean address list. A panel can be one
 * or several people, entered comma-separated; semicolons are accepted too
 * since Outlook hands addresses back that way.
 *
 * @param {string} raw
 * @returns {{ emails: string[], invalid: string[] }} de-duplicated, trimmed
 */
export function parseInterviewerEmails(raw) {
  const parts = String(raw || '')
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean);

  const emails = [];
  const invalid = [];
  const seen = new Set();

  for (const part of parts) {
    if (!EMAIL_RE.test(part)) {
      invalid.push(part);
      continue;
    }
    const key = part.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      emails.push(part);
    }
  }
  return { emails, invalid };
}

/**
 * Reads the MRF-defined interviewer + preferred slot for a stage.
 * @param {object|null} mrf - rpa_mrf row
 * @param {string} stageKey
 * @returns {{interviewerName: string|null, preferredSlot: string|null}|null}
 */
export function mrfRoundHints(mrf, stageKey) {
  const mapping = SCHEDULABLE_STAGES[stageKey];
  if (!mapping || !mrf) return null;
  return {
    // Only surface a name that actually looks like one — "1", "TEST", "dev"
    // become null so the UI shows "not specified" instead of a junk value.
    // A null ownerField means the round has no MRF column at all (Tech 3).
    interviewerName: mapping.ownerField ? cleanInterviewerName(mrf[mapping.ownerField]) : null,
    // The slot is free-form ("4-5", "11 AM- 12 PM"), so it keeps the lenient cleaner.
    preferredSlot: mapping.slotField ? cleanHint(mrf[mapping.slotField]) : null,
  };
}

/** Serializes a schedule row for the API (BigInt -> Number). */
function serialize(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    pipeline_id: Number(row.pipeline_id),
  };
}

/** The single live (non-cancelled) booking for a candidate-round, if any. */
export async function getLiveSchedule(pipelineId, stageKey) {
  const row = await prisma.rpa_interview_schedule.findFirst({
    where: { pipeline_id: BigInt(pipelineId), stage_key: stageKey, status: { not: 'cancelled' } },
    orderBy: { created_at: 'desc' },
  });
  return serialize(row);
}

/**
 * Every round's live booking for one journey, keyed by stage_key.
 *
 * The drawer used to load only the CURRENT stage's booking, so once a candidate
 * moved tech1 → tech2 the finished tech1 column lost its schedule and fell back
 * to "Not scheduled yet" — wrong for a round that demonstrably happened. One
 * query for the whole journey costs no more than the single-stage lookup did.
 *
 * @param {number|bigint} pipelineId
 * @returns {Promise<Record<string, object>>} stage_key -> serialized row (newest wins).
 */
export async function getSchedulesByStage(pipelineId) {
  const rows = await prisma.rpa_interview_schedule.findMany({
    where: { pipeline_id: BigInt(pipelineId), status: { not: 'cancelled' } },
    orderBy: { created_at: 'asc' },
  });
  // Scorecards that exist but were never actually emailed (sent_at IS NULL).
  //
  // scorecard_dispatched_at only records that dispatch was ATTEMPTED, so on its
  // own it cannot tell a delivered link from one whose send failed — the drawer
  // was reading it as proof and showing "scorecard sent" either way, with no
  // retry offered. This count is what lets it say otherwise.
  //
  // The status literal avoids importing interviewScorecard.service.js, which
  // imports helpers from this module (the same cycle markInterviewOccurrence
  // dodges with a lazy import).
  const undelivered = rows.length === 0 ? [] : await prisma.rpa_interview_scorecard.groupBy({
    by: ['schedule_id'],
    where: { schedule_id: { in: rows.map((r) => r.id) }, status: 'pending', sent_at: null },
    _count: { _all: true },
  });
  const undeliveredBySchedule = new Map(undelivered.map((u) => [String(u.schedule_id), u._count._all]));

  // Ascending order means a later booking for the same round overwrites the
  // earlier one, leaving the newest per stage — matching getLiveSchedule().
  return Object.fromEntries(rows.map((r) => [r.stage_key, {
    ...serialize(r),
    scorecard_undelivered: undeliveredBySchedule.get(String(r.id)) || 0,
  }]));
}

/**
 * Interviews that have ended but still have no held/no_show verdict.
 *
 * These are the rows nothing can move: scorecards only dispatch on 'held', so
 * until someone rules, the round shows "Awaiting Results" indefinitely. The
 * occurrence sweep chases them by email for three days and reads Teams
 * attendance for two weeks, but when both come up empty a human has to decide —
 * and previously nothing told anyone which interviews those were.
 *
 * Includes rows already written off as 'unconfirmed' so they stay actionable
 * rather than disappearing into a terminal state nobody sees.
 *
 * @param {object} [opts]
 * @param {number} [opts.graceMin=15] - Ignore interviews that only just ended.
 * @returns {Promise<object[]>} Newest-ended first, with candidate + stage context.
 */
export async function listUnresolvedInterviews({ graceMin = 15 } = {}) {
  const cutoff = new Date(Date.now() - graceMin * 60 * 1000);

  const rows = await prisma.rpa_interview_schedule.findMany({
    where: {
      status: { notIn: ['cancelled', 'completed', 'no_show'] },
      // A manually-coordinated round is never chased for confirmation: the ATS
      // did not arrange it and has no way of knowing whether it happened. A
      // client round marked as arranged but not yet fed back would otherwise
      // match every clause here (status 'scheduled', end date past, occurrence
      // still null) and reappear in the "confirm this happened" queue this
      // change set removed — labelled with the raw stage key, since its
      // SCHEDULABLE_STAGES entry no longer exists to supply a label.
      stage_key: { notIn: [...MANUALLY_COORDINATED_STAGES] },
      scheduled_end_at: { lt: cutoff },
      // A closed journey has nothing left to resolve. Without this the row sat
      // in the recruiter's "confirm this happened" queue forever: the sweep
      // eventually stops nudging, but this list has no upper bound, so a
      // withdrawn candidate's abandoned interview stayed actionable for good.
      // Same guard as documentReminder.js:46.
      // See docs/PHASE3-CLOSURE-AUDIT-2026-08-26.md §2.3.
      // is_paused too (Q33): a paused journey leaves the recruiter's queue for
      // as long as it is held, and comes back when it is resumed.
      rpa_candidate_pipeline: { final_outcome: null, is_paused: false },
      OR: [{ occurrence_status: null }, { occurrence_status: OCCURRENCE_UNCONFIRMED }],
    },
    include: {
      rpa_candidate_pipeline: { include: { rpa_shortlisted_candidates: true } },
    },
    orderBy: { scheduled_end_at: 'desc' },
  });

  return rows.map((r) => {
    const candidate = r.rpa_candidate_pipeline?.rpa_shortlisted_candidates;
    return {
      id: Number(r.id),
      pipeline_id: Number(r.pipeline_id),
      stage_key: r.stage_key,
      stage_label: SCHEDULABLE_STAGES[r.stage_key]?.label || r.stage_key,
      candidate_name: candidate?.candidate_name || null,
      candidate_email: candidate?.candidate_email || null,
      interviewer_name: r.interviewer_name,
      interviewer_email: r.interviewer_email,
      scheduled_start_at: r.scheduled_start_at,
      scheduled_end_at: r.scheduled_end_at,
      occurrence_status: r.occurrence_status,
      attendance_checked_at: r.attendance_checked_at,
      occurrence_nudge_at: r.occurrence_nudge_at,
      // Drives the "how stale is this?" column in the UI.
      hours_overdue: Math.floor((Date.now() - new Date(r.scheduled_end_at).getTime()) / 3_600_000),
    };
  });
}

const IST = 'Asia/Kolkata';
const fmtIst = (d) =>
  `${new Date(d).toLocaleString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: IST,
  })} IST`;

/** Loads an active template row by name, or null. */
async function getTemplate(name) {
  return prisma.rpa_email_templates.findFirst({ where: { name, is_active: true } });
}

/**
 * Builds the interpolation values shared by every interview email. The Teams
 * line and cancellation-reason line are pre-rendered HTML fragments so the
 * templates can place them with a single {{teams_line}} / {{reason_line}} token.
 */
/**
 * The Microsoft Teams meeting block for an invite email: a Join button, then the
 * dial-in Meeting ID + Passcode (each rendered only when Graph returned it).
 * Empty string when there is no join URL. Shared by the template token and the
 * send-time injector below.
 */
export function buildTeamsBlock(joinUrl, meetingId, passcode) {
  if (!joinUrl) return '';
  // Styled to match the branded card it now sits inside (emailLayout.service.js):
  // the same tinted panel + green left rule the Shortlist template's callout
  // uses, so the block reads as part of the email rather than pasted on.
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background:#f6f9eb;border-left:4px solid #7a922e;border-radius:8px;">
         <tr><td style="padding:16px 18px;">
         <p style="margin:0 0 10px 0;font-weight:700;color:#5a6e1f;">Microsoft Teams meeting</p>
         <p style="margin:0 0 10px 0;"><a href="${joinUrl}" style="background:#7a922e;color:#ffffff;padding:11px 22px;text-decoration:none;border-radius:8px;font-weight:700;display:inline-block;">Join the meeting</a></p>
         <p style="margin:0;font-size:13px;color:#374151;word-break:break-all;">Or join with the link: <a href="${joinUrl}" style="color:#5a6e1f;">${joinUrl}</a></p>
         ${meetingId ? `<p style="margin:6px 0 0 0;font-size:13px;color:#374151;"><strong>Meeting ID:</strong> ${meetingId}</p>` : ''}
         ${passcode ? `<p style="margin:2px 0 0 0;font-size:13px;color:#374151;"><strong>Passcode:</strong> ${passcode}</p>` : ''}
         </td></tr></table>`;
}

/**
 * Guarantees the Teams block is present in a final email body. The Schedule
 * modal's preview is compiled BEFORE the meeting exists, so the recruiter-edited
 * copy the UI sends back has no join link ({{teams_line}} rendered empty). At
 * real send time the meeting DOES exist, so if the body doesn't already contain
 * the join URL we append the block — otherwise the initial invite would ship
 * without the Teams link even though the reminder later has it.
 *
 * @param {string} html - the (possibly recruiter-edited) body
 * @param {string|null} joinUrl
 * @param {string|null} meetingId
 * @param {string|null} passcode
 * @returns {string}
 */
function ensureTeamsBlock(html, joinUrl, meetingId, passcode) {
  if (!joinUrl || !html) return html;
  if (html.includes(joinUrl)) return html; // already there (fresh-compiled body)
  return `${html}${buildTeamsBlock(joinUrl, meetingId, passcode)}`;
}

/**
 * Marker used to keep the recording notice idempotent across the compile →
 * recruiter-edit → send round trip. An HTML comment rather than a class, so it
 * survives a recruiter pasting the body through a rich-text editor.
 */
const RECORDING_NOTICE_MARKER = '<!--ats-recording-notice-->';

/**
 * The "this interview is recorded" notice, worded for whoever is reading it.
 *
 * WHY THIS IS NOT OPTIONAL: recording a person requires telling them. The
 * candidate half is a consent notice with a stated purpose, audience and
 * retention period — under India's DPDP Act an interview recording is personal
 * data under purpose limitation, and "we recorded you and kept it forever"
 * is not a defensible position. The panel half is operational.
 *
 * @param {'candidate'|'panel'} audience
 * @returns {string} HTML
 */
export function buildRecordingNotice(audience) {
  const body = audience === 'panel'
    ? `<p style="margin:0 0 8px 0;font-weight:700;color:#8a6d1f;">This round records automatically</p>
       <p style="margin:0;font-size:13px;color:#374151;">You do not need to press Record — it starts on its own. Please do not stop it: the recording is what later interviewers and the final decision-makers review.</p>
       <p style="margin:6px 0 0 0;font-size:13px;color:#374151;">The candidate joins as an attendee, so they cannot share their screen by default. If you need them to, make them a presenter from the participant list during the call.</p>`
    : `<p style="margin:0 0 8px 0;font-weight:700;color:#8a6d1f;">This interview will be recorded</p>
       <p style="margin:0;font-size:13px;color:#374151;">The recording is used only to help our hiring team review your interview and reach a decision. It is kept confidential, is not shared outside the company, and is deleted within 12 months of your application closing.</p>
       <p style="margin:6px 0 0 0;font-size:13px;color:#374151;">If you have any concerns about being recorded, please reply to this email before the interview.</p>`;

  return `${RECORDING_NOTICE_MARKER}<table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background:#fdf8e7;border-left:4px solid #d0a72c;border-radius:8px;">
         <tr><td style="padding:16px 18px;">${body}</td></tr></table>`;
}

/**
 * Appends the recording notice to a final email body.
 *
 * Applied at SEND time, next to ensureTeamsBlock, for the same reason that one
 * exists: the modal's preview is compiled before the meeting exists, and the
 * recruiter-edited copy that comes back would otherwise carry no notice. Doing
 * it here means a recruiter cannot remove the consent line by editing the body,
 * accidentally or otherwise.
 *
 * `recorded` is the booking's OWN state (record_auto_applied_at), not the global
 * feature flag, so the email never promises — or warns about — a recording that
 * is not actually going to happen.
 *
 * @param {string} html
 * @param {'candidate'|'panel'} audience
 * @param {boolean} recorded - whether THIS round will record
 * @returns {string}
 */
function ensureRecordingNotice(html, audience, recorded) {
  if (!recorded || !html) return html;
  if (html.includes(RECORDING_NOTICE_MARKER)) return html;
  return `${html}${buildRecordingNotice(audience)}`;
}

function interviewTokens({ candidate, stageLabel, position, when, durationMinutes, joinUrl, meetingId, passcode, reason, previousWhen, interviewerName, interviewerEmail }) {
  const teamsLine = buildTeamsBlock(joinUrl, meetingId, passcode);
  const reasonLine = reason ? `<p><strong>Reason:</strong> ${reason}</p>` : '';
  return {
    candidate_name: candidate?.candidate_name || 'Candidate',
    // The CV's live address, not the shortlist's denormalised copy — this token
    // is the "Candidate email:" line the interviewer reads and replies to, and
    // it was the clearest symptom of D5.
    candidate_email: liveCandidateEmail(candidate) || 'n/a',
    // Panel-side greeting. Absent from this map until 2026-08-11, so the seeded
    // "Hi," could never be personalised and any template carrying the placeholder
    // rendered it verbatim — compileTemplate leaves unknown tokens in place.
    interviewer_name: interviewerGreeting(interviewerName, interviewerEmail),
    position,
    stage_label: stageLabel,
    interview_when: when,
    // The slot the interview was moved FROM — only used by the reschedule templates.
    previous_when: previousWhen || '',
    duration: String(durationMinutes ?? ''),
    teams_line: teamsLine,
    reason_line: reasonLine,
  };
}

/**
 * Loads the candidate + panel email templates for an action and compiles both
 * with the given context. Used by both the preview endpoints and the real send.
 *
 * @param {'schedule'|'cancel'|'reschedule'} action
 * @param {object} ctx - the values interviewTokens() needs
 * @returns {Promise<{ candidate: {subject,body,templateId,templateName}, panel: {...} }>}
 */
async function buildInterviewEmails(action, ctx) {
  const names = action === 'cancel'
    ? { c: TEMPLATE_NAMES.cancelCandidate, p: TEMPLATE_NAMES.cancelPanel }
    : action === 'reschedule'
      ? { c: TEMPLATE_NAMES.rescheduleCandidate, p: TEMPLATE_NAMES.reschedulePanel }
      : { c: TEMPLATE_NAMES.scheduleCandidate, p: TEMPLATE_NAMES.schedulePanel };

  const tokens = interviewTokens(ctx);
  const [cTpl, pTpl] = await Promise.all([getTemplate(names.c), getTemplate(names.p)]);

  const compile = (tpl) => {
    if (!tpl) return { subject: '', body: '', templateId: null, templateName: null };
    const { subject, html } = compileTemplate(tpl.subject, tpl.body_html, tokens);
    return { subject, body: html, templateId: tpl.id, templateName: tpl.name };
  };
  const candidate = compile(cTpl);
  const panel = compile(pTpl);
  // The branded header/footer each body is wrapped in at send time, returned so
  // the Schedule/Cancel modals can render the real email around the editable
  // fragment (plan §4.2). Candidate and panel carry DIFFERENT subjects, and the
  // headline is the subject, so each side gets its own wrapper.
  return {
    candidate: { ...candidate, wrapper: brandedWrapperParts(interviewWrapOpts(candidate.subject)) },
    panel: { ...panel, wrapper: brandedWrapperParts(interviewWrapOpts(panel.subject)) },
  };
}

/**
 * The branded-shell options for an interview email. The header headline is the
 * email's own subject (RT decision, 2026-07-25) — pass the FINAL subject, i.e.
 * the recruiter's edited value when the modal supplied one.
 */
const interviewWrapOpts = (subject) => ({ title: subject || '' });

/**
 * Assembles the full email context for a pipeline's current round without
 * sending — feeds the Schedule modal's editable preview. Uses the given
 * date/time/duration so the preview reflects what the recruiter is entering.
 *
 * @param {number} pipelineId
 * @param {object} params - { stageKey, startAt, durationMinutes }
 */
export async function previewScheduleEmails(pipelineId, { stageKey, startAt, durationMinutes = 60, interviewerName = '', interviewerEmail = '' } = {}) {
  const pipeline = await prisma.rpa_candidate_pipeline.findUnique({
    where: { id: BigInt(pipelineId) },
    include: { rpa_shortlisted_candidates: { include: { mrf: true, cv: { select: { EmailID: true } } } } },
  });
  if (!pipeline) throw new AppError('Pipeline journey not found.', 404);
  if (!isSchedulableStage(stageKey || pipeline.current_stage_key)) {
    throw new AppError('This stage does not support interview scheduling.', 400);
  }

  const candidate = pipeline.rpa_shortlisted_candidates;
  const key = stageKey || pipeline.current_stage_key;
  const start = startAt ? new Date(startAt) : new Date(Date.now() + 24 * 60 * 60 * 1000);
  const when = fmtIst(start);

  // The Teams link is unknown until the event is created, so previews show the
  // note that it will be added; the real send fills in the actual link.
  // The interviewer name/mailbox come from what the recruiter is typing into the
  // modal, not from a saved row — there is no booking yet. They MUST be honoured
  // here: the modal posts this compiled body straight back on submit, and the
  // send path prefers it over its own defaults, so a preview that greeted "Hi
  // there," would be the copy that actually went out.
  return buildInterviewEmails('schedule', {
    candidate,
    stageLabel: SCHEDULABLE_STAGES[key].label,
    position: candidate?.mrf?.position_hiring_for || candidate?.position_applied || 'the role',
    when,
    durationMinutes,
    joinUrl: null,
    reason: null,
    interviewerName: interviewerName || mrfRoundHints(candidate?.mrf, key)?.interviewerName || '',
    interviewerEmail,
  });
}

/**
 * Preview for the Cancel action — compiles from the live booking so the
 * recruiter edits the exact text before the cancellation email goes out.
 * @param {number} scheduleId
 */
export async function previewCancelEmails(scheduleId, { reason = '' } = {}) {
  const row = await prisma.rpa_interview_schedule.findUnique({
    where: { id: BigInt(scheduleId) },
    include: { rpa_candidate_pipeline: { include: { rpa_shortlisted_candidates: { include: { mrf: true, cv: { select: { EmailID: true } } } } } } },
  });
  if (!row) throw new AppError('Interview booking not found.', 404);

  const candidate = row.rpa_candidate_pipeline?.rpa_shortlisted_candidates;
  return buildInterviewEmails('cancel', {
    candidate,
    stageLabel: SCHEDULABLE_STAGES[row.stage_key]?.label || row.stage_key,
    position: candidate?.mrf?.position_hiring_for || candidate?.position_applied || 'the role',
    when: fmtIst(row.scheduled_start_at),
    durationMinutes: Math.round((new Date(row.scheduled_end_at) - new Date(row.scheduled_start_at)) / 60000),
    joinUrl: row.teams_join_url,
    reason: reason || null,
    // Cancel previews from the live booking, so the name is already saved.
    interviewerName: row.interviewer_name,
    interviewerEmail: row.interviewer_email,
  });
}

/**
 * Books an interview: saves the row, creates the Outlook/Teams event when
 * enabled, then emails the candidate and the interviewer.
 *
 * @param {number} pipelineId
 * @param {object} params
 * @param {string} params.stageKey - any key in SCHEDULABLE_STAGES
 * @param {string} params.startAt - ISO datetime
 * @param {number} [params.durationMinutes=60]
 * @param {string} params.interviewerEmail - required; one or more mailboxes, comma-separated
 * @param {string} [params.interviewerName] - defaults to the MRF owner name
 * @param {string} [params.notes]
 * @param {number} params.actedBy
 */
export async function scheduleInterviewRound(pipelineId, {
  stageKey,
  startAt,
  durationMinutes = 60,
  interviewerEmail = '',
  interviewerName = '',
  notes = null,
  actedBy,
  // Optional recruiter-edited copy from the modal. When omitted, the seeded
  // templates are compiled fresh at send time.
  candidateSubject = null,
  candidateBody = null,
  panelSubject = null,
  panelBody = null,
}) {
  if (!isSchedulableStage(stageKey)) {
    throw new AppError(`Stage "${stageKey}" does not support interview scheduling.`, 400);
  }

  const pipeline = await prisma.rpa_candidate_pipeline.findUnique({
    where: { id: BigInt(pipelineId) },
    include: { rpa_shortlisted_candidates: { include: { mrf: true, cv: { select: { EmailID: true } } } } },
  });
  if (!pipeline) {
    throw new AppError('Pipeline journey not found.', 404);
  }
  // A closed journey cannot be booked into. This entry point checked
  // stage-support, journey-exists, current-stage and one-live-booking — and
  // nothing about final_outcome, so a stale browser tab could book a fresh
  // interview on a closed record AFTER the closure sweep had cancelled its
  // bookings, leaving exactly the live Teams invite that sweep exists to
  // prevent. Latent until 2026-08-26; surfacing closure at every stage
  // (audit §2.1) turns it from unreachable into a matter of time. See §6a.
  //
  // Inlined rather than calling pipeline.service.js's assertJourneyOpen for the
  // import-cycle reason noted at the top of this file; the message is kept
  // identical so the two read the same to a recruiter.
  if (pipeline.final_outcome) {
    throw new AppError(
      `This candidate's record was closed as "${finalStatusLabelFor(pipeline.current_stage_key, pipeline.final_outcome)}". Reopen it before you schedule an interview.`,
      409
    );
  }
  if (pipeline.current_stage_key !== stageKey) {
    throw new AppError(`The candidate is not currently on ${SCHEDULABLE_STAGES[stageKey].label}.`, 400);
  }

  // At least one interviewer mailbox is required: without it only the
  // candidate is told about the interview, and the panel never receives the
  // invite or the pre-interview reminder. Several may be given, comma-separated.
  const { emails: interviewerEmails, invalid } = parseInterviewerEmails(interviewerEmail);
  if (invalid.length > 0) {
    throw new AppError(
      `Not a valid email address: ${invalid.join(', ')}. Separate multiple interviewers with commas.`,
      400
    );
  }
  if (interviewerEmails.length === 0) {
    throw new AppError("At least one interviewer's email is required so they receive the invite.", 400);
  }
  // Stored as the canonical comma-separated list the mailer already understands.
  const interviewerEmailList = interviewerEmails.join(', ');

  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) {
    throw new AppError('A valid interview date & time is required.', 400);
  }
  if (start.getTime() < Date.now()) {
    throw new AppError('The interview time is in the past. Please pick a future slot.', 400);
  }
  const end = new Date(start.getTime() + Math.max(15, durationMinutes) * 60 * 1000);

  const existing = await getLiveSchedule(pipelineId, stageKey);
  if (existing) {
    throw new AppError('This round already has a scheduled interview. Cancel it first to rebook.', 409);
  }

  const candidate = pipeline.rpa_shortlisted_candidates;
  const hints = mrfRoundHints(candidate?.mrf, stageKey);
  const resolvedName = (interviewerName || '').trim() || hints?.interviewerName || null;
  const stageLabel = SCHEDULABLE_STAGES[stageKey].label;
  const position = candidate?.mrf?.position_hiring_for || candidate?.position_applied || 'the role';

  // 1) Persist first — the booking is the source of truth even if Graph fails.
  const row = await prisma.rpa_interview_schedule.create({
    data: {
      pipeline_id: pipeline.id,
      stage_key: stageKey,
      interviewer_name: resolvedName,
      interviewer_email: interviewerEmailList,
      scheduled_start_at: start,
      scheduled_end_at: end,
      status: 'scheduled',
      notes,
      created_by: actedBy || null,
    },
  });

  // 2) Best-effort calendar event (no-op unless MS_CALENDAR_ENABLED=true, and
  //    skipped entirely for manually-coordinated rounds — see autoInvite).
  const sendsInvites = stageSendsInvites(stageKey);
  const attendees = [
    liveCandidateEmail(candidate)
      ? { email: calendarCandidateEmail(liveCandidateEmail(candidate)), name: candidate.candidate_name, role: 'candidate' }
      : null,
    ...interviewerEmails.map((email) => ({ email, role: 'panel' })),
  ].filter(Boolean);

  // ── DANGER WINDOW ────────────────────────────────────────────────────────
  // The booking row now exists but carries none of its detail. Everything from
  // here to the final update is wrapped so that a failure rolls the row back
  // rather than stranding it as a phantom that blocks the round forever. See
  // rollbackFailedBooking() for why this is a compensating action and not a
  // transaction.
  let calendar = NO_CALENDAR;
  let inviteSentAt = null;
  let updated;
  let when = fmtIst(start);
  try {
    calendar = sendsInvites
      ? await createInterviewEvent({
        subject: `${stageLabel} — ${candidate?.candidate_name || 'Candidate'} (${position})`,
        bodyHtml: `<p>${stageLabel} for <strong>${candidate?.candidate_name || 'the candidate'}</strong> — ${position}.</p>${notes ? `<p>${notes}</p>` : ''}`,
        start,
        end,
        attendees,
      })
      : NO_CALENDAR;

    // 2b) Make the meeting record itself, and demote the candidate to attendee so
    //     they cannot stop it. Best-effort: a failure is recorded on the row (and
    //     surfaced in the drawer) rather than costing the recruiter the booking.
    const recording = await applyRecordingOptions(stageKey, calendar.onlineMeetingId);

    // 3) Notify both sides. Recipients follow the usual prod/non-prod redirect.
    //    Copy comes from the modal when the recruiter edited it, else the seeded
    //    templates compiled with this booking's real details (incl. Teams link).
    const defaults = await buildInterviewEmails('schedule', {
      candidate,
      stageLabel,
      position,
      when,
      durationMinutes,
      joinUrl: calendar.joinUrl,
      meetingId: calendar.meetingId,
      passcode: calendar.passcode,
      reason: null,
      interviewerName: resolvedName,
      interviewerEmail: interviewerEmailList,
    });

    // The recruiter-edited copy from the modal was previewed before the meeting
    // existed, so ensure the Teams block is present on the body actually sent.
    // Branding is applied AFTER that, so the Teams block lands inside the card
    // rather than after </html> (plan §3.2).
    // Each side's header headline is its own final subject.
    const candidateFinalSubject = candidateSubject ?? defaults.candidate.subject;
    const panelFinalSubject = panelSubject ?? defaults.panel.subject;
    // The recording notice is applied AFTER the Teams block and BEFORE branding,
    // so it lands inside the branded card rather than after </html> — same
    // reasoning as the Teams block above.
    const isRecorded = Boolean(recording.appliedAt);
    const candidateEmail = {
      subject: candidateFinalSubject,
      body: wrapBrandedEmail(
        ensureRecordingNotice(
          ensureTeamsBlock(candidateBody ?? defaults.candidate.body, calendar.joinUrl, calendar.meetingId, calendar.passcode),
          'candidate', isRecorded
        ),
        interviewWrapOpts(candidateFinalSubject)
      ),
    };
    const panelEmail = {
      subject: panelFinalSubject,
      body: wrapBrandedEmail(
        ensureRecordingNotice(
          ensureTeamsBlock(panelBody ?? defaults.panel.body, calendar.joinUrl, calendar.meetingId, calendar.passcode),
          'panel', isRecorded
        ),
        interviewWrapOpts(panelFinalSubject)
      ),
    };

    const { to: candidateTo } = resolveRecipients('interviewScheduled', liveCandidateEmail(candidate));
    if (sendsInvites && candidateTo && candidateEmail.subject) {
      try {
        await sendGraphEmail({
          sender: config.microsoft.defaultSender,
          to: candidateTo,
          subject: candidateEmail.subject,
          html: candidateEmail.body,
        });
        inviteSentAt = new Date();
      } catch (err) {
        logger.error(`Interview schedule: candidate email failed for pipeline ${pipelineId}: ${err.message}`);
      }
    }

    const { to: interviewerTo } = resolveRecipients('interviewScheduledPanel', interviewerEmailList);
    if (sendsInvites && interviewerTo && panelEmail.subject) {
      try {
        // OPERATOR_ADDRESSED: the panel address was typed into the Schedule modal
        // for this very booking, so it is reached in every environment.
        await sendGraphEmail({
          sender: config.microsoft.defaultSender,
          to: interviewerTo,
          subject: panelEmail.subject,
          html: panelEmail.body,
          allowRealRecipients: true,
        });
        inviteSentAt = inviteSentAt || new Date();
      } catch (err) {
        logger.error(`Interview schedule: interviewer email failed for pipeline ${pipelineId}: ${err.message}`);
      }
    }

    updated = await prisma.rpa_interview_schedule.update({
      where: { id: row.id },
      data: {
        graph_event_id: calendar.eventId,
        teams_join_url: calendar.joinUrl,
        // Stored so the occurrence sweep can read the Teams attendance report
        // after the meeting ends (null unless the calendar integration is on).
        online_meeting_id: calendar.onlineMeetingId,
        // Dial-in details shown in the invite emails (mirror the Outlook block).
        teams_meeting_id: calendar.meetingId,
        teams_passcode: calendar.passcode,
        // Null here means this round is NOT recording — either the feature is off,
        // the round is not in the recorded set, or Graph refused the PATCH (in
        // which case record_policy_error says why).
        record_auto_applied_at: recording.appliedAt,
        record_policy_error: recording.error,
        invite_sent_at: inviteSentAt,
        modified_at: new Date(),
      },
    });
  } catch (err) {
    // Nothing reached anybody → undo the booking so the round stays bookable.
    // Something DID reach somebody → the round is genuinely booked, however
    // incomplete the row is; erasing it would strand a real invitation. Keep it
    // and shout, so a human can repair rather than a recruiter be told to retry
    // a booking that already exists.
    if (!inviteSentAt) {
      await rollbackFailedBooking(row.id, calendar, err);
    } else {
      logger.error(
        `Interview schedule: booking ${row.id} (pipeline ${pipelineId} ${stageKey}) failed AFTER invitations went out — ${err.message}. `
        + 'The booking is kept because people have already been invited, but its row is incomplete; check it in the drawer.'
      );
    }
    throw err;
  }

  // ── PAST THE DANGER WINDOW ───────────────────────────────────────────────
  // The booking is complete and committed. What follows is bookkeeping, and a
  // failure in it must NOT surface as a failed booking: doing so would send the
  // recruiter round again to a round that is now genuinely booked, and the
  // second attempt would be refused with "already has a scheduled interview" —
  // the very symptom this rewrite exists to remove.
  try {
    // Record the booking on the journey's audit trail.
    await prisma.rpa_pipeline_stage_events.create({
      data: {
        pipeline_id: pipeline.id,
        stage_key: stageKey,
        event_type: 'note',
        notes: `${stageLabel} scheduled for ${when}${resolvedName ? ` with ${resolvedName}` : ''}${calendar.joinUrl ? ' (Teams)' : ''}${sendsInvites ? '' : ' — coordinated manually, no invite sent'}`,
        acted_by: actedBy || null,
      },
    });

    // Vendor status line (M6). Says the round was booked — never the time, the
    // panel, or the Teams link, none of which are a vendor's business.
    await notifyVendor({
      pipelineRow: pipeline,
      candidate: { name: candidate?.candidate_name },
      eventType: VENDOR_EVENTS.INTERVIEW_SCHEDULED,
      stageKey,
      stageLabel,
      positionLabel: position,
    });
  } catch (err) {
    logger.error(`Interview schedule: booking ${row.id} succeeded but its follow-up bookkeeping failed — ${err.message}`);
  }

  logger.info(`Interview scheduled: pipeline ${pipelineId} ${stageKey} at ${start.toISOString()} (calendar=${calendar.eventId ? 'yes' : isCalendarEnabled() ? 'failed' : 'disabled'}).`);
  return serialize(updated);
}

/**
 * Cancels a booking: cancels the calendar event (best effort), marks the row
 * cancelled so the round can be rebooked, and notifies the candidate.
 *
 * @param {number} scheduleId
 * @param {object} params
 * @param {string} params.reason
 * @param {number} params.actedBy
 * @param {string|null} [params.candidateSubject] - recruiter-edited copy from the modal
 * @param {string|null} [params.candidateBody]
 * @param {string|null} [params.panelSubject]
 * @param {string|null} [params.panelBody]
 * @param {boolean} [params.notifyCandidateOfCancellation=true] - false when the
 *   cancellation is a CONSEQUENCE of a larger event rather than news in its own
 *   right. setFinalOutcome passes false when closing a journey.
 *
 *   Panel always, candidate never (decision, 2026-08-26 — audit §6a). The panel
 *   half is never suppressed: someone must not show up to a room for a
 *   candidate who is no longer coming. The candidate half is, because five of
 *   the eight closure outcomes are in SILENT_FINAL_OUTCOMES precisely on the
 *   grounds that there is nothing to tell someone who withdrew — and mailing
 *   them "your Tech 2 interview is cancelled" would reintroduce, through the
 *   side door, the notification that rule exists to prevent.
 *
 *   NOT named `notifyVendor`: that is a live import in this module (:29), and a
 *   destructured param of that name would shadow it, turning the call below
 *   into a boolean invocation.
 */
export async function cancelInterviewRound(scheduleId, {
  reason,
  actedBy,
  candidateSubject = null,
  candidateBody = null,
  panelSubject = null,
  panelBody = null,
  notifyCandidateOfCancellation = true,
}) {
  const row = await prisma.rpa_interview_schedule.findUnique({
    where: { id: BigInt(scheduleId) },
    include: {
      rpa_candidate_pipeline: { include: { rpa_shortlisted_candidates: { include: { mrf: true, cv: { select: { EmailID: true } } } } } },
    },
  });
  if (!row) {
    throw new AppError('Interview booking not found.', 404);
  }
  if (row.status === 'cancelled') {
    throw new AppError('This interview is already cancelled.', 400);
  }

  await cancelInterviewEvent(row.graph_event_id, reason || 'This interview has been cancelled.');

  // Conditional claim, not a bare update. The `status === 'cancelled'` read
  // above and this write straddle an await (the Graph call), so two racers —
  // a recruiter cancelling by hand while a journey closure sweeps the same
  // booking — both passed the check and both went on to email the panel twice.
  // `status: { not: 'cancelled' }` in the filter means exactly one of them wins.
  const claim = await prisma.rpa_interview_schedule.updateMany({
    where: { id: row.id, status: { not: 'cancelled' } },
    data: { status: 'cancelled', cancelled_at: new Date(), cancel_reason: reason || null, modified_at: new Date() },
  });
  if (claim.count !== 1) {
    throw new AppError('This interview is already cancelled.', 400);
  }
  const updated = await prisma.rpa_interview_schedule.findUnique({ where: { id: row.id } });

  const candidate = row.rpa_candidate_pipeline?.rpa_shortlisted_candidates;
  const stageLabel = SCHEDULABLE_STAGES[row.stage_key]?.label || row.stage_key;
  const position = candidate?.mrf?.position_hiring_for || candidate?.position_applied || 'the role';
  // A manually-coordinated round was never invited by the system, so it is not
  // un-invited by it either — HR tells the client themselves (Q14).
  const sendsInvites = stageSendsInvites(row.stage_key);

  // Copy from the modal when edited, else the seeded cancellation templates
  // compiled with the reason the recruiter gave.
  const defaults = await buildInterviewEmails('cancel', {
    candidate,
    stageLabel,
    position,
    when: fmtIst(row.scheduled_start_at),
    durationMinutes: Math.round((new Date(row.scheduled_end_at) - new Date(row.scheduled_start_at)) / 60000),
    joinUrl: null,
    reason,
    interviewerName: row.interviewer_name,
    interviewerEmail: row.interviewer_email,
  });
  const candidateFinalSubject = candidateSubject ?? defaults.candidate.subject;
  const panelFinalSubject = panelSubject ?? defaults.panel.subject;
  const candidateEmail = {
    subject: candidateFinalSubject,
    body: wrapBrandedEmail(candidateBody ?? defaults.candidate.body, interviewWrapOpts(candidateFinalSubject)),
  };
  const panelEmail = {
    subject: panelFinalSubject,
    body: wrapBrandedEmail(panelBody ?? defaults.panel.body, interviewWrapOpts(panelFinalSubject)),
  };

  const { to: candidateTo } = resolveRecipients('interviewCancelled', liveCandidateEmail(candidate));
  if (notifyCandidateOfCancellation && sendsInvites && candidateTo && candidateEmail.subject) {
    try {
      await sendGraphEmail({
        sender: config.microsoft.defaultSender,
        to: candidateTo,
        subject: candidateEmail.subject,
        html: candidateEmail.body,
      });
    } catch (err) {
      logger.error(`Interview cancel: candidate email failed for schedule ${scheduleId}: ${err.message}`);
    }
  }

  // Also tell the panel the round is off, so no one shows up.
  // Never gated on notifyCandidateOfCancellation: whatever the cancellation is a
  // consequence of, the panel must not show up to a room for a candidate who is
  // no longer coming.
  const { to: panelTo } = resolveRecipients('interviewCancelledPanel', row.interviewer_email || '');
  if (sendsInvites && panelTo && panelEmail.subject) {
    try {
      // OPERATOR_ADDRESSED: same panel mailbox the booking was made against.
      await sendGraphEmail({
        sender: config.microsoft.defaultSender,
        to: panelTo,
        subject: panelEmail.subject,
        html: panelEmail.body,
        allowRealRecipients: true,
      });
    } catch (err) {
      logger.error(`Interview cancel: panel email failed for schedule ${scheduleId}: ${err.message}`);
    }
  }

  await prisma.rpa_pipeline_stage_events.create({
    data: {
      pipeline_id: row.pipeline_id,
      stage_key: row.stage_key,
      event_type: 'note',
      notes: `${stageLabel} interview cancelled${reason ? `: ${reason}` : ''}`,
      acted_by: actedBy || null,
    },
  });

  // Vendor status line (M6). The cancellation reason is deliberately not
  // forwarded — it is internal, and often about the panel rather than the
  // candidate. Suppressed for a closure-driven cancellation, which sends its
  // own VENDOR_EVENTS.CLOSURE line moments later; the vendor wants the outcome,
  // not a play-by-play of the bookings being torn down to reach it.
  if (notifyCandidateOfCancellation) {
    await notifyVendor({
      pipelineRow: row.rpa_candidate_pipeline,
      candidate: { name: candidate?.candidate_name },
      eventType: VENDOR_EVENTS.INTERVIEW_CANCELLED,
      stageKey: row.stage_key,
      stageLabel,
      positionLabel: position,
    });
  }

  logger.info(`Interview cancelled: schedule ${scheduleId} (pipeline ${row.pipeline_id}, ${row.stage_key}).`);
  return serialize(updated);
}

/**
 * Preview for the Reschedule action — the candidate + panel "rescheduled"
 * emails, showing the existing booking's time as `previous_when` and the
 * recruiter's proposed new time as `interview_when`.
 *
 * @param {number} pipelineId
 * @param {object} params - { stageKey, startAt, durationMinutes }
 */
export async function previewRescheduleEmails(pipelineId, { stageKey, startAt, durationMinutes = 60, interviewerName = '', interviewerEmail = '' } = {}) {
  const pipeline = await prisma.rpa_candidate_pipeline.findUnique({
    where: { id: BigInt(pipelineId) },
    include: { rpa_shortlisted_candidates: { include: { mrf: true, cv: { select: { EmailID: true } } } } },
  });
  if (!pipeline) throw new AppError('Pipeline journey not found.', 404);
  const key = stageKey || pipeline.current_stage_key;
  if (!isSchedulableStage(key)) {
    throw new AppError('This stage does not support interview scheduling.', 400);
  }

  const candidate = pipeline.rpa_shortlisted_candidates;
  const existing = await getLiveSchedule(pipelineId, key);
  const start = startAt ? new Date(startAt) : new Date(Date.now() + 24 * 60 * 60 * 1000);

  return buildInterviewEmails('reschedule', {
    candidate,
    stageLabel: SCHEDULABLE_STAGES[key].label,
    position: candidate?.mrf?.position_hiring_for || candidate?.position_applied || 'the role',
    when: fmtIst(start),
    previousWhen: existing ? fmtIst(existing.scheduled_start_at) : '(not set)',
    durationMinutes,
    // The live booking's Teams details, NOT null. A reschedule now patches the
    // event rather than replacing it, so this join link is the one the candidate
    // will still be using afterwards — and the preview is what the recruiter
    // reads and edits before sending. Showing a link-free body here made the
    // reschedule notice look like it carried no way to join (it did: the send
    // path appends the block via ensureTeamsBlock), which is what the D4
    // investigation on 2026-08-20 caught.
    joinUrl: existing?.teams_join_url || null,
    meetingId: existing?.teams_meeting_id || null,
    passcode: existing?.teams_passcode || null,
    reason: null,
    // What the recruiter is typing wins; the existing booking is the fallback,
    // since a reschedule usually keeps the same panel.
    interviewerName: interviewerName || existing?.interviewer_name || '',
    interviewerEmail: interviewerEmail || existing?.interviewer_email || '',
  });
}

/**
 * Reschedules the candidate's current-round interview: cancels the existing
 * booking (calendar event + row), creates a NEW booking, and sends ONE
 * "rescheduled" email to each side showing the old → new time. This is
 * cancel+rebook in a single action, so the recipient sees it as a move, not
 * two disconnected cancel/invite mails.
 *
 * @param {number} pipelineId
 * @param {object} params - same shape as scheduleInterviewRound, plus the
 *   optional edited candidate/panel copy.
 */
export async function rescheduleInterviewRound(pipelineId, {
  stageKey,
  startAt,
  durationMinutes = 60,
  interviewerEmail = '',
  interviewerName = '',
  actedBy,
  candidateSubject = null,
  candidateBody = null,
  panelSubject = null,
  panelBody = null,
}) {
  if (!isSchedulableStage(stageKey)) {
    throw new AppError(`Stage "${stageKey}" does not support interview scheduling.`, 400);
  }

  const pipeline = await prisma.rpa_candidate_pipeline.findUnique({
    where: { id: BigInt(pipelineId) },
    include: { rpa_shortlisted_candidates: { include: { mrf: true, cv: { select: { EmailID: true } } } } },
  });
  if (!pipeline) throw new AppError('Pipeline journey not found.', 404);
  if (pipeline.current_stage_key !== stageKey) {
    throw new AppError(`The candidate is not currently on ${SCHEDULABLE_STAGES[stageKey].label}.`, 400);
  }

  const oldRow = await getLiveSchedule(pipelineId, stageKey);
  if (!oldRow) {
    throw new AppError('There is no scheduled interview to reschedule. Use Schedule Interview instead.', 400);
  }
  const previousWhen = fmtIst(oldRow.scheduled_start_at);

  const { emails: interviewerEmails, invalid } = parseInterviewerEmails(interviewerEmail);
  if (invalid.length > 0) {
    throw new AppError(`Not a valid email address: ${invalid.join(', ')}. Separate multiple interviewers with commas.`, 400);
  }
  if (interviewerEmails.length === 0) {
    throw new AppError("At least one interviewer's email is required so they receive the invite.", 400);
  }
  const interviewerEmailList = interviewerEmails.join(', ');

  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) throw new AppError('A valid interview date & time is required.', 400);
  if (start.getTime() < Date.now()) throw new AppError('The new interview time is in the past. Please pick a future slot.', 400);
  const end = new Date(start.getTime() + Math.max(15, durationMinutes) * 60 * 1000);

  const candidate = pipeline.rpa_shortlisted_candidates;
  const hints = mrfRoundHints(candidate?.mrf, stageKey);
  const resolvedName = (interviewerName || '').trim() || hints?.interviewerName || null;
  const stageLabel = SCHEDULABLE_STAGES[stageKey].label;
  const position = candidate?.mrf?.position_hiring_for || candidate?.position_applied || 'the role';

  // 1) Move the EXISTING calendar event rather than destroying it (defect D4).
  //
  //    The booking ROW still has to be replaced — the unique "one live booking
  //    per round" index requires the old one to go cancelled before a new one
  //    can be inserted — but the Graph EVENT is a separate thing, and the two
  //    were needlessly coupled. Cancelling it minted a fresh Teams meeting on
  //    every reschedule, so everyone holding the original invite got a dead
  //    join link, and Outlook mailed the candidate a "Canceled:" notice for the
  //    destroyed meeting at the same moment we told them it had merely moved.
  //
  //    Patching start/end leaves onlineMeeting alone: the join URL, meeting id
  //    and passcode survive, and attendees get a normal "Updated:" notice.
  //
  //    The guest list goes with the patch. It used not to, which left the panel
  //    on an event stale when the recruiter changed it mid-journey, and — worse
  //    — meant an event booked before the non-prod attendee guard kept its REAL
  //    candidate address for life, so staging went on mailing that candidate an
  //    "Updated:"/"Canceled:" notice from Outlook every time the round moved.
  const attendees = [
    liveCandidateEmail(candidate)
      ? { email: calendarCandidateEmail(liveCandidateEmail(candidate)), name: candidate.candidate_name, role: 'candidate' }
      : null,
    ...interviewerEmails.map((email) => ({ email, role: 'panel' })),
  ].filter(Boolean);

  const sendsInvitesForStage = stageSendsInvites(stageKey);
  const patched = sendsInvitesForStage
    ? await updateInterviewEventTime(oldRow.graph_event_id, {
      start,
      end,
      subject: `${stageLabel} — ${candidate?.candidate_name || 'Candidate'} (${position})`,
      attendees,
    })
    : { ok: false, error: 'stage does not send invites' };

  // Fall back to the old cancel-and-recreate when the patch could not happen —
  // a booking made while the calendar was off has no event to patch, and a
  // Graph failure must not cost the recruiter their reschedule.
  if (!patched.ok && oldRow.graph_event_id && sendsInvitesForStage) {
    await cancelInterviewEvent(oldRow.graph_event_id, 'This interview has been rescheduled.');
  }

  await prisma.rpa_interview_schedule.update({
    where: { id: BigInt(oldRow.id) },
    data: { status: 'cancelled', cancelled_at: new Date(), cancel_reason: 'Rescheduled', modified_at: new Date() },
  });

  // 2) Create the new booking.
  const row = await prisma.rpa_interview_schedule.create({
    data: {
      pipeline_id: pipeline.id,
      stage_key: stageKey,
      interviewer_name: resolvedName,
      interviewer_email: interviewerEmailList,
      scheduled_start_at: start,
      scheduled_end_at: end,
      status: 'scheduled',
      created_by: actedBy || null,
    },
  });

  // 3) The calendar side. When the patch above succeeded there is nothing to
  //    create — the same event, and the same Teams meeting, carry forward onto
  //    the new row. Only fall back to creating one when the patch could not
  //    happen (calendar off, no prior event, or Graph refused the PATCH).
  const sendsInvites = sendsInvitesForStage;

  // ── DANGER WINDOW (same shape as scheduleInterviewRound) ─────────────────
  // Worse here than on a fresh booking: the OLD row has already been cancelled,
  // so a failure now would leave the round with one cancelled booking and one
  // phantom — no live interview, and no way to rebook without a hand cleanup.
  let calendar;
  let inviteSentAt = null;
  let updated;
  try {
    if (patched.ok) {
      calendar = {
        eventId: patched.eventId,
        joinUrl: patched.joinUrl,
        onlineMeetingId: patched.onlineMeetingId,
        meetingId: patched.meetingId,
        passcode: patched.passcode,
        skipped: false,
        error: null,
      };
    } else if (sendsInvites) {
      calendar = await createInterviewEvent({
        subject: `${stageLabel} (rescheduled) — ${candidate?.candidate_name || 'Candidate'} (${position})`,
        bodyHtml: `<p>${stageLabel} for <strong>${candidate?.candidate_name || 'the candidate'}</strong> — ${position} (rescheduled).</p>`,
        start,
        end,
        attendees,
      });
    } else {
      calendar = NO_CALENDAR;
    }

    // 3b) Re-assert auto-recording. Usually a no-op — the patched meeting keeps
    //     its options — but it heals bookings made before this feature existed and
    //     covers the cancel-and-recreate branch above, which mints a NEW meeting
    //     carrying Teams' defaults (recording off, everyone a presenter).
    const recording = await applyRecordingOptions(stageKey, calendar.onlineMeetingId);

    // 4) One "rescheduled" email per side, old → new time.
    const when = fmtIst(start);
    const defaults = await buildInterviewEmails('reschedule', {
      candidate, stageLabel, position, when, previousWhen, durationMinutes,
      joinUrl: calendar.joinUrl, meetingId: calendar.meetingId, passcode: calendar.passcode, reason: null,
      interviewerName: resolvedName, interviewerEmail: interviewerEmailList,
    });
    const candidateFinalSubject = candidateSubject ?? defaults.candidate.subject;
    const panelFinalSubject = panelSubject ?? defaults.panel.subject;
    const isRecorded = Boolean(recording.appliedAt);
    const candidateEmail = {
      subject: candidateFinalSubject,
      body: wrapBrandedEmail(ensureRecordingNotice(ensureTeamsBlock(candidateBody ?? defaults.candidate.body, calendar.joinUrl, calendar.meetingId, calendar.passcode), 'candidate', isRecorded), interviewWrapOpts(candidateFinalSubject)),
    };
    const panelEmail = {
      subject: panelFinalSubject,
      body: wrapBrandedEmail(ensureRecordingNotice(ensureTeamsBlock(panelBody ?? defaults.panel.body, calendar.joinUrl, calendar.meetingId, calendar.passcode), 'panel', isRecorded), interviewWrapOpts(panelFinalSubject)),
    };

    const { to: candidateTo } = resolveRecipients('interviewScheduled', liveCandidateEmail(candidate));
    if (sendsInvites && candidateTo && candidateEmail.subject) {
      try {
        await sendGraphEmail({ sender: config.microsoft.defaultSender, to: candidateTo, subject: candidateEmail.subject, html: candidateEmail.body });
        inviteSentAt = new Date();
      } catch (err) {
        logger.error(`Interview reschedule: candidate email failed for pipeline ${pipelineId}: ${err.message}`);
      }
    }
    const { to: panelTo } = resolveRecipients('interviewScheduledPanel', interviewerEmailList);
    if (sendsInvites && panelTo && panelEmail.subject) {
      try {
        // OPERATOR_ADDRESSED: panel address typed into the Reschedule modal.
        await sendGraphEmail({ sender: config.microsoft.defaultSender, to: panelTo, subject: panelEmail.subject, html: panelEmail.body, allowRealRecipients: true });
        inviteSentAt = inviteSentAt || new Date();
      } catch (err) {
        logger.error(`Interview reschedule: panel email failed for pipeline ${pipelineId}: ${err.message}`);
      }
    }

    updated = await prisma.rpa_interview_schedule.update({
      where: { id: row.id },
      data: { graph_event_id: calendar.eventId, teams_join_url: calendar.joinUrl, online_meeting_id: calendar.onlineMeetingId, teams_meeting_id: calendar.meetingId, teams_passcode: calendar.passcode, record_auto_applied_at: recording.appliedAt, record_policy_error: recording.error, invite_sent_at: inviteSentAt, modified_at: new Date() },
    });
  } catch (err) {
    // Same rule as the fresh-booking path: roll back only while nothing has
    // reached anybody. Note the new event is NOT cancelled when the reschedule
    // PATCHED an existing meeting — that meeting belongs to the round, not to
    // this attempt, and cancelling it would wipe out the booking we were only
    // trying to move.
    if (!inviteSentAt) {
      await rollbackFailedBooking(row.id, patched.ok ? null : calendar, err);
    } else {
      logger.error(
        `Interview reschedule: booking ${row.id} (pipeline ${pipelineId} ${stageKey}) failed AFTER invitations went out — ${err.message}. Kept, but incomplete.`
      );
    }
    throw err;
  }

  try {
    await prisma.rpa_pipeline_stage_events.create({
      data: {
        pipeline_id: pipeline.id,
        stage_key: stageKey,
        event_type: 'note',
        notes: `${stageLabel} rescheduled: ${previousWhen} → ${when}${resolvedName ? ` with ${resolvedName}` : ''}`,
        acted_by: actedBy || null,
      },
    });

    // Vendor status line (M6) — the round moved; neither the old nor the new
    // time goes out.
    await notifyVendor({
      pipelineRow: pipeline,
      candidate: { name: candidate?.candidate_name },
      eventType: VENDOR_EVENTS.INTERVIEW_RESCHEDULED,
      stageKey,
      stageLabel,
      positionLabel: position,
    });
  } catch (err) {
    // Bookkeeping only — the reschedule itself is committed. Surfacing this as a
    // failure would send the recruiter back to a round that has already moved.
    logger.error(`Interview reschedule: booking ${row.id} succeeded but its follow-up bookkeeping failed — ${err.message}`);
  }

  logger.info(`Interview rescheduled: pipeline ${pipelineId} ${stageKey} ${previousWhen} -> ${start.toISOString()}.`);
  return serialize(updated);
}

/**
 * Records whether a scheduled interview actually HAPPENED — the single gate the
 * scorecard is released under. Converged on by all three paths: the Graph
 * attendance sweep (source 'graph'), the recruiter's drawer button (source
 * 'recruiter'), and the interviewer's no-login gate link (source 'interviewer').
 *
 * Idempotent: once occurrence_status is set, the verdict is returned unchanged
 * so a second path (or a repeated sweep tick) is a no-op. On 'held' the booking
 * becomes status='completed' and the scorecard links are dispatched exactly
 * once (guarded inside dispatchScorecards by scorecard_dispatched_at). On
 * 'no_show' the booking becomes status='no_show', the reason is recorded, and
 * NO scorecard is ever sent — the caller then offers reschedule/reject.
 *
 * @param {number|bigint} scheduleId
 * @param {object} params
 * @param {'held'|'no_show'} params.outcome
 * @param {'graph'|'recruiter'|'interviewer'} params.source
 * @param {string} [params.confirmedBy] - ATS username or interviewer email
 * @param {number} [params.actedBy] - ATS user id (recruiter path)
 * @param {string} [params.party] - no_show only: candidate|panel|both|technical
 * @param {string} [params.reason] - no_show only
 * @returns {Promise<{status: string, occurrence_status: string, alreadyResolved: boolean, scorecard?: object}>}
 */
export async function markInterviewOccurrence(scheduleId, { outcome, source, confirmedBy = null, actedBy = null, party = null, reason = null } = {}) {
  if (!Object.values(OCCURRENCE_STATUS).includes(outcome)) {
    throw new AppError("outcome must be 'held' or 'no_show'.", 400);
  }

  const schedule = await prisma.rpa_interview_schedule.findUnique({ where: { id: BigInt(scheduleId) } });
  if (!schedule) throw new AppError('Interview booking not found.', 404);
  if (schedule.status === 'cancelled') {
    throw new AppError('This interview was cancelled; its occurrence cannot be recorded.', 400);
  }

  // Already resolved → return the existing verdict unchanged (idempotent).
  //
  // 'unconfirmed' is NOT a verdict: the occurrence sweep writes it after two
  // weeks of nobody confirming, only so the row stops looking pending. A real
  // held/no_show decision must still be able to land on top of it, otherwise a
  // written-off interview could never dispatch its scorecard.
  if (schedule.occurrence_status && schedule.occurrence_status !== OCCURRENCE_UNCONFIRMED) {
    return { status: schedule.status, occurrence_status: schedule.occurrence_status, alreadyResolved: true };
  }

  const stageLabel = SCHEDULABLE_STAGES[schedule.stage_key]?.label || schedule.stage_key;
  const newStatus = outcome === 'held' ? 'completed' : 'no_show';

  await prisma.rpa_interview_schedule.update({
    where: { id: schedule.id },
    data: {
      status: newStatus,
      occurrence_status: outcome,
      occurrence_source: source || null,
      occurrence_confirmed_by: confirmedBy || null,
      occurrence_confirmed_at: new Date(),
      no_show_party: outcome === 'no_show' ? (party || null) : null,
      no_show_reason: outcome === 'no_show' ? (reason || null) : null,
      modified_at: new Date(),
    },
  });

  // Audit note on the journey.
  await prisma.rpa_pipeline_stage_events.create({
    data: {
      pipeline_id: schedule.pipeline_id,
      stage_key: schedule.stage_key,
      event_type: 'note',
      notes: outcome === 'held'
        ? `${stageLabel} confirmed held (${source || 'manual'})`
        : `${stageLabel} marked no-show${party ? ` — ${party}` : ''}${reason ? `: ${reason}` : ''} (${source || 'manual'})`,
      acted_by: actedBy || null,
    },
  });

  logger.info(`Interview occurrence: schedule ${scheduleId} → ${outcome} (${source}).`);

  // A no-show needs a human decision — reschedule or reject (Q9: never
  // auto-Hold). 'held' raises its own notification from dispatchScorecards().
  if (outcome === 'no_show') {
    const { notify, NOTIFICATION_TYPES } = await import('./notification.service.js');
    await notify({
      type: NOTIFICATION_TYPES.INTERVIEW_NO_SHOW,
      title: `No-show — ${stageLabel}`,
      description: `${party ? `${party} did not attend` : 'The interview did not happen'}${reason ? `: ${reason}` : ''} — reschedule or reject`,
      pipelineId: schedule.pipeline_id,
      meta: { stage_key: schedule.stage_key, party, source },
      excludeUserId: actedBy || null,
    });
  }

  // On 'held', release the scorecard links (exactly once). Lazy import breaks
  // the cycle with interviewScorecard.service.js (which imports helpers here).
  let scorecard;
  if (outcome === 'held') {
    const { dispatchScorecards } = await import('./interviewScorecard.service.js');
    scorecard = await dispatchScorecards(scheduleId, { trigger: source === 'graph' ? 'graph' : 'manual', actedBy });
  }

  return { status: newStatus, occurrence_status: outcome, alreadyResolved: false, scorecard };
}
