/**
 * interviewOccurrence.js — post-interview OCCURRENCE sweep for booked human
 * rounds (rpa_interview_schedule). Inverts the pre-interview reminder window:
 * every N minutes it looks for interviews whose scheduled_end_at has passed but
 * whose occurrence is still unresolved, and tries to settle "did it happen?".
 *
 * CRITICAL: this job NEVER sends a scorecard on the end time alone. For each
 * due booking it either
 *   (a) reads the Teams attendance report (when MS_ATTENDANCE_ENABLED) and, if
 *       decisive, marks the interview held/no_show via markInterviewOccurrence
 *       (held then dispatches the scorecard exactly once), or
 *   (b) sends a ONE-TIME "please confirm it happened" nudge to recruiter/HR,
 *       leaving the booking 'scheduled' until a human confirms.
 *
 * Idempotency: attendance_checked_at (last poll) and occurrence_nudge_at (nudge
 * sent once) guard against reprocessing, mirroring the reminder job's
 * *_reminded_at columns. See docs/phase3/INTERVIEWER-SCORECARD-PLAN.md.
 */
import cron from 'node-cron';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import { resolveRecipients, nonProdSafeCandidateEmail } from '../config/emailRecipients.js';
import { sendGraphEmail, compileTemplate } from '../services/emailNotification.service.js';
import { wrapBrandedEmail } from '../services/emailLayout.service.js';
import { markInterviewOccurrence, OCCURRENCE_UNCONFIRMED } from '../services/interviewSchedule.service.js';
import { getAttendanceOutcome, isAttendanceEnabled } from '../services/graphAttendance.service.js';
import { notify, NOTIFICATION_TYPES } from '../services/notification.service.js';

let job = null;

export const SETTING_KEYS = Object.freeze({
  ENABLED: 'interview_occurrence_enabled',
  INTERVAL_MIN: 'interview_occurrence_interval_min',
  GRACE_MIN: 'interview_occurrence_grace_min',
});

/** Poll intervals the UI offers, in minutes (shared with the reminder job). */
export const ALLOWED_INTERVALS = Object.freeze([1, 2, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]);

const DEFAULTS = { enabled: false, intervalMin: 30, graceMin: 15 };

/**
 * How long to wait before nudging again about an interview nobody has confirmed,
 * and how many nudges to send in total before giving up.
 *
 * The sweep used to send exactly ONE nudge and then exclude the booking forever
 * (`occurrence_nudge_at: null` in the due filter). If that single email was
 * missed, the interview stayed unresolved permanently: no scorecard, no second
 * prompt, and — because the same filter gated the attendance branch — no further
 * attempt to read a Teams report that may only have become available afterwards.
 *
 * A capped re-nudge is the middle ground: persistent enough to be a work queue,
 * bounded so it never becomes a daily nag about an interview that plainly is not
 * going to be confirmed.
 */
const NUDGE_REPEAT_HOURS = 24;
const MAX_NUDGES = 3;

/**
 * How long the Teams attendance branch keeps re-checking, and when an interview
 * nobody ever confirmed is finally written off.
 *
 * The nudge cap above and this one used to be the same bound, which quietly
 * stranded bookings: once selection stopped at MAX_NUDGES × NUDGE_REPEAT_HOURS,
 * the attendance branch stopped too, so a row whose Teams report published late
 * — or whose recruiter simply missed three emails — kept occurrence_status=null
 * forever. Because scorecard dispatch is gated on 'held', those interviews could
 * never produce a result, and nothing surfaced them.
 *
 * Splitting the two lets the emails stay capped (they are a nag) while the free,
 * silent attendance read keeps trying. The hard stop then closes the row out as
 * OCCURRENCE_UNCONFIRMED instead of leaving it pending in perpetuity.
 */
const ATTENDANCE_RECHECK_DAYS = 14;

/**
 * Reads the occurrence-sweep configuration from rpa_settings, with defaults.
 * @returns {Promise<{enabled: boolean, intervalMin: number, graceMin: number}>}
 */
export async function getInterviewOccurrenceSettings() {
  const rows = await prisma.rpa_settings.findMany({
    where: { key: { in: Object.values(SETTING_KEYS) } },
  });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  const intervalMin = parseInt(map[SETTING_KEYS.INTERVAL_MIN], 10);
  const graceMin = parseInt(map[SETTING_KEYS.GRACE_MIN], 10);

  return {
    enabled: map[SETTING_KEYS.ENABLED] === 'true',
    intervalMin: ALLOWED_INTERVALS.includes(intervalMin) ? intervalMin : DEFAULTS.intervalMin,
    graceMin: Number.isInteger(graceMin) && graceMin >= 0 ? graceMin : DEFAULTS.graceMin,
  };
}

/** Builds the node-cron expression for an every-N-minutes poll. */
const cronForInterval = (minutes) => (minutes >= 60 ? '0 * * * *' : `*/${minutes} * * * *`);

const fmtIst = (d) =>
  `${new Date(d).toLocaleString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
  })} IST`;

/** Loads an active template row by name, or null. */
async function getTemplate(name) {
  return prisma.rpa_email_templates.findFirst({ where: { name, is_active: true } });
}

/**
 * Starts (or restarts) the occurrence sweep from the current settings.
 * A disabled setting means no cron is registered at all.
 */
export async function startInterviewOccurrenceJob() {
  try {
    // Defensive: stop any live cron first so a double start never stacks two.
    stopInterviewOccurrenceJob();

    const { enabled, intervalMin } = await getInterviewOccurrenceSettings();
    if (!enabled) {
      logger.info('⏸️  Interview occurrence sweep disabled (interview_occurrence_enabled=false) — not scheduling.');
      return;
    }
    const expression = cronForInterval(intervalMin);
    job = cron.schedule(expression, async () => {
      try {
        await sweepInterviewOccurrence();
      } catch (err) {
        logger.error(`Interview occurrence sweep failed: ${err.message}`);
      }
    });
    logger.info(`🕵️  Interview occurrence sweep running every ${intervalMin} min ("${expression}").`);
  } catch (err) {
    logger.error(`Failed to start interview occurrence job: ${err.message}`);
  }
}

/** Stops the sweep cron if one is registered. */
export function stopInterviewOccurrenceJob() {
  if (job) {
    job.stop();
    job = null;
    logger.info('Interview occurrence sweep stopped.');
  }
}

/** Applies a settings change immediately (called from the settings controller). */
export async function restartInterviewOccurrenceJob() {
  stopInterviewOccurrenceJob();
  await startInterviewOccurrenceJob();
}

/**
 * One sweep pass. Exported so it can be triggered manually and unit-tested.
 * @returns {Promise<{processed: number, held: number, noShow: number, nudged: number}>}
 */
export async function sweepInterviewOccurrence() {
  const { graceMin } = await getInterviewOccurrenceSettings();
  const cutoff = new Date(Date.now() - graceMin * 60 * 1000);

  // Bookings whose window ended (+grace) and whose occurrence is unresolved.
  //
  // A row stays selectable until it is either resolved or aged out, rather than
  // dropping out the moment one nudge is sent. Two things depend on that: the
  // nudge can repeat (capped below), and the Teams attendance branch gets
  // another look — a report is often not published until well after the meeting
  // ends, and the old one-shot filter meant we only ever asked once, usually too
  // early.
  //
  // The nudge cap is expressed as a window rather than a counter so it needs no
  // new column: nudges land ~NUDGE_REPEAT_HOURS apart, and emailing stops
  // MAX_NUDGES × NUDGE_REPEAT_HOURS after the interview ended. An interview
  // nobody has confirmed after three days is not going to be confirmed by a
  // fourth email.
  //
  // Selection, however, runs to the much longer ATTENDANCE_RECHECK_DAYS bound so
  // the attendance branch keeps looking after the emails stop (see the constant).
  const nudgeUntil = new Date(Date.now() - MAX_NUDGES * NUDGE_REPEAT_HOURS * 60 * 60 * 1000);
  const giveUpBefore = new Date(Date.now() - ATTENDANCE_RECHECK_DAYS * 24 * 60 * 60 * 1000);
  const nudgeAgainBefore = new Date(Date.now() - NUDGE_REPEAT_HOURS * 60 * 60 * 1000);

  const due = await prisma.rpa_interview_schedule.findMany({
    where: {
      status: 'scheduled',
      occurrence_status: null,
      scheduled_end_at: { lt: cutoff, gt: giveUpBefore },
    },
    include: {
      rpa_candidate_pipeline: { include: { rpa_shortlisted_candidates: { include: { mrf: true } } } },
      rpa_pipeline_stages: true,
    },
  });

  // Anything older than the re-check window is written off in one statement, so
  // it stops looking pending and drops out of every subsequent sweep.
  const writtenOff = await prisma.rpa_interview_schedule.updateMany({
    where: {
      status: 'scheduled',
      occurrence_status: null,
      scheduled_end_at: { lt: giveUpBefore },
    },
    data: {
      occurrence_status: OCCURRENCE_UNCONFIRMED,
      occurrence_source: 'system',
      occurrence_confirmed_at: new Date(),
    },
  });
  if (writtenOff.count > 0) {
    logger.warn(
      `[Occurrence Sweep] ${writtenOff.count} interview(s) unconfirmed after ${ATTENDANCE_RECHECK_DAYS} days — marked '${OCCURRENCE_UNCONFIRMED}'. A recruiter can still mark them held or no-show by hand.`
    );
  }

  if (due.length === 0) return { processed: 0, held: 0, noShow: 0, nudged: 0, unconfirmed: writtenOff.count };
  logger.info(`[Occurrence Sweep] ${due.length} interview(s) past end awaiting an occurrence verdict.`);

  let held = 0, noShow = 0, nudged = 0;

  for (const row of due) {
    const candidate = row.rpa_candidate_pipeline?.rpa_shortlisted_candidates;

    // Match attendance against the address that was actually PUT ON THE INVITE,
    // not the one on file.
    //
    // Outside production the calendar attendee is substituted with the test
    // inbox (nonProdSafeCandidateEmail), so nobody ever joins as the real
    // candidate. Matching on the real address therefore found them absent every
    // single time and auto-marked every staging interview a candidate no-show —
    // silently, and with a no-show alert to boot.
    //
    // Substituting here too keeps the two ends symmetric: whoever holds the test
    // inbox stands in for the candidate on staging, exactly as they do on the
    // invite. In production nothing is substituted and this is a no-op.
    const realCandidateEmail = candidate?.candidate_email || '';
    const candidateEmail = realCandidateEmail
      ? nonProdSafeCandidateEmail(realCandidateEmail, 'attendance:match')
      : '';

    // (a) Try Teams attendance first when enabled.
    if (isAttendanceEnabled()) {
      try {
        const outcome = await getAttendanceOutcome(row, candidateEmail);
        await prisma.rpa_interview_schedule.update({
          where: { id: row.id },
          data: { attendance_checked_at: new Date() },
        });
        if (outcome.decided) {
          // The absent side comes from the attendance report itself, so the
          // recruiter is told WHO missed it rather than a blanket 'both'.
          await markInterviewOccurrence(Number(row.id), {
            outcome: outcome.occurred ? 'held' : 'no_show',
            source: 'graph',
            party: outcome.occurred ? null : (outcome.absentParty || 'both'),
            reason: outcome.occurred ? null : noShowReasonFor(outcome.absentParty),
          });
          if (outcome.occurred) {
            held += 1; // 'held' dispatches the scorecard inside markInterviewOccurrence
          } else {
            noShow += 1;
            // Tell the recruiter it did NOT happen so they can chase or rebook.
            await sendNoShowAlert(row, candidate, outcome.absentParty);
          }
          continue; // resolved — no nudge needed
        }
      } catch (err) {
        logger.warn(`[Occurrence Sweep] attendance check failed for schedule ${row.id}: ${err.message}`);
      }
    }

    // (b) Fall back to a human-confirmation nudge — but only while the row is
    // still inside the nudge window. The due-filter no longer enforces that
    // (it now runs to the longer attendance bound), so the cap is applied here:
    // keep reading Teams reports silently, stop emailing after MAX_NUDGES.
    const endedAt = row.scheduled_end_at;
    const withinNudgeWindow = endedAt && new Date(endedAt) > nudgeUntil;
    const nudgeDue =
      !row.occurrence_nudge_at || new Date(row.occurrence_nudge_at) < nudgeAgainBefore;
    if (withinNudgeWindow && nudgeDue) {
      nudged += await sendConfirmationNudge(row, candidate) ? 1 : 0;
    }
  }

  logger.info(
    `[Occurrence Sweep] held=${held} no_show=${noShow} nudged=${nudged} unconfirmed=${writtenOff.count}.`
  );
  return { processed: due.length, held, noShow, nudged, unconfirmed: writtenOff.count };
}

/** Human-readable phrase for the side that failed to attend. */
const ABSENT_PARTY_PHRASE = Object.freeze({
  candidate: 'the candidate did not join',
  panel: 'the interviewer / panel did not join',
  both: 'neither side joined',
});

/** The stored no_show_reason for an auto-detected no-show. */
const noShowReasonFor = (party) =>
  `Teams attendance report shows ${ABSENT_PARTY_PHRASE[party] || 'no qualifying attendance'}.`;

/**
 * Alerts RECRUITER/HR that an interview did NOT take place, so they can chase
 * the absent side or rebook. Sent only when Teams attendance DECIDED the
 * interview was a no-show — never on a guess, and never for a held interview
 * (success is silent; the interviewer simply receives the scorecard link).
 *
 * @param {object} row - the rpa_interview_schedule row
 * @param {object} candidate - the joined rpa_shortlisted_candidates row
 * @param {'candidate'|'panel'|'both'|null} absentParty - who failed to attend
 * @returns {Promise<boolean>} true when the alert was sent
 */
async function sendNoShowAlert(row, candidate, absentParty) {
  const stageLabel = row.rpa_pipeline_stages?.label || row.stage_key;
  const position = candidate?.mrf?.position_hiring_for || candidate?.position_applied || 'the role';
  const when = fmtIst(row.scheduled_start_at);
  const whoMissed = ABSENT_PARTY_PHRASE[absentParty] || 'no qualifying attendance was recorded';
  const pipelineLink = `${config.cors.frontendUrl}/pipeline`;

  const tokens = {
    candidate_name: candidate?.candidate_name || 'the candidate',
    position,
    stage_label: stageLabel,
    interview_when: when,
    absent_party: whoMissed,
    confirm_link: pipelineLink,
  };

  const tpl = await getTemplate('Interview No-Show Notice');
  const compiled = tpl
    ? compileTemplate(tpl.subject, tpl.body_html, tokens)
    : {
        subject: `${stageLabel} with ${tokens.candidate_name} did not take place`,
        html: `<p>The <strong>${stageLabel}</strong> interview with <strong>${tokens.candidate_name}</strong> (${position}) scheduled for ${when} <strong>did not take place</strong>.</p>
               <p>The Microsoft Teams attendance report shows that <strong>${whoMissed}</strong>.</p>
               <p>No scorecard has been requested from the interviewer. Please reschedule the round or update the candidate's status in the Candidate Pipeline.</p>
               <p><a href="${pipelineLink}">Open the Candidate Pipeline</a></p>`,
      };

  const { to } = resolveRecipients('occurrenceNudge', config.microsoft.defaultSender);
  if (!to) return false;

  // Header headline = the email's own subject (RT decision, 2026-07-25).
  const brandedHtml = wrapBrandedEmail(compiled.html, { title: compiled.subject });
  try {
    // OPERATOR_ADDRESSED: internal recruitment mailbox, reached in every env.
    await sendGraphEmail({ sender: config.microsoft.defaultSender, to, subject: compiled.subject, html: brandedHtml, allowRealRecipients: true });
    logger.info(`[Occurrence Sweep] no-show alert sent for schedule ${row.id} (${absentParty || 'unknown'}).`);
    return true;
  } catch (err) {
    logger.error(`[Occurrence Sweep] no-show alert failed for schedule ${row.id} → ${to}: ${err.message}`);
    return false;
  }
}

/**
 * Emails RECRUITER/HR a one-time "please confirm it happened" nudge and stamps
 * occurrence_nudge_at so it is sent only once. The interviewer is not copied —
 * only a logged-in recruiter can record the verdict in the pipeline drawer.
 *
 * This is the UNDECIDED path only: attendance could not be read (disabled, no
 * report, error). A decided verdict sends the scorecard (held) or the no-show
 * alert instead.
 * @returns {Promise<boolean>} true when the nudge was sent
 */
async function sendConfirmationNudge(row, candidate) {
  const stageLabel = row.rpa_pipeline_stages?.label || row.stage_key;
  const position = candidate?.mrf?.position_hiring_for || candidate?.position_applied || 'the role';
  const when = fmtIst(row.scheduled_start_at);
  // NOTE: must be /pipeline — the real tracker whose drawer carries the
  // held/no-show controls. Not /candidate-pipeline-prototype (a mock), and not
  // /candidate-pipeline (no such route — it 404'd).
  const confirmLink = `${config.cors.frontendUrl}/pipeline`;

  const tpl = await getTemplate('Interview Attendance Check');
  const tokens = {
    candidate_name: candidate?.candidate_name || 'the candidate',
    position,
    stage_label: stageLabel,
    interview_when: when,
    confirm_link: confirmLink,
  };
  const compiled = tpl
    ? compileTemplate(tpl.subject, tpl.body_html, tokens)
    : {
        subject: `Did the ${stageLabel} with ${tokens.candidate_name} take place?`,
        html: `<p>The ${stageLabel} interview with ${tokens.candidate_name} (${position}) for ${when} has passed.</p>
               <p>Please confirm whether it happened in the Candidate Pipeline so we can request the scorecard or reschedule.</p>`,
      };

  // RECRUITER/HR ONLY (RT decision, 2026-07-27). The interviewer is deliberately
  // NOT nudged: confirming held/no-show happens in the pipeline drawer at
  // /pipeline, which is behind login, and interviewers generally have no ATS
  // account — so asking them would request an action they cannot perform. Their
  // touchpoint is the scorecard link, which is sent separately once the round is
  // confirmed held.
  //
  // The address resolves to config.microsoft.defaultSender (the recruitment
  // mailbox) because there is no per-requisition recruiter/owner field in the
  // schema yet. If one is ever added, route this to that owner instead.
  const { to: recruiterTo } = resolveRecipients('occurrenceNudge', config.microsoft.defaultSender);

  // Header headline = the email's own subject (RT decision, 2026-07-25).
  const brandedHtml = wrapBrandedEmail(compiled.html, { title: compiled.subject });

  let sentAny = false;
  for (const to of [recruiterTo].filter(Boolean)) {
    try {
      // OPERATOR_ADDRESSED: internal recruitment mailbox, reached in every env.
      await sendGraphEmail({ sender: config.microsoft.defaultSender, to, subject: compiled.subject, html: brandedHtml, allowRealRecipients: true });
      sentAny = true;
    } catch (err) {
      logger.error(`[Occurrence Sweep] nudge email failed for schedule ${row.id} → ${to}: ${err.message}`);
    }
  }

  // The same ask, in-app. The email goes to the shared recruitment mailbox
  // (no per-requisition owner exists yet), so the bell is what actually puts
  // this in front of the individual recruiters.
  await notify({
    type: NOTIFICATION_TYPES.INTERVIEW_CONFIRM_NEEDED,
    title: `Confirm: did the ${stageLabel} happen?`,
    description: `${tokens.candidate_name} · was scheduled for ${when} — mark it held or no-show`,
    pipelineId: row.pipeline_id,
    meta: { stage_key: row.stage_key, schedule_id: Number(row.id) },
  });

  // Stamp regardless of whether the email got out — the timestamp is what
  // spaces the next nudge NUDGE_REPEAT_HOURS away, so a booking with no
  // reachable recipient backs off like any other instead of being retried every
  // tick. The give-up window in sweepInterviewOccurrence() ends the sequence;
  // a human can still resolve it from the drawer at any point.
  await prisma.rpa_interview_schedule.update({
    where: { id: row.id },
    data: { occurrence_nudge_at: new Date(), modified_at: new Date() },
  });
  return sentAny;
}
