import * as pipelineService from '../services/pipeline.service.js';
import * as offerService from '../services/offer.service.js';
import * as clientRoundService from '../services/clientRound.service.js';
import * as documentService from '../services/documentCollection.service.js';
import prisma from '../config/database.js';
import { success } from '../utils/apiResponse.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';
import runExport from '../exports/runExport.js';
import pipelineExport from '../exports/pipeline.export.js';
import pipelineAnalyticsExport from '../exports/pipelineAnalytics.export.js';
// The generic-fallback chain and the never-email list are the dispatcher's, not
// this controller's — listStageTemplates reads them so the admin screen shows
// what actually sends. See stageNotification.service.js's resolveTemplate().
import {
  GENERIC_FALLBACK_BY_OUTCOME,
  SILENT_FINAL_OUTCOMES,
} from '../services/stageNotification.service.js';

/**
 * GET /api/pipeline
 * Board data for the kanban view: columns (stages) + cards (journeys), filterable.
 */
export const listPipeline = catchAsync(async (req, res) => {
  const { source, on_hold_only, mrf_id, stuck_days, position, include_closed } = req.query;
  const result = await pipelineService.listPipeline({
    source: source || undefined,
    onHoldOnly: on_hold_only === '1' || on_hold_only === 'true',
    mrfId: mrf_id ? parseInt(mrf_id, 10) : undefined,
    stuckDays: stuck_days ? parseInt(stuck_days, 10) : undefined,
    position: position || undefined,
    includeClosed: include_closed === '1' || include_closed === 'true',
  });
  return success(res, result, 'Pipeline board retrieved successfully');
});

/**
 * GET /api/pipeline/analytics
 * Real pipeline analytics — feeds the "Pipeline Insights" and "Recruiter
 * Insights" tabs on the Analytics page (replaces the hardcoded mock data in
 * CandidatePipelineAnalyticsPreview / RecruiterInsightsPreview).
 */
export const getPipelineAnalytics = catchAsync(async (req, res) => {
  // Same parser the CSV export uses — see parseAnalyticsParams for why they
  // must not be two separate implementations.
  const result = await pipelineService.getPipelineAnalytics(
    pipelineAnalyticsExport.parseAnalyticsParams(req.query),
  );
  return success(res, result, 'Pipeline analytics retrieved successfully');
});

/**
 * GET /api/pipeline/export
 * CSV of every journey matching the board's current filters.
 */
export const exportPipeline = catchAsync(async (req, res) => runExport(req, res, {
  key: 'pipeline',
  label: 'Candidate-Pipeline',
  columns: pipelineExport.columns,
  filters: pipelineExport.parseFilters(req),
  fetch: pipelineExport.fetch,
}));

/**
 * GET /api/pipeline/analytics/export?table=…
 * CSV of one analytics table, complete rather than the screen's top 10.
 */
export const exportPipelineAnalytics = catchAsync(async (req, res) => {
  // req.query is forwarded so the CSV honours the same mrf_id/threshold filters
  // the screen used, rather than silently exporting the unfiltered set.
  const spec = pipelineAnalyticsExport.specFor(req.query.table, req.query);
  if (!spec) {
    throw new AppError(
      `Unknown analytics table "${req.query.table || ''}". Expected one of: ${pipelineAnalyticsExport.TABLE_KEYS.join(', ')}.`,
      400,
    );
  }
  // Only the recognised params are echoed into the audit line — spreading raw
  // req.query would log arbitrary caller-supplied keys.
  const { mrf_id, rejection_window_days, stuck_threshold_days, hold_threshold_days } = req.query;
  return runExport(req, res, {
    ...spec,
    filters: {
      table: req.query.table, mrf_id, rejection_window_days, stuck_threshold_days, hold_threshold_days,
    },
  });
});

/**
 * GET /api/pipeline/stages
 * Admin-configurable stage list, for the board column headers and admin config UI.
 */
export const listStages = catchAsync(async (_req, res) => {
  const stages = await prisma.rpa_pipeline_stages.findMany({
    orderBy: { sort_order: 'asc' },
    // Outcomes come along so the admin config screen can show and edit each
    // stage's outcome set without a request per stage. Purely additive — the
    // board and the drawer's dropdowns read the same top-level fields as before.
    include: { rpa_stage_outcomes: { orderBy: { sort_order: 'asc' } } },
  });
  return success(res, stages, 'Stages retrieved successfully');
});

/**
 * GET /api/pipeline/reasons
 * Full reason taxonomy (global + stage-scoped), for Reject/Hold dropdowns.
 */
export const listReasons = catchAsync(async (req, res) => {
  // Recruiters picking a reason should only ever see live ones, so active-only
  // stays the default. The admin config screen passes include_inactive=true —
  // without it a deactivated reason becomes invisible and therefore impossible
  // to reactivate from the UI that deactivated it.
  const includeInactive = req.query.include_inactive === 'true';
  const reasons = await prisma.rpa_outcome_reasons.findMany({
    where: includeInactive ? {} : { is_active: true },
    orderBy: { sort_order: 'asc' },
  });
  return success(res, reasons, 'Outcome reasons retrieved successfully');
});

/**
 * GET /api/pipeline/:id
 * Full detail for one journey — feeds the per-round drawer.
 */
export const getPipelineDetail = catchAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('Invalid pipeline id.', 400);
  const detail = await pipelineService.getPipelineDetail(id);
  return success(res, detail, 'Pipeline detail retrieved successfully');
});

/**
 * GET /api/pipeline/:id/outcome-preview?outcome_key=approved
 * Compiles (without sending) the outcome email a given outcome would
 * produce — feeds the drawer's editable "Record round outcome" modal.
 */
export const getOutcomePreview = catchAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('Invalid pipeline id.', 400);
  const { outcome_key } = req.query;
  if (!outcome_key) throw new AppError('outcome_key is required.', 400);

  const preview = await pipelineService.getOutcomePreview(id, outcome_key);
  return success(res, preview, 'Outcome email preview generated successfully');
});

/**
 * POST /api/pipeline/:id/outcome
 * Records Approve/Reject/Hold (or any configured outcome) on the current
 * stage. Approve auto-advances to the next active stage in the same call.
 * If that next stage is optional, `skip_optional_next: true` lands on the
 * stage after it instead, logging the bypassed stage as a skip.
 *
 * `expected_stage_key` is the stage the client was DISPLAYING when the recruiter
 * decided. Sending it turns a stale-tab decision into a 409 instead of a second
 * silent advance (defect D3) — see setStageOutcome() for why the server cannot
 * work this out on its own.
 */
export const setStageOutcome = catchAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('Invalid pipeline id.', 400);
  const { outcome_key, reason_id, other_text, notes, email_subject, email_body, skip_optional_next, expected_stage_key } = req.body;
  if (!outcome_key) throw new AppError('outcome_key is required.', 400);

  const result = await pipelineService.setStageOutcome(id, {
    outcomeKey: outcome_key,
    reasonId: reason_id ? parseInt(reason_id, 10) : null,
    otherText: other_text || null,
    notes: notes || null,
    emailSubject: email_subject || null,
    emailBody: email_body || null,
    skipOptionalNext: !!skip_optional_next,
    expectedStageKey: expected_stage_key || null,
    actedBy: req.user?.id,
  });
  return success(res, result, 'Stage outcome recorded successfully');
});

/**
 * POST /api/pipeline/:id/advance
 * Moves the journey to the next active stage (used after an "advance" outcome,
 * or to explicitly skip an optional stage).
 */
export const advanceStage = catchAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('Invalid pipeline id.', 400);
  const { skip } = req.body || {};
  const result = await pipelineService.advanceStage(id, { skip: !!skip, actedBy: req.user?.id });
  return success(res, result, 'Pipeline advanced successfully');
});

/**
 * POST /api/pipeline/:id/interview
 * Books the interview for the candidate's current scheduled round.
 */
export const scheduleInterview = catchAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('Invalid pipeline id.', 400);

  const {
    stage_key, start_at, duration_minutes, interviewer_email, interviewer_name, notes,
    candidate_subject, candidate_body, panel_subject, panel_body,
  } = req.body || {};
  if (!stage_key || !start_at) {
    throw new AppError('Stage and interview start time are required.', 400);
  }

  const result = await pipelineService.scheduleInterviewRound(id, {
    stageKey: stage_key,
    startAt: start_at,
    durationMinutes: duration_minutes ? parseInt(duration_minutes, 10) : 60,
    interviewerEmail: interviewer_email || '',
    interviewerName: interviewer_name || '',
    notes: notes || null,
    candidateSubject: candidate_subject ?? null,
    candidateBody: candidate_body ?? null,
    panelSubject: panel_subject ?? null,
    panelBody: panel_body ?? null,
    actedBy: req.user?.id,
  });
  return success(res, result, 'Interview scheduled successfully');
});

/**
 * GET /api/pipeline/:id/interview-preview?stage_key&start_at&duration_minutes
 * Compiled (not sent) candidate + panel invite emails for the Schedule modal.
 */
export const getSchedulePreview = catchAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('Invalid pipeline id.', 400);

  // interviewer_name/_email are forwarded so the panel copy the modal shows is
  // the copy that gets sent — the submit posts this compiled body back, and the
  // send path prefers it over recompiling.
  const { stage_key, start_at, duration_minutes, interviewer_name, interviewer_email } = req.query;
  const result = await pipelineService.previewScheduleEmails(id, {
    stageKey: stage_key,
    startAt: start_at,
    durationMinutes: duration_minutes ? parseInt(duration_minutes, 10) : 60,
    interviewerName: interviewer_name || '',
    interviewerEmail: interviewer_email || '',
  });
  return success(res, result, 'Schedule email preview generated');
});

/**
 * POST /api/pipeline/:id/interview/reschedule
 * Cancels the current-round booking and creates a new one, notifying both
 * sides with a single "rescheduled" email (old → new time).
 */
export const rescheduleInterview = catchAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('Invalid pipeline id.', 400);

  const {
    stage_key, start_at, duration_minutes, interviewer_email, interviewer_name,
    candidate_subject, candidate_body, panel_subject, panel_body,
  } = req.body || {};
  if (!stage_key || !start_at) {
    throw new AppError('Stage and new interview start time are required.', 400);
  }

  const result = await pipelineService.rescheduleInterviewRound(id, {
    stageKey: stage_key,
    startAt: start_at,
    durationMinutes: duration_minutes ? parseInt(duration_minutes, 10) : 60,
    interviewerEmail: interviewer_email || '',
    interviewerName: interviewer_name || '',
    candidateSubject: candidate_subject ?? null,
    candidateBody: candidate_body ?? null,
    panelSubject: panel_subject ?? null,
    panelBody: panel_body ?? null,
    actedBy: req.user?.id,
  });
  return success(res, result, 'Interview rescheduled successfully');
});

/**
 * GET /api/pipeline/:id/interview/reschedule-preview
 * Compiled (not sent) candidate + panel "rescheduled" emails for the modal.
 */
export const getReschedulePreview = catchAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('Invalid pipeline id.', 400);

  const { stage_key, start_at, duration_minutes, interviewer_name, interviewer_email } = req.query;
  const result = await pipelineService.previewRescheduleEmails(id, {
    stageKey: stage_key,
    startAt: start_at,
    durationMinutes: duration_minutes ? parseInt(duration_minutes, 10) : 60,
    interviewerName: interviewer_name || '',
    interviewerEmail: interviewer_email || '',
  });
  return success(res, result, 'Reschedule email preview generated');
});

/**
 * POST /api/pipeline/interview/:scheduleId/cancel
 * Cancels a booked interview so the round can be rebooked.
 */
export const cancelScheduledInterview = catchAsync(async (req, res) => {
  const scheduleId = parseInt(req.params.scheduleId, 10);
  if (Number.isNaN(scheduleId)) throw new AppError('Invalid interview id.', 400);

  const { cancel_reason, candidate_subject, candidate_body, panel_subject, panel_body } = req.body || {};
  const result = await pipelineService.cancelInterviewRound(scheduleId, {
    reason: cancel_reason || '',
    candidateSubject: candidate_subject ?? null,
    candidateBody: candidate_body ?? null,
    panelSubject: panel_subject ?? null,
    panelBody: panel_body ?? null,
    actedBy: req.user?.id,
  });
  return success(res, result, 'Interview cancelled successfully');
});

/**
 * GET /api/pipeline/interview/:scheduleId/cancel-preview
 * Compiled (not sent) candidate + panel cancellation emails for the Cancel modal.
 */
export const getCancelPreview = catchAsync(async (req, res) => {
  const scheduleId = parseInt(req.params.scheduleId, 10);
  if (Number.isNaN(scheduleId)) throw new AppError('Invalid interview id.', 400);

  const result = await pipelineService.previewCancelEmails(scheduleId, { reason: req.query.reason || '' });
  return success(res, result, 'Cancel email preview generated');
});

/**
 * POST /api/pipeline/interview/:scheduleId/occurrence
 * Records whether the interview happened. 'held' releases the scorecard link
 * (once); 'no_show' records it and the caller then offers reschedule/reject.
 */
export const recordInterviewOccurrence = catchAsync(async (req, res) => {
  const scheduleId = parseInt(req.params.scheduleId, 10);
  if (Number.isNaN(scheduleId)) throw new AppError('Invalid interview id.', 400);

  const { outcome, party, reason } = req.body || {};
  if (!outcome) throw new AppError('outcome is required.', 400);

  const result = await pipelineService.markInterviewOccurrence(scheduleId, {
    outcome,
    source: 'recruiter',
    confirmedBy: req.user?.username || null,
    actedBy: req.user?.id,
    party: party || null,
    reason: reason || null,
  });
  return success(res, result, 'Interview outcome recorded');
});

/**
 * GET /api/pipeline/interviews/unresolved
 * Interviews that have ended with no held/no_show verdict — the work queue for
 * rounds that cannot progress until someone rules on whether they happened.
 */
export const listUnresolvedInterviews = catchAsync(async (req, res) => {
  const graceMin = parseInt(req.query.grace_min, 10);
  const rows = await pipelineService.listUnresolvedInterviews({
    graceMin: Number.isInteger(graceMin) && graceMin >= 0 ? graceMin : undefined,
  });
  return success(res, rows, 'Unresolved interviews fetched');
});

/**
 * POST /api/pipeline/interview/:scheduleId/send-scorecard
 * Manually dispatches the scorecard link (only meaningful once the interview is
 * confirmed held). Idempotent — a second call is a no-op.
 */
export const sendScorecard = catchAsync(async (req, res) => {
  const scheduleId = parseInt(req.params.scheduleId, 10);
  if (Number.isNaN(scheduleId)) throw new AppError('Invalid interview id.', 400);

  const result = await pipelineService.dispatchScorecards(scheduleId, {
    trigger: 'manual',
    actedBy: req.user?.id,
  });
  return success(res, result, 'Scorecard dispatch processed');
});

/**
 * GET /api/pipeline/:id/scorecard-report
 * Per-round submitted scorecards + overall sum/average for a candidate.
 */
export const getScorecardReport = catchAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('Invalid pipeline id.', 400);

  const result = await pipelineService.getCandidateScorecardReport(id);
  return success(res, result, 'Scorecard report retrieved');
});

/**
 * POST /api/pipeline/:id/closure
 * Sets the final/closure outcome (Q12 — 8 closure statuses).
 */
export const setFinalOutcome = catchAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('Invalid pipeline id.', 400);
  const { final_outcome_key, notes } = req.body;
  if (!final_outcome_key) throw new AppError('final_outcome_key is required.', 400);

  const result = await pipelineService.setFinalOutcome(id, {
    finalOutcomeKey: final_outcome_key,
    notes: notes || null,
    actedBy: req.user?.id,
  });
  return success(res, result, 'Closure recorded successfully');
});

/**
 * POST /api/pipeline/:id/reopen
 * Re-opens a closed journey (audit §2.6). Reason is mandatory — a re-open is an
 * exception, and until 2026-08-26 assertJourneyOpen named this action without
 * it existing.
 */
export const reopenJourney = catchAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('Invalid pipeline id.', 400);
  const { reason } = req.body;
  if (!reason || !String(reason).trim()) throw new AppError('reason is required.', 400);

  const result = await pipelineService.reopenJourney(id, {
    reason: String(reason).trim(),
    actedBy: req.user?.id,
  });
  return success(res, result, 'Candidate record reopened');
});

/**
 * POST /api/pipeline/:id/pause
 * Pauses or resumes a journey (Q33). `paused` is explicit rather than a toggle
 * so two recruiters acting at once cannot flip it past each other.
 */
export const setJourneyPaused = catchAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('Invalid pipeline id.', 400);
  const { paused, reason } = req.body;
  if (typeof paused !== 'boolean') throw new AppError('paused must be true or false.', 400);

  const result = await pipelineService.setJourneyPaused(id, {
    paused,
    reason: reason ? String(reason).trim() : null,
    actedBy: req.user?.id,
  });
  return success(res, result, paused ? 'Journey paused' : 'Journey resumed');
});

// ── Client round — marked, never booked; nothing reaches the client (Q14) ───

/**
 * POST /api/pipeline/:id/client-round/arranged
 * Marks that the client interview took place, and when.
 */
export const recordClientRoundArranged = catchAsync(async (req, res) => {
  const { happened_at, contact_name } = req.body;
  const result = await clientRoundService.recordClientRoundArranged(pipelineIdFrom(req), {
    happenedAt: happened_at || null,
    contactName: contact_name || null,
    actedBy: req.user?.id,
  });
  return success(res, result, 'Client interview marked as arranged');
});

/**
 * POST /api/pipeline/:id/client-round/feedback
 * Records the client's transcribed verdict.
 */
export const recordClientRoundFeedback = catchAsync(async (req, res) => {
  const { heard_at, feedback } = req.body;
  const result = await clientRoundService.recordClientRoundFeedback(pipelineIdFrom(req), {
    heardAt: heard_at || null,
    feedback: feedback || null,
    actedBy: req.user?.id,
  });
  return success(res, result, 'Client feedback recorded');
});

// ── Offer round (Module 5) — record-only; letters live outside the ATS ──────

/** Parses + validates :id, shared by the offer endpoints. */
function pipelineIdFrom(req) {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('Invalid pipeline id.', 400);
  return id;
}

/* DISABLED 2026-08-25 — the two internal-approval endpoints. RT: the offer is
 * handled offline and the app marks the round only. Reverses Q3/Q26; uncomment
 * together with the service functions in offer.service.js and the routes in
 * pipeline.routes.js if the sign-off is ever wanted back. */
/*
export const requestOfferApproval = catchAsync(async (req, res) => {
  const result = await offerService.requestApproval(pipelineIdFrom(req), { actedBy: req.user?.id });
  return success(res, result, 'Offer approval requested');
});

export const approveOffer = catchAsync(async (req, res) => {
  const result = await offerService.approveOffer(pipelineIdFrom(req), { actedBy: req.user?.id });
  return success(res, result, 'Offer approved');
});
*/

/**
 * POST /api/pipeline/:id/offer/share
 * Records that HR shared the offer — the first step of the offer round.
 */
export const recordOfferShared = catchAsync(async (req, res) => {
  const { joining_date, remarks } = req.body;
  const result = await offerService.recordOfferShared(pipelineIdFrom(req), {
    joiningDate: joining_date || null,
    remarks: remarks || null,
    actedBy: req.user?.id,
  });
  return success(res, result, 'Offer recorded as shared');
});

/**
 * POST /api/pipeline/:id/offer/decision
 * Records the candidate's accept/reject.
 */
export const recordOfferDecision = catchAsync(async (req, res) => {
  const { decision, remarks, amend } = req.body;
  if (!decision) throw new AppError('decision is required.', 400);

  const result = await offerService.recordCandidateDecision(pipelineIdFrom(req), {
    decision,
    remarks: remarks || null,
    // Overwriting a decision that is already recorded needs an explicit
    // `amend: true` from the UI, so a stale tab cannot flip an acceptance.
    amend: amend === true,
    actedBy: req.user?.id,
  });
  return success(res, result, 'Offer decision recorded');
});

// ── Documents round (Module 4) — recruiter-facing half ─────────────────────
// The candidate-facing upload half is public, in document.controller.js.

/**
 * GET /api/pipeline/:id/documents
 * The request + its checklist state, plus the configured checklist itself.
 */
export const getDocumentStatus = catchAsync(async (req, res) => {
  const result = await documentService.getDocumentStatus(pipelineIdFrom(req));
  return success(res, result, 'Document status retrieved');
});

/**
 * POST /api/pipeline/:id/documents/request
 * Raises the request and emails the candidate the no-login upload link.
 */
export const requestDocuments = catchAsync(async (req, res) => {
  const result = await documentService.requestDocuments(pipelineIdFrom(req), { actedBy: req.user?.id });
  return success(res, result, 'Document request sent');
});

/**
 * POST /api/pipeline/:id/documents/remind
 * Re-sends the upload link for an outstanding request.
 */
export const remindDocuments = catchAsync(async (req, res) => {
  const result = await documentService.sendReminder(pipelineIdFrom(req), { actedBy: req.user?.id });
  return success(res, result, 'Reminder sent');
});

/**
 * POST /api/pipeline/documents/:docId/verify
 * Marks one uploaded document as verified.
 */
export const verifyDocument = catchAsync(async (req, res) => {
  const docId = parseInt(req.params.docId, 10);
  if (Number.isNaN(docId)) throw new AppError('Invalid document id.', 400);

  const result = await documentService.verifyDocument(docId, { actedBy: req.user?.id });
  return success(res, result, 'Document verified');
});

/**
 * POST /api/pipeline/documents/:docId/reject
 * Rejects one document with a reason and re-requests it from the candidate.
 */
export const rejectDocument = catchAsync(async (req, res) => {
  const docId = parseInt(req.params.docId, 10);
  if (Number.isNaN(docId)) throw new AppError('Invalid document id.', 400);
  const { reason } = req.body;

  const result = await documentService.rejectDocument(docId, { reason, actedBy: req.user?.id });
  return success(res, result, 'Document rejected and re-requested');
});

/**
 * POST /api/pipeline/:id/email
 * Ad-hoc per-candidate email override (RT ask, 2026-07-14).
 */
export const sendAdHocEmail = catchAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('Invalid pipeline id.', 400);
  const { subject, body } = req.body;
  if (!subject || !body) throw new AppError('subject and body are required.', 400);

  const result = await pipelineService.sendAdHocEmail(id, { subject, body });
  return success(res, result, 'Email sent successfully');
});

// ── Admin config CRUD (RT ask 2026-07-13): stages / outcomes / reasons ──────
// Behind the existing admin access control (checkModuleAccess in the routes file).

/**
 * POST /api/pipeline/stages
 * Creates a new stage (admin-only — RT ask: stages must be extensible without code changes).
 */
export const createStage = catchAsync(async (req, res) => {
  const { stage_key, label, sort_order, is_optional, stage_type } = req.body;
  if (!stage_key || !label) throw new AppError('stage_key and label are required.', 400);

  const stage = await prisma.rpa_pipeline_stages.create({
    data: {
      stage_key,
      label,
      sort_order: sort_order ?? 0,
      is_optional: !!is_optional,
      stage_type: stage_type || 'manual',
    },
  });
  return success(res, stage, 'Stage created successfully', 201);
});

/**
 * PUT /api/pipeline/stages/:key
 * Updates a stage's label/order/active/optional flags.
 */
export const updateStage = catchAsync(async (req, res) => {
  const { key } = req.params;
  const { label, sort_order, is_optional, is_active, stage_type } = req.body;

  // Deactivating a stage that candidates are currently sitting on strands them:
  // the stage engine resolves the next stage from the ACTIVE stage list, so
  // their current stage is no longer in it and they can neither advance nor be
  // approved. That used to fail silently; now the engine 409s, and this stops
  // the situation arising in the first place — which matters much more now that
  // an admin can do this from a screen rather than by hand-writing SQL.
  if (is_active === false) {
    const stranded = await prisma.rpa_candidate_pipeline.count({
      where: { current_stage_key: key, final_outcome: null },
    });
    if (stranded > 0) {
      throw new AppError(
        `${stranded} open candidate${stranded === 1 ? ' is' : 's are'} currently on this stage. Move them on before deactivating it — deactivating now would leave them unable to advance.`,
        409
      );
    }
  }

  const stage = await prisma.rpa_pipeline_stages.update({
    where: { stage_key: key },
    data: {
      ...(label !== undefined && { label }),
      ...(sort_order !== undefined && { sort_order }),
      ...(is_optional !== undefined && { is_optional }),
      ...(is_active !== undefined && { is_active }),
      ...(stage_type !== undefined && { stage_type }),
      modified_at: new Date(),
    },
  });
  return success(res, stage, 'Stage updated successfully');
});

/**
 * POST /api/pipeline/stages/:key/outcomes
 * Adds a new outcome to a stage's outcome set (admin ask — extensible without code changes).
 */
export const createStageOutcome = catchAsync(async (req, res) => {
  const { key } = req.params;
  const { outcome_key, label, is_advance, is_final, sort_order } = req.body;
  if (!outcome_key || !label) throw new AppError('outcome_key and label are required.', 400);

  const outcome = await prisma.rpa_stage_outcomes.create({
    data: {
      stage_key: key,
      outcome_key,
      label,
      is_advance: !!is_advance,
      is_final: !!is_final,
      sort_order: sort_order ?? 0,
    },
  });
  return success(res, outcome, 'Stage outcome created successfully', 201);
});

/**
 * PUT /api/pipeline/stages/:key/outcomes/:outcomeKey
 * Edits an existing outcome (label / advance / final / active / order).
 */
export const updateStageOutcome = catchAsync(async (req, res) => {
  const { key, outcomeKey } = req.params;
  const { label, is_advance, is_final, is_active, sort_order } = req.body;

  const outcome = await prisma.rpa_stage_outcomes.update({
    where: { stage_key_outcome_key: { stage_key: key, outcome_key: outcomeKey } },
    data: {
      ...(label !== undefined && { label }),
      ...(is_advance !== undefined && { is_advance }),
      ...(is_final !== undefined && { is_final }),
      ...(is_active !== undefined && { is_active }),
      ...(sort_order !== undefined && { sort_order }),
      modified_at: new Date(),
    },
  });
  return success(res, outcome, 'Stage outcome updated successfully');
});

/**
 * POST /api/pipeline/reasons
 * Adds a new Reject/Hold reason (stage-scoped or global).
 */
export const createReason = catchAsync(async (req, res) => {
  const { stage_key, outcome_key, reason_label, is_other, sort_order } = req.body;
  if (!reason_label) throw new AppError('reason_label is required.', 400);

  const reason = await prisma.rpa_outcome_reasons.create({
    data: {
      stage_key: stage_key || null,
      outcome_key: outcome_key || 'rejected',
      reason_label,
      is_other: !!is_other,
      sort_order: sort_order ?? 0,
    },
  });
  return success(res, reason, 'Reason created successfully', 201);
});

/**
 * PUT /api/pipeline/reasons/:id
 * Edits an existing reason.
 */
export const updateReason = catchAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('Invalid reason id.', 400);
  const { reason_label, is_active, sort_order } = req.body;

  const reason = await prisma.rpa_outcome_reasons.update({
    where: { id: BigInt(id) },
    data: {
      ...(reason_label !== undefined && { reason_label }),
      ...(is_active !== undefined && { is_active }),
      ...(sort_order !== undefined && { sort_order }),
    },
  });
  return success(res, reason, 'Reason updated successfully');
});

/**
 * GET /api/pipeline/stage-templates
 * Every stage×outcome → email template mapping (rpa_stage_email_templates).
 *
 * The table has always existed and the dispatcher has always read it, but no
 * screen ever wrote to it — so "which email goes out when a candidate is
 * rejected at Tech 2" needed a developer and a SQL client, which is the exact
 * opposite of RT's "changeable without development" ask (2026-07-13). Every
 * mapping row in staging today was inserted by hand; there were zero.
 *
 * Returns the resolution chain, not just the mappings (2026-08-26). Almost every
 * pair is unmapped and therefore served by the generic per-outcome fallback, so
 * a bare mapping list left the config screen showing 38 blank dropdowns with no
 * way to tell "nothing is configured" from "nothing is sent". `fallbacks` names
 * the template each outcome_key really lands on, resolved against the live
 * rpa_email_templates rows so a renamed or deactivated generic shows up as
 * missing here instead of silently failing at send time; `silent_outcomes`
 * mirrors SILENT_FINAL_OUTCOMES, which short-circuits before any lookup.
 */
export const listStageTemplates = catchAsync(async (_req, res) => {
  const mappings = await prisma.rpa_stage_email_templates.findMany({
    include: { rpa_email_templates: { select: { id: true, name: true, subject: true, is_active: true } } },
  });

  // One query for all six generics rather than one per outcome; matched on the
  // same (name, is_active) pair resolveTemplate() uses so the screen cannot
  // claim a template the dispatcher would not find.
  const fallbackNames = Object.values(GENERIC_FALLBACK_BY_OUTCOME);
  const fallbackTemplates = await prisma.rpa_email_templates.findMany({
    where: { name: { in: fallbackNames }, is_active: true },
    select: { id: true, name: true, subject: true },
  });
  const byName = new Map(fallbackTemplates.map((t) => [t.name, t]));

  const fallbacks = Object.entries(GENERIC_FALLBACK_BY_OUTCOME).map(([outcomeKey, name]) => {
    const template = byName.get(name) || null;
    return {
      outcome_key: outcomeKey,
      template_name: name,
      template_id: template?.id ?? null,
      subject: template?.subject ?? null,
      // false = the named generic is missing or deactivated, so an unmapped pair
      // on this outcome sends nothing at all. Worth surfacing loudly.
      resolves: !!template,
    };
  });

  return success(
    res,
    { mappings, fallbacks, silent_outcomes: [...SILENT_FINAL_OUTCOMES] },
    'Stage email template mappings retrieved successfully'
  );
});

/**
 * PUT /api/pipeline/stage-templates
 * Sets (or clears) the template for one stage×outcome pair. Admin only.
 *
 * Upsert rather than create+update: the pair is the natural key, and an admin
 * re-picking a template for a stage they already configured is the common case,
 * not an error. A null/absent template_id clears the mapping, which returns
 * that pair to the generic per-outcome fallback rather than silencing it.
 */
export const setStageTemplate = catchAsync(async (req, res) => {
  const { stage_key, outcome_key, template_id } = req.body;
  if (!stage_key || !outcome_key) {
    throw new AppError('stage_key and outcome_key are required.', 400);
  }

  const key = { stage_key_outcome_key: { stage_key, outcome_key } };

  if (template_id === null || template_id === undefined || template_id === '') {
    await prisma.rpa_stage_email_templates.deleteMany({ where: { stage_key, outcome_key } });
    return success(res, { stage_key, outcome_key, template_id: null }, 'Stage email template mapping cleared');
  }

  const templateId = parseInt(template_id, 10);
  if (Number.isNaN(templateId)) throw new AppError('template_id must be a number.', 400);

  // Checked explicitly so a bad id reads as "that template does not exist"
  // rather than a raw foreign-key violation.
  const template = await prisma.rpa_email_templates.findUnique({ where: { id: templateId } });
  if (!template) throw new AppError('That email template does not exist.', 404);

  const mapping = await prisma.rpa_stage_email_templates.upsert({
    where: key,
    create: { stage_key, outcome_key, template_id: templateId },
    update: { template_id: templateId },
  });
  return success(res, mapping, 'Stage email template mapping saved');
});
