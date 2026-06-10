import cron from 'node-cron';
import logger from '../config/logger.js';
import { cleanupExpiredSessions } from '../services/auth.service.js';

/**
 * Session cleanup cron job.
 *
 * Runs every 2 hours and removes expired rows from `rpa_sessions`.
 * This prevents the sessions table from growing unbounded when users
 * don't explicitly log out.
 *
 * Schedule: '0 *​/2 * * *' → minute 0 of every 2nd hour
 */
let job;

export function startSessionCleanupJob() {
  job = cron.schedule('0 */2 * * *', async () => {
    logger.info('⏰ Running session cleanup job…');
    try {
      const count = await cleanupExpiredSessions();
      logger.info(`Session cleanup complete — removed ${count} expired session(s)`);
    } catch (error) {
      logger.error('Session cleanup failed', { error: error.message });
    }
  });

  logger.info('📅 Session cleanup cron scheduled (every 2 hours)');
}

export function stopSessionCleanupJob() {
  if (job) {
    job.stop();
    logger.info('Session cleanup cron stopped');
  }
}
