/**
 * alertThrottle.js — one developer alert per error signature per cooldown, so
 * a sustained outage sends one email, not a flood (5xx, job and crash alerts).
 *
 * Per process and in memory: a restart may send one repeat, which is fine.
 * Old entries are pruned so a long-running process with many distinct errors
 * doesn't grow the map forever.
 */

export const ERROR_ALERT_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Job alerts repeat at most hourly per job + error: the busiest jobs run every
 * 5 minutes, so the 5-minute throttle would mail on every tick of an outage.
 */
export const JOB_ALERT_COOLDOWN_MS = 60 * 60 * 1000;

const PRUNE_ABOVE = 500;

/**
 * @param {Map<string, {at: number, cooldownMs: number}>} [store]
 * @returns {(signature: string, cooldownMs?: number, now?: number) => boolean}
 */
export function createAlertThrottle(store = new Map()) {
  return function alertAllowed(signature, cooldownMs = ERROR_ALERT_COOLDOWN_MS, now = Date.now()) {
    const last = store.get(signature);
    if (last && now - last.at < last.cooldownMs) return false;
    if (store.size > PRUNE_ABOVE) {
      for (const [key, entry] of store) {
        if (now - entry.at >= entry.cooldownMs) store.delete(key);
      }
    }
    store.set(signature, { at: now, cooldownMs });
    return true;
  };
}

/** The process-wide throttle shared by every alert. */
export const alertAllowed = createAlertThrottle();
