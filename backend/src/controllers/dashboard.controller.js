import * as dashboardService from '../services/dashboard.service.js';
import { success } from '../utils/apiResponse.js';
import catchAsync from '../utils/catchAsync.js';

/**
 * @desc    Get dashboard summary statistics
 * @route   GET /api/dashboard/stats
 * @access  Private
 */
export const getStats = catchAsync(async (_req, res) => {
  const stats = await dashboardService.getStats();
  return success(res, stats, 'Dashboard statistics retrieved');
});

/**
 * @desc    Get recent file uploads
 * @route   GET /api/dashboard/recent-uploads
 * @access  Private
 */
export const getRecentUploads = catchAsync(async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 10;
  const uploads = await dashboardService.getRecentUploads(limit);
  return success(res, uploads, 'Recent uploads retrieved');
});
