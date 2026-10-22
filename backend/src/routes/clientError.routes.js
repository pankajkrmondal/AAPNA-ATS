import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth.js';
import { reportClientError } from '../controllers/systemLogs.controller.js';

const router = Router();

/**
 * Browser error reports (N42). Signed-in users only, and at most 30 reports per
 * 5 minutes per user: a page stuck in an error loop must not flood the error
 * log. Keyed on the user, not the IP (the office shares one public address).
 * Over the limit the report is silently dropped (204) — never a second error.
 */
const reportLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`),
  handler: (_req, res) => res.status(204).end(),
});

router.post('/', authenticate, reportLimiter, reportClientError);

export default router;
