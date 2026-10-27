/**
 * Forms & Links API (L08): every link the ATS has sent. The list never carries
 * a URL; `copy` fetches one and the server records who copied it.
 */
import api from './api';

const formsLinksService = {
  /**
   * @param {object} params - { tab, types, states, tile, sentDays, mine, search, candidate, mrf, includeProfiles, page, pageSize }
   */
  list(params = {}) {
    return api.get('/forms-links', { params });
  },

  /** Counts for the Dashboard row. */
  summary() {
    return api.get('/forms-links/summary');
  },

  /** The Standing forms tab: blank MRF form, sign-in, forgot password, open MRFs' JD and test paper. */
  standing() {
    return api.get('/forms-links/standing');
  },

  /** { url, message }; the copy is recorded on the candidate's timeline (D4). */
  copy(type, id, { purpose = 'copy' } = {}) {
    return api.post(`/forms-links/${type}/${id}/copy`, { purpose });
  },

  resend(type, id) {
    return api.post(`/forms-links/${type}/${id}/resend`);
  },

  /** Scorecards only: 7 more days on the same link, sent again (D5). */
  renew(type, id) {
    return api.post(`/forms-links/${type}/${id}/renew`);
  },

  /** Recording share links only. */
  revoke(type, id) {
    return api.post(`/forms-links/${type}/${id}/revoke`);
  },
};

export default formsLinksService;
