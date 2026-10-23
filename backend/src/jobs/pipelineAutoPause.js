/**
 * pipelineAutoPause.js — hourly sweep that pauses idle pipeline journeys.
 *
 * A journey with no activity in its stage for N days (Settings › Candidate
 * Pipeline auto-pause, default 10) is paused and leaves the default board; it
 * is listed under "Paused journey". Hourly so a card does not sit a day past
 * its limit; the sweep is one UPDATE and a no-op when nothing is due.
 * Self-gated by pipeline_auto_pause_enabled (read on every run, so turning it
 * off in Settings takes effect without a restart).
 */
import cron from 'node-cron';
import logger from '../config/logger.js';
import { runJob } from '../utils/jobRunner.js';
import { autoPauseIdleJourneys } from '../services/pipelineAutoPause.service.js';

let task = null;
let running = false;

/** One sweep pass. Exported for manual runs and tests. */
export async function runPipelineAutoPause() {
  if (running) {
    logger.warn('[Auto-pause] previous sweep still running — skipped.');
    return { paused: 0, skipped: true };
  }
  running = true;
  try {
    return await autoPauseIdleJourneys();
  } finally {
    running = false;
  }
}

/** Hourly at :20 IST (clear of the other jobs on the hour). */
export function startPipelineAutoPauseJob() {
  if (task) return;
  task = cron.schedule('20 * * * *', () => runJob('pipelineAutoPause', () => runPipelineAutoPause()), { timezone: 'Asia/Kolkata' });
  logger.info('⏸️  Pipeline auto-pause sweep scheduled (hourly at :20, idle days from Settings)');
}

export function stopPipelineAutoPauseJob() {
  if (task) {
    task.stop();
    task = null;
  }
}
