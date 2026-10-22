/**
 * Candidate Screening API Service
 * Interacts with /api/screening endpoints for matching, scoring, and Zeko integrations.
 */
import api from './api';

/** Shortlist requests: up to 10 minutes (a large "Select all" batch). */
const SHORTLIST_TIMEOUT_MS = 10 * 60 * 1000;

/** JD search / export body: only the filters that are set. "Active
 *  candidates first" (L01) is on by default server-side, so only `false` is sent. */
const roleSearchBody = (addedWithinDays, taggedOnly, activeFirst = true) => ({
  ...(addedWithinDays ? { addedWithinDays } : {}),
  ...(taggedOnly ? { taggedOnly: true } : {}),
  ...(activeFirst === false ? { activeFirst: false } : {}),
});

const screeningService = {
  /**
   * Get approved MRF roles list for selection dropdown.
   * @returns {Promise<{ data: Array }>}
   */
  /**
   * One entry per approved MRF (N19). `includeClosed` also lists filled /
   * closed MRFs, flagged `closed` (N20). Also used directly as a React Query
   * queryFn, whose context object carries no includeClosed — so only an explicit
   * `true` asks for closed ones.
   */
  getRoles(opts = {}) {
    return opts?.includeClosed === true
      ? api.get('/screening/roles', { params: { includeClosed: 1 } })
      : api.get('/screening/roles');
  },

  /**
   * Whether this MRF's JD can go as an email attachment (N17).
   * @param {number} mrfId
   * @returns {Promise<{ data: { data: { attachable: boolean, name: string|null, size_bytes: number|null, has_link: boolean, reason: string|null } } }>}
   */
  getRoleJd(mrfId) {
    return api.get(`/screening/roles/${mrfId}/jd`);
  },

  /**
   * Match and rank candidates against selected MRF role.
   * @param {number} mrfId
   * @param {Object} [opts] - { force } when true, bypasses the backend Redis cache (used by Refresh);
   *   { addedWithinDays } limits to candidates added in the last N days (N38);
   *   { taggedOnly } limits to candidates tagged to this JD (N15);
   *   { activeFirst } false = order by match score only (L01).
   * @returns {Promise<{ data: { role: Object, candidates: Array, summary: Object } }>}
   */
  searchRoleCandidates(mrfId, { force = false, addedWithinDays = null, taggedOnly = false, activeFirst = true } = {}) {
    return api.post(`/screening/roles/${mrfId}/search${force ? '?force=1' : ''}`, roleSearchBody(addedWithinDays, taggedOnly, activeFirst));
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
   * @param {number|null} [addedWithinDays] - the screen's "Added within" filter (N38), so the file matches
   * @param {boolean} [taggedOnly] - the screen's "Tagged to this JD only" switch (N15)
   * @param {boolean} [activeFirst] - the screen's "Active candidates first" switch (L01)
   */
  exportRoleCandidates(mrfId, config = {}, addedWithinDays = null, taggedOnly = false, activeFirst = true) {
    return api.post(`/screening/roles/${mrfId}/export`, roleSearchBody(addedWithinDays, taggedOnly, activeFirst), config);
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
  exportRoleSummary(config = {}, range = {}) {
    return api.get('/screening/analytics/pipeline/export', { params: range, ...config });
  },

  /** Analytics "Role Summary" (L06): one row per MRF, with Total applied. */
  getRoleSummary(range = {}) {
    return api.get('/screening/analytics/role-summary', { params: range });
  },

  /**
   * Change JD (G3): may this shortlist's JD be changed, why not, and which JDs to leave out.
   * @param {number} shortlistId
   */
  getChangeJdStatus(shortlistId) {
    return api.get(`/screening/shortlist/${shortlistId}/change-jd`);
  },

  /**
   * Change JD (G3): replace a shortlist's JD in place.
   * @param {number} shortlistId
   * @param {{ newMrfId: number, reason: string, notifyCandidate?: boolean }} body
   */
  changeShortlistJd(shortlistId, body) {
    return api.post(`/screening/shortlist/${shortlistId}/change-jd`, body);
  },

  /**
   * Shortlist selected candidates (insert records, send notification draft emails, update vectors).
   * Also creates a Candidate Pipeline journey per candidate (best-effort) — the
   * response's `pipeline_entries: [{ cv_id, pipeline_id }]` carries the ids
   * needed to deep-link into /pipeline?candidate=<pipeline_id>.
   * @param {Object} payload - { candidates: Array, mrf_id: number, role_name: string, send_email?: boolean, email_override?: { subject, body } }
   * @returns {Promise<{ data: { success: boolean, emails_sent: number, pipeline_entries: Array<{cv_id: number, pipeline_id: number}>, failed_candidates: Array } }>}
   */
  shortlistCandidates(payload) {
    // "Select all N matches" can send hundreds; each one is a journey plus an
    // email, processed one by one, so allow far more than the 2-minute default.
    return api.post('/screening/shortlist', payload, { timeout: SHORTLIST_TIMEOUT_MS });
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
  getZekoPipeline(range = {}) {
    return api.get('/screening/analytics/pipeline', { params: range });
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

