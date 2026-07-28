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
};

export default settingsService;
