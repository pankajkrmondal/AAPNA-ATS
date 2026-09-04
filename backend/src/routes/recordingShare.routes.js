/**
 * PUBLIC routes — intentionally NO authenticate middleware.
 *
 * A recording share link is opened by an interviewer outside the company who has
 * no ATS account, from a file the recruiter emailed them (plan §6.5, HR decision
 * #7). The uuid token is the only credential; expiry and revocation are checked
 * server-side on every request in recordingShare.service.js.
 *
 * Mounted alongside the other public token routes in routes/index.js — the
 * scorecard link and the candidate document-upload link — so that the set of
 * unauthenticated surfaces in this system is visible in one place rather than
 * scattered.
 */
import { Router } from 'express';
import { shareLimiter, shareStreamLimiter } from '../middleware/shareRateLimit.js';
import {
  getSharedRecordingPage,
  streamSharedRecording,
} from '../controllers/recordingShare.controller.js';

const router = Router();

// The page a human opens, and where a view is counted.
router.get('/:token', shareLimiter, getSharedRecordingPage);

// The bytes it plays. Its OWN limiter — same key, separate store and a larger
// ceiling — so seeking through a long interview cannot exhaust the allowance for
// opening the page again. Sharing one limiter instance between the two routes
// shared one bucket, which is precisely what this comment used to claim it did
// not do.
router.get('/:token/stream', shareStreamLimiter, streamSharedRecording);

export default router;
