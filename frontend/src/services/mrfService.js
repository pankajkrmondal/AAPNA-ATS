import api from './api';

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
};

export default mrfService;
