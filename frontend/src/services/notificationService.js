/**
 * Notification Centre API Service (Phase 3)
 * Interacts with /api/notifications — the signed-in user's own inbox, which
 * replaced the header bell's in-memory list.
 */
import api from './api';

const notificationService = {
  /**
   * The bell's list plus the unread count, newest first.
   * @param {Object} [params] - { limit, unread_only }
   * @returns {Promise<{ data: { items: Array, unread: number } }>}
   */
  list(params = {}) {
    return api.get('/notifications', { params });
  },

  /** Badge only — cheaper than fetching the whole list. */
  getUnreadCount() {
    return api.get('/notifications/unread-count');
  },

  /** Marks one notification read. */
  markRead(id) {
    return api.post(`/notifications/${id}/read`);
  },

  /** Marks every unread notification read. */
  markAllRead() {
    return api.post('/notifications/read-all');
  },
};

export default notificationService;
