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
import fs from 'fs';
import path from 'path';
import { getRequestByToken, uploadDocument } from '../services/documentCollection.service.js';
import { success } from '../utils/apiResponse.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';
import { matchesSignature } from '../utils/fileSignature.js';

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

  // CONTENT CHECK (defect D7, 2026-08-20). multer's fileFilter only saw the
  // filename, so renaming an executable to .pdf uploaded it successfully — 200,
  // row written, binary pushed into the OneDrive tenant. This route is public
  // and unauthenticated, so renaming was the whole attack.
  //
  // It runs HERE rather than in fileFilter because fileFilter fires before any
  // bytes are written: there is nothing on disk to sniff at that point.
  //
  // The temp file is removed on rejection. uploadDocument() unlinks on its own
  // paths, but it is never reached when this throws.
  if (req.file?.path) {
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    if (!(await matchesSignature(req.file.path, ext))) {
      await fs.promises.unlink(req.file.path).catch(() => {});
      throw new AppError(
        `That file is not a valid ${ext.replace('.', '').toUpperCase()}. `
        + 'Please upload the document in the format its name suggests.',
        400
      );
    }
  }

  const result = await uploadDocument(req.params.token, {
    checklistItemId: checklist_item_id,
    file: req.file,
  });
  return success(res, result, 'Document uploaded');
});
