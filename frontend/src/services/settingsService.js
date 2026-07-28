import api from './api';

const settingsService = {
  /**
   * Get email reminder settings.
   * @returns {Promise}
   */
  getReminderSettings() {
    return api.get('/settings/reminder');
  },

  /**
   * Save email reminder settings.
   * @param {object} payload — { reminder_interval_days, reminder_max_count }
   * @returns {Promise}
   */
  saveReminderSettings(payload) {
    return api.post('/settings/reminder', payload);
  },

  /**
   * Get the interview reminder scheduler config (on/off, poll interval, lead time).
   * @returns {Promise}
   */
  getInterviewReminderConfig() {
    return api.get('/settings/interview-reminder');
  },

  /**
   * Update the interview reminder scheduler. Applies immediately — no restart.
   * @param {object} payload — { enabled, interval_minutes?, lead_minutes? }
   * @returns {Promise}
   */
  saveInterviewReminderConfig(payload) {
    return api.post('/settings/interview-reminder', payload);
  },

  /**
   * Get Evalground Assessment automation settings (invite deadline days +
   * the global auto-advance/auto-reject toggle).
   * @returns {Promise}
   */
  getAssessmentAutomation() {
    return api.get('/settings/assessment-automation');
  },

  /**
   * Save Evalground Assessment automation settings. Admin-tier only server-side.
   * @param {object} payload — { assessment_deadline_days, assessment_auto_advance_enabled }
   * @returns {Promise}
   */
  saveAssessmentAutomation(payload) {
    return api.post('/settings/assessment-automation', payload);
  },
};

export default settingsService;
