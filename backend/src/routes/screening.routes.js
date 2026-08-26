import { Router } from 'express';
import * as screeningController from '../controllers/screening.controller.js';
import { authenticate, checkModuleAccess, requireStaff } from '../middleware/auth.js';
import { exportLimiter } from '../middleware/exportRateLimit.js';

const router = Router();

// Require authentication for all screening actions
router.use(authenticate);

// Internal staff only (M6). Screening searches the whole candidate database
// across every vendor, so the module toggle alone is not a sufficient guard.
router.use(requireStaff);

// Middleware to check if user has access to candidate screening module
router.use(checkModuleAccess('candidate_screening'));

/**
 * GET /api/screening/roles
 * Retrieve approved MRF roles for selection dropdown
 */
router.get('/roles', screeningController.getRoles);

/**
 * POST /api/screening/roles/:id/search
 * Match and rank candidates against selected MRF role
 */
router.post('/roles/:id/search', screeningController.searchRoleCandidates);

/**
 * POST /api/screening/roles/:id/export
 * CSV of the JD-filtering results. POST (not GET) because it re-runs the same
 * search; the server never accepts a client-supplied candidate list.
 */
router.post('/roles/:id/export', exportLimiter, screeningController.exportRoleCandidates);

/**
 * POST /api/screening/keyword-search
 * Keyword-based candidate search and scoring
 */
router.post('/keyword-search', screeningController.searchKeywordCandidates);

/**
 * POST /api/screening/keyword-export
 * CSV of the keyword-tab results, from the same filter body as the search.
 */
router.post('/keyword-export', exportLimiter, screeningController.exportKeywordCandidates);

/**
 * POST /api/screening/shortlist
 * Shortlist candidates, update status, create Outlook email, and refresh vectors
 */
router.post('/shortlist', screeningController.shortlistCandidates);

/**
 * POST /api/screening/reject
 * Reject candidates directly from screening results, update status, notify (optional)
 */
router.post('/reject', screeningController.rejectCandidates);

/**
 * GET /api/screening/analytics/jobs
 * List PUBLISHED Zeko jobs for the assignment dropdown — booking a candidate
 * onto a draft or archived job hands them a dead interview link.
 */
router.get('/analytics/jobs', screeningController.getZekoJobs);

/**
 * GET /api/screening/analytics/pipeline
 * Retrieve Zeko interview pipeline candidates
 */
router.get('/analytics/pipeline', screeningController.getZekoPipeline);

/**
 * GET /api/screening/analytics/pipeline/export
 * CSV of the Analytics "Role Summary" table.
 */
router.get('/analytics/pipeline/export', exportLimiter, screeningController.exportRoleSummary);

/**
 * POST /api/screening/analytics/assign
 * Assign a candidate to a Zeko job
 */
router.post('/analytics/assign', screeningController.assignZekoJob);

/**
 * POST /api/screening/analytics/schedule
 * Schedule Zeko interview and notify candidate
 */
router.post('/analytics/schedule', screeningController.scheduleZekoInterview);

/**
 * POST /api/screening/analytics/cancel
 * Cancel Zeko interview and notify candidate
 */
router.post('/analytics/cancel', screeningController.cancelZekoInterview);

/**
 * POST /api/screening/analytics/status
 * Update shortlisted candidate status
 */
router.post('/analytics/status', screeningController.updateCandidateStatus);

/**
 * GET /api/screening/outlook/conversations
 * Fetch candidate email conversation threads from the database
 */
router.get('/outlook/conversations', screeningController.getOutlookConversations);

/**
 * POST /api/screening/outlook/reply
 * Send a threaded reply (Graph createReply) to a conversation message
 */
router.post('/outlook/reply', screeningController.replyToOutlookMessage);

export default router;
