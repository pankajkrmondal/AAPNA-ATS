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
};

export default settingsService;
