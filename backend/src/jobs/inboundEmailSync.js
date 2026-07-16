/**
 * Inbound email conversation sync — Node equivalent of the n8n
 * "Outlook WF2 - Incoming Email Sync" workflow.
 *
 * Matches each inbound message from the per-environment mailbox
 * (config.microsoft.defaultSender) to a candidate/shortlist, records it in
 * rpa_email_messages (direction 'inbound'), and updates rpa_email_tracking for
 * the matching outbound thread (replied, or bounced for NDRs). This populates
 * the screening conversation view that getOutlookConversations() reads.
 *
 * Scheduled polling now runs through jobs/mailboxPoller.js (delta queries);
 * runInboundEmailSync() keeps the legacy timestamp-watermark path for
 * manual/scratch runs. Disabled by default; enabled via INBOUND_SYNC_ENABLED.
 */
import cron from 'node-cron';
import prisma from '../config/database.js';
import config from '../config/index.js';
import logger from '../config/logger.js';
import { fetchMessagesSince, isAdminSender } from '../services/outlookReader.service.js';

const WATERMARK_KEY = 'inbound_sync_last_sync';

let job;
let running = false; // overlap guard

async function getWatermark() {
  const row = await prisma.rpa_settings.findUnique({ where: { key: WATERMARK_KEY } });
  if (row && row.value) return row.value;
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

async function setWatermark(iso) {
  await prisma.rpa_settings.upsert({
    where: { key: WATERMARK_KEY },
    update: { value: iso },
    create: { key: WATERMARK_KEY, value: iso },
  });
}

/**
 * Match an inbound sender to a candidate/shortlist (mirrors WF2 "Lookup Candidate").
 * @param {string} fromEmail
 * @returns {Promise<{ candidate_id: bigint|null, shortlist_id: number|null }>}
 */
async function lookupCandidate(fromEmail) {
  const rows = await prisma.$queryRaw`
    SELECT sc.id AS shortlist_id, cv.id AS candidate_id, sc.position_applied
    FROM rpa_cv cv
    LEFT JOIN rpa_shortlisted_candidates sc ON sc.cv_id = cv.id
    WHERE cv."EmailID" ILIKE ${fromEmail}
    ORDER BY sc.created_at DESC NULLS LAST
    LIMIT 1
  `;
  if (rows && rows.length > 0) {
    return {
      candidate_id: rows[0].candidate_id ?? null,
      shortlist_id: rows[0].shortlist_id ?? null,
    };
  }
  return { candidate_id: null, shortlist_id: null };
}

/**
 * Fallback mapping when the sender address matches no rpa_cv row (candidate
 * replying from a different address): adopt the candidate/shortlist of the
 * latest OUTBOUND message in the same Graph conversation. Viable since
 * outbound rows store real conversation ids.
 * @param {string} conversationId
 * @returns {Promise<{ candidate_id: bigint|null, shortlist_id: number|null }>}
 */
async function lookupCandidateByConversation(conversationId) {
  if (!conversationId) return { candidate_id: null, shortlist_id: null };
  const row = await prisma.rpa_email_messages.findFirst({
    where: {
      conversation_id: conversationId,
      direction: 'outbound',
      candidate_id: { not: null },
    },
    orderBy: { created_at: 'desc' },
    select: { candidate_id: true, shortlist_id: true },
  });
  if (!row) return { candidate_id: null, shortlist_id: null };
  return { candidate_id: row.candidate_id, shortlist_id: row.shortlist_id ?? null };
}

/**
 * Process a batch of normalized inbox messages (already fetched): insert
 * inbound rows, close reminder loops, and flip replied/bounced tracking.
 * Idempotent via the unique graph_message_id, so re-delivery (poller restarts,
 * delta re-emits) is safe. Shared by the consolidated mailbox poller and the
 * legacy runInboundEmailSync watermark path.
 * @param {Object[]} messages - normalized messages (see outlookReader.normalizeMessage)
 */
export async function processInboundMessages(messages) {
  for (const msg of messages || []) {
    // Skip internal/admin senders (outbound loopbacks) — mirrors WF2.
    if (!msg.fromEmail || isAdminSender(msg.fromEmail)) continue;

    let { candidate_id, shortlist_id } = await lookupCandidate(msg.fromEmail);

    // P6.3 fallback: unknown sender address, but the thread is known.
    if (candidate_id === null) {
      const byConv = await lookupCandidateByConversation(msg.conversationId);
      if (byConv.candidate_id !== null) {
        ({ candidate_id, shortlist_id } = byConv);
        logger.info(`[Inbound Sync] Mapped "${msg.fromEmail}" to candidate ${candidate_id} via conversation ${msg.conversationId} (address not on file).`);
      }
    }

    // Insert inbound message; dedup on the unique graph_message_id.
    let inserted;
    try {
      inserted = await prisma.rpa_email_messages.create({
        data: {
          graph_message_id: msg.graphMessageId || null,
          conversation_id: msg.conversationId || '',
          internet_msg_id: msg.internetMsgId || null,
          from_email: msg.fromEmail,
          from_name: msg.fromName || null,
          to_emails: msg.toEmails || [],
          cc_emails: msg.ccEmails || [],
          subject: msg.subject || null,
          body_preview: msg.bodyPreview || null,
          body_html: msg.bodyHtml || null,
          has_attachments: msg.hasAttachments,
          direction: 'inbound',
          folder: 'inbox',
          candidate_id: candidate_id !== null ? BigInt(candidate_id) : null,
          shortlist_id: shortlist_id !== null ? Number(shortlist_id) : null,
          received_at: new Date(msg.receivedAt),
        },
      });
    } catch (err) {
      // Unique-violation on graph_message_id => already synced; skip quietly.
      if (err.code === 'P2002') continue;
      logger.error(`[Inbound Sync] Insert failed for ${msg.graphMessageId}: ${err.message}`);
      continue;
    }

    // A genuine reply means the sender has responded: close out their open
    // rpa_email_log rows so the reminder cron stops following up. Matched by
    // recipient address, so it works even for sends without Graph ids.
    if (!msg.isBounce) {
      try {
        const closed = await prisma.rpa_email_log.updateMany({
          where: {
            responded_at: null,
            recipient_email: { equals: msg.fromEmail, mode: 'insensitive' },
          },
          data: { responded_at: new Date(msg.receivedAt) },
        });
        if (closed.count > 0) {
          logger.info(`[Inbound Sync] Marked ${closed.count} email log(s) responded for "${msg.fromEmail}".`);
        }
      } catch (err) {
        logger.error(`[Inbound Sync] responded_at update failed for "${msg.fromEmail}": ${err.message}`);
      }
    }

    // Update outbound tracking for the same conversation (mirrors WF2).
    if (msg.conversationId) {
      try {
        if (msg.isBounce) {
          await prisma.$executeRaw`
            UPDATE rpa_email_tracking SET bounced = true, bounce_reason = ${msg.subject || ''}
            WHERE message_id IN (
              SELECT id FROM rpa_email_messages
              WHERE conversation_id = ${msg.conversationId} AND direction = 'outbound'
            ) AND bounced = false
          `;
        } else {
          await prisma.$executeRaw`
            UPDATE rpa_email_tracking SET replied = true, replied_at = NOW()
            WHERE message_id IN (
              SELECT id FROM rpa_email_messages
              WHERE conversation_id = ${msg.conversationId} AND direction = 'outbound'
            ) AND replied = false
          `;
        }
      } catch (err) {
        logger.error(`[Inbound Sync] Tracking update failed for conv ${msg.conversationId}: ${err.message}`);
      }
    }

    logger.info(`[Inbound Sync] Recorded inbound mail from "${msg.fromEmail}" (msg id ${inserted.id}${msg.isBounce ? ', bounce' : ''}).`);
  }
}

/**
 * One poll cycle (legacy timestamp-watermark path, kept for manual/scratch
 * runs): ingest new inbound messages into the conversation tables.
 */
export async function runInboundEmailSync() {
  if (running) {
    logger.warn('[Inbound Sync] Previous run still in flight; skipping this tick.');
    return;
  }
  running = true;
  try {
    const sinceIso = await getWatermark();
    const messages = await fetchMessagesSince(sinceIso, { withAttachmentsOnly: false });

    if (messages.length === 0) {
      return;
    }
    logger.info(`[Inbound Sync] ${messages.length} new inbound message(s) since ${sinceIso}`);

    let newestReceived = sinceIso;
    for (const msg of messages) {
      if (msg.receivedAt > newestReceived) newestReceived = msg.receivedAt;
    }

    await processInboundMessages(messages);

    await setWatermark(newestReceived);

    // Best-effort: stamp the account's last_sync_at if a row exists for this mailbox.
    try {
      await prisma.rpa_outlook_accounts.updateMany({
        where: { outlook_email: config.microsoft.defaultSender },
        data: { last_sync_at: new Date(newestReceived) },
      });
    } catch {
      /* non-fatal */
    }
  } catch (err) {
    logger.error(`[Inbound Sync] Poll cycle failed: ${err.message}`);
  } finally {
    running = false;
  }
}

export function startInboundEmailSyncJob() {
  if (!config.email.inboundSync.enabled) {
    logger.info('📪 Inbound email sync poller DISABLED (set INBOUND_SYNC_ENABLED=true to enable).');
    return;
  }
  job = cron.schedule(config.email.inboundSync.cron, () => {
    runInboundEmailSync().catch((err) =>
      logger.error(`[Inbound Sync] Unhandled error: ${err.message}`)
    );
  });
  logger.info(`📨 Inbound email sync poller scheduled (${config.email.inboundSync.cron}).`);
}

export function stopInboundEmailSyncJob() {
  if (job) {
    job.stop();
    logger.info('Inbound email sync poller stopped.');
  }
}
