import cron from 'node-cron';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import { sendGraphEmail, injectTrackingPixel } from '../services/emailNotification.service.js';
import { v4 as uuidv4 } from 'uuid';
import {
  CANDIDATE_DATA_EMAIL_TYPE,
  MRF_HM_EMAIL_TYPE,
  MRF_APPROVAL_REQUEST_EMAIL_TYPE,
  REMINDABLE_EMAIL_TYPES,
  reminderSkipReason,
} from './reminderEligibility.js';

let job = null;
let currentSchedule = null;
// In-process guard: a slow run (or a manual call) must not overlap the next tick.
let running = false;

/**
 * Starts the automated reminder scheduler job.
 * Reads the cron schedule from the database or defaults to '0 9 * * *' (9:00 AM daily).
 */
export async function startReminderSchedulerJob() {
  try {
    const cronSetting = await prisma.rpa_settings.findUnique({
      where: { key: 'reminder_cron_schedule' }
    });

    const cronExpression = cronSetting?.value?.trim() || '0 9 * * *';
    currentSchedule = cronExpression;

    if (!cron.validate(cronExpression)) {
      logger.error(`Invalid cron expression loaded from settings: "${cronExpression}". Falling back to daily at 9:00 AM.`);
      currentSchedule = '0 9 * * *';
    }

    job = cron.schedule(currentSchedule, async () => {
      logger.info('⏰ Running automated reminder scheduler job…');
      try {
        await sendPendingReminders();
      } catch (error) {
        logger.error('Reminder scheduler job execution failed:', { error: error.message });
      }
    });

    logger.info(`📅 Reminder scheduler cron scheduled with expression: "${currentSchedule}"`);
  } catch (error) {
    logger.error('Failed to start reminder scheduler job:', { error: error.message });
  }
}

/**
 * Stops the active reminder scheduler job.
 */
export function stopReminderSchedulerJob() {
  if (job) {
    job.stop();
    job = null;
    logger.info('Reminder scheduler cron stopped');
  }
}

/**
 * Reschedules the reminder job if the cron expression has changed in the settings.
 */
export async function rescheduleReminderJob() {
  logger.info('Rescheduling reminder job due to configuration update…');
  stopReminderSchedulerJob();
  await startReminderSchedulerJob();
}

/**
 * Queries the database for pending candidate/MRF follow-ups and sends reminder emails.
 */
export async function sendPendingReminders() {
  if (running) {
    logger.warn('[Reminder Scheduler] Previous run still in progress — skipping this run.');
    return;
  }
  running = true;
  try {
    // 1. Fetch settings
    const settings = await prisma.rpa_settings.findMany({
      where: {
        key: { in: ['reminder_interval_days', 'reminder_max_count'] }
      }
    });
    
    const intervalDays = parseInt(settings.find(s => s.key === 'reminder_interval_days')?.value || '2', 10);
    const maxCount = parseInt(settings.find(s => s.key === 'reminder_max_count')?.value || '3', 10);

    // 2. Fetch pending logs from DB. Only whitelisted types are selected, and
    //    each is joined to the table its reference_id actually points at:
    //    missing_jd -> rpa_cv, mrf_approval_request -> rpa_mrf,
    //    mrf_hm -> rpa_mrf_jd_send (NOT rpa_mrf — that join used to remind HMs
    //    only on accidental id collisions). The joined status columns let
    //    reminderSkipReason() stop reminding once the record no longer needs
    //    action. See reminderEligibility.js.
    const query = `
      SELECT el.*,
             c."cvMissingToken",
             c.id AS candidate_exists_id,
             m.id AS mrf_exists_id,
             m.approval_status AS mrf_approval_status,
             s.id AS mrf_request_exists_id,
             s.mrfstatus AS mrf_request_status,
             s.mrf_id AS mrf_request_mrf_id,
             t.id AS approval_token_id,
             t.revoked_at AS approval_token_revoked_at,
             t.revoked_reason AS approval_token_revoked_reason,
             t.used_at AS approval_token_used_at,
             t.expires_at AS approval_token_expires_at
      FROM rpa_email_log el
      LEFT JOIN rpa_cv c ON el.reference_id = c.id AND el.email_type = $3
      LEFT JOIN rpa_mrf m ON el.reference_id = m.id AND el.email_type = $4
      LEFT JOIN rpa_mrf_jd_send s ON el.reference_id = s.id AND el.email_type = $5
      -- Personal approval link behind this email (MRF approval audit trail);
      -- absent for shared-link emails sent before it existed.
      LEFT JOIN rpa_mrf_approval_tokens t ON t.email_log_id = el.id AND el.email_type = $4
      WHERE el.email_type = ANY($6::text[])
        AND el.responded_at IS NULL
        AND el.status = 'sent'
        AND el.reminder_count < $1
        AND (
          (el.last_reminder_at IS NULL AND el.sent_at <= NOW() - ($2 || ' days')::interval)
          OR
          (el.last_reminder_at IS NOT NULL AND el.last_reminder_at <= NOW() - ($2 || ' days')::interval)
        );
    `;

    const pendingLogs = await prisma.$queryRawUnsafe(
      query,
      maxCount,
      intervalDays,
      CANDIDATE_DATA_EMAIL_TYPE,
      MRF_APPROVAL_REQUEST_EMAIL_TYPE,
      MRF_HM_EMAIL_TYPE,
      [...REMINDABLE_EMAIL_TYPES],
    );
    logger.info(`[Reminder Scheduler] Found ${pendingLogs.length} pending reminder(s) to process.`);

    if (pendingLogs.length === 0) return;

    const sender = config.microsoft.defaultSender;

    for (const log of pendingLogs) {
      try {
        // Stop reminding once the underlying record no longer needs action
        // (MRF decided, HM already submitted, orphaned reference, no portal
        // token). Closing the row is the same mechanism the old orphan checks used.
        const skipReason = reminderSkipReason(log);
        if (skipReason) {
          await prisma.rpa_email_log.update({
            where: { id: log.id },
            data: { responded_at: new Date() }
          });
          logger.info(`[Reminder Scheduler] Closing log ID ${log.id} (${log.email_type}) without a reminder - ${skipReason}.`);
          continue;
        }

        const reminderNumber = log.reminder_count + 1;
        const subject = `Reminder (${reminderNumber}/${maxCount}): ${log.subject}`;
        let finalBody = '';

        if (log.email_type === CANDIDATE_DATA_EMAIL_TYPE) {
          // Use frontend URL for the collection portal to remove external Aapna web dependency
          const frontendUrl = config.cors.frontendUrl || 'http://localhost:5173';
          const formLink = `${frontendUrl}/missing-jd-upload?token=${log.cvMissingToken}`;
          
          finalBody = `
<div style="font-family:Inter,Arial,sans-serif; max-width:600px; margin:0 auto; padding:24px; color:#111827;">
  <div style="background:#fff3cd; border-left:4px solid #f59e0b; padding:12px 16px; margin-bottom:24px; border-radius:4px;">
    <strong style="font-size:14px;">Reminder ${reminderNumber} of ${maxCount}</strong><br/>
    <span style="font-size:13px;">This is a follow-up to our previous email. Please take action at your earliest convenience.</span>
  </div>
  <p>Dear ${log.recipient_name || 'Candidate'},</p>
  <p>We hope this message finds you well.</p>
  <p>This is a gentle reminder that we are still awaiting your response regarding the <strong>missing profile details</strong> that are required to complete your application process.</p>
  <p>Please take a moment to fill in the required information by clicking the button below:</p>
  <div style="text-align:center; margin:28px 0;">
    <a href="${formLink}"
       style="display:inline-block; background:#6366f1; color:white;
              padding:14px 32px; border-radius:8px; text-decoration:none;
              font-weight:600; font-size:15px;">
      Complete Your Profile
    </a>
  </div>
  <p style="font-size:13px; color:#6b7280;">
    If the button doesn't work, copy and paste this link into your browser:<br/>
    <a href="${formLink}" style="color:#6366f1;">${formLink}</a>
  </p>
  <p>If you have any questions, please feel free to reach out to our HR team.</p>
  <p style="margin-top: 24px;">Warm regards,<br/>
  <strong>HR Team</strong><br/>
  AAPNA Infotech</p>
</div>
          `.trim();
        } else {
          // General reminder: banner + the original body (mrf_hm, and
          // mrf_approval_request — whose original body carries the live
          // Approve/Reject buttons, which is correct because this row is only
          // reached while the MRF is still pending). The old 'mrf_approval'
          // branch lived here; that type goes to the HM, not the approvers, and
          // is no longer remindable (reminderEligibility.js).
          const reminderBanner = `
<div style="background:#fff3cd; border-left:4px solid #f59e0b; padding:12px 16px; margin-bottom:20px; font-family:sans-serif; border-radius:4px;">
  <strong>Reminder ${reminderNumber} of ${maxCount}</strong><br/>
  This is a follow-up to our previous email. Please take action at your earliest convenience.
</div>
          `.trim();
          finalBody = reminderBanner + (log.body_html || '');
        }

        // Send email via Outlook Graph API.
        // Reminders re-send to the original logged recipient in production; in
        // non-production all mail is redirected to the internal test inbox.
        let toEmail = log.recipient_email;
        if (config.email.redirectInNonProd) {
          toEmail = config.email.testRecipients;
          logger.info(`[Reminder Scheduler] Non-prod: Redirected reminder for log ${log.id} to test inbox: "${toEmail}"`);
        }

        // Claim the row BEFORE sending: count and timestamp move together,
        // conditional on the count this run read. A concurrent run (a second
        // backend process, or an overlapping call) that read the same row finds
        // nothing to claim and skips it, so each reminder goes out at most once.
        // Counting before the send also means a failure in the bookkeeping
        // below can never cause the same reminder to be re-sent on every run.
        // (A Postgres advisory lock was considered, but Prisma pools
        // connections, so a session lock could be released on a different
        // connection than the one that took it.)
        const claimedAt = new Date();
        const claim = await prisma.rpa_email_log.updateMany({
          where: { id: log.id, reminder_count: log.reminder_count, responded_at: null },
          data: { reminder_count: { increment: 1 }, last_reminder_at: claimedAt },
        });
        if (claim.count === 0) {
          logger.info(`[Reminder Scheduler] Log ID ${log.id} already handled by another run — skipping.`);
          continue;
        }

        // Shared send path: network retry, sender fallback, and real Graph id
        // capture (draft → send) all live in sendGraphEmail. Pixel goes into
        // the sent html only; the stored body_html stays clean.
        const trackingToken = uuidv4();
        let sendResult;
        try {
          sendResult = await sendGraphEmail({
            sender,
            to: toEmail,
            subject,
            html: injectTrackingPixel(finalBody, trackingToken),
          });
        } catch (sendErr) {
          // Nothing was sent: release the claim so the next run retries.
          await prisma.rpa_email_log.updateMany({
            where: { id: log.id, reminder_count: log.reminder_count + 1, last_reminder_at: claimedAt },
            data: { reminder_count: log.reminder_count, last_reminder_at: log.last_reminder_at },
          }).catch((revertErr) => {
            logger.error(`[Reminder Scheduler] Could not release claim on log ID ${log.id}: ${revertErr.message}`);
          });
          throw sendErr;
        }

        // Log outbound reminder to rpa_email_messages
        const emailMsg = await prisma.rpa_email_messages.create({
          data: {
            graph_message_id: sendResult?.graphMessageId || null,
            conversation_id: sendResult?.conversationId || `reminder-conv-${log.id}`,
            internet_msg_id: sendResult?.internetMessageId || null,
            from_email: sender,
            from_name: 'HR Team',
            to_emails: toEmail.split(',').map(e => e.trim()),
            subject,
            body_html: finalBody,
            direction: 'outbound',
            candidate_id: log.email_type === CANDIDATE_DATA_EMAIL_TYPE ? BigInt(log.reference_id) : null,
            // Only approval requests reference rpa_mrf. An mrf_hm reference_id
            // is an rpa_mrf_jd_send id; writing it here pointed the message at
            // an unrelated MRF (or violated the FK).
            mrf_id: log.email_type === MRF_APPROVAL_REQUEST_EMAIL_TYPE ? BigInt(log.reference_id) : null,
            sent_at: new Date(),
          }
        });

        // Log email tracking record
        await prisma.rpa_email_tracking.create({
          data: {
            message_id: emailMsg.id,
            tracking_token: trackingToken,
            delivered: true,
            delivered_at: new Date(),
          }
        });

        logger.info(`[Reminder Scheduler] Successfully sent reminder ${reminderNumber}/${maxCount} for log ID ${log.id} to ${toEmail}`);
      } catch (err) {
        logger.error(`[Reminder Scheduler] Failed to process reminder for log ID ${log.id}: ${err.message}`);
      }
    }
  } catch (err) {
    logger.error('[Reminder Scheduler] Failed to send pending reminders:', err);
  } finally {
    running = false;
  }
}
