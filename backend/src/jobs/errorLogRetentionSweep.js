/**
 * errorLogRetentionSweep.js — keeps rpa_error_log to the last 30 days (N42).
 *
 * Decision 19 Oct 2026: errors are kept 30 days. Runs nightly at 02:45 IST
 * (after the MRF audit sweep at 02:30), deletes in batches and never overlaps
 * itself. Runs through runJob, so a failed sweep is alerted like any job.
 */
import cron from 'node-cron';
import logger from '../config/logger.js';
import { deleteOlderThan } from '../services/errorLog.service.js';
import { runJob } from '../utils/jobRunner.js';

export const ERROR_LOG_RETENTION_DAYS = 30;

let task = null;
let running = false;

/**
 * One sweep pass. Exported for manual runs and tests.
 * @returns {Promise<number>} rows deleted
 */
export async function runErrorLogRetentionSweep(days = ERROR_LOG_RETENTION_DAYS) {
  if (running) {
    logger.warn('[Error Log Retention] previous sweep still running — skipped.');
    return 0;
  }
  running = true;
  try {
    const deleted = await deleteOlderThan(days);
    if (deleted) logger.info(`[Error Log Retention] deleted ${deleted} error(s) older than ${days} days.`);
    return deleted;
  } finally {
    running = false;
  }
}

/** Nightly at 02:45 IST (off-peak). */
export function startErrorLogRetentionJob() {
  if (task) return;
  task = cron.schedule('45 2 * * *', () => runJob('errorLogRetention', () => runErrorLogRetentionSweep()), { timezone: 'Asia/Kolkata' });
  logger.info(`🧹 Error log retention sweep scheduled (02:45 IST daily, keeps ${ERROR_LOG_RETENTION_DAYS} days)`);
}

export function stopErrorLogRetentionJob() {
  if (task) {
    task.stop();
    task = null;
  }
}
