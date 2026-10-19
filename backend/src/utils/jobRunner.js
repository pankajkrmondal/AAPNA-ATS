/**
 * jobRunner.js — every scheduled job runs through `runJob` (N42).
 *
 * One run:
 *   - gets its own ref ("job-mailboxPoller-K7Q2MX"), so every log line and
 *     outside call it makes can be found from Logs & errors;
 *   - is timed;
 *   - on failure is logged, stored in rpa_error_log, and alerted to developers
 *     (same recipients as the 5xx alert; at most hourly per job and error);
 *   - leaves a heartbeat in rpa_settings: job_heartbeat.<env>.<job>, holding
 *     last run / last success / last failure / last error / duration. The env
 *     is in the key because a local backend also runs the jobs against the
 *     staging database.
 *
 * `runJob` never throws, like the job callbacks it replaces: a failed run must
 * not crash the process or stop the schedule.
 */
import prisma from '../config/database.js';
import config from '../config/index.js';
import logger from '../config/logger.js';
import { newRef, runWithContext } from '../middleware/requestContext.js';
import { recordError } from '../services/errorLog.service.js';
import { sendOpsAlert } from '../services/emailNotification.service.js';
import { maskText } from './logMask.js';

export const HEARTBEAT_PREFIX = 'job_heartbeat.';

export function heartbeatKey(name, env = config.env) {
  return `${HEARTBEAT_PREFIX}${env}.${name}`;
}

async function writeHeartbeat(name, patch) {
  try {
    const key = heartbeatKey(name);
    const row = await prisma.rpa_settings.findUnique({ where: { key } });
    let prev = {};
    try { prev = row ? JSON.parse(row.value) : {}; } catch { prev = {}; }
    const value = JSON.stringify({ ...prev, ...patch, env: config.env, host: process.env.HOSTNAME || process.env.COMPUTERNAME || null });
    await prisma.rpa_settings.upsert({ where: { key }, update: { value }, create: { key, value } });
  } catch (e) {
    logger.warn(`[JobRunner] heartbeat for ${name} not saved: ${e.message}`);
  }
}

const DEFAULT_DEPS = { recordError, writeHeartbeat, sendOpsAlert };

/**
 * A runJob bound to its side effects; tests pass stubs. Production code uses
 * the exported `runJob`.
 */
export function createJobRunner(deps = DEFAULT_DEPS) {
  const { recordError: record, writeHeartbeat: beat, sendOpsAlert: alertDevs } = { ...DEFAULT_DEPS, ...deps };

  /**
   * Run one job pass.
   * @template T
   * @param {string} name  stable job name, e.g. "mailboxPoller"
   * @param {() => Promise<T>} fn  the pass; throw to report a failed run
   * @param {object} [opts]
   * @param {boolean} [opts.alert=true]  email developers on failure
   * @returns {Promise<T|undefined>} the pass's result, or undefined if it failed
   */
  return function runJob(name, fn, { alert = true } = {}) {
    const requestId = `job-${name}-${newRef()}`;
    return runWithContext({ requestId, userId: null, role: 'system', route: `job:${name}` }, async () => {
      const started = Date.now();
      const startedAt = new Date(started).toISOString();
      try {
        const result = await fn();
        const durationMs = Date.now() - started;
        logger.debug(`[Job] ${name} finished in ${durationMs} ms`);
        await beat(name, { lastRunAt: startedAt, lastOkAt: new Date().toISOString(), lastDurationMs: durationMs, lastRef: requestId });
        return result;
      } catch (err) {
        const durationMs = Date.now() - started;
        logger.error(`[Job] ${name} failed after ${durationMs} ms: ${err?.message || err}`, { job: name, stack: err?.stack });
        await record({ source: 'job', err, route: `job:${name}`, requestId, meta: { job: name, durationMs } });
        await beat(name, {
          lastRunAt: startedAt,
          lastFailAt: new Date().toISOString(),
          lastError: maskText(String(err?.message || err)).slice(0, 500),
          lastFailRef: requestId,
          lastDurationMs: durationMs,
        });
        if (alert) {
          Promise.resolve(alertDevs({
            kind: 'job_failure',
            title: `Job failed: ${name}`,
            signature: jobAlertSignature(name, err),
            err,
            ref: requestId,
            details: [['Job', name], ['Duration', `${durationMs} ms`]],
          })).catch(() => {});
        }
        return undefined;
      }
    });
  };
}

/** Same job + same kind of error = same alert (numbers ignored, so ids don't split it). */
export function jobAlertSignature(name, err) {
  return `${name}:${err?.code || err?.name || 'Error'}:${String(err?.message || '').replace(/\d+/g, '#').slice(0, 80)}`;
}

export const runJob = createJobRunner();
