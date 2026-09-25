/**
 * mrfAuditRetentionSweep.js — nightly privacy sweep for the MRF approval trail.
 *
 * IP address and device are personal data. Business decision D2 (25 Sep 2026):
 * keep them 12 months, then mask them, and keep WHO decided, WHAT and WHEN
 * permanently. After the retention period this sweep:
 *   - masks rpa_mrf_approval_events.ip_address to its /24 (IPv6: /48) network
 *     and reduces user_agent to "Browser on OS", stamping client_data_masked_at;
 *   - masks rpa_mrf.decided_ip the same way;
 *   - deletes link_opened events (supporting detail, not the decision).
 *
 * The events table is append-only (trigger trg_mrf_approval_events_guard). This
 * sweep is the ONE writer the trigger lets through, and only because it sets
 * app.audit_retention = 'on' inside its own transaction; even then the trigger
 * refuses anything younger than the retention period or any other column.
 *
 * Built not to hurt the site: runs at 02:30 IST, batches of 500 rows with a
 * 5 s statement timeout, at most 20 batches per night (continues next night),
 * and never overlaps itself. Expected volume is a handful of rows a day.
 *
 * Retention is the setting `mrf_audit_client_data_retention_days` (default 365,
 * never below 30 — the trigger enforces the same floor).
 */
import cron from 'node-cron';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import { maskIp, summarizeUserAgent } from '../utils/mrfApprovalRules.js';

const RETENTION_KEY = 'mrf_audit_client_data_retention_days';
const DEFAULT_RETENTION_DAYS = 365;
const MIN_RETENTION_DAYS = 30;

let task = null;
let running = false;

async function retentionDays() {
  const row = await prisma.rpa_settings.findUnique({ where: { key: RETENTION_KEY } });
  const n = parseInt(row?.value ?? '', 10);
  return Math.max(Number.isFinite(n) ? n : DEFAULT_RETENTION_DAYS, MIN_RETENTION_DAYS);
}

/**
 * One sweep pass. Exported for manual runs and tests.
 * @returns {Promise<{ days: number, masked: number, deleted: number, mrfMasked: number }>}
 */
export async function runMrfAuditRetentionSweep({ batchSize = 500, maxBatches = 20 } = {}) {
  if (running) {
    logger.warn('[MRF Audit Retention] previous sweep still running — skipped.');
    return { days: 0, masked: 0, deleted: 0, mrfMasked: 0 };
  }
  running = true;
  const totals = { days: 0, masked: 0, deleted: 0, mrfMasked: 0 };
  try {
    const days = await retentionDays();
    totals.days = days;
    const cutoff = new Date(Date.now() - days * 86400000);

    for (let batch = 0; batch < maxBatches; batch += 1) {
      const { deleted, masked } = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '5s'`);
        await tx.$executeRawUnsafe(`SET LOCAL app.audit_retention = 'on'`);
        await tx.$executeRawUnsafe(`SET LOCAL app.audit_retention_days = '${days}'`); // integer from parseInt

        const del = await tx.$executeRawUnsafe(
          `DELETE FROM rpa_mrf_approval_events WHERE id IN (
             SELECT id FROM rpa_mrf_approval_events
              WHERE event_type = 'link_opened' AND created_at < $1
              ORDER BY id LIMIT $2)`,
          cutoff, batchSize,
        );
        const rows = await tx.$queryRawUnsafe(
          `SELECT id, host(ip_address) AS ip, user_agent FROM rpa_mrf_approval_events
            WHERE client_data_masked_at IS NULL AND created_at < $1
              AND (ip_address IS NOT NULL OR user_agent IS NOT NULL)
            ORDER BY id LIMIT $2`,
          cutoff, batchSize,
        );
        for (const r of rows) {
          await tx.$executeRawUnsafe(
            `UPDATE rpa_mrf_approval_events
                SET ip_address = $1::inet, user_agent = $2, client_data_masked_at = now()
              WHERE id = $3`,
            maskIp(r.ip), summarizeUserAgent(r.user_agent), r.id,
          );
        }
        return { deleted: del, masked: rows.length };
      }, { timeout: 60000 });

      totals.deleted += deleted;
      totals.masked += masked;
      if (deleted < batchSize && masked < batchSize) break;
    }

    // Decision summary on the MRF itself (no trigger on rpa_mrf).
    const mrfs = await prisma.$queryRawUnsafe(
      `SELECT id, host(decided_ip) AS ip FROM rpa_mrf
        WHERE decided_ip IS NOT NULL AND decided_at < $1 LIMIT $2`,
      cutoff, batchSize,
    );
    for (const m of mrfs) {
      const masked = maskIp(m.ip);
      if (masked && masked !== m.ip) {
        await prisma.$executeRawUnsafe(`UPDATE rpa_mrf SET decided_ip = $1::inet WHERE id = $2`, masked, m.id);
        totals.mrfMasked += 1;
      }
    }

    if (totals.masked || totals.deleted || totals.mrfMasked) {
      logger.info(`[MRF Audit Retention] retention ${days}d: masked ${totals.masked} event(s), deleted ${totals.deleted} link-open event(s), masked ${totals.mrfMasked} MRF decision IP(s).`);
    }
    return totals;
  } catch (err) {
    logger.error(`[MRF Audit Retention] sweep failed: ${err.message}`);
    return totals;
  } finally {
    running = false;
  }
}

/** Nightly at 02:30 IST (off-peak). */
export function startMrfAuditRetentionJob() {
  if (task) return;
  task = cron.schedule('30 2 * * *', () => { runMrfAuditRetentionSweep(); }, { timezone: 'Asia/Kolkata' });
  logger.info('🧹 MRF approval audit retention sweep scheduled (02:30 IST daily)');
}

export function stopMrfAuditRetentionJob() {
  if (task) {
    task.stop();
    task = null;
  }
}
