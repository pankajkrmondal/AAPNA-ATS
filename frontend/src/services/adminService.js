import api from './api';

const adminService = {
  /**
   * Verify token for HR Admin access.
   * @param {string} token
   * @returns {Promise}
   */
  verifyToken(token) {
    return api.get(`/admin/auth/verify?token=${token}`);
  },

  /**
   * List users in scope. Superadmin may optionally filter by company.
   * @param {{ companyId?: number }} [opts]
   * @returns {Promise}
   */
  listUsers(opts = {}) {
    const qs = opts.companyId ? `?company_id=${opts.companyId}` : '';
    return api.get(`/admin/users/list${qs}`);
  },

  /**
   * Check if email exists in database.
   * @param {string} email
   * @returns {Promise}
   */
  checkEmail(email) {
    return api.get(`/admin/users/check-email?email=${encodeURIComponent(email)}`);
  },

  /**
   * Create a new user.
   * @param {object} payload
   * @returns {Promise}
   */
  createUser(payload) {
    return api.post('/admin/users/create', payload);
  },

  /**
   * Update an existing user.
   * @param {object} payload
   * @returns {Promise}
   */
  updateUser(payload) {
    return api.post('/admin/users/update', payload);
  },

  /**
   * Delete a user.
   * @param {number} id
   * @returns {Promise}
   */
  deleteUser(id) {
    return api.post('/admin/users/delete', { id });
  },

  /**
   * Toggle user active/inactive status.
   * @param {number} id
   * @param {boolean} is_active
   * @returns {Promise}
   */
  toggleStatus(id, is_active) {
    return api.post('/admin/users/toggle-status', { id, is_active });
  },

  /**
   * Get module permissions access config for a user.
   * @param {number} userId
   * @returns {Promise}
   */
  getModulesAccess(userId) {
    return api.get(`/admin/modules/get-access?user_id=${userId}`);
  },

  /**
   * Set specific module permission for a user.
   * @param {number} userId
   * @param {string} moduleKey
   * @param {boolean} isEnabled
   * @returns {Promise}
   */
  setModulesAccess(userId, moduleKey, isEnabled) {
    return api.post('/admin/modules/set-access', {
      user_id: userId,
      module_key: moduleKey,
      is_enabled: isEnabled,
    });
  },

  // ── Company (tenant) management — superadmin only ──────────────────────

  /**
   * List all companies (with user counts).
   * @returns {Promise}
   */
  listCompanies() {
    return api.get('/admin/companies/list');
  },

  /**
   * Create a new company.
   * @param {{ name: string, slug?: string, domain?: string }} payload
   * @returns {Promise}
   */
  createCompany(payload) {
    return api.post('/admin/companies/create', payload);
  },

  /**
   * Update a company.
   * @param {{ id: number, name?: string, slug?: string, domain?: string }} payload
   * @returns {Promise}
   */
  updateCompany(payload) {
    return api.post('/admin/companies/update', payload);
  },

  /**
   * Activate / deactivate a company.
   * @param {number} id
   * @param {boolean} is_active
   * @returns {Promise}
   */
  toggleCompanyStatus(id, is_active) {
    return api.post('/admin/companies/toggle-status', { id, is_active });
  },
};

export default adminService;
