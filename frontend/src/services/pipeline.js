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

  /** @returns {Promise<{ data: Array }>} admin-configurable stage list */
  listStages() {
    return api.get('/pipeline/stages');
  },

  /** @returns {Promise<{ data: Array }>} full reason taxonomy (global + stage-scoped) */
  listReasons() {
    return api.get('/pipeline/reasons');
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
   * @param {Object} payload - { outcome_key, reason_id?, other_text?, notes?, email_subject?, email_body? }
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
