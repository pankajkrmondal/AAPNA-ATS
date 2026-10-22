/**
 * scorecardService.js — client for the PUBLIC (no-login) interviewer scorecard
 * endpoints (/api/scorecard/:token). Reached from an emailed link by
 * interviewers/HR/CEO who have no ATS session; the uuid token is the only
 * credential. Uses the shared axios instance — the public routes ignore any
 * bearer token that happens to be present.
 */
import api from './api';

const scorecardService = {
  /** Load the form view model (context + gate state) for a token. */
  getScorecard(token) {
    return api.get(`/scorecard/${token}`);
  },

  /**
   * Interviewer answers the "did it happen?" gate.
   * @param {string} token
   * @param {Object} payload - { outcome: 'held'|'no_show', party?, reason? }
   */
  confirmOccurrence(token, payload) {
    return api.post(`/scorecard/${token}/occurrence`, payload);
  },

  /**
   * Submit the scorecard (single-use).
   * @param {string} token
   * @param {Object} payload - { skills:[{label,rating,remark}], communication,
   *   attitude, final_rating, recommendation, comments, recording_url, hr_* }
   */
  submit(token, payload) {
    return api.post(`/scorecard/${token}/submit`, payload);
  },
};

export default scorecardService;
