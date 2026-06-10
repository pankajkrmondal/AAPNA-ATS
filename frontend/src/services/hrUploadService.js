/**
 * hrUploadService.js — API service for the HR Manual Upload feature.
 * Handles file uploads, batch summary polling, and duplicate management.
 */
import api from './api';

const hrUploadService = {
  /**
   * Upload resume files to the backend.
   * @param {FormData} formData - FormData with files appended as 'resumes'
   * @returns {Promise} — { executionId, totalFiles, batchSummary }
   */
  uploadResumes(formData) {
    return api.post('/hr-upload/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000, // 2 min timeout for large uploads
    });
  },

  /**
   * Get the summary/status of a batch upload.
   * @param {string} executionId - The batch execution ID
   * @returns {Promise} — batch metrics and file breakdown
   */
  getSummary(executionId) {
    return api.get(`/hr-upload/summary/${executionId}`);
  },

  /**
   * Search the duplicates review queue.
   * @param {Object} params - { filterName, filterEmail, page, perPage }
   * @returns {Promise} — paginated duplicate candidates
   */
  searchDuplicates(params = {}) {
    return api.post('/hr-upload/duplicates/search', params);
  },

  /**
   * Merge selected duplicates into the main candidate database.
   * @param {number[]} ids - Array of rpa_cv_tmp IDs to merge
   * @returns {Promise}
   */
  mergeDuplicates(ids) {
    return api.post('/hr-upload/duplicates/merge', { ids });
  },

  /**
   * Delete selected duplicates from the review queue.
   * @param {number[]} ids - Array of rpa_cv_tmp IDs to delete
   * @returns {Promise}
   */
  deleteDuplicates(ids) {
    return api.post('/hr-upload/duplicates/delete', { ids });
  },
};

export default hrUploadService;
