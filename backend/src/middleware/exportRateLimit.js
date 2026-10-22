/**
 * Per-user rate limiter for CSV export endpoints.
 *
 * Exports are far more expensive than an ordinary list call — they run
 * unpaginated queries and, on the screening routes, re-run embeddings and a
 * rerank. The global limiter (app.js) allows 2000 requests / 15 min, which
 * would happily permit a user to fire dozens of full-table scans a minute.
 *
 * Keyed on the authenticated user id, NOT the IP: the office sits behind one
 * public address, so an IP-keyed limiter would let one person's exports lock
 * out the whole recruitment team.
 *
 * Must be mounted AFTER `authenticate` so `req.user` is populated.
 */
import rateLimit from 'express-rate-limit';

import config from '../config/index.js';
import { friendlyRateLimitHandler } from '../utils/rateLimitHandler.js';

export const exportLimiter = rateLimit({
  windowMs: config.exports.rateWindowMs,
  max: config.exports.rateMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`),
  handler: friendlyRateLimitHandler('Too many exports in a short time.'),
});

export default exportLimiter;
