/**
 * mrfHoldSweep.js — the daily MRF hold release.
 *
 * Every MRF on hold whose hold-until date (IST) is today or earlier goes back to
 * pending, and the approval email is sent again to every approver — the same
 * email as the first time, with a "Back from hold" banner — so they can
 * approve, reject or hold further. Normal approval reminders then apply.
 *
 * Runs once a day at the "release time" set in Settings › MRF Approval & Hold
 * (mrf_hold_release_time, default 09:00 IST). `<= today` means a day the server
 * missed is caught up on the next run; the held -> pending update is the claim,
 * so two processes never release (or email) the same MRF twice.
 *
 * It runs whether or not MRF_HOLD_ENABLED is on: turning the feature off stops
 * NEW holds, it must never strand MRFs that are already held.
 *
 * Plan: docs/phase3/MRF/MRF-Hold-and-Delegate-Approval-Plan.md §6.5
 */
import cron from 'node-cron';
import logger from '../config/logger.js';
import { runJob } from '../utils/jobRunner.js';
import { releaseDueHolds } from '../services/mrfApproval.service.js';
import { getHoldRules } from '../services/mrfHoldSettings.service.js';
import { releaseTimeToCron } from '../utils/mrfApprovalRules.js';

let task = null;
let running = false;

/** Release every hold that is due. Returns { due, released, emails }. */
export async function runMrfHoldSweep() {
  if (running) {
    logger.warn('[MRF Hold] previous sweep still running — skipping this run.');
    return { due: 0, released: 0, emails: 0, skipped: true };
  }
  running = true;
  try {
    const result = await releaseDueHolds();
    if (result.due) {
      logger.info(`[MRF Hold] ${result.released}/${result.due} held MRF(s) released; ${result.emails} approval email(s) sent.`);
    }
    return result;
  } finally {
    running = false;
  }
}

/** Schedule the sweep at the release time from Settings (IST). */
export async function startMrfHoldSweepJob() {
  if (task) return;
  let releaseTime = '09:00';
  try {
    ({ releaseTime } = await getHoldRules());
  } catch (err) {
    logger.warn(`[MRF Hold] could not read the release time (${err.message}); using 09:00 IST.`);
  }
  const expression = releaseTimeToCron(releaseTime);
  task = cron.schedule(expression, () => runJob('mrfHoldSweep', () => runMrfHoldSweep()), { timezone: 'Asia/Kolkata' });
  logger.info(`⏸️  MRF hold release sweep scheduled daily at ${releaseTime} IST ("${expression}").`);
}

export function stopMrfHoldSweepJob() {
  if (task) {
    task.stop();
    task = null;
  }
}

/** Re-read the release time after Settings changes it. */
export async function rescheduleMrfHoldSweepJob() {
  stopMrfHoldSweepJob();
  await startMrfHoldSweepJob();
}
