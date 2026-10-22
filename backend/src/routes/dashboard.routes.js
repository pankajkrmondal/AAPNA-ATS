import { Router } from 'express';
import * as dashboardController from '../controllers/dashboard.controller.js';
import { authenticate, requireStaff } from '../middleware/auth.js';

const router = Router();

// All dashboard routes require authentication
router.use(authenticate);

/**
 * GET /api/dashboard/stats
 * Aggregate counts: candidates, MRFs, uploads, shortlisted — optional ?range=7|30|90&mrfId=
 */
router.get('/stats', dashboardController.getStats);

/**
 * GET /api/dashboard/trends?range=7|30|90&mrfId=
 * Daily added / entered-pipeline / MRFs-raised series and top roles & skills (N36)
 */
router.get('/trends', requireStaff, dashboardController.getTrends);

/**
 * GET /api/dashboard/upcoming-interviews?days=7
 * Zeko windows + Teams interviews, soonest first, each with its pipeline id (N36).
 * Staff only: it names candidates, and a vendor must only see their own.
 */
router.get('/upcoming-interviews', requireStaff, dashboardController.getUpcomingInterviews);

/**
 * GET /api/dashboard/mrf-options
 * Open MRFs for the dashboard MRF filter (N36)
 */
router.get('/mrf-options', requireStaff, dashboardController.getMrfOptions);

/**
 * GET /api/dashboard/recent-uploads
 * List of recent CV uploads — optional ?limit=N query param
 */
router.get('/recent-uploads', dashboardController.getRecentUploads);

/**
 * GET /api/dashboard/recruiter-breakdown
 * Per-recruiter Added vs Tagged candidate counts — optional ?limit=N (default 10)
 */
router.get('/recruiter-breakdown', dashboardController.getRecruiterBreakdown);

export default router;
