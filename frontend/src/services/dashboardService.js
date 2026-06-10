/**
 * Dashboard API Service
 * Fetches aggregated dashboard statistics and recent activity.
 */
import api from './api';

const dashboardService = {
  /**
   * Get dashboard summary statistics.
   * @returns {Promise<{ data: { totalCandidates: number, activeMRFs: number, todayUploads: number, shortlisted: number } }>}
   */
  getStats() {
    return api.get('/dashboard/stats');
  },

  /**
   * Get recent resume uploads / candidate activity.
   * @param {number} [limit=10] — number of recent items to fetch
   * @returns {Promise<{ data: Array }>}
   */
  getRecentUploads(limit = 10) {
    return api.get('/dashboard/recent-uploads', { params: { limit } });
  },
};

export default dashboardService;
