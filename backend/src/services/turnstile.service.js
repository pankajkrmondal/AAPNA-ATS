/**
 * Cloudflare Turnstile — server-side token verification.
 *
 * The browser widget (frontend TurnstileWidget) hands the client a one-time
 * token; this service confirms it with Cloudflare's siteverify API before the
 * login is allowed to touch credentials.
 * Docs: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */
import config from '../config/index.js';
import logger from '../config/logger.js';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Whether Turnstile enforcement is active in this environment. */
export const isTurnstileEnabled = () => Boolean(config.turnstile.secretKey);

/**
 * Verify a Turnstile token issued to the browser widget.
 * Tokens are single-use and expire after 300 seconds.
 *
 * @param {string} token - Widget response token from the client
 * @param {string} [remoteip] - Client IP, lets Cloudflare cross-check the solver
 * @returns {Promise<boolean>} true when Cloudflare confirms the token
 */
export async function verifyTurnstileToken(token, remoteip) {
  const body = new URLSearchParams({
    secret: config.turnstile.secretKey,
    response: token,
  });
  if (remoteip) {
    body.append('remoteip', remoteip);
  }

  try {
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body });
    const data = await res.json();

    if (!data.success) {
      logger.warn(`Turnstile verification rejected a login token: ${(data['error-codes'] || []).join(', ') || 'no error code'}`);
    }
    return Boolean(data.success);
  } catch (err) {
    // Cloudflare unreachable: fail open so an outage on their side never locks
    // every user out of the ATS — the express-rate-limit brute-force throttle
    // in app.js remains in force behind this check.
    logger.error(`Turnstile siteverify request failed (allowing login): ${err.message}`);
    return true;
  }
}
