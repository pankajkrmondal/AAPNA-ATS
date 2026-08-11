/**
 * Pipeline Tracker API Service (Phase 3 Module 1)
 * Interacts with /api/pipeline endpoints — the real stage engine backing
 * the Pipeline Tracker, distinct from the mock CandidatePipelinePrototype.jsx.
 */
import api from './api';

const pipelineService = {
  /**
   * Board data: columns (stages) + cards (candidate-per-MRF journeys), filterable.
   * @param {Object} [filters] - { source, on_hold_only, mrf_id, stuck_days, position }
   * @returns {Promise<{ data: { stages: Array, columns: Array, positions: Array } }>}
   */
  listPipeline(filters = {}) {
    return api.get('/pipeline', { params: filters });
  },

  /**
   * Real pipeline analytics: tiles, stage funnel, stuck candidates, rejection
   * reasons, time-to-hire, vendor performance, source-of-hire. Feeds the
   * "Pipeline Insights" and "Recruiter Insights" tabs on the Analytics page.
   * @param {Object} [params] - { mrf_id, rejection_window_days, stuck_threshold_days, hold_threshold_days }
   */
  getAnalytics(params = {}) {
    return api.get('/pipeline/analytics', { params });
  },

  /**
   * CSV of every journey matching the board filters (no pagination).
   * @param {Object} [filters] - the same params listPipeline takes
   * @param {Object} [config] - blob/timeout config from downloadFile
   */
  exportBoard(filters = {}, config = {}) {
    return api.get('/pipeline/export', { params: filters, ...config });
  },

  /**
   * CSV of one analytics table — the COMPLETE ranked list, where the screen
   * shows only the top 10.
   * @param {string} table - funnel | stuck | rejection_reasons | time_to_hire
   *                       | vendor_performance | source_of_hire
   * @param {Object} [config]
   */
  exportAnalytics(table, config = {}) {
    return api.get('/pipeline/analytics/export', { params: { table }, ...config });
  },

  /** @returns {Promise<{ data: Array }>} admin-configurable stage list */
  listStages() {
    return api.get('/pipeline/stages');
  },

  /** @returns {Promise<{ data: Array }>} full reason taxonomy (global + stage-scoped) */
  /**
   * @param {boolean} [includeInactive] - admin config screen only; recruiters
   *   picking a reason must never be offered a deactivated one.
   */
  listReasons(includeInactive = false) {
    return api.get('/pipeline/reasons', includeInactive ? { params: { include_inactive: true } } : undefined);
  },

  /**
   * Full detail for one journey — feeds the per-round drawer.
   * @param {number} id
   * @returns {Promise<{ data: { pipeline: Object, currentStageOutcomes: Array, reasons: Array } }>}
   */
  getPipelineDetail(id) {
    return api.get(`/pipeline/${id}`);
  },

  /**
   * Compiles (without sending) the outcome email a given outcome would
   * produce — feeds the drawer's editable "Record round outcome" modal.
   * @param {number} id
   * @param {string} outcomeKey
   * @returns {Promise<{ data: { subject: string, body: string, templateId: number|null, templateName: string|null } }>}
   */
  getOutcomePreview(id, outcomeKey) {
    return api.get(`/pipeline/${id}/outcome-preview`, { params: { outcome_key: outcomeKey } });
  },

  /**
   * Records Approve/Reject/Hold (or any configured outcome) on the current
   * stage. Approve auto-advances to the next active stage in the same call.
   * @param {number} id
   * @param {Object} payload - { outcome_key, reason_id?, other_text?, notes?, email_subject?, email_body?, skip_optional_next? }
   */
  setStageOutcome(id, payload) {
    return api.post(`/pipeline/${id}/outcome`, payload);
  },

  /**
   * Moves the journey to the next active stage.
   * @param {number} id
   * @param {Object} [payload] - { skip? }
   */
  advanceStage(id, payload = {}) {
    return api.post(`/pipeline/${id}/advance`, payload);
  },

  /**
   * Books the interview for the candidate's current scheduled round (tech1/tech2).
   * @param {number} id - pipeline id
   * @param {Object} payload - { stage_key, start_at, duration_minutes?, interviewer_email?, interviewer_name?, notes? }
   */
  scheduleInterview(id, payload) {
    return api.post(`/pipeline/${id}/interview`, payload);
  },

  /**
   * Compiled (not sent) candidate + panel invite emails for the Schedule modal.
   * @param {number} id - pipeline id
   * @param {Object} params - { stage_key, start_at, duration_minutes }
   */
  getSchedulePreview(id, params) {
    return api.get(`/pipeline/${id}/interview-preview`, { params });
  },

  /**
   * Reschedules the current-round interview (cancels the old booking + rebooks).
   * @param {number} id - pipeline id
   * @param {Object} payload - { stage_key, start_at, duration_minutes?, interviewer_email?, candidate_subject?, candidate_body?, panel_subject?, panel_body? }
   */
  rescheduleInterview(id, payload) {
    return api.post(`/pipeline/${id}/interview/reschedule`, payload);
  },

  /**
   * Compiled (not sent) candidate + panel reschedule emails for the modal.
   * @param {number} id - pipeline id
   * @param {Object} params - { stage_key, start_at, duration_minutes }
   */
  getReschedulePreview(id, params) {
    return api.get(`/pipeline/${id}/interview/reschedule-preview`, { params });
  },

  /**
   * Cancels a booked interview so the round can be rebooked.
   * @param {number} scheduleId - rpa_interview_schedule id
   * @param {Object} [payload] - { cancel_reason?, candidate_subject?, candidate_body?, panel_subject?, panel_body? }
   */
  cancelInterview(scheduleId, payload = {}) {
    return api.post(`/pipeline/interview/${scheduleId}/cancel`, payload);
  },

  /**
   * Compiled (not sent) candidate + panel cancellation emails for the Cancel modal.
   * @param {number} scheduleId - rpa_interview_schedule id
   */
  getCancelPreview(scheduleId, reason = '') {
    return api.get(`/pipeline/interview/${scheduleId}/cancel-preview`, { params: { reason } });
  },

  /**
   * Records whether the interview happened. 'held' releases the scorecard link;
   * 'no_show' records it (with party/reason) and the caller offers reschedule/reject.
   * @param {number} scheduleId - rpa_interview_schedule id
   * @param {Object} payload - { outcome: 'held'|'no_show', party?, reason? }
   */
  recordInterviewOccurrence(scheduleId, payload) {
    return api.post(`/pipeline/interview/${scheduleId}/occurrence`, payload);
  },

  /**
   * Manually dispatches the interviewer scorecard link (only meaningful once the
   * interview is confirmed held). Idempotent — a repeat call is a no-op.
   * @param {number} scheduleId - rpa_interview_schedule id
   */
  sendScorecard(scheduleId) {
    return api.post(`/pipeline/interview/${scheduleId}/send-scorecard`, {});
  },

  /**
   * Per-round submitted scorecards + overall sum/average for a candidate.
   * @param {number} id - pipeline id
   */
  getScorecardReport(id) {
    return api.get(`/pipeline/${id}/scorecard-report`);
  },

  /**
   * Sets the final/closure outcome (Q12 — 8 closure statuses).
   * @param {number} id
   * @param {Object} payload - { final_outcome_key, notes? }
   */
  setFinalOutcome(id, payload) {
    return api.post(`/pipeline/${id}/closure`, payload);
  },

  /**
   * Ad-hoc per-candidate email override (RT ask, 2026-07-14).
   * @param {number} id
   * @param {Object} payload - { subject, body }
   */
  sendAdHocEmail(id, payload) {
    return api.post(`/pipeline/${id}/email`, payload);
  },

  // ── Documents round (Module 4) — recruiter-facing half ────────────────────

  /** The request + checklist state for a journey. */
  getDocumentStatus(id) {
    return api.get(`/pipeline/${id}/documents`);
  },
  /** Raises the request and emails the candidate the upload link. */
  requestDocuments(id) {
    return api.post(`/pipeline/${id}/documents/request`, {});
  },
  /** Re-sends the upload link for an outstanding request. */
  remindDocuments(id) {
    return api.post(`/pipeline/${id}/documents/remind`, {});
  },
  /** Marks one uploaded document as verified. */
  verifyDocument(docId) {
    return api.post(`/pipeline/documents/${docId}/verify`, {});
  },
  /** Rejects one document with a reason, re-requesting it from the candidate. */
  rejectDocument(docId, reason) {
    return api.post(`/pipeline/documents/${docId}/reject`, { reason });
  },

  // ── Offer round (Module 5) — record-only; the letter never enters the ATS ──

  /** Asks for internal sign-off and arms the daily nudge. */
  requestOfferApproval(id) {
    return api.post(`/pipeline/${id}/offer/request-approval`, {});
  },
  /** Records the internal sign-off. */
  approveOffer(id) {
    return api.post(`/pipeline/${id}/offer/approve`, {});
  },
  /**
   * Records that HR shared the offer from their own mailbox.
   * @param {Object} payload - { joining_date?, remarks? }
   */
  recordOfferShared(id, payload) {
    return api.post(`/pipeline/${id}/offer/share`, payload);
  },
  /**
   * Records the candidate's answer.
   * @param {Object} payload - { decision: 'accepted'|'rejected', remarks? }
   */
  recordOfferDecision(id, payload) {
    return api.post(`/pipeline/${id}/offer/decision`, payload);
  },

  // ── Admin config CRUD (admin-tier only, enforced server-side) ──────────

  createStage(payload) {
    return api.post('/pipeline/stages', payload);
  },
  updateStage(key, payload) {
    return api.put(`/pipeline/stages/${key}`, payload);
  },
  createStageOutcome(key, payload) {
    return api.post(`/pipeline/stages/${key}/outcomes`, payload);
  },
  updateStageOutcome(key, outcomeKey, payload) {
    return api.put(`/pipeline/stages/${key}/outcomes/${outcomeKey}`, payload);
  },
  createReason(payload) {
    return api.post('/pipeline/reasons', payload);
  },
  updateReason(id, payload) {
    return api.put(`/pipeline/reasons/${id}`, payload);
  },
};

export default pipelineService;
