/**
 * Email resume intake poller — Node equivalent of the n8n
 * "Microsoft Outlook Trigger2" node (Resume Parser Step 1.1.1).
 *
 * Polls the per-environment mailbox (config.microsoft.defaultSender) for new
 * messages that have attachments, saves each attachment to disk, and feeds them
 * into the SAME resume-parse pipeline as HR/vendor uploads via
 * startBackgroundParsing(..., source='email_intake'). Dedup + watermark are kept
 * in rpa_settings so messages are processed exactly once.
 *
 * Disabled by default; enabled via EMAIL_INTAKE_ENABLED.
 */
import cron from 'node-cron';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import prisma from '../config/database.js';
import config from '../config/index.js';
import logger from '../config/logger.js';
import { fetchMessagesSince, downloadAttachments } from '../services/outlookReader.service.js';
import { startBackgroundParsing } from '../services/hrUpload.service.js';

const WATERMARK_KEY = 'email_intake_last_sync';
const RESUME_EXTS = ['.pdf', '.docx'];

/**
 * Build a stable, short execution id from a Graph message id.
 *
 * Graph message ids are ~150+ chars, but rpa_upload_batch_summary.execution_id
 * is VarChar(100). We hash the message id (sha1, first 16 hex chars) so the id is
 * both well under the column limit and deterministic — re-polling the same message
 * yields the same execution id, preserving idempotency. The full graph_message_id
 * is still recorded in the batch summary `details`.
 */
function executionIdFor(graphMessageId) {
  const hash = crypto.createHash('sha1').update(graphMessageId).digest('hex').slice(0, 16);
  return `email-${hash}`;
}

let job;
let running = false; // overlap guard

/** Read the last-sync watermark (ISO string) from rpa_settings. */
async function getWatermark() {
  const row = await prisma.rpa_settings.findUnique({ where: { key: WATERMARK_KEY } });
  if (row && row.value) return row.value;
  // First run: look back 1 day so we don't reprocess the whole mailbox.
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

/** Persist the watermark (ISO string) into rpa_settings. */
async function setWatermark(iso) {
  await prisma.rpa_settings.upsert({
    where: { key: WATERMARK_KEY },
    update: { value: iso },
    create: { key: WATERMARK_KEY, value: iso },
  });
}

/**
 * One poll cycle: fetch messages-with-attachments since the watermark and
 * route their resume attachments through the parse pipeline.
 */
export async function runEmailResumeIntake() {
  if (running) {
    logger.warn('[Email Intake] Previous run still in flight; skipping this tick.');
    return;
  }
  running = true;
  try {
    const sinceIso = await getWatermark();
    const messages = await fetchMessagesSince(sinceIso, { withAttachmentsOnly: true });

    if (messages.length === 0) {
      return;
    }
    logger.info(`[Email Intake] ${messages.length} new message(s) with attachments since ${sinceIso}`);

    const uploadDir = path.resolve(config.upload.dir);
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    let newestReceived = sinceIso;

    for (const msg of messages) {
      // Track the newest receivedDateTime so the watermark always advances,
      // even for messages whose attachments we skip.
      if (msg.receivedAt > newestReceived) newestReceived = msg.receivedAt;

      // Deterministic execution id (hashed Graph id) keeps us under the
      // execution_id VarChar(100) limit while staying stable across re-polls.
      const executionId = executionIdFor(msg.graphMessageId);

      // Idempotency: skip a message we've already turned into an upload batch.
      const seen = await prisma.rpa_upload_log.findFirst({
        where: { execution_id: executionId },
        select: { id: true },
      });
      if (seen) continue;

      let attachments;
      try {
        attachments = await downloadAttachments(msg.graphMessageId);
      } catch (err) {
        logger.error(`[Email Intake] Failed to download attachments for ${msg.graphMessageId}: ${err.message}`);
        continue;
      }

      // Keep only resume-like attachments the parser supports.
      const resumeAttachments = attachments.filter((a) =>
        RESUME_EXTS.includes(path.extname(a.name).toLowerCase())
      );
      if (resumeAttachments.length === 0) continue;

      // Write attachments to disk as multer-like file descriptors.
      const flatFiles = [];
      for (const att of resumeAttachments) {
        const ext = path.extname(att.name);
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const filename = `email-intake-${uniqueSuffix}${ext}`;
        const filePath = path.join(uploadDir, filename);
        fs.writeFileSync(filePath, Buffer.from(att.contentBytes, 'base64'));
        flatFiles.push({
          fieldname: 'resumes',
          originalname: att.name,
          mimetype: att.contentType,
          destination: uploadDir,
          filename,
          path: filePath,
          size: fs.statSync(filePath).size,
        });
      }

      try {
        // Mirror the controller's batch scaffolding that startBackgroundParsing expects.
        await prisma.rpa_upload_batch_summary.create({
          data: {
            execution_id: executionId,
            uploaded_by: 'email_intake',
            uploaded_at: new Date(),
            total_count: flatFiles.length,
            success_count: 0,
            failed_count: 0,
            duplicate_count: 0,
            update_count: 0,
            details: {
              source: 'email_intake',
              from_email: msg.fromEmail,
              subject: msg.subject,
              graph_message_id: msg.graphMessageId,
              files: flatFiles.map((f) => ({ name: f.originalname, size: f.size })),
            },
          },
        });

        await Promise.all(
          flatFiles.map((f) =>
            prisma.rpa_upload_log.create({
              data: {
                execution_id: executionId,
                file_name: f.originalname,
                status: 'pending',
                source: 'email_intake',
                processed_at: new Date(),
              },
            })
          )
        );

        // Synthetic system user — the sender mailbox acts as the uploader identity.
        const systemUser = {
          email: msg.fromEmail || config.microsoft.defaultSender,
          username: 'email_intake',
          first_name: msg.fromName || 'Email',
          last_name: 'Intake',
        };

        await startBackgroundParsing(executionId, flatFiles, systemUser, 'email_intake');
        logger.info(`[Email Intake] Queued ${flatFiles.length} resume(s) from "${msg.fromEmail}" (batch ${executionId}).`);
      } catch (err) {
        logger.error(`[Email Intake] Failed to queue batch for ${msg.graphMessageId}: ${err.message}`);
      }
    }

    await setWatermark(newestReceived);
  } catch (err) {
    logger.error(`[Email Intake] Poll cycle failed: ${err.message}`);
  } finally {
    running = false;
  }
}

export function startEmailResumeIntakeJob() {
  if (!config.email.intake.enabled) {
    logger.info('📭 Email resume intake poller DISABLED (set EMAIL_INTAKE_ENABLED=true to enable).');
    return;
  }
  job = cron.schedule(config.email.intake.cron, () => {
    runEmailResumeIntake().catch((err) =>
      logger.error(`[Email Intake] Unhandled error: ${err.message}`)
    );
  });
  logger.info(`📬 Email resume intake poller scheduled (${config.email.intake.cron}).`);
}

export function stopEmailResumeIntakeJob() {
  if (job) {
    job.stop();
    logger.info('Email resume intake poller stopped.');
  }
}
