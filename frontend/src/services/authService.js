/**
 * Auth API Service
 * Handles authentication endpoints: login, logout, user info, token refresh.
 */
import api from './api';

const authService = {
  /**
   * Authenticate user with credentials.
   * @param {string} username
   * @param {string} password
   * @returns {Promise<{ data: { token: string, user: object } }>}
   */
  login(username, password) {
    return api.post('/auth/login', { username, password });
  },

  /**
   * Invalidate the current session on the server.
   * @returns {Promise}
   */
  logout() {
    return api.post('/auth/logout');
  },

  /**
   * Get the currently authenticated user profile.
   * @returns {Promise<{ data: { user: object } }>}
   */
  getCurrentUser() {
    return api.get('/auth/me');
  },

  /**
   * Request a new access token using the existing session/refresh token.
   * @returns {Promise<{ data: { token: string } }>}
   */
  refreshToken() {
    return api.post('/auth/refresh');
  },
};

export default authService;
