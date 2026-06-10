/**
 * Candidate Screening API Service
 * Interacts with /api/screening endpoints for matching, scoring, and Zeko integrations.
 */
import api from './api';

const screeningService = {
  /**
   * Get approved MRF roles list for selection dropdown.
   * @returns {Promise<{ data: Array }>}
   */
  getRoles() {
    return api.get('/screening/roles');
  },

  /**
   * Match and rank candidates against selected MRF role.
   * @param {number} mrfId
   * @returns {Promise<{ data: { role: Object, candidates: Array, summary: Object } }>}
   */
  searchRoleCandidates(mrfId) {
    return api.post(`/screening/roles/${mrfId}/search`);
  },

  /**
   * Advanced keyword-based candidate filtering and scoring.
   * @param {Object} filters
   * @returns {Promise<{ data: { candidates: Array, summary: Object } }>}
   */
  searchKeywordCandidates(filters) {
    return api.post('/screening/keyword-search', filters);
  },

  /**
   * Shortlist selected candidates (insert records, send notification draft emails, update vectors).
   * @param {Object} payload - { candidates: Array, mrf_id: number, role_name: string }
   * @returns {Promise<{ data: { success: boolean, emails_sent: number } }>}
   */
  shortlistCandidates(payload) {
    return api.post('/screening/shortlist', payload);
  },

  /**
   * Get Zeko active jobs list.
   * @returns {Promise<{ data: Array }>}
   */
  getZekoJobs() {
    return api.get('/screening/analytics/jobs');
  },

  /**
   * Get Zeko pipeline candidates and analytics tiles counts.
   * @returns {Promise<{ data: { pipeline: Array, tiles: Object } }>}
   */
  getZekoPipeline() {
    return api.get('/screening/analytics/pipeline');
  },

  /**
   * Assign a candidate to a Zeko job.
   * @param {Object} payload - { candidate_id: number, zeko_job_id: string }
   * @returns {Promise<{ data: Object }>}
   */
  assignZekoJob(payload) {
    return api.post('/screening/analytics/assign', payload);
  },

  /**
   * Schedule Zeko interview for a candidate and notify via email.
   * @param {Object} payload - { shortlist_id: number, zeko_job_id: string, interview_start_at: string, interview_end_at: string }
   * @returns {Promise<{ data: { success: boolean } }>}
   */
  scheduleZekoInterview(payload) {
    return api.post('/screening/analytics/schedule', payload);
  },

  /**
   * Cancel scheduled interview and notify candidate via email.
   * @param {Object} payload - { pipeline_id: number, cancel_reason: string }
   * @returns {Promise<{ data: { success: boolean } }>}
   */
  cancelZekoInterview(payload) {
    return api.post('/screening/analytics/cancel', payload);
  },

  /**
   * Fetch candidate email conversations from the database.
   * @param {string} email
   * @param {string} [token]
   * @returns {Promise<{ data: { success: boolean, threads: Array } }>}
   */
  getOutlookConversations(email, token) {
    return api.get('/screening/outlook/conversations', {
      params: { email, token }
    });
  },

  /**
   * Update shortlisted candidate status.
   * @param {Object} payload - { candidate_id: number, status: string }
   * @returns {Promise<{ data: Object }>}
   */
  updateCandidateStatus(payload) {
    return api.post('/screening/analytics/status', payload);
  },
};

export default screeningService;

