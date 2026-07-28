import * as screeningService from '../services/screening.service.js';
import { success } from '../utils/apiResponse.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';

/**
 * GET /api/screening/roles
 */
export const getRoles = catchAsync(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  const roles = await screeningService.getApprovedRoles();
  return success(res, roles, 'Approved MRF roles retrieved successfully');
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
  const result = await screeningService.searchRoleCandidates(mrfId, force);
  return success(res, result, 'Role-matched candidates retrieved successfully');
});

/**
 * POST /api/screening/keyword-search
 */
export const searchKeywordCandidates = catchAsync(async (req, res) => {
  const filters = req.body || {};
  const result = await screeningService.searchKeywordCandidates(filters);
  return success(res, result, 'Keyword-filtered candidates retrieved successfully');
});

/**
 * POST /api/screening/shortlist
 */
export const shortlistCandidates = catchAsync(async (req, res) => {
  const { candidates, mrf_id, role_name, send_email, email_override } = req.body;
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
  const { candidate_id, zeko_job_id } = req.body;
  const candidateId = parseInt(candidate_id, 10);
  if (isNaN(candidateId) || !zeko_job_id) {
    throw new AppError('Candidate ID and Zeko Job ID are required.', 400);
  }

  const result = await screeningService.assignCandidateToZekoJob(candidateId, zeko_job_id);
  return success(res, result, 'Candidate successfully assigned to Zeko job');
});

/**
 * POST /api/screening/analytics/schedule
 */
export const scheduleZekoInterview = catchAsync(async (req, res) => {
  const { shortlist_id, zeko_job_id, interview_start_at, interview_end_at } = req.body;
  const shortlistId = parseInt(shortlist_id, 10);
  if (isNaN(shortlistId) || !zeko_job_id || !interview_start_at || !interview_end_at) {
    throw new AppError('Shortlist ID, Zeko Job ID, Start time, and End time are required.', 400);
  }

  const result = await screeningService.scheduleInterview(
    shortlistId,
    zeko_job_id,
    interview_start_at,
    interview_end_at,
    req.user
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

