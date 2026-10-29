import cron from 'node-cron';
import logger from '../config/logger.js';
import config from '../config/index.js';
import { ensureZekoToken, syncZekoJobs, fetchInterviewResults } from '../services/zeko.service.js';
import { runJob } from '../utils/jobRunner.js';

/**
 * Zeko background scheduler.
 *
 * Registers two node-cron jobs (replacing the n8n "FULLY AUTO Sync (API Key Auth)"
 * and "Step 3 — Auto Fetch Interview Results" workflows):
 *   - jobsCron    : refresh the Zeko bearer token (job `zekoToken`), then sync the
 *                   job catalog (job `zekoJobs`) — hourly.
 *   - resultsCron : fetch interview results for ended interviews (every 5 min).
 *
 * The bearer token is also minted on demand by schedule/cancel (withZekoToken),
 * so this refresh keeps one ready and surfaces a broken API key early; nothing
 * depends on it running.
 *
 * Self-gated by config.zeko.sync.enabled — does nothing unless ZEKO_SYNC_ENABLED=true.
 */

let jobsTask = null;
let resultsTask = null;

/**
 * Guards against overlapping results runs.
 *
 * node-cron fires on schedule regardless of whether the previous invocation has
 * finished. At the hourly cadence this could not matter, but the results fetch
 * now runs every 5 minutes and a real run takes ~15s and climbs with the number
 * of pending interviews — a slow Zeko response or a backlog could exceed the
 * interval and stack concurrent syncs, doubling the API load and racing two
 * writers onto the same rows. Skipping the tick is the right call: the next one
 * is only minutes away.
 */
let resultsRunning = false;

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
      // Separate runs, separate heartbeats: the token is the API-key bearer used
      // by schedule/cancel, the catalog sync signs in with the OTP cookie, and a
      // failure in one must not skip the other. runJob never throws.
      await runJob('zekoToken', () => ensureZekoToken());
      await runJob('zekoJobs', async () => {
        logger.info('⏰ Running Zeko job catalog sync…');
        await syncZekoJobs();
      });
    });
    logger.info(`📅 Zeko job sync cron scheduled: "${jobsCron}"`);
  }

  if (!cron.validate(resultsCron)) {
    logger.error(`Invalid ZEKO_RESULTS_CRON "${resultsCron}" — Zeko results fetch not scheduled.`);
  } else {
    resultsTask = cron.schedule(resultsCron, async () => {
      if (resultsRunning) {
        logger.warn('Zeko results fetch still running from the previous tick — skipping this one.');
        return;
      }
      resultsRunning = true;
      logger.info('⏰ Running Zeko interview-results fetch…');
      try {
        await runJob('zekoResults', () => fetchInterviewResults());
      } finally {
        // Must release even when the fetch throws, or one failure would wedge
        // the job permanently.
        resultsRunning = false;
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
