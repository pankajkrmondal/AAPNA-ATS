/**
 * zekoLinkService.js — client for the PUBLIC (no-login) Zeko link endpoints
 * behind the /zeko-start/:token page (U08). The uuid token from the candidate's
 * email is the only credential.
 */
import api from './api';

const zekoLinkService = {
  /** { state, firstName, role, zekoUrl } — zekoUrl only while the window is open. */
  getInfo(token) {
    return api.get(`/z/${token}/info`);
  },

  /** Saves the number; resolves to { zekoUrl, saved }. */
  savePhone(token, phone) {
    return api.post(`/z/${token}/phone`, { phone });
  },
};

export default zekoLinkService;
