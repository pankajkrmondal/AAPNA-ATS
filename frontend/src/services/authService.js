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
   * Change the current user's password.
   * @param {string} currentPassword
   * @param {string} newPassword
   * @returns {Promise}
   */
  changePassword(currentPassword, newPassword) {
    return api.post('/auth/change-password', { currentPassword, newPassword });
  },

  /**
   * Request a password reset link (forgot password).
   * @param {string} login - Username or email address
   * @returns {Promise}
   */
  forgotPassword(login) {
    return api.post('/auth/forgot-password', { login });
  },

  /**
   * Reset the password using an emailed reset token.
   * @param {string} token
   * @param {string} newPassword
   * @returns {Promise}
   */
  resetPassword(token, newPassword) {
    return api.post('/auth/reset-password', { token, newPassword });
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
