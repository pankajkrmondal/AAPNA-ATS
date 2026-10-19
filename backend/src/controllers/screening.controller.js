import * as screeningService from '../services/screening.service.js';
import * as screeningV2 from '../services/screeningV2.service.js';
import config from '../config/index.js';
import { success } from '../utils/apiResponse.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';
import runExport from '../exports/runExport.js';
import screeningExport from '../exports/screening.export.js';
import { getMrfJdAttachment } from '../services/jdAttachment.service.js';

/**
 * GET /api/screening/roles[?includeClosed=1]
 * One entry per approved MRF (N19); `includeClosed` also lists filled/closed
 * MRFs after the open ones, flagged `closed` (N20).
 */
export const getRoles = catchAsync(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  const flag = String(req.query.includeClosed || '').toLowerCase();
  const roles = await screeningService.getApprovedRoles({ includeClosed: flag === '1' || flag === 'true' });
  return success(res, roles, 'Approved MRF roles retrieved successfully');
});

/**
 * GET /api/screening/roles/:id/jd
 * For the shortlist dialog's "JD attached" line (N17). Never returns the file itself.
 */
export const getRoleJdAttachment = catchAsync(async (req, res) => {
  const mrfId = parseInt(req.params.id, 10);
  if (isNaN(mrfId) || mrfId <= 0) throw new AppError('Invalid MRF ID provided.', 400);
  const jd = await getMrfJdAttachment(mrfId);
  return success(res, {
    attachable: Boolean(jd.attachment),
    name: jd.name,
    size_bytes: jd.sizeBytes,
    has_link: Boolean(jd.link),
    reason: jd.reason,
  }, 'JD attachment details');
});

/**
 * POST /api/screening/roles/:id/search
 */
export const searchRoleCandidates = catchAsync(async (req, res) => {
  const { id } = req.params;
  const mrfId = parseInt(id, 10);
  if (isNaN(mrfId)) {
    throw new AppError('Invalid MRF ID provided.', 400);
  }

  const force = req.query.force === '1' || req.query.force === 'true' || req.body?.force === true;
  // N38 "Added within" (days); validated by parseScreeningFilters in the service.
  const opts = { addedWithinDays: req.body?.addedWithinDays ?? req.query.addedWithinDays ?? null };
  const result = config.screening.v2
    ? await screeningV2.searchRoleCandidatesV2(mrfId, force, opts)
    : await screeningService.searchRoleCandidates(mrfId, force, opts);
  return success(res, result, 'Role-matched candidates retrieved successfully');
});

/**
 * POST /api/screening/keyword-search
 */
export const searchKeywordCandidates = catchAsync(async (req, res) => {
  const filters = req.body || {};
  // Lookups (name / email / phone) always use V2 — the old search has none.
  const result = config.screening.v2 || screeningV2.isLookupRequest(filters)
    ? await screeningV2.searchKeywordCandidatesV2(filters)
    : await screeningService.searchKeywordCandidates(filters);
  return success(res, result, 'Keyword-filtered candidates retrieved successfully');
});

/**
 * POST /api/screening/roles/:id/export
 * CSV of the JD-filtering results for one MRF. POST, not GET, to mirror the
 * search it re-runs.
 */
export const exportRoleCandidates = catchAsync(async (req, res) => {
  const mrfId = parseInt(req.params.id, 10);
  if (isNaN(mrfId)) {
    throw new AppError('Invalid MRF ID provided.', 400);
  }
  return runExport(req, res, screeningExport.roleSpec(mrfId, {
    addedWithinDays: req.body?.addedWithinDays ?? req.query.addedWithinDays ?? null,
  }));
});

/**
 * POST /api/screening/keyword-export
 * CSV of the keyword-tab results. Takes the same filter body as the search.
 */
export const exportKeywordCandidates = catchAsync(async (req, res) => runExport(
  req,
  res,
  screeningExport.keywordSpec(req.body || {}),
));

/**
 * GET /api/screening/analytics/pipeline/export
 * CSV of the Analytics "Role Summary" table.
 */
export const exportRoleSummary = catchAsync(async (req, res) => runExport(
  req,
  res,
  screeningExport.roleSummarySpec,
));

/**
 * POST /api/screening/shortlist
 */
export const shortlistCandidates = catchAsync(async (req, res) => {
  const { candidates, mrf_id, role_name, send_email, email_override, source } = req.body;
  if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
    throw new AppError('Candidates array is required.', 400);
  }
  const mrfId = parseInt(mrf_id, 10);
  if (isNaN(mrfId)) {
    throw new AppError('Invalid MRF ID.', 400);
  }

  const result = await screeningService.shortlistCandidates(candidates, mrfId, role_name, req.user, {
    sendEmail: send_email !== false,
    emailOverride: email_override || null,
    // 'jd' | 'keyword' | 'search_candidate' — only 'keyword' attaches the JD (N17).
    source: ['jd', 'keyword', 'search_candidate'].includes(source) ? source : null,
  });
  return success(res, result, 'Candidates shortlisted successfully');
});

/**
 * POST /api/screening/reject
 */
export const rejectCandidates = catchAsync(async (req, res) => {
  const { candidates, mrf_id, role_name, reason, send_email, email_override } = req.body;
  if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
    throw new AppError('Candidates array is required.', 400);
  }
  if (!reason) {
    throw new AppError('A rejection reason is required.', 400);
  }
  const mrfId = parseInt(mrf_id, 10) || 0;

  const result = await screeningService.rejectCandidates(candidates, mrfId, role_name, req.user, {
    reason,
    sendEmail: send_email !== false,
    emailOverride: email_override || null,
  });
  return success(res, result, 'Candidates rejected successfully');
});

/**
 * GET /api/screening/analytics/jobs
 */
export const getZekoJobs = catchAsync(async (req, res) => {
  const jobs = await screeningService.getZekoJobs();
  return success(res, jobs, 'Zeko jobs retrieved successfully');
});

/**
 * GET /api/screening/analytics/pipeline
 */
export const getZekoPipeline = catchAsync(async (req, res) => {
  const pipeline = await screeningService.getZekoPipeline();
  return success(res, pipeline, 'Zeko interview pipeline retrieved successfully');
});

/**
 * POST /api/screening/analytics/assign
 */
export const assignZekoJob = catchAsync(async (req, res) => {
  // `stage` picks the Zeko round ('hr' | 'functional', or the board stage key);
  // omitted by Candidate Screening, which only ever assigns the HR round.
  const { candidate_id, zeko_job_id, stage } = req.body;
  const candidateId = parseInt(candidate_id, 10);
  if (isNaN(candidateId) || !zeko_job_id) {
    throw new AppError('Candidate ID and Zeko Job ID are required.', 400);
  }

  const result = await screeningService.assignCandidateToZekoJob(candidateId, zeko_job_id, stage);
  return success(res, result, 'Candidate successfully assigned to Zeko job');
});

/**
 * POST /api/screening/analytics/schedule
 */
export const scheduleZekoInterview = catchAsync(async (req, res) => {
  const { shortlist_id, zeko_job_id, interview_start_at, interview_end_at, stage } = req.body;
  const shortlistId = parseInt(shortlist_id, 10);
  if (isNaN(shortlistId) || !zeko_job_id || !interview_start_at || !interview_end_at) {
    throw new AppError('Shortlist ID, Zeko Job ID, Start time, and End time are required.', 400);
  }

  const result = await screeningService.scheduleInterview(
    shortlistId,
    zeko_job_id,
    interview_start_at,
    interview_end_at,
    req.user,
    stage
  );
  return success(res, result, 'Zeko interview scheduled successfully');
});

/**
 * POST /api/screening/analytics/cancel
 */
export const cancelZekoInterview = catchAsync(async (req, res) => {
  const { pipeline_id, cancel_reason } = req.body;
  const pipelineId = parseInt(pipeline_id, 10);
  if (isNaN(pipelineId) || !cancel_reason) {
    throw new AppError('Pipeline ID and cancellation reason are required.', 400);
  }

  const result = await screeningService.cancelInterview(pipelineId, cancel_reason, req.user);
  return success(res, result, 'Zeko interview cancelled successfully');
});

/**
 * GET /api/screening/outlook/conversations
 */
export const getOutlookConversations = catchAsync(async (req, res) => {
  const { email } = req.query;
  if (!email) {
    throw new AppError('Candidate email parameter is required.', 400);
  }

  const result = await screeningService.getOutlookConversations(email);
  return success(res, result, 'Candidate conversations retrieved successfully');
});

/**
 * POST /api/screening/outlook/reply
 */
export const replyToOutlookMessage = catchAsync(async (req, res) => {
  const { message_id, body_html } = req.body;
  const messageId = parseInt(message_id, 10);
  if (isNaN(messageId)) {
    throw new AppError('A valid message_id is required.', 400);
  }
  if (typeof body_html !== 'string' || body_html.trim() === '') {
    throw new AppError('Reply body is required.', 400);
  }

  const result = await screeningService.replyToOutlookMessage(messageId, body_html.trim(), req.user);
  return success(res, result, 'Reply sent successfully');
});

/**
 * POST /api/screening/analytics/status
 */
export const updateCandidateStatus = catchAsync(async (req, res) => {
  const { candidate_id, status } = req.body;
  const candidateId = parseInt(candidate_id, 10);
  if (isNaN(candidateId) || !status) {
    throw new AppError('Candidate ID and status are required.', 400);
  }

  const result = await screeningService.updateCandidateStatus(candidateId, status, req.user);
  return success(res, result, 'Candidate status updated successfully');
});

