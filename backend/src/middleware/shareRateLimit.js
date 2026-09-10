/**
 * Rate limiters for the PUBLIC recording share-link routes.
 *
 * A separate limiter from exportLimiter, and it has to be: that one keys on
 * `req.user.id`, and there is no user here — the token IS the identity. Falling
 * back to its `ip:` branch would put every external interviewer behind one
 * corporate NAT into a single bucket, so one person watching an interview would
 * lock out everyone else at their company.
 *
 * KEYED ON TOKEN + IP, which is the pairing that makes the two failure modes
 * distinguishable:
 *   - one interviewer watching one interview: one token, one IP, many range
 *     requests — comfortably inside the allowance;
 *   - a link doing the rounds: one token, many IPs — each new IP starts with a
 *     fresh allowance, but `view_count` on the link itself is what catches this,
 *     and the drawer flags it (see describeShareLink's `unusual`).
 *
 * ONLY A REAL TOKEN BECOMES A KEY. The token comes off the URL, so it is
 * attacker-chosen and unbounded: keying on it verbatim let anyone allocate a
 * fresh entry in the limiter's in-memory store per request, retained for the
 * whole window, simply by walking made-up URLs. Anything that is not shaped like
 * one of our tokens therefore shares ONE bucket per IP — which also means a
 * brute-force sweep for a valid token runs into the limit rather than resetting
 * it on every guess.
 *
 * TWO LIMITERS, NOT ONE INSTANCE ON TWO ROUTES. A single limiter is a single
 * store, so a player's range requests spent the page's allowance too — the exact
 * thing the routes file said could not happen. The stream gets its own, larger
 * budget, because seeking through an hour-long interview is many requests and a
 * 429 there stalls the video with nothing on screen to explain it.
 *
 * The limiters are a brake on hammering, not the access control. The access
 * control is the token's expiry and its revoke button.
 */
import rateLimit from 'express-rate-limit';

import config from '../config/index.js';
import { friendlyRateLimitHandler } from '../utils/rateLimitHandler.js';
import { isShareToken } from '../utils/recordingShareModel.js';
import { esc } from '../exports/candidateDossier.export.js';
import { publicHeaders, sharePage } from '../controllers/recordingShare.controller.js';

/**
 * token+IP for a plausible token, IP alone for anything else.
 *
 * Exported so the store-exhaustion property above is pinned by a unit test
 * rather than by whoever next reads the keyGenerator line.
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
export function shareRateKey(req) {
  const token = req.params?.token;
  return isShareToken(token) ? `share:${token}:${req.ip}` : `share:invalid:${req.ip}`;
}

/** The 429 an external viewer gets: a page, like every other answer this route gives a human. */
function shareLimitPage(req, res) {
  const title = 'Too many requests for this recording';
  const message = 'Please wait a few minutes and open the link again. If it still will not play, '
    + 'ask the recruiter who sent it to you.';
  publicHeaders(res);
  return res.status(429).type('html').send(sharePage(title, `
    <header><div class="mark">AAPNA Infotech</div><h1>${esc(title)}</h1></header>
    <main><div class="gone"><p>${esc(message)}</p></div></main>`));
}

/** The page a human opens. */
export const shareLimiter = rateLimit({
  windowMs: config.dossier.shareRateWindowMs,
  max: config.dossier.shareRateMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: shareRateKey,
  handler: shareLimitPage,
});

/**
 * The bytes that page plays. Its own store and its own ceiling — a video player
 * issues far more requests than a reader opens pages, and the two allowances
 * must not be drawn from the same pot. JSON here, not HTML: the caller is a
 * <video> element, not a reader.
 */
export const shareStreamLimiter = rateLimit({
  windowMs: config.dossier.shareRateWindowMs,
  max: config.dossier.shareStreamRateMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: shareRateKey,
  handler: friendlyRateLimitHandler('Too many requests for this recording.'),
});

export default shareLimiter;
