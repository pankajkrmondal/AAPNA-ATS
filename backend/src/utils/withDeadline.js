/**
 * withDeadline.js — a wall-clock ceiling on work that has no signal reaching
 * inside it.
 *
 * WHY THIS EXISTS RATHER THAN AN AbortSignal. Both callers are waiting on the
 * Zeko client, whose own fetches already carry AbortSignal timeouts. The step
 * that actually runs long is not a fetch: an invalidated dashboard cookie sends
 * it through the OTP login — request a code, poll the mailbox, verify — which
 * measured 38 SECONDS against staging (2026-09-03). No abort signal reaches
 * inside that, so it is raced instead.
 *
 * The losing work is NOT cancelled, deliberately: the login finishes in the
 * background and stores a fresh cookie, so the ONE request that paid the cost is
 * the only one that degrades and the next attempt is fast. That is why both
 * callers tell the user to try again rather than reporting a hard failure.
 *
 * The timer is unref'd so a pending race can never hold the process open.
 *
 * @param {Promise<*>} promise
 * @param {number} ms - remaining budget; a non-positive value rejects at once
 * @returns {Promise<*>}
 */
export function withDeadline(promise, ms) {
  if (!(ms > 0)) return Promise.reject(new Error('the time budget for this step was already spent'));
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      timer.unref?.();
    }),
  ]);
}

export default { withDeadline };
