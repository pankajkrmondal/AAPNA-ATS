import cron from 'node-cron';
import logger from '../config/logger.js';
import config from '../config/index.js';
import { syncZekoJobs, fetchInterviewResults } from '../services/zeko.service.js';

/**
 * Zeko background scheduler.
 *
 * Registers two node-cron jobs (replacing the n8n "FULLY AUTO Sync (API Key Auth)"
 * and "Step 3 — Auto Fetch Interview Results" workflows):
 *   - jobsCron    : refresh the Zeko bearer token + sync the job catalog (hourly).
 *   - resultsCron : fetch interview results for ended interviews (hourly, offset).
 *
 * Self-gated by config.zeko.sync.enabled — does nothing unless ZEKO_SYNC_ENABLED=true.
 */

let jobsTask = null;
let resultsTask = null;

/**
 * Starts the Zeko sync cron jobs if enabled and configured.
 */
export function startZekoSchedulerJob() {
  if (!config.zeko.sync.enabled) {
    logger.info('Zeko sync scheduler disabled (ZEKO_SYNC_ENABLED is not true) — skipping.');
    return;
  }

  if (!config.zeko.clientId || !config.zeko.apiKey || !config.zeko.companyId) {
    logger.warn(
      'Zeko sync enabled but ZEKO_CLIENT_ID / ZEKO_API_KEY / ZEKO_COMPANY_ID are incomplete — scheduler not started.'
    );
    return;
  }

  const jobsCron = config.zeko.sync.jobsCron;
  const resultsCron = config.zeko.sync.resultsCron;

  if (!cron.validate(jobsCron)) {
    logger.error(`Invalid ZEKO_JOBS_CRON "${jobsCron}" — Zeko job sync not scheduled.`);
  } else {
    jobsTask = cron.schedule(jobsCron, async () => {
      logger.info('⏰ Running Zeko token refresh + job catalog sync…');
      try {
        await syncZekoJobs();
      } catch (error) {
        logger.error('Zeko job sync failed:', { error: error.message });
      }
    });
    logger.info(`📅 Zeko job sync cron scheduled: "${jobsCron}"`);
  }

  if (!cron.validate(resultsCron)) {
    logger.error(`Invalid ZEKO_RESULTS_CRON "${resultsCron}" — Zeko results fetch not scheduled.`);
  } else {
    resultsTask = cron.schedule(resultsCron, async () => {
      logger.info('⏰ Running Zeko interview-results fetch…');
      try {
        await fetchInterviewResults();
      } catch (error) {
        logger.error('Zeko results fetch failed:', { error: error.message });
      }
    });
    logger.info(`📅 Zeko results fetch cron scheduled: "${resultsCron}"`);
  }
}

/**
 * Stops the active Zeko sync cron jobs.
 */
export function stopZekoSchedulerJob() {
  if (jobsTask) {
    jobsTask.stop();
    jobsTask = null;
  }
  if (resultsTask) {
    resultsTask.stop();
    resultsTask = null;
  }
  logger.info('Zeko sync scheduler stopped');
}
