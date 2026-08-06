/**
 * offerSweep.js — the two daily Offer-round sweeps (Phase 3 M5).
 *
 *  1. Approval nudge (Q26): while an offer's internal approval is still
 *     'pending', email the recruitment mailbox once a day until someone
 *     approves it. approval_nudged_at is the per-day idempotency guard.
 *
 *  2. Post-joining auto-close (Q12): a candidate who accepted and whose joining
 *     date is more than OFFER_AUTO_CLOSE_AFTER_DAYS (90) days past is closed
 *     automatically as 'joined' — unless the recruiter already closed the record
 *     themselves (e.g. as 'joined_and_left'), which is always left alone.
 *
 * Both are pure DB polling with no external API, so unlike the Zeko/Graph jobs
 * there is nothing to feature-gate — the cadence alone is configurable
 * (OFFER_SWEEP_CRON, daily by default).
 */
import cron from 'node-cron';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import { resolveRecipients } from '../config/emailRecipients.js';
import { sendGraphEmail, compileTemplate } from '../services/emailNotification.service.js';
import { wrapBrandedEmail } from '../services/emailLayout.service.js';
import { setFinalOutcome } from '../services/pipeline.service.js';
import { FINAL_OUTCOMES } from '../config/pipelineStages.js';

let task = null;

/** Loads an active template row by name, or null. */
async function getTemplate(name) {
  return prisma.rpa_email_templates.findFirst({ where: { name, is_active: true } });
}

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * Emails a daily reminder for every offer still awaiting internal approval.
 * @returns {Promise<number>} how many nudges were sent
 */
export async function runApprovalNudges() {
  const due = await prisma.rpa_offers.findMany({
    where: {
      approval_status: 'pending',
      approval_requested_at: { not: null },
      // Once per calendar day, however often the sweep runs.
      OR: [{ approval_nudged_at: null }, { approval_nudged_at: { lt: startOfToday() } }],
    },
    include: {
      rpa_candidate_pipeline: { include: { rpa_shortlisted_candidates: { include: { mrf: true } } } },
    },
  });
  if (due.length === 0) return 0;

  const tpl = await getTemplate('Offer Approval Reminder');
  const { to } = resolveRecipients('offerApprovalNudge', config.microsoft.defaultSender);
  if (!to) {
    logger.warn('[Offer Sweep] no recipient resolved for the approval nudge — skipping.');
    return 0;
  }

  let sent = 0;
  for (const offer of due) {
    const candidate = offer.rpa_candidate_pipeline?.rpa_shortlisted_candidates;
    const position = candidate?.mrf?.position_hiring_for || candidate?.position_applied || 'the role';
    const waitingDays = Math.max(
      0,
      Math.floor((Date.now() - new Date(offer.approval_requested_at).getTime()) / 86400000)
    );
    const tokens = {
      candidate_name: candidate?.candidate_name || 'the candidate',
      position,
      waiting_days: String(waitingDays),
      pipeline_link: `${config.cors.frontendUrl}/pipeline`,
    };

    const compiled = tpl
      ? compileTemplate(tpl.subject, tpl.body_html, tokens)
      : {
          subject: `Offer approval pending — ${tokens.candidate_name} (${position})`,
          html: `<p>The offer for <strong>${tokens.candidate_name}</strong> (${position}) is still waiting for internal approval${waitingDays ? ` — requested ${waitingDays} day(s) ago` : ''}.</p>
                 <p>Please approve it in the Pipeline Tracker so the offer can be shared with the candidate.</p>
                 <p><a href="${tokens.pipeline_link}">Open the Pipeline Tracker</a></p>`,
        };

    try {
      await sendGraphEmail({
        sender: config.microsoft.defaultSender,
        to,
        subject: compiled.subject,
        // Header headline = the email's own subject (RT decision, 2026-07-25).
        html: wrapBrandedEmail(compiled.html, { title: compiled.subject }),
      });
      await prisma.rpa_offers.update({
        where: { id: offer.id },
        data: { approval_nudged_at: new Date(), modified_at: new Date() },
      });
      sent += 1;
    } catch (err) {
      logger.error(`[Offer Sweep] approval nudge failed for offer ${offer.id}: ${err.message}`);
    }
  }

  if (sent) logger.info(`[Offer Sweep] sent ${sent} offer-approval nudge(s).`);
  return sent;
}

/**
 * Closes journeys where the candidate joined and the retention window has
 * passed. Only touches records that are still open — a recruiter-set closure
 * (including 'joined_and_left') always wins.
 * @returns {Promise<number>} how many records were closed
 */
export async function runPostJoiningAutoClose() {
  const cutoff = new Date(Date.now() - config.offer.autoCloseAfterDays * 86400000);

  const due = await prisma.rpa_offers.findMany({
    where: {
      candidate_decision: 'accepted',
      joining_date: { not: null, lte: cutoff },
      rpa_candidate_pipeline: { final_outcome: null },
    },
    include: { rpa_candidate_pipeline: true },
  });
  if (due.length === 0) return 0;

  let closed = 0;
  for (const offer of due) {
    try {
      await setFinalOutcome(Number(offer.pipeline_id), {
        finalOutcomeKey: FINAL_OUTCOMES.JOINED,
        notes: `Auto-closed ${config.offer.autoCloseAfterDays} days after the joining date.`,
        actedBy: null,
        // Administrative tidy-up, not a communication: this fires ~90 days after
        // someone joined and started working. 'joined' is in
        // SILENT_FINAL_OUTCOMES too, so this is belt and braces.
        notifyCandidate: false,
      });
      closed += 1;
    } catch (err) {
      logger.error(`[Offer Sweep] auto-close failed for pipeline ${offer.pipeline_id}: ${err.message}`);
    }
  }

  if (closed) logger.info(`[Offer Sweep] auto-closed ${closed} joined candidate record(s).`);
  return closed;
}

/** Runs both sweeps back to back; a failure in one never blocks the other. */
export async function runOfferSweep() {
  try {
    await runApprovalNudges();
  } catch (err) {
    logger.error(`[Offer Sweep] approval-nudge pass failed: ${err.message}`);
  }
  try {
    await runPostJoiningAutoClose();
  } catch (err) {
    logger.error(`[Offer Sweep] auto-close pass failed: ${err.message}`);
  }
}

/** Registers the daily offer sweep. */
export function startOfferSweepJob() {
  stopOfferSweepJob();

  const expression = config.offer.sweepCron;
  if (!cron.validate(expression)) {
    logger.error(`Invalid OFFER_SWEEP_CRON "${expression}" — offer sweep not scheduled.`);
    return;
  }

  task = cron.schedule(expression, () => {
    logger.info('⏰ Running offer sweep (approval nudges + post-joining auto-close)…');
    runOfferSweep();
  });
  logger.info(`📅 Offer sweep cron scheduled: "${expression}".`);
}

/** Stops the offer sweep if one is registered. */
export function stopOfferSweepJob() {
  if (task) {
    task.stop();
    task = null;
  }
}
