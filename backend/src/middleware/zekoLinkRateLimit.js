/**
 * Rate limiters for U08's public Zeko link routes (/api/z/...). Same keying as
 * shareRateLimit.js and for the same reasons: there is no user, so the token
 * plus the IP is the identity, and only a uuid-shaped token becomes a key (an
 * attacker-chosen string would otherwise mint a fresh bucket per request, and
 * a token sweep would never run into the limit).
 *
 * Two stores: opening the link and the page's /info read share a generous
 * allowance; saving a phone gets a small one of its own.
 */
import rateLimit from 'express-rate-limit';

import { friendlyRateLimitHandler } from '../utils/rateLimitHandler.js';
import { isZekoLinkToken } from '../utils/zekoLinkModel.js';

const WINDOW_MS = 15 * 60 * 1000;

/**
 * token+IP for a plausible token, IP alone for anything else.
 * @param {import('express').Request} req
 * @returns {string}
 */
export function zekoLinkRateKey(req) {
  const token = req.params?.token;
  return isZekoLinkToken(token) ? `zeko:${token}:${req.ip}` : `zeko:invalid:${req.ip}`;
}

/** GET /:token and GET /:token/info. */
export const zekoLinkLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: zekoLinkRateKey,
  handler: friendlyRateLimitHandler('Too many requests for this interview link.'),
});

/** POST /:token/phone. */
export const zekoPhoneLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: zekoLinkRateKey,
  handler: friendlyRateLimitHandler('Too many attempts to save a phone number.'),
});

export default zekoLinkLimiter;
