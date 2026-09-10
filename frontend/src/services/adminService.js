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
   * CSV of the users in scope — same tenant scoping as listUsers.
   * @param {{ companyId?: number }} [opts]
   * @param {object} [config] - blob/timeout config from downloadFile
   */
  exportUsers(opts = {}, config = {}) {
    return api.get('/admin/users/export', {
      params: opts.companyId ? { company_id: opts.companyId } : {},
      ...config,
    });
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

  // ── Referral Log — admin-tier only ─────────────────────────────────────
  // The audit trail behind the referral flag. Admin-tier because any recruiter
  // may SET a referral, but only admin-tier may remove one or read the record of
  // who did — and this endpoint is the record.

  /**
   * Paginated referral audit trail.
   * @param {object} [params] - { action?, candidate?, referrer?, from?, to?, page?, limit? }
   * @returns {Promise<{ data: { data: Array, removals: number, pagination: object } }>}
   */
  getReferralLog(params = {}) {
    return api.get('/admin/referral-log', { params });
  },

  /**
   * CSV of the referral log, using the same filters as the screen.
   * @param {object} [filters]
   * @param {object} [config] - blob/timeout config from downloadFile
   */
  exportReferralLog(filters = {}, config = {}) {
    return api.get('/admin/referral-log/export', { params: filters, ...config });
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
   * CSV of all companies (superadmin only).
   * @param {object} [config] - blob/timeout config from downloadFile
   */
  exportCompanies(config = {}) {
    return api.get('/admin/companies/export', config);
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
