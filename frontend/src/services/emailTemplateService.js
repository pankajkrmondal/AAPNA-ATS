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
};

export default emailTemplateService;
