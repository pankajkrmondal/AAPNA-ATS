import { Router } from 'express';
import * as screeningController from '../controllers/screening.controller.js';
import { authenticate, checkModuleAccess } from '../middleware/auth.js';

const router = Router();

// Require authentication for all screening actions
router.use(authenticate);

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
 * POST /api/screening/keyword-search
 * Keyword-based candidate search and scoring
 */
router.post('/keyword-search', screeningController.searchKeywordCandidates);

/**
 * POST /api/screening/shortlist
 * Shortlist candidates, update status, create Outlook email, and refresh vectors
 */
router.post('/shortlist', screeningController.shortlistCandidates);

/**
 * GET /api/screening/analytics/jobs
 * List active Zeko jobs for assignment dropdown
 */
router.get('/analytics/jobs', screeningController.getZekoJobs);

/**
 * GET /api/screening/analytics/pipeline
 * Retrieve Zeko interview pipeline candidates
 */
router.get('/analytics/pipeline', screeningController.getZekoPipeline);

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

export default router;
