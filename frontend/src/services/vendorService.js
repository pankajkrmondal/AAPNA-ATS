/**
 * Vendor API Service
 * Vendor specific candidate lists and resume batch upload operations.
 */
import api from './api';

const vendorService = {
  /**
   * Get candidates uploaded by the logged-in vendor.
   * @param {object} [params={}] — search, page, limit, sort, order
   * @returns {Promise}
   */
  getCandidates(params = {}) {
    return api.get('/vendor/candidates', { params });
  },

  /**
   * Get the vendor dashboard summary (candidate status + recent uploads).
   * Vendors omit the arg (scoped to themselves); staff pass a vendor's email.
   * @param {string} [vendorEmail]
   * @returns {Promise}
   */
  getDashboard(vendorEmail) {
    return api.get('/vendor/dashboard', {
      params: vendorEmail ? { vendorEmail } : {},
    });
  },

  /**
   * List registered vendors for the staff vendor-picker.
   * @returns {Promise}
   */
  getVendors() {
    return api.get('/vendor/vendors');
  },

  /**
   * Upload resumes to the parsing system.
   * @param {FormData} formData — Multi-part form data containing 'resumes' array
   * @param {function} onUploadProgress — Callback for upload progress bar
   * @returns {Promise}
   */
  uploadResumes(formData, onUploadProgress) {
    return api.post('/vendor/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress,
    });
  },

  /**
   * Get upload batch summaries for the vendor.
   * @returns {Promise}
   */
  getBatches() {
    return api.get('/vendor/batches');
  },

  /**
   * Get the summary/status of a batch upload.
   * @param {string} executionId - The batch execution ID
   * @returns {Promise}
   */
  getSummary(executionId) {
    return api.get(`/vendor/summary/${executionId}`);
  },

  /**
   * Persistent upload/job-tracking dashboard feed (one row per resume).
   * @param {object} [params] — page, limit, status, actionRequired, vendorEmail
   * @returns {Promise}
   */
  getJobs(params = {}) {
    return api.get('/vendor/jobs', { params });
  },

  /**
   * Reprocess a failed upload job.
   * @param {string|number} id
   * @returns {Promise}
   */
  reprocessJob(id) {
    return api.post(`/vendor/jobs/${id}/reprocess`);
  },

  /**
   * Recruiter review action — merge selected duplicates into the main DB.
   * @param {Array<number|string>} ids — rpa_cv_tmp ids
   * @returns {Promise}
   */
  reviewMerge(ids) {
    return api.post('/vendor/review/merge', { ids });
  },

  /**
   * Recruiter review action — cancel/reject selected duplicates.
   * @param {Array<number|string>} ids — rpa_cv_tmp ids
   * @returns {Promise}
   */
  reviewCancel(ids) {
    return api.post('/vendor/review/cancel', { ids });
  },
};

export default vendorService;
