import api from './api';
import axios from 'axios';

const mrfService = {
  /**
   * Submit a new MRF request.
   * @param {object} payload
   * @returns {Promise}
   */
  create(payload) {
    return api.post('/mrf', payload);
  },

  /**
   * List and search MRF requests.
   * @param {object} [params={}] — { search, status, page, limit }
   * @returns {Promise}
   */
  list(params = {}) {
    return api.get('/mrf', { params });
  },

  /**
   * Get MRF request details by ID.
   * @param {string|number} id
   * @returns {Promise}
   */
  getById(id) {
    return api.get(`/mrf/${id}`);
  },

  /**
   * Update MRF request fields.
   * @param {string|number} id
   * @param {object} payload
   * @returns {Promise}
   */
  update(id, payload) {
    return api.patch(`/mrf/${id}`, payload);
  },

  /**
   * Get the submitted main MRF record (rpa_mrf) by its MRF id.
   * @param {string|number} id — the rpa_mrf id (the linked mrf_id)
   * @returns {Promise}
   */
  getMain(id) {
    return api.get(`/mrf/main/${id}`);
  },

  /**
   * Edit the submitted main MRF record (rpa_mrf) by its MRF id.
   * @param {string|number} id — the rpa_mrf id (the linked mrf_id)
   * @param {object} payload — any editable main-MRF fields
   * @returns {Promise}
   */
  updateMain(id, payload) {
    return api.patch(`/mrf/main/${id}`, payload);
  },

  // ── Public Endpoints (Use direct axios to prevent redirect on 401) ───

  /**
   * Get pre-fill options for the hiring manager form.
   * Returns all prior submissions for this email (+ role when given), matching
   * the n8n form's prefill dropdown.
   * @param {string} email
   * @param {string} [role]
   */
  getPrefillOptions(email, role) {
    const params = role ? { email, role } : { email };
    return axios.get('/api/mrf/prefill-options', { params }).then((res) => res.data);
  },

  /**
   * Submit the completed MRF form.
   * @param {FormData} formData
   */
  submitHiringManagerMrf(formData) {
    return axios.post('/api/mrf/submit', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }).then((res) => res.data);
  },

  /**
   * Get public details of an MRF request (verifies token).
   * @param {string} id
   * @param {string} token
   */
  getPublicMrfDetails(id, token) {
    return axios.get(`/api/mrf/public-details/${id}`, { params: { token } }).then((res) => res.data);
  },

  /**
   * Submit the approval/rejection outcome.
   * @param {string} id
   * @param {object} payload — { token, action, comments }
   */
  handleMrfApproval(id, payload) {
    return axios.post(`/api/mrf/${id}/approve`, payload).then((res) => res.data);
  },
};

export default mrfService;

