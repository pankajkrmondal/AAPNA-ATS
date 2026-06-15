/**
 * Candidate API Service
 * CRUD + search operations for the candidate resource.
 */
import api from './api';

const candidateService = {
  /**
   * Search candidates with filters, pagination, and sorting.
   * @param {object} [filters={}] — search criteria (name, skills, status, etc.)
   * @param {number} [page=1]
   * @param {number} [limit=20]
   * @returns {Promise<{ data: { candidates: Array, total: number, page: number, limit: number } }>}
   */
  search(filters = {}, page = 1, limit = 20) {
    return api.get('/candidates', {
      params: { ...filters, page, limit },
    });
  },

  /**
   * Get a single candidate by ID.
   * @param {string} id
   * @returns {Promise<{ data: object }>}
   */
  getById(id) {
    return api.get(`/candidates/${id}`);
  },

  /**
   * Update candidate data.
   * @param {string} id
   * @param {object} data — partial update payload
   * @returns {Promise<{ data: object }>}
   */
  update(id, data) {
    return api.patch(`/candidates/${id}`, data);
  },

  /**
   * Get email conversations for a candidate.
   * @param {string} id
   * @returns {Promise}
   */
  getEmails(id) {
    return api.get(`/candidates/${id}/emails`);
  },

  /**
   * Get approved MRF roles for the public missing-JD form (no auth required).
   * @returns {Promise}
   */
  getPublicRoles() {
    return api.get('/candidates/public/roles');
  },

  /**
   * Get candidate's missing data fields using base64 token.
   * @param {string} token
   * @returns {Promise}
   */
  getPublicMissingData(token) {
    return api.get('/candidates/public/missing-data', {
      params: { token },
    });
  },

  /**
   * Submit candidate's missing data using base64 token.
   * @param {string} token
   * @param {object} data
   * @returns {Promise}
   */
  submitPublicMissingData(token, data) {
    const config = {};
    if (data instanceof FormData) {
      config.headers = { 'Content-Type': 'multipart/form-data' };
    }
    return api.post(`/candidates/public/missing-data?token=${encodeURIComponent(token)}`, data, config);
  },
};

export default candidateService;
