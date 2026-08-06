/**
 * document.controller.js — PUBLIC (no-login) candidate document-upload endpoints.
 *
 * Reached from an emailed tokenized link by a candidate who has no ATS session,
 * so the router mounting these applies NO authenticate middleware (see
 * routes/document.routes.js). The uuid token is the only credential and is
 * validated here before any lookup.
 *
 * The recruiter-facing half (request / remind / verify / reject) lives on the
 * authenticated pipeline routes instead.
 */
import { getRequestByToken, uploadDocument } from '../services/documentCollection.service.js';
import { success } from '../utils/apiResponse.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const assertToken = (token) => {
  if (!token || !UUID_RE.test(token)) throw new AppError('This document upload link is invalid.', 404);
};

/**
 * GET /api/documents/:token — public. The checklist and each item's state.
 */
export const getDocumentRequest = catchAsync(async (req, res) => {
  assertToken(req.params.token);
  const result = await getRequestByToken(req.params.token);
  return success(res, result, 'Document request retrieved');
});

/**
 * POST /api/documents/:token/upload — public. One checklist item per call
 * (multipart: `document` file + `checklist_item_id`).
 */
export const uploadCandidateDocument = catchAsync(async (req, res) => {
  assertToken(req.params.token);
  const { checklist_item_id } = req.body || {};
  if (!checklist_item_id) throw new AppError('checklist_item_id is required.', 400);

  const result = await uploadDocument(req.params.token, {
    checklistItemId: checklist_item_id,
    file: req.file,
  });
  return success(res, result, 'Document uploaded');
});
