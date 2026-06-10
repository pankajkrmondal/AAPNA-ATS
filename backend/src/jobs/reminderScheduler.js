import cron from 'node-cron';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import { getAccessToken } from '../services/onedrive.service.js';

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

    // 2. Fetch pending logs from DB
    const query = `
      SELECT el.*, c."cvMissingToken"
      FROM rpa_email_log el
      LEFT JOIN rpa_cv c ON el.reference_id = c.id AND el.email_type = 'missing_jd'
      WHERE el.responded_at IS NULL
        AND el.reminder_count < $1
        AND (
          (el.last_reminder_at IS NULL AND el.sent_at <= NOW() - ($2 || ' days')::interval)
          OR
          (el.last_reminder_at IS NOT NULL AND el.last_reminder_at <= NOW() - ($2 || ' days')::interval)
        );
    `;
    
    const pendingLogs = await prisma.$queryRawUnsafe(query, maxCount, intervalDays);
    logger.info(`[Reminder Scheduler] Found ${pendingLogs.length} pending reminder(s) to process.`);

    if (pendingLogs.length === 0) return;

    // Get Microsoft Graph API access token
    const accessToken = await getAccessToken();
    const sender = config.microsoft.defaultSender;

    for (const log of pendingLogs) {
      try {
        const reminderNumber = log.reminder_count + 1;
        const subject = `Reminder (${reminderNumber}/${maxCount}): ${log.subject}`;
        let finalBody = '';

        if (log.email_type === 'missing_jd') {
          // Use frontend URL for the collection portal to remove external Aapna web dependency
          const frontendUrl = config.cors.frontendUrl || 'http://localhost:5173';
          const formLink = `${frontendUrl}/missing-jd-upload?token=${log.cvMissingToken || ''}`;
          
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

        // Send email via Outlook Graph API
        let toEmail = log.recipient_email;
        if (config.env !== 'production') {
          toEmail = config.microsoft.stagingRecipients;
          logger.info(`[Reminder Scheduler] Staging Mode: Redirected reminder for log ${log.id} to staging: "${toEmail}"`);
        }

        const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`;
        const toRecipients = toEmail.split(',')
          .map(email => email.trim())
          .filter(email => email.length > 0)
          .map(email => ({ emailAddress: { address: email } }));

        const mailPayload = {
          message: {
            subject,
            body: {
              contentType: 'HTML',
              content: finalBody
            },
            toRecipients
          },
          saveToSentItems: 'true'
        };

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(mailPayload)
        });

        if (!res.ok) {
          const errorBody = await res.json().catch(() => ({}));
          throw new Error(`Graph sendMail failed: ${res.statusText}. ${JSON.stringify(errorBody)}`);
        }

        // Log outbound reminder to rpa_email_messages
        const emailMsg = await prisma.rpa_email_messages.create({
          data: {
            conversation_id: `reminder-conv-${log.id}`,
            from_email: sender,
            from_name: 'HR Team',
            to_emails: toEmail.split(',').map(e => e.trim()),
            subject,
            body_html: finalBody,
            direction: 'outbound',
            candidate_id: log.email_type === 'missing_jd' ? BigInt(log.reference_id) : null,
            mrf_id: log.email_type !== 'missing_jd' ? BigInt(log.reference_id) : null,
            sent_at: new Date(),
          }
        });

        // Log email tracking record
        await prisma.rpa_email_tracking.create({
          data: {
            message_id: emailMsg.id,
            delivered: true,
            delivered_at: new Date(),
          }
        });

        // Update log record (increment reminder count)
        await prisma.rpa_email_log.update({
          where: { id: log.id },
          data: {
            reminder_count: { increment: 1 },
            last_reminder_at: new Date()
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
