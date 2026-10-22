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
  getStats({ rangeDays, mrfId } = {}) {
    return api.get('/dashboard/stats', { params: { range: rangeDays, mrfId: mrfId || undefined } });
  },

  /**
   * Daily series + top roles / skills for the selected period, counted server-side (N36).
   * @param {{ rangeDays?: number, mrfId?: number|string }} [filters]
   */
  getTrends({ rangeDays, mrfId } = {}) {
    return api.get('/dashboard/trends', { params: { range: rangeDays, mrfId: mrfId || undefined } });
  },

  /** Zeko + Teams interviews in the next `days` days, each with its pipeline id (N36). */
  getUpcomingInterviews(days = 7) {
    return api.get('/dashboard/upcoming-interviews', { params: { days } });
  },

  /** Open MRFs for the dashboard's MRF filter (same list and labels as Screening, N19). */
  getMrfOptions() {
    return api.get('/dashboard/mrf-options');
  },

  /** L06: the open-positions strip (health, last 7 days, attention per open MRF). */
  getOpenPositionsPulse() {
    return api.get('/dashboard/open-positions');
  },

  /**
   * Get recent resume uploads / candidate activity.
   * @param {number} [limit=10] — number of recent items to fetch
   * @returns {Promise<{ data: Array }>}
   */
  getRecentUploads(limit = 10) {
    return api.get('/dashboard/recent-uploads', { params: { limit } });
  },

  /**
   * Get per-recruiter candidate breakdown (Added vs Tagged).
   * @param {number} [limit=10]
   * @returns {Promise<{ data: { added: Array<{recruiter:string,count:number}>, tagged: Array<{recruiter:string,count:number}> } }>}
   */
  getRecruiterBreakdown(limit = 10) {
    return api.get('/dashboard/recruiter-breakdown', { params: { limit } });
  },
};

export default dashboardService;
