/**
 * zekoExpiryReminder.js — U08: one "your Zeko interview closes soon" email per
 * booking window, to a candidate who has not attempted the test yet.
 *
 * Hourly at :20 IST (not :00, when zekoScheduler may be running the OTP login).
 * Picks rpa_zeko_candidate_pipeline rows that are 'sent', not yet reminded, and
 * close within the lead time (rpa_settings zeko_reminder_lead_hours, default
 * 24). Skips a window no longer than the lead time, and a journey that is
 * closed or paused. Then asks Zeko live whether the candidate has attempted it
 * (results are only fetched after a window closes) and reminds only when Zeko
 * lists them as 'scheduled' or 'notAttempted'.
 *
 * Fires once: reminded_at is CLAIMED before anything is sent (the local backend
 * and the staging server both run jobs on the staging database), and released
 * again when nothing was sent, so the next run looks again. scheduleInterview()
 * clears it on a reschedule, so a new window gets its own reminder.
 *
 * Runs only with ZEKO_REMINDER_ENABLED=true and ZEKO_SYNC_ENABLED=true.
 */
import cron from 'node-cron';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import { resolveRecipients, nonProdSafeCandidateEmail } from '../config/emailRecipients.js';
import { sendGraphEmail, compileTemplate } from '../services/emailNotification.service.js';
import { wrapBrandedEmail } from '../services/emailLayout.service.js';
import { createZekoAttemptChecker } from '../services/zeko.service.js';
import {
  ZEKO_REMINDER_TEMPLATE_NAME,
  ZEKO_REMINDER_TEMPLATE_DEFAULT,
} from '../services/zekoReminderTemplate.js';
import { fmtDateTimeIst } from '../utils/dateFormat.js';
import { runJob } from '../utils/jobRunner.js';
import {
  reminderEligibility,
  attemptVerdict,
  reminderInterviewId,
  zekoCandidateLink,
} from '../utils/zekoLinkModel.js';

export const ZEKO_REMINDER_CRON = '20 * * * *';
export const LEAD_HOURS_SETTING = 'zeko_reminder_lead_hours';
export const DEFAULT_LEAD_HOURS = 24;
/** A week: anything longer is a typo, and the default is used instead. */
const MAX_LEAD_HOURS = 168;

let job = null;

/** rpa_settings zeko_reminder_lead_hours, or 24 when unset or out of range. */
export async function getZekoReminderLeadHours() {
  const row = await prisma.rpa_settings.findUnique({ where: { key: LEAD_HOURS_SETTING } });
  const n = Number(row?.value);
  return Number.isFinite(n) && n > 0 && n <= MAX_LEAD_HOURS ? n : DEFAULT_LEAD_HOURS;
}

/** Rows closing within the lead time and not reminded yet (eligibility is re-checked in JS). */
async function findDueRows({ now, leadHours, rowIds }) {
  const horizon = new Date(now.getTime() + leadHours * 3_600_000);
  const only = rowIds?.length ? rowIds.map(Number) : null;
  return prisma.$queryRaw`
    SELECT p.id, p.candidate_id, p.zeko_job_id, p.pipeline_id, p.stage, p.status,
           p.interview_start_at, p.interview_end_at, p.link_sent_at, p.reminded_at,
           p.cancelled_at, p.completed_at, p.link_token::text AS link_token,
           COALESCE(p.candidate_email, sc.candidate_email) AS candidate_email,
           sc.candidate_name, j.title AS job_title, j.slug, j.primary_interview_id,
           cp.final_outcome, cp.is_paused
    FROM rpa_zeko_candidate_pipeline p
    JOIN rpa_shortlisted_candidates sc ON sc.id = p.candidate_id
    LEFT JOIN rpa_zeko_jobs j ON j.zeko_id = p.zeko_job_id
    LEFT JOIN LATERAL (
      SELECT final_outcome, is_paused FROM rpa_candidate_pipeline
      WHERE shortlist_id = p.candidate_id
      ORDER BY created_at DESC LIMIT 1
    ) cp ON TRUE
    WHERE p.status = 'sent'
      AND p.reminded_at IS NULL
      AND p.cancelled_at IS NULL
      AND p.completed_at IS NULL
      AND p.interview_end_at > ${now}
      AND p.interview_end_at <= ${horizon}
      AND (${only}::int[] IS NULL OR p.id = ANY(${only}::int[]))
    ORDER BY p.interview_end_at ASC`;
}

/** The active template row, or the built-in default. */
async function reminderTemplate() {
  const row = await prisma.rpa_email_templates.findFirst({
    where: { name: ZEKO_REMINDER_TEMPLATE_NAME, is_active: true },
  });
  return row || ZEKO_REMINDER_TEMPLATE_DEFAULT;
}

/** Sends one reminder. Throws when there is no link or no recipient. */
async function sendReminderEmail(row) {
  const link = zekoCandidateLink({
    token: row.link_token,
    slug: row.slug,
    publicBaseUrl: config.publicBaseUrl,
    interviewLinkBase: config.zeko.interviewLinkBase,
  });
  if (!link) throw new Error(`no interview link (job ${row.zeko_job_id} has no slug)`);
  const { to } = resolveRecipients('zekoReminder', row.candidate_email);
  if (!to) throw new Error('no recipient address');

  const template = await reminderTemplate();
  const { subject, html } = compileTemplate(template.subject, template.body_html, {
    candidate_name: row.candidate_name,
    job_title: row.job_title || 'Position',
    interview_end: fmtDateTimeIst(row.interview_end_at),
    interview_link: link,
  });
  await sendGraphEmail({
    sender: config.microsoft.defaultSender,
    to,
    subject,
    html: wrapBrandedEmail(html, { title: subject }),
  });
}

/**
 * One pass. Exported for the manual dry run and the tests.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun] - decide and ask Zeko, but claim and send nothing
 * @param {number[]} [opts.rowIds] - only these rpa_zeko_candidate_pipeline ids
 * @param {Date} [opts.now]
 * @param {object} [opts.deps] - { checkAttempt, send } stubs for tests
 * @returns {Promise<{considered: number, sent: number, skipped: number, failed: number,
 *   decisions: {id: number, decision: string}[]}>}
 */
export async function sendZekoExpiryReminders({ dryRun = false, rowIds = null, now = new Date(), deps = {} } = {}) {
  const leadHours = await getZekoReminderLeadHours();
  const rows = await findDueRows({ now, leadHours, rowIds });
  const summary = { considered: rows.length, sent: 0, skipped: 0, failed: 0, decisions: [] };
  if (rows.length === 0) return summary;

  const checkAttempt = deps.checkAttempt || createZekoAttemptChecker();
  const send = deps.send || sendReminderEmail;
  const decide = (row, decision) => summary.decisions.push({ id: row.id, decision });

  for (const row of rows) {
    const { eligible, reason } = reminderEligibility(row, { now, leadHours });
    if (!eligible) { summary.skipped += 1; decide(row, reason); continue; }
    const interviewId = reminderInterviewId(row);
    if (!interviewId) { summary.skipped += 1; decide(row, 'no_interview_id'); continue; }

    // Claim first: another instance on the same database may be on this row.
    const claimedAt = new Date();
    if (!dryRun) {
      const claim = await prisma.rpa_zeko_candidate_pipeline.updateMany({
        where: { id: row.id, status: 'sent', reminded_at: null },
        data: { reminded_at: claimedAt },
      });
      if (claim.count === 0) { summary.skipped += 1; decide(row, 'claimed_elsewhere'); continue; }
    }
    const release = () => (dryRun ? null : prisma.rpa_zeko_candidate_pipeline.updateMany({
      where: { id: row.id, reminded_at: claimedAt },
      data: { reminded_at: null },
    }));

    try {
      // Outside production Zeko was given the test inbox, not the candidate (zeko:schedule).
      const candidateEmail = nonProdSafeCandidateEmail(row.candidate_email, 'zeko:reminder-check');
      const verdict = attemptVerdict(await checkAttempt({ jobId: row.zeko_job_id, interviewId, candidateEmail }));
      if (verdict !== 'remind') {
        await release();
        summary.skipped += 1;
        decide(row, verdict);
        continue;
      }
      if (dryRun) { decide(row, 'would_send'); continue; }
      await send(row);
      summary.sent += 1;
      decide(row, 'sent');
      logger.info(`Zeko expiry reminder sent: pipeline_row ${row.id} (shortlist ${row.candidate_id} ${row.stage}), closes ${fmtDateTimeIst(row.interview_end_at)}.`);
    } catch (err) {
      await release()?.catch((e) => logger.error(`Zeko expiry reminder: could not release row ${row.id}: ${e.message}`));
      summary.failed += 1;
      decide(row, 'failed');
      logger.error(`Zeko expiry reminder failed for pipeline_row ${row.id}: ${err.message}`);
    }
  }

  logger.info(`Zeko expiry reminder${dryRun ? ' [dry run]' : ''}: ${rows.length} due, ${summary.sent} sent, ${summary.skipped} skipped, ${summary.failed} failed.`);
  return summary;
}

/** Registers the hourly cron when both flags are on. */
export function startZekoExpiryReminderJob() {
  stopZekoExpiryReminderJob();
  if (!config.zeko.reminder.enabled) {
    logger.info('⏸️  Zeko expiry reminder disabled (ZEKO_REMINDER_ENABLED=false) — not scheduling.');
    return;
  }
  if (!config.zeko.sync.enabled) {
    logger.info('⏸️  Zeko expiry reminder needs ZEKO_SYNC_ENABLED=true for the attempt check — not scheduling.');
    return;
  }
  job = cron.schedule(
    ZEKO_REMINDER_CRON,
    () => runJob('zekoExpiryReminder', () => sendZekoExpiryReminders()),
    { timezone: 'Asia/Kolkata' },
  );
  logger.info(`📅 Zeko expiry reminder scheduled: "${ZEKO_REMINDER_CRON}" (Asia/Kolkata).`);
}

export function stopZekoExpiryReminderJob() {
  if (job) {
    job.stop();
    job = null;
    logger.info('Zeko expiry reminder stopped.');
  }
}

export default { startZekoExpiryReminderJob, stopZekoExpiryReminderJob, sendZekoExpiryReminders };
