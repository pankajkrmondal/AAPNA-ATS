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
   * @param {Object} [opts] - { force } when true, bypasses the backend Redis cache (used by Refresh).
   * @returns {Promise<{ data: { role: Object, candidates: Array, summary: Object } }>}
   */
  searchRoleCandidates(mrfId, { force = false } = {}) {
    return api.post(`/screening/roles/${mrfId}/search${force ? '?force=1' : ''}`);
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
   * CSV of the JD-filtering results for one MRF. The server re-runs the search
   * (hitting the cache the on-screen search wrote) rather than accepting a
   * client-supplied candidate list.
   * @param {number} mrfId
   * @param {Object} [config] - blob/timeout config from downloadFile
   */
  exportRoleCandidates(mrfId, config = {}) {
    return api.post(`/screening/roles/${mrfId}/export`, {}, config);
  },

  /**
   * CSV of the keyword-tab results, from the same filter body as the search.
   * Re-runs embeddings + rerank, so it can be slow and can degrade — the
   * response carries X-Export-Degraded when the ranking was unavailable.
   * @param {Object} filters
   * @param {Object} [config]
   */
  exportKeywordCandidates(filters, config = {}) {
    return api.post('/screening/keyword-export', filters, config);
  },

  /** CSV of the Analytics "Role Summary" table. */
  exportRoleSummary(config = {}) {
    return api.get('/screening/analytics/pipeline/export', config);
  },

  /**
   * Shortlist selected candidates (insert records, send notification draft emails, update vectors).
   * Also creates a Candidate Pipeline journey per candidate (best-effort) — the
   * response's `pipeline_entries: [{ cv_id, pipeline_id }]` carries the ids
   * needed to deep-link into /pipeline?candidate=<pipeline_id>.
   * @param {Object} payload - { candidates: Array, mrf_id: number, role_name: string, send_email?: boolean, email_override?: { subject, body } }
   * @returns {Promise<{ data: { success: boolean, emails_sent: number, pipeline_entries: Array<{cv_id: number, pipeline_id: number}> } }>}
   */
  shortlistCandidates(payload) {
    return api.post('/screening/shortlist', payload);
  },

  /**
   * Reject selected candidates directly from screening results.
   * @param {Object} payload - { candidates: Array, mrf_id: number, role_name: string, reason: string, send_email?: boolean, email_override?: { subject, body } }
   * @returns {Promise<{ data: { success: boolean, emails_sent: number } }>}
   */
  rejectCandidates(payload) {
    return api.post('/screening/reject', payload);
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
   * Send a threaded reply to a conversation message from inside the ATS.
   * @param {number|string} messageId - rpa_email_messages row id being replied to
   * @param {string} bodyHtml - Reply body HTML
   * @returns {Promise<{ data: { data: Object } }>} the stored outbound message
   */
  replyToOutlookConversation(messageId, bodyHtml) {
    return api.post('/screening/outlook/reply', {
      message_id: messageId,
      body_html: bodyHtml
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

