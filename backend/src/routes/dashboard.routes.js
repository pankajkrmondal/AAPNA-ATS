import { Router } from 'express';
import * as dashboardController from '../controllers/dashboard.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// All dashboard routes require authentication
router.use(authenticate);

/**
 * GET /api/dashboard/stats
 * Aggregate counts: candidates, MRFs, uploads, shortlisted
 */
router.get('/stats', dashboardController.getStats);

/**
 * GET /api/dashboard/recent-uploads
 * List of recent CV uploads — optional ?limit=N query param
 */
router.get('/recent-uploads', dashboardController.getRecentUploads);

export default router;
