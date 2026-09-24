import cron from 'node-cron';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import { sendGraphEmail, injectTrackingPixel } from '../services/emailNotification.service.js';
import { v4 as uuidv4 } from 'uuid';
import {
  REMINDABLE_EMAIL_TYPES,
  MRF_APPROVAL_EMAIL_TYPES,
  CANDIDATE_DATA_EMAIL_TYPE,
  MRF_HM_EMAIL_TYPE,
  isMrfApprovalEmailType,
  reminderSkipReason,
} from './reminderEligibility.js';

let job = null;
let currentSchedule = null;

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
  try {
    // 1. Fetch settings
    const settings = await prisma.rpa_settings.findMany({
      where: {
        key: { in: ['reminder_interval_days', 'reminder_max_count'] }
      }
    });
    
    const intervalDays = parseInt(settings.find(s => s.key === 'reminder_interval_days')?.value || '2', 10);
    const maxCount = parseInt(settings.find(s => s.key === 'reminder_max_count')?.value || '3', 10);

    // 2. Fetch pending logs from DB. Only email types that ask for a response
    // are eligible, and each is joined to the record it is chasing so
    // reminderSkipReason() can tell whether that record still needs action.
    // mrf_hm's reference_id is an rpa_mrf_jd_send id, NOT an rpa_mrf id.
    const query = `
      SELECT el.*,
             c."cvMissingToken",
             c.id AS candidate_exists_id,
             m.id AS mrf_exists_id,
             m.approval_status AS mrf_approval_status,
             s.id AS mrf_request_exists_id,
             s.mrfstatus AS mrf_request_status,
             s.mrf_id AS mrf_request_mrf_id
      FROM rpa_email_log el
      LEFT JOIN rpa_cv c ON el.reference_id = c.id AND el.email_type = $3
      LEFT JOIN rpa_mrf m ON el.reference_id = m.id AND el.email_type = ANY($4::text[])
      LEFT JOIN rpa_mrf_jd_send s ON el.reference_id = s.id AND el.email_type = $5
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
      MRF_APPROVAL_EMAIL_TYPES,
      MRF_HM_EMAIL_TYPE,
      REMINDABLE_EMAIL_TYPES
    );
    logger.info(`[Reminder Scheduler] Found ${pendingLogs.length} pending reminder(s) to process.`);

    if (pendingLogs.length === 0) return;

    const sender = config.microsoft.defaultSender;

    for (const log of pendingLogs) {
      try {
        // Orphaned reference, or the record no longer needs action (MRF already
        // approved/rejected, HM already submitted). Close the row so it is never
        // picked up again — a reminder here re-sends a dead link.
        const skipReason = reminderSkipReason(log);
        if (skipReason) {
          logger.info(`[Reminder Scheduler] Closing log ID ${log.id} (${log.email_type}) without a reminder - ${skipReason}.`);
          await prisma.rpa_email_log.update({
            where: { id: log.id },
            data: { responded_at: new Date() }
          });
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
        } else if (log.email_type === 'mrf_approval') {
          finalBody = `
<div style="font-family:Inter,Arial,sans-serif; max-width:600px; margin:0 auto; padding:24px; color:#111827;">
  <div style="background:#fff3cd; border-left:4px solid #f59e0b; padding:12px 16px; margin-bottom:24px; border-radius:4px;">
    <strong style="font-size:14px;">Reminder ${reminderNumber} of ${maxCount}</strong><br/>
    <span style="font-size:13px;">This is a follow-up to our previous MRF Approval request.</span>
  </div>
  <p>Dear Abhijit Roy &amp; Sanghamitra Roy,</p>
  <p>I hope this message finds you well.</p>
  <p>This is a gentle reminder regarding the <strong>Manpower Requisition Form (MRF) Approval</strong> that was sent to you earlier and is currently awaiting your review and decision.</p>
  <p>Kindly check your inbox for our previous email with the subject:<br/>
    <strong style="color:#1e40af;">"${log.subject}"</strong>
  </p>
  <p>The email contains the complete MRF details along with the attached Job Description. Please review and share your <strong>Approval or Decline</strong> at your earliest convenience so we can proceed with the hiring process accordingly.</p>
  <div style="background:#f0fdf4; border:1px solid #86efac; border-radius:8px; padding:16px; margin:24px 0;">
    <p style="margin:0; font-size:14px; color:#166534;">
      ⏳ <strong>Action Required:</strong> Please check your previous email and click <strong>Approve</strong> or <strong>Decline</strong> to complete the MRF review process.
    </p>
  </div>
  <p>If you are unable to locate the original email, please do not hesitate to contact the HR team and we will be happy to resend it immediately.</p>
  <p>We appreciate your time and look forward to your response.</p>
  <p style="margin-top: 24px;">Warm regards,<br/>
  <strong>HR Team</strong><br/>
  AAPNA Infotech</p>
</div>
          `.trim();
        } else {
          // General reminder (e.g. mrf_hm)
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

        // Shared send path: network retry, sender fallback, and real Graph id
        // capture (draft → send) all live in sendGraphEmail. Pixel goes into
        // the sent html only; the stored body_html stays clean.
        const trackingToken = uuidv4();
        const sendResult = await sendGraphEmail({
          sender,
          to: toEmail,
          subject,
          html: injectTrackingPixel(finalBody, trackingToken),
        });

        // Count the reminder as soon as it is SENT. This used to run last, so a
        // failure in the bookkeeping below left the count unchanged and the same
        // reminder went out again on every run.
        await prisma.rpa_email_log.update({
          where: { id: log.id },
          data: {
            reminder_count: { increment: 1 },
            last_reminder_at: new Date()
          }
        });

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
            // mrf_id is an FK to rpa_mrf. Only approval reminders reference an
            // rpa_mrf id; an mrf_hm reference_id is an rpa_mrf_jd_send id.
            mrf_id: isMrfApprovalEmailType(log.email_type) ? BigInt(log.reference_id) : null,
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
  }
}
