import * as dashboardService from '../services/dashboard.service.js';
import { success } from '../utils/apiResponse.js';
import catchAsync from '../utils/catchAsync.js';
import { parseDashboardParams } from '../utils/dashboardMetrics.js';
import { getApprovedRoles } from '../services/screening.service.js';
import { getOpenPositionsPulse as getOpenPositionsPulseData } from '../services/openPositions.service.js';

/**
 * @desc    Get dashboard summary statistics
 * @route   GET /api/dashboard/stats
 * @access  Private
 */
export const getStats = catchAsync(async (req, res) => {
  const stats = await dashboardService.getStats(parseDashboardParams(req.query));
  return success(res, stats, 'Dashboard statistics retrieved');
});

/**
 * @desc    Daily series + top roles / skills for the selected period (N36)
 * @route   GET /api/dashboard/trends?range=7|30|90&mrfId=
 * @access  Private
 */
export const getTrends = catchAsync(async (req, res) => {
  const trends = await dashboardService.getTrends(parseDashboardParams(req.query));
  return success(res, trends, 'Dashboard trends retrieved');
});

/**
 * @desc    Zeko and Teams interviews in the next N days (N36)
 * @route   GET /api/dashboard/upcoming-interviews?days=7
 * @access  Private
 */
export const getUpcomingInterviews = catchAsync(async (req, res) => {
  const days = parseInt(req.query.days, 10) || 7;
  const rows = await dashboardService.getUpcomingInterviews({ days });
  return success(res, rows, 'Upcoming interviews retrieved');
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

/**
 * @desc    Get per-recruiter candidate breakdown (Added vs Tagged)
 * @route   GET /api/dashboard/recruiter-breakdown
 * @access  Private
 */
export const getRecruiterBreakdown = catchAsync(async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 10;
  const breakdown = await dashboardService.getRecruiterBreakdown(limit);
  return success(res, breakdown, 'Recruiter breakdown retrieved');
});

/**
 * @desc    Open MRFs for the dashboard's MRF filter — the Screening list (N19
 *          labels: reference, date, "Latest"), without the Screening module
 *          check, since every signed-in user sees the dashboard (N36)
 * @route   GET /api/dashboard/mrf-options
 * @access  Private
 */
export const getMrfOptions = catchAsync(async (_req, res) => {
  const roles = await getApprovedRoles({ includeClosed: false });
  return success(res, roles, 'Dashboard MRF options retrieved');
});

/**
 * @desc    "Open positions" strip on the Dashboard (L06): each open MRF's health,
 *          applicants in the last 7 days and attention count. Always 7 days,
 *          whatever range the Dashboard shows.
 * @route   GET /api/dashboard/open-positions
 * @access  Staff (names roles and their counts)
 */
export const getOpenPositionsPulse = catchAsync(async (_req, res) => {
  const result = await getOpenPositionsPulseData();
  return success(res, result, 'Open positions pulse retrieved');
});
