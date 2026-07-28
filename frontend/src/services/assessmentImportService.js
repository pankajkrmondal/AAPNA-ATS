/**
 * assessmentImportService.js — API service for Phase 3 M2, the Evalground
 * bulk-CSV importer that lives inside the Assessment round panel.
 */
import api from './api';

const assessmentImportService = {
  /**
   * Uploads a CSV/XLSX file for parsing — nothing is written to the database yet.
   * @param {FormData} formData - FormData with the file appended as 'file'
   * @returns {Promise} — { batchId, totalRows, matched, unmatched, duplicateSkipped, scoreWillOverwrite, malformed, clusters, rows }
   */
  preview(formData, onUploadProgress) {
    return api.post('/pipeline/assessment-import/preview', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
      onUploadProgress,
    });
  },

  /**
   * Confirms (possibly HR-edited) cluster mappings and any multi-journey row
   * overrides, and writes the import.
   * @param {Object} payload - { batchId, clusterMappings, rowOverrides }
   */
  commit(payload) {
    return api.post('/pipeline/assessment-import/commit', payload);
  },

  /**
   * Paginated import history.
   * @param {Object} [params] - { page, limit }
   */
  getHistory(params = {}) {
    return api.get('/pipeline/assessment-import/history', { params });
  },

  /**
   * Latest Evalground result (+ suggested outcome) for one candidate's journey.
   * @param {number|string} pipelineId
   */
  getCandidateResult(pipelineId) {
    return api.get(`/pipeline/assessment-import/candidate/${pipelineId}`);
  },

  /**
   * Sends (method:'email') or records (method:'manual') an Evalground invite
   * attempt for one candidate's journey — starts the deadline clock.
   * @param {Object} payload - { pipeline_id, method, subject?, body? }
   */
  sendInvite(payload) {
    return api.post('/pipeline/assessment-import/invite', payload);
  },

  /**
   * Latest Evalground invite (+ overdue state) for one candidate's journey.
   * @param {number|string} pipelineId
   */
  getInviteState(pipelineId) {
    return api.get(`/pipeline/assessment-import/invite/${pipelineId}`);
  },
};

export default assessmentImportService;
