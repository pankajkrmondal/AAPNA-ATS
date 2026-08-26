import fs from 'fs';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';
import { success, paginated } from '../utils/apiResponse.js';
import * as assessmentImportService from '../services/assessmentImport.service.js';
import * as assessmentInviteService from '../services/assessmentInvite.service.js';
import { assertSignature } from '../utils/fileSignature.js';

function actingUser(req) {
  return { id: req.user?.id, username: req.user?.username || req.user?.email || 'user' };
}

/**
 * @desc    Parse an uploaded Evalground CSV/Excel export — nothing is written yet
 * @route   POST /api/pipeline/assessment-import/preview
 * @access  Private (recruitment_pipeline module)
 */
export const preview = catchAsync(async (req, res) => {
  const file = req.file;
  if (!file) {
    throw new AppError('No file uploaded.', 400);
  }

  // CONTENT CHECK (defect D7). Placed before the try so it unlinks its own temp
  // copy — the finally below only runs once we are inside. Note this verifies
  // .xlsx only: .csv is plain text with no signature, so the route's extension
  // allowlist stays the sole control there.
  await assertSignature(req);

  try {
    const result = await assessmentImportService.previewImport({
      filePath: file.path,
      originalName: file.originalname,
      uploadedByUser: actingUser(req),
    });
    return success(res, result, 'File parsed.');
  } finally {
    // The file itself is durably kept on OneDrive (or the local /uploads fallback)
    // by previewImport — the multer temp copy is no longer needed once read.
    fs.unlink(file.path, () => {});
  }
});

/**
 * @desc    Confirm cluster mappings (+ any row overrides) and write the import
 * @route   POST /api/pipeline/assessment-import/commit
 * @access  Private (recruitment_pipeline module)
 */
export const commit = catchAsync(async (req, res) => {
  const { batchId, clusterMappings, rowOverrides } = req.body;
  if (!batchId) {
    throw new AppError('batchId is required.', 400);
  }
  const result = await assessmentImportService.commitImport({
    batchId,
    clusterMappings: clusterMappings || [],
    rowOverrides: rowOverrides || {},
    actedByUser: actingUser(req),
  });
  return success(res, result, 'Import committed.');
});

/**
 * @desc    Paginated import history
 * @route   GET /api/pipeline/assessment-import/history
 * @access  Private (recruitment_pipeline module)
 */
export const history = catchAsync(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const { rows, total } = await assessmentImportService.listImportHistory({ page, limit });
  return paginated(res, rows, page, limit, total);
});

/**
 * @desc    Latest Evalground result (+ suggested outcome) for one candidate's journey
 * @route   GET /api/pipeline/assessment-import/candidate/:pipelineId
 * @access  Private (recruitment_pipeline module)
 */
export const getCandidateResult = catchAsync(async (req, res) => {
  const result = await assessmentImportService.getAssessmentResultForPipeline(req.params.pipelineId);
  return success(res, result);
});

/**
 * @desc    Send (email) or record (manual) an Evalground invite attempt
 * @route   POST /api/pipeline/assessment-import/invite
 * @access  Private (recruitment_pipeline module)
 */
export const sendInvite = catchAsync(async (req, res) => {
  const { pipeline_id, method, subject, body } = req.body;
  if (!pipeline_id) {
    throw new AppError('pipeline_id is required.', 400);
  }
  if (!method) {
    throw new AppError('method is required ("email" or "manual").', 400);
  }
  const invite = await assessmentInviteService.sendAssessmentInvite(pipeline_id, {
    method,
    subject: subject || null,
    body: body || null,
    createdBy: req.user?.id || null,
  });
  return success(res, invite, method === 'email' ? 'Evalground invite sent.' : 'Invite marked as sent manually.');
});

/**
 * @desc    Latest Evalground invite (+ overdue state) for one candidate's journey
 * @route   GET /api/pipeline/assessment-import/invite/:pipelineId
 * @access  Private (recruitment_pipeline module)
 */
export const getInviteState = catchAsync(async (req, res) => {
  const state = await assessmentInviteService.getInviteState(req.params.pipelineId);
  return success(res, state);
});
