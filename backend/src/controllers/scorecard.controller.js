/**
 * scorecard.controller.js — PUBLIC (no-login) interviewer scorecard endpoints.
 *
 * These are reached from an emailed tokenized link by interviewers/HR/CEO who
 * have no ATS session, so the router mounting them applies NO authenticate
 * middleware (see routes/scorecard.routes.js). The uuid token is the only
 * credential and is validated here before any lookup.
 */
import {
  getScorecardByToken,
  submitScorecardByToken,
} from '../services/interviewScorecard.service.js';
import { markInterviewOccurrence } from '../services/interviewSchedule.service.js';
import prisma from '../config/database.js';
import { success } from '../utils/apiResponse.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const assertToken = (token) => {
  if (!token || !UUID_RE.test(token)) throw new AppError('This scorecard link is invalid.', 404);
};

/** Best-effort client IP for the submission audit. */
const clientIp = (req) =>
  (req.headers['x-forwarded-for']?.split(',')[0]?.trim()) || req.socket?.remoteAddress || null;

/**
 * GET /api/scorecard/:token — public. Returns the form view model (pre-filled
 * context + occurrence gate state), or a closed state for a used/expired token.
 */
export const getScorecard = catchAsync(async (req, res) => {
  assertToken(req.params.token);
  const result = await getScorecardByToken(req.params.token);
  return success(res, result, 'Scorecard retrieved');
});

/**
 * POST /api/scorecard/:token/occurrence — public. The interviewer answers the
 * "did the interview take place?" gate. 'held' releases the scorecard (and the
 * same page then shows the form); 'no_show' records it and closes the link.
 */
export const confirmScorecardOccurrence = catchAsync(async (req, res) => {
  assertToken(req.params.token);
  const { outcome, party, reason } = req.body || {};

  // Resolve the schedule + recipient from the token (public: no user context).
  const card = await prisma.rpa_interview_scorecard.findUnique({
    where: { token: req.params.token },
    select: { schedule_id: true, recipient_email: true, status: true },
  });
  if (!card) throw new AppError('This scorecard link is invalid.', 404);
  if (card.status === 'submitted') throw new AppError('This scorecard has already been submitted.', 409);

  const result = await markInterviewOccurrence(Number(card.schedule_id), {
    outcome,
    source: 'interviewer',
    confirmedBy: card.recipient_email,
    party: party || null,
    reason: reason || null,
  });
  return success(res, result, 'Interview outcome recorded');
});

/**
 * POST /api/scorecard/:token/submit — public, single-use. Persists the card and
 * closes the token.
 */
export const submitScorecard = catchAsync(async (req, res) => {
  assertToken(req.params.token);
  const result = await submitScorecardByToken(req.params.token, req.body || {}, { ip: clientIp(req) });
  return success(res, result, 'Feedback submitted — thank you');
});
