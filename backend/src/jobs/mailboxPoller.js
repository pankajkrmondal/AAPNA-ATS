/**
 * Consolidated mailbox poller (P5-A + P6.1).
 *
 * Replaces the two independent inbox pollers (email resume intake + inbound
 * conversation sync) with a single Graph DELTA-query fetch per tick that fans
 * out to both processors. Delta queries have no watermark-boundary miss/dup
 * edge cases and return only changes, so the interval can be tightened
 * (MAILBOX_SYNC_CRON) without extra Graph load.
 *
 * The delta link lives in rpa_settings ('mailbox_delta_link'). It is saved
 * only AFTER both processors finish, so a failed tick reprocesses the same
 * changes next time — both processors are idempotent (unique
 * graph_message_id / hashed execution_id).
 */
import cron from 'node-cron';
import prisma from '../config/database.js';
import config from '../config/index.js';
import logger from '../config/logger.js';
import { fetchMessagesDelta } from '../services/outlookReader.service.js';
import { processIntakeMessages } from './emailResumeIntake.js';
import { processInboundMessages } from './inboundEmailSync.js';

const DELTA_KEY = 'mailbox_delta_link';

let job;
let running = false; // overlap guard

async function getDeltaLink() {
  const row = await prisma.rpa_settings.findUnique({ where: { key: DELTA_KEY } });
  return row?.value || null;
}

async function setDeltaLink(link) {
  await prisma.rpa_settings.upsert({
    where: { key: DELTA_KEY },
    update: { value: link },
    create: { key: DELTA_KEY, value: link },
  });
}

async function clearDeltaLink() {
  await prisma.rpa_settings.deleteMany({ where: { key: DELTA_KEY } });
}

/**
 * One poll cycle: delta-fetch inbox changes once, fan out to the enabled
 * processors, then persist the new delta link.
 */
export async function runMailboxPoll() {
  if (running) {
    logger.warn('[Mailbox Poller] Previous run still in flight; skipping this tick.');
    return;
  }
  running = true;
  try {
    let result;
    try {
      result = await fetchMessagesDelta(await getDeltaLink());
    } catch (err) {
      if (err.code === 'DELTA_EXPIRED') {
        logger.warn('[Mailbox Poller] Delta token expired; restarting with a fresh 24h initial sync (idempotency absorbs the overlap).');
        await clearDeltaLink();
        result = await fetchMessagesDelta(null);
      } else {
        throw err;
      }
    }
    const { messages, deltaLink } = result;

    if (messages.length > 0) {
      logger.info(`[Mailbox Poller] ${messages.length} inbox change(s) from delta query.`);
      if (config.email.intake.enabled) {
        await processIntakeMessages(messages);
      }
      if (config.email.inboundSync.enabled) {
        await processInboundMessages(messages);
      }
    }

    if (deltaLink) {
      await setDeltaLink(deltaLink);
    }

    // Best-effort: stamp the account's last_sync_at if a row exists for this mailbox.
    try {
      await prisma.rpa_outlook_accounts.updateMany({
        where: { outlook_email: config.microsoft.defaultSender },
        data: { last_sync_at: new Date() },
      });
    } catch {
      /* non-fatal */
    }
  } catch (err) {
    logger.error(`[Mailbox Poller] Poll cycle failed: ${err.message}`);
  } finally {
    running = false;
  }
}

export function startMailboxPollerJob() {
  const { intake, inboundSync, mailboxSync } = config.email;
  if (!intake.enabled && !inboundSync.enabled) {
    logger.info('📪 Mailbox poller DISABLED (set EMAIL_INTAKE_ENABLED and/or INBOUND_SYNC_ENABLED to true to enable).');
    return;
  }
  job = cron.schedule(mailboxSync.cron, () => {
    runMailboxPoll().catch((err) =>
      logger.error(`[Mailbox Poller] Unhandled error: ${err.message}`)
    );
  });
  logger.info(`📬 Mailbox poller scheduled (${mailboxSync.cron}; intake=${intake.enabled}, inboundSync=${inboundSync.enabled}).`);
}

export function stopMailboxPollerJob() {
  if (job) {
    job.stop();
    logger.info('Mailbox poller stopped.');
  }
}
