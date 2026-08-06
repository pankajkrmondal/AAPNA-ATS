/**
 * interviewReminder.js — pre-interview reminder emails for the scheduled
 * technical rounds booked through the Pipeline Tracker
 * (rpa_interview_schedule).
 *
 * Runs on a recruiter-configurable interval (Reminder Settings): every N
 * minutes it looks for interviews starting inside the lead-time window and
 * emails the candidate and the interviewer once each. The
 * candidate_reminded_at / interviewer_reminded_at columns are the idempotency
 * guard, so a tighter interval never means duplicate mail.
 *
 * Settings (rpa_settings), all editable from the Settings page:
 *   interview_reminder_enabled       'true' | 'false'  (default false)
 *   interview_reminder_interval_min  poll interval in minutes (default 30)
 *   interview_reminder_lead_min      how far ahead to remind (default 30)
 */
import cron from 'node-cron';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import { resolveRecipients } from '../config/emailRecipients.js';
import { sendGraphEmail, compileTemplate } from '../services/emailNotification.service.js';
import { wrapBrandedEmail } from '../services/emailLayout.service.js';
import { SCHEDULABLE_STAGES, buildTeamsBlock, stageSendsInvites } from '../services/interviewSchedule.service.js';

/**
 * Template names for the two reminder emails (seeded by
 * prisma/seed-email-templates.js). Promoted from hard-coded strings so HR can
 * edit the copy from the Email Templates page like every other notification;
 * the inline bodies below remain as the fallback if a row is missing.
 */
const REMINDER_TEMPLATES = Object.freeze({
  candidate: 'Interview Reminder — Candidate',
  panel: 'Interview Reminder — Panel',
});

/** Loads an active template row by name, or null. */
async function getTemplate(name) {
  return prisma.rpa_email_templates.findFirst({ where: { name, is_active: true } });
}

let job = null;

export const SETTING_KEYS = Object.freeze({
  ENABLED: 'interview_reminder_enabled',
  INTERVAL_MIN: 'interview_reminder_interval_min',
  LEAD_MIN: 'interview_reminder_lead_min',
});

/** Poll intervals the UI offers, in minutes. */
export const ALLOWED_INTERVALS = Object.freeze([1, 2, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]);

const DEFAULTS = { enabled: false, intervalMin: 30, leadMin: 30 };

/**
 * Reads the reminder configuration from rpa_settings, falling back to defaults
 * when a key has never been saved.
 * @returns {Promise<{enabled: boolean, intervalMin: number, leadMin: number}>}
 */
export async function getInterviewReminderSettings() {
  const rows = await prisma.rpa_settings.findMany({
    where: { key: { in: Object.values(SETTING_KEYS) } },
  });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  const intervalMin = parseInt(map[SETTING_KEYS.INTERVAL_MIN], 10);
  const leadMin = parseInt(map[SETTING_KEYS.LEAD_MIN], 10);

  return {
    enabled: map[SETTING_KEYS.ENABLED] === 'true',
    intervalMin: ALLOWED_INTERVALS.includes(intervalMin) ? intervalMin : DEFAULTS.intervalMin,
    leadMin: Number.isInteger(leadMin) && leadMin > 0 ? leadMin : DEFAULTS.leadMin,
  };
}

/** Builds the node-cron expression for an every-N-minutes poll. */
const cronForInterval = (minutes) => (minutes >= 60 ? '0 * * * *' : `*/${minutes} * * * *`);

const fmtIst = (d) =>
  `${new Date(d).toLocaleString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
  })} IST`;

/**
 * Starts (or restarts) the reminder cron from the current settings.
 * A disabled setting means no cron is registered at all.
 */
export async function startInterviewReminderJob() {
  try {
    // Defensive: never stack a second cron on top of a live one. Any earlier
    // scheduler (e.g. a double start) is stopped first so only one ever fires —
    // stacked crons are a source of duplicate reminder emails.
    stopInterviewReminderJob();

    const { enabled, intervalMin } = await getInterviewReminderSettings();

    if (!enabled) {
      logger.info('⏸️  Interview reminder scheduler disabled (interview_reminder_enabled=false) — not scheduling.');
      return;
    }

    const expression = cronForInterval(intervalMin);
    job = cron.schedule(expression, async () => {
      try {
        await sendInterviewReminders();
      } catch (err) {
        logger.error(`Interview reminder job execution failed: ${err.message}`);
      }
    });

    logger.info(`📅 Interview reminder scheduler running every ${intervalMin} min ("${expression}").`);
  } catch (err) {
    logger.error(`Failed to start interview reminder job: ${err.message}`);
  }
}

/** Stops the reminder cron if one is registered. */
export function stopInterviewReminderJob() {
  if (job) {
    job.stop();
    job = null;
    logger.info('Interview reminder scheduler stopped.');
  }
}

/** Applies a settings change immediately (called from the settings controller). */
export async function restartInterviewReminderJob() {
  stopInterviewReminderJob();
  await startInterviewReminderJob();
}

/**
 * One sweep: emails the candidate and interviewer for every interview starting
 * within the lead-time window that has not already been reminded.
 * Exported so it can be triggered manually and unit-tested.
 *
 * @returns {Promise<{processed: number, candidateSent: number, interviewerSent: number}>}
 */
export async function sendInterviewReminders() {
  const { leadMin } = await getInterviewReminderSettings();
  const now = new Date();
  const windowEnd = new Date(now.getTime() + leadMin * 60 * 1000);

  // Interviews starting between now and the lead-time horizon that still need
  // at least one of the two reminders. Past-start rows are excluded so a
  // long-disabled job never emails about interviews that already happened.
  const due = await prisma.rpa_interview_schedule.findMany({
    where: {
      status: 'scheduled',
      scheduled_start_at: { gte: now, lte: windowEnd },
      OR: [{ candidate_reminded_at: null }, { interviewer_reminded_at: null }],
    },
    include: {
      rpa_candidate_pipeline: {
        include: { rpa_shortlisted_candidates: { include: { mrf: true } } },
      },
    },
  });

  if (due.length === 0) {
    return { processed: 0, candidateSent: 0, interviewerSent: 0 };
  }
  logger.info(`[Interview Reminder] ${due.length} interview(s) starting within ${leadMin} min.`);

  let candidateSent = 0;
  let interviewerSent = 0;

  for (const row of due) {
    // A round the system never invited is not reminded by it either — the
    // Client Interview is coordinated by HR by hand (Q14). Skipped rather than
    // filtered in the query so the reason stays next to the invite rules.
    if (!stageSendsInvites(row.stage_key)) continue;

    const candidate = row.rpa_candidate_pipeline?.rpa_shortlisted_candidates;
    const stageLabel = SCHEDULABLE_STAGES[row.stage_key]?.label || row.stage_key;
    const position = candidate?.mrf?.position_hiring_for || candidate?.position_applied || 'the role';
    const when = fmtIst(row.scheduled_start_at);
    // Same Teams block the invite emails use, so the reminder matches it
    // exactly rather than maintaining a second near-identical copy.
    const joinLine = buildTeamsBlock(row.teams_join_url, row.teams_meeting_id, row.teams_passcode);

    // Shared interpolation values for both reminder templates.
    const tokens = {
      candidate_name: candidate?.candidate_name || 'Candidate',
      candidate_email: candidate?.candidate_email || 'n/a',
      interviewer_name: row.interviewer_name || 'there',
      position,
      stage_label: stageLabel,
      interview_when: when,
      teams_line: joinLine,
      notes_line: row.notes ? `<p><strong>Notes:</strong> ${row.notes}</p>` : '',
    };

    if (!row.candidate_reminded_at && candidate?.candidate_email) {
      const { to } = resolveRecipients('interviewScheduled', candidate.candidate_email);
      if (to) {
        // Atomically CLAIM this reminder before sending: flip candidate_reminded_at
        // from null → now only if it is still null. updateMany returns how many
        // rows matched, so exactly one caller can win — even if several ticks or
        // several server processes run this sweep at the same instant. This is
        // the guard against duplicate reminder emails (a plain read-then-send
        // races because the DB stamp lands after the send).
        const claimed = await prisma.rpa_interview_schedule.updateMany({
          where: { id: row.id, candidate_reminded_at: null },
          data: { candidate_reminded_at: new Date(), modified_at: new Date() },
        });
        if (claimed.count === 1) {
          try {
            const tpl = await getTemplate(REMINDER_TEMPLATES.candidate);
            const compiled = tpl
              ? compileTemplate(tpl.subject, tpl.body_html, tokens)
              : {
                  subject: `Reminder: your ${stageLabel} interview is coming up`,
                  html: `
                <p>Dear ${tokens.candidate_name},</p>
                <p>This is a reminder that your <strong>${stageLabel}</strong> interview for <strong>${position}</strong> starts shortly.</p>
                <p><strong>When:</strong> ${when}</p>
                ${joinLine}
                ${tokens.notes_line}
                <p>Please be ready a few minutes early.</p>
                <p>Best regards,<br/>AAPNA Recruitment Team</p>`,
                };
            await sendGraphEmail({
              sender: config.microsoft.defaultSender,
              to,
              subject: compiled.subject,
              html: wrapBrandedEmail(compiled.html, { title: compiled.subject }),
            });
            candidateSent += 1;
          } catch (err) {
            // Release the claim so a later tick retries the failed send.
            await prisma.rpa_interview_schedule.updateMany({ where: { id: row.id }, data: { candidate_reminded_at: null } });
            logger.error(`[Interview Reminder] Candidate email failed for schedule ${row.id}: ${err.message}`);
          }
        }
      }
    }

    if (!row.interviewer_reminded_at && row.interviewer_email) {
      const { to } = resolveRecipients('interviewScheduledPanel', row.interviewer_email);
      if (to) {
        const claimed = await prisma.rpa_interview_schedule.updateMany({
          where: { id: row.id, interviewer_reminded_at: null },
          data: { interviewer_reminded_at: new Date(), modified_at: new Date() },
        });
        if (claimed.count === 1) {
          try {
            const tpl = await getTemplate(REMINDER_TEMPLATES.panel);
            const compiled = tpl
              ? compileTemplate(tpl.subject, tpl.body_html, tokens)
              : {
                  subject: `Reminder: ${stageLabel} with ${tokens.candidate_name}`,
                  html: `
                <p>${row.interviewer_email.includes(',') ? 'Hi all,' : `Hi ${tokens.interviewer_name},`}</p>
                <p>Your <strong>${stageLabel}</strong> interview with <strong>${tokens.candidate_name}</strong> (${position}) starts shortly.</p>
                <p><strong>When:</strong> ${when}<br/>
                   <strong>Candidate email:</strong> ${tokens.candidate_email}</p>
                ${joinLine}
                ${tokens.notes_line}
                <p>Best regards,<br/>AAPNA Recruitment Team</p>`,
                };
            // OPERATOR_ADDRESSED: the panel mailbox typed in when the interview
            // was booked, so the reminder is reached in every environment.
            await sendGraphEmail({
              sender: config.microsoft.defaultSender,
              to,
              subject: compiled.subject,
              html: wrapBrandedEmail(compiled.html, { title: compiled.subject }),
              allowRealRecipients: true,
            });
            interviewerSent += 1;
          } catch (err) {
            await prisma.rpa_interview_schedule.updateMany({ where: { id: row.id }, data: { interviewer_reminded_at: null } });
            logger.error(`[Interview Reminder] Interviewer email failed for schedule ${row.id}: ${err.message}`);
          }
        }
      }
    }
    // No trailing update needed — the claim-before-send stamped both timestamps
    // atomically above.
  }

  logger.info(`[Interview Reminder] Sent ${candidateSent} candidate + ${interviewerSent} interviewer reminder(s).`);
  return { processed: due.length, candidateSent, interviewerSent };
}
