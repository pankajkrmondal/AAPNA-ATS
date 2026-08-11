import api from './api';

const emailTemplateService = {
  /**
   * Get all email templates.
   * @returns {Promise}
   */
  getEmailTemplates() {
    return api.get('/email/templates');
  },

  /**
   * Get email template details by ID.
   * @param {number|string} id
   * @returns {Promise}
   */
  getEmailTemplateById(id) {
    return api.get(`/email/templates/${id}`);
  },

  /**
   * Update email template.
   * @param {number|string} id
   * @param {object} payload - { subject, body_html }
   * @returns {Promise}
   */
  updateEmailTemplate(id, payload) {
    return api.put(`/email/templates/${id}`, payload);
  },

  /**
   * Get email delivery monitoring data (send/tracking stats, recent failures,
   * mailbox poller status).
   * @param {number} [days=30] - reporting window in days
   * @returns {Promise}
   */
  getEmailMonitoring(days = 30) {
    return api.get('/email/monitoring', { params: { days } });
  },

  /**
   * CSV of one Email Delivery table. `failures` returns every failure in the
   * window, where the screen shows only the 20 most recent.
   * @param {'by_type'|'failures'} table
   * @param {number} [days=30]
   * @param {object} [config] - blob/timeout config from downloadFile
   */
  exportEmailMonitoring(table, days = 30, config = {}) {
    return api.get('/email/monitoring/export', { params: { table, days }, ...config });
  },
};

export default emailTemplateService;
