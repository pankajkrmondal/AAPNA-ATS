/**
 * documentService.js — client for the PUBLIC (no-login) candidate
 * document-upload endpoints (/api/documents/:token). Reached from an emailed
 * link by a candidate who has no ATS session; the uuid token is the only
 * credential. Uses the shared axios instance — the public routes ignore any
 * bearer token that happens to be present.
 *
 * The recruiter-facing half (request / remind / verify / reject) lives on
 * pipelineService instead, behind auth.
 */
import api from './api';

const documentService = {
  /** Load the checklist and each item's state for a token. */
  getRequest(token) {
    return api.get(`/documents/${token}`);
  },

  /**
   * Upload one checklist item.
   * @param {string} token
   * @param {number} checklistItemId
   * @param {File} file
   */
  upload(token, checklistItemId, file) {
    const form = new FormData();
    form.append('checklist_item_id', checklistItemId);
    form.append('document', file);
    return api.post(`/documents/${token}/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

export default documentService;
