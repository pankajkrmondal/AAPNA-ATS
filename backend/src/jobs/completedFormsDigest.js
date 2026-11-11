/**
 * completedFormsDigest.js — U10: one bell note a day at 09:00 IST to HR and
 * Admin, "12 forms completed yesterday across 4 JDs", linking to Analytics →
 * Completed forms for that day. In-app only, no email. Nothing is sent when
 * nobody completed a form.
 *
 * Fires once per day: the day is CLAIMED in rpa_settings (forms_digest.last_day)
 * before the note is written, because the local backend and the staging server
 * both run jobs on the staging database.
 *
 * Runs only with FORMS_DIGEST_ENABLED=true. Recipients: FORMS_DIGEST_ROLES.
 * The decisions are pure and unit tested (completedForms.helpers.js).
 */
import cron from 'node-cron';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import { runJob } from '../utils/jobRunner.js';
import { notify, resolveRecipients, NOTIFICATION_TYPES } from '../services/notification.service.js';
import { getCompletedForms } from '../services/completedForms.service.js';
import { yesterdayRange, planDigest, claimDigestDay } from '../services/completedForms.helpers.js';

export const FORMS_DIGEST_CRON = '0 9 * * *';

let job = null;

/**
 * One pass. Exported for the manual dry run.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun] - count and log the note, but claim and write nothing
 * @param {Date} [opts.now]
 * @param {string[]} [opts.roles] - defaults to FORMS_DIGEST_ROLES
 * @returns {Promise<{ day: string, total: number, jd_count: number, decision: string,
 *   created: number, recipients?: number, note?: object }>}
 */
export async function sendCompletedFormsDigest({ dryRun = false, now = new Date(), roles = config.formsDigest.roles } = {}) {
  const range = yesterdayRange(now);
  const data = await getCompletedForms(range);
  const plan = planDigest({ data, range, roles, type: NOTIFICATION_TYPES.CANDIDATE_FORMS_DIGEST });
  const summary = { day: range.fromDay, total: data.total, jd_count: data.jd_count, decision: plan.decision, created: 0 };

  if (!plan.send) {
    logger.info(`[Forms digest] ${range.fromDay}: ${plan.decision === 'no_roles' ? 'FORMS_DIGEST_ROLES is empty' : 'no forms completed'}; no note.`);
    return summary;
  }

  if (dryRun) {
    const recipients = await resolveRecipients({ roles });
    logger.info(`[Forms digest] [dry run] ${range.fromDay}: "${plan.note.title}" — ${plan.note.description} → ${plan.note.linkPath}; would reach ${recipients.length} user(s) (${roles.join(', ')}).`);
    return { ...summary, decision: 'would_send', recipients: recipients.length, note: plan.note };
  }

  if (!(await claimDigestDay(range.fromDay, prisma))) {
    logger.info(`[Forms digest] ${range.fromDay}: already sent by another process; skipping.`);
    return { ...summary, decision: 'claimed_elsewhere' };
  }

  const { created } = await notify(plan.note);
  logger.info(`[Forms digest] ${range.fromDay}: "${plan.note.title}" sent to ${created} user(s).`);
  return { ...summary, decision: 'sent', created };
}

/** Registers the daily cron when FORMS_DIGEST_ENABLED is on. */
export function startCompletedFormsDigestJob() {
  stopCompletedFormsDigestJob();
  if (!config.formsDigest.enabled) {
    logger.info('⏸️  Completed forms bell note disabled (FORMS_DIGEST_ENABLED=false) — not scheduling.');
    return;
  }
  job = cron.schedule(
    FORMS_DIGEST_CRON,
    () => runJob('completedFormsDigest', () => sendCompletedFormsDigest()),
    { timezone: 'Asia/Kolkata' },
  );
  logger.info(`📅 Completed forms bell note scheduled: "${FORMS_DIGEST_CRON}" (Asia/Kolkata), to ${config.formsDigest.roles.join(', ')}.`);
}

export function stopCompletedFormsDigestJob() {
  if (job) {
    job.stop();
    job = null;
  }
}

export default { startCompletedFormsDigestJob, stopCompletedFormsDigestJob, sendCompletedFormsDigest };
