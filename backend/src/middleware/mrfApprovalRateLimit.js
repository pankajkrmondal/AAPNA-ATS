/**
 * Rate limiter for the PUBLIC MRF approval routes (view details, approve/reject).
 *
 * Keyed on IP alone. The token is attacker-chosen, so keying on it would let
 * anyone mint a fresh bucket per request (see shareRateLimit.js for the same
 * reasoning); an approver opens their link a handful of times, far inside the
 * allowance. This is a brake on hammering and on filling the audit table —
 * the access control is the personal token itself.
 */
import rateLimit from 'express-rate-limit';

import config from '../config/index.js';
import { friendlyRateLimitHandler } from '../utils/rateLimitHandler.js';

export const mrfApprovalLimiter = rateLimit({
  windowMs: config.mrfApprovalAudit.rateWindowMs,
  max: config.mrfApprovalAudit.rateMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `mrf-approval:${req.ip}`,
  // The handler appends "Please try again in about N minutes." itself.
  handler: friendlyRateLimitHandler('Too many requests for this approval link.'),
});

export default mrfApprovalLimiter;
