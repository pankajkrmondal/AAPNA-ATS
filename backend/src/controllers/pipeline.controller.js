import * as pipelineService from '../services/pipeline.service.js';
import * as offerService from '../services/offer.service.js';
import * as clientRoundService from '../services/clientRound.service.js';
import * as documentService from '../services/documentCollection.service.js';
// screeningService, not a forked query — getOutlookConversations() already
// exists for the Candidate Screening page (G4); this controller is a second
// entry point onto it, not a new implementation. Importing it here rather
// than from pipeline.service.js avoids a service-to-service import cycle:
// screening.service.js already imports createPipelineJourney FROM
// pipeline.service.js.
import * as screeningService from '../services/screening.service.js';
import {
  getRecordingsForPipeline,
  getRecordingForStream,
  resolveStreamSource,
  logRecordingView,
  canViewRecordings,
} from '../services/interviewRecording.service.js';
import { getAccessToken } from '../services/onedrive.service.js';
// Phase 4 — the no-login recording links a dossier can carry (plan §6.5).
// Minting is NOT imported here on purpose: it happens inside
// collectRecordingShareLinks() during a download, so there is exactly one place
// in the system where a public URL to someone's interview comes into existence.
import {
  listShareLinks,
  revokeShareLink,
} from '../services/recordingShare.service.js';
import { emailCandidates } from '../utils/emailMatch.js';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
// The dossier's pack-size threshold lives in config (§6.4). Imported explicitly:
// this file previously pulled in only database.js and logger.js from config/,
// and referencing a bare `config` without this line throws at REQUEST time, not
// at import time — so it 500s every download while the module still loads fine.
import config from '../config/index.js';
import { success } from '../utils/apiResponse.js';
import catchAsync from '../utils/catchAsync.js';
import AppError from '../utils/AppError.js';
import runExport from '../exports/runExport.js';
// The candidate dossier: model (aggregation + redaction) and view (HTML/XLSX/ZIP)
// are separate modules on purpose — see candidateDossier.service.js's header.
import {
  applyAttachments,
  applyRecordingShareLinks,
  applyZekoExtras,
  buildDossierModel,
  collectAttachments,
  collectRecordingShareLinks,
  collectZekoExtras,
  describeIncludedCategories,
  logDossierDownload,
} from '../services/candidateDossier.service.js';
import { packSizeNotice } from '../utils/dossierModel.js';
import { buildPack, sendPack } from '../exports/candidateDossier.export.js';
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
  const { source, on_hold_only, rejected_only, mrf_id, stuck_days, position, include_closed, owned_by } = req.query;
  const result = await pipelineService.listPipeline({
    source: source || undefined,
    onHoldOnly: on_hold_only === '1' || on_hold_only === 'true',
    rejectedOnly: rejected_only === '1' || rejected_only === 'true',
    mrfId: mrf_id ? parseInt(mrf_id, 10) : undefined,
    stuckDays: stuck_days ? parseInt(stuck_days, 10) : undefined,
    position: position || undefined,
    includeClosed: include_closed === '1' || include_closed === 'true',
    // G6 — "my candidates". Resolved server-side to the caller's own
    // identity; a client-supplied user id/name would let anyone view anyone
    // else's filtered board, which defeats the point of the check being here
    // rather than trusted from the request.
    ownedByUsername: owned_by === 'me' ? req.user.username : undefined,
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
 * GET /api/pipeline/:id/conversations
 * The real Outlook thread for this candidate (G4) — the drawer's "emails"
 * tab is otherwise synthesised client-side from pipeline events and never
 * shows what the candidate actually said. Delegates to the same
 * screeningService.getOutlookConversations() the Candidate Screening page
 * calls; one implementation, a second entry point, no forked query.
 *
 * Passes every address on file for the candidate, not just the primary one —
 * candidate_email and candidate_email_all can each already hold more than
 * one address (see emailMatch.js); a candidate with two addresses must not
 * silently see only the thread filed under one of them.
 */
export const getPipelineConversations = catchAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('Invalid pipeline id.', 400);

  const journey = await prisma.rpa_candidate_pipeline.findUnique({
    where: { id: BigInt(id) },
    select: {
      rpa_shortlisted_candidates: { select: { candidate_email: true, candidate_email_all: true } },
    },
  });
  if (!journey) throw new AppError('Pipeline journey not found.', 404);

  const sc = journey.rpa_shortlisted_candidates;
  const knownAddresses = [sc?.candidate_email, sc?.candidate_email_all].flatMap((v) => emailCandidates(v));
  if (knownAddresses.length === 0) {
    return success(res, { success: true, threads: [] }, 'No candidate email on file for this journey.');
  }

  const result = await screeningService.getOutlookConversations(knownAddresses);
  return success(res, result, 'Candidate conversations retrieved successfully');
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
 * Whether the caller asked to keep the candidate's phone and email in the pack.
 *
 * Defaults to INCLUDED (HR decision #10, 2026-09-02) — an external interviewer
 * usually needs to reach the candidate to agree a slot. Only an explicit "0" or
 * "false" removes them, so a malformed or missing parameter yields the agreed
 * default rather than silently stripping data the recruiter expected to send.
 */
function wantsContactDetails(req) {
  const raw = req.query.contact_details;
  if (raw === undefined) return true;
  return !['0', 'false', 'no'].includes(String(raw).trim().toLowerCase());
}

/**
 * GET /api/pipeline/:id/dossier
 * A JSON preview of exactly what the downloadable pack will contain, AFTER
 * redaction.
 *
 * This exists so the "what will be shared" modal can show a recruiter the real
 * post-redaction content before the file leaves the building — not a description
 * of it, the thing itself. Making the preview a different code path from the
 * download is how the two drift apart, so both call buildDossierModel().
 *
 * Not audited: looking at what a pack WOULD contain is not the same as taking
 * one out of the building. The audit is written when bytes are actually sent —
 * the same distinction getPipelineRecordings() draws against the stream route.
 */
export const getCandidateDossier = catchAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('Invalid pipeline id.', 400);

  const model = await buildDossierModel(id, {
    includeContactDetails: wantsContactDetails(req),
    generatedBy: req.user,
  });
  return success(res, model, 'Dossier preview retrieved');
});

/**
 * GET /api/pipeline/:id/dossier/download
 *   ?format=zip|html|xlsx&contact_details=0|1&resume=0|1&documents=0|1
 *   &screening_detail=0|1&screening_report=0|1&assessment_detail=0|1
 *   &recording_links=0|1
 * The pack itself.
 *
 * Access is the router's requireStaff (rank >= recruiter, so never a vendor) —
 * decision #5, and the reason no new middleware appears here. "Final
 * decision-makers" are admin-tier accounts and are already above that floor.
 *
 * Rate-limited alongside the CSV exports at the route. The row cap does NOT
 * apply: one candidate is one candidate, and refusing a dossier for being too
 * long would be refusing the feature.
 *
 * The audit is written AFTER the pack is built but BEFORE it is sent, for the
 * same reason logRecordingView() is: someone whose download fails halfway has
 * still had the file generated for them, and an audit written only on a clean
 * send would quietly miss exactly the cases worth reviewing.
 */
export const downloadCandidateDossier = catchAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('Invalid pipeline id.', 400);

  const requested = String(req.query.format || 'zip').trim().toLowerCase();
  if (!['zip', 'html', 'xlsx'].includes(requested)) {
    throw new AppError('Unsupported dossier format. Use zip, html or xlsx.', 400);
  }

  const includeContactDetails = wantsContactDetails(req);
  // Resume defaults ON; personal documents default OFF and must be asked for
  // explicitly — HR chose opt-in over exclusion (decision #11), so the deterrent
  // is that the choice is deliberate AND recorded, not that it is impossible.
  const includeResume = req.query.resume === undefined
    || !['0', 'false', 'no'].includes(String(req.query.resume).trim().toLowerCase());
  const includeDocuments = ['1', 'true', 'yes'].includes(
    String(req.query.documents ?? '').trim().toLowerCase(),
  );
  // The screening ASSESSMENT, rendered into the pack under our own redaction
  // (plan §6.7). Defaults ON: it is what HR asked for (decision #8), it carries
  // no compensation, nothing is playable from it, and it needs no link — so it
  // is the safe half of the Zeko story and the one most readers want.
  const includeScreeningDetail = req.query.screening_detail === undefined
    || !['0', 'false', 'no'].includes(String(req.query.screening_detail).trim().toLowerCase());

  // The vendor's own page, as a NO-LOGIN link. A separate decision from the
  // above, and a much bigger one — the PDF is unreachable to us (it 403s), so a
  // link is the only form it can take.
  //
  // OFF by default, like personal documents, and for a sharper reason: the page
  // that link opens is OUTSIDE this pack's redaction. A real staging report
  // (2026-09-03) states the candidate's current and expected CTC in prose, their
  // email address and an IP-derived location — all three of which §8 strips from
  // the pack itself. Defaulting it on would have made the dossier's own promise
  // ("compensation and contact details removed") false by one click, and the
  // §10.3 leak scan would not have caught it: the link text carries no CTC, the
  // page behind it does. See plan §6.6.
  const includeScreeningReport = ['1', 'true', 'yes'].includes(
    String(req.query.screening_report ?? '').trim().toLowerCase(),
  );

  // The written assessment's own breakdown — question counts, difficulty split
  // and topic scores, read out of the Evalground import. Defaults ON for the
  // same reasons the screening assessment does: it is rendered inside the pack
  // under our redaction, it carries no link and no login, and it is the whole
  // of what an interviewer asks for after seeing a bare percentage.
  const includeAssessmentDetail = req.query.assessment_detail === undefined
    || !['0', 'false', 'no'].includes(String(req.query.assessment_detail).trim().toLowerCase());

  const model = await buildDossierModel(id, {
    includeContactDetails, includeAssessmentDetail, generatedBy: req.user,
  });

  // Attachments only travel in a ZIP; the single-file formats have nowhere to
  // put them, so we do not spend Graph round trips fetching what cannot ship.
  const attachments = requested === 'zip'
    ? await collectAttachments(id, {
      includeResume, includeDocuments, candidateName: model.candidate.name,
    })
    : { files: [], notes: {}, degraded: false, documentCount: 0, totalBytes: 0 };
  applyAttachments(model, attachments, {
    includeResume, includeDocuments, supportsAttachments: requested === 'zip',
  });

  // Unlike attachments, neither of these is a file — one is rendered text, the
  // other a link — so both work in all three formats. Fetched here rather than
  // in buildDossierModel() because opening the preview must not spend Zeko round
  // trips, nor create public links, as a side effect of looking.
  const zeko = await collectZekoExtras(id, {
    includeReport: includeScreeningDetail,
    includeShareLink: includeScreeningReport,
  });
  applyZekoExtras(model, zeko, { includeScreeningDetail, includeScreeningReport });

  // Recordings as expiring, no-login links (HR decision #7, plan §6.5).
  //
  // Defaults ON, unlike the Zeko report link, and the difference is the point:
  // these links are OURS. One link per round, 14-day expiry enforced on the
  // server, revocable from the drawer the moment a recruiter changes their mind,
  // and every open written onto the candidate's timeline with the viewer's IP.
  // None of that is true of a vendor's page, which is why that one is opt-in and
  // this one is not.
  //
  // Minted here rather than in buildDossierModel() for the same reason as the
  // Zeko links: opening the preview must not create public URLs to someone's
  // interview as a side effect of looking.
  const includeRecordingLinks = req.query.recording_links === undefined
    || !['0', 'false', 'no'].includes(String(req.query.recording_links).trim().toLowerCase());
  const recordingLinks = await collectRecordingShareLinks(id, {
    include: includeRecordingLinks, user: req.user,
  });
  applyRecordingShareLinks(model, recordingLinks, { includeRecordingLinks });

  const { buffer, filename, contentType } = buildPack(model, requested, attachments.files);

  const includedCategories = describeIncludedCategories(model);
  await logDossierDownload({
    pipelineId: id,
    user: req.user,
    model,
    format: requested,
    bytes: buffer.length,
    includedCategories,
    stageKey: model.status.stage_key,
    url: req.originalUrl,
  });

  const sizeNotice = packSizeNotice(buffer.length, config.dossier.warnPackBytes);

  logger.info(`Dossier download: pipeline ${id}`, {
    user: req.user?.email,
    role: req.user?.role,
    format: requested,
    bytes: buffer.length,
    included: includedCategories.join(','),
    // Logged when it fires so a recruiter reporting "my email bounced" can be
    // matched to the download that produced the oversized pack.
    ...(sizeNotice ? { oversize: sizeNotice.message } : {}),
  });

  // X-Export-Degraded, not a dossier-specific name: that is the header
  // downloadFile() already reads for every export in the app (runExport.js:121),
  // and inventing a second spelling would mean the warning silently never fired.
  //
  // "Degraded" means something the recruiter asked for could not be fetched —
  // never that the pack is empty. The download still succeeds; the UI warns, and
  // the pack's own manifest says which item and why.
  // recordingLinks.degraded is read explicitly rather than left to the manifest
  // sweep below: applyRecordingShareLinks() sets `included = true` as soon as
  // ONE link mints, so a PARTIAL failure — two rounds linked, the third's mint
  // threw — would never satisfy `included === false` and the recruiter would be
  // told nothing, while a total failure warned them. Partial silence is the
  // worse of the two: they send a pack believing every round is watchable.
  const degraded = attachments.degraded
    || zeko.degraded
    || recordingLinks.degraded
    || model.manifest.some((m) => m.included === false && m.degraded === true);

  return sendPack(res, buffer, filename, contentType, {
    'X-Dossier-Format': requested,
    ...(degraded ? { 'X-Export-Degraded': 'true' } : {}),
    // The message travels with the response rather than being rebuilt in the
    // browser: the threshold is server config, and a second copy of it in the
    // frontend would drift the first time somebody changed the env var.
    ...(sizeNotice ? { 'X-Dossier-Oversize': String(sizeNotice.megabytes) } : {}),
  });
});

/**
 * GET /api/pipeline/:id/recordings
 * The Teams recordings linked to a candidate's rounds. Metadata only — playback
 * goes through the stream endpoint below, which is where viewing is audited.
 *
 * The route already sits behind requireStaff (rank >= recruiter), so vendors
 * cannot reach it. canViewRecordings() is asserted anyway: this is the one
 * endpoint whose whole purpose is footage of a person, and a second explicit
 * check costs nothing next to the cost of being wrong if that router-level
 * middleware is ever reordered or relaxed.
 */
export const getPipelineRecordings = catchAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('Invalid pipeline id.', 400);
  if (!canViewRecordings(req.user?.role)) {
    throw new AppError('You do not have permission to view interview recordings.', 403);
  }

  const recordings = await getRecordingsForPipeline(id);
  return success(res, recordings, 'Interview recordings retrieved');
});

/**
 * GET /api/pipeline/:id/share-links
 * What no-login recording links exist for this candidate, and what state each is in.
 *
 * Staff-only by the router's requireStaff, like every other route on this
 * router. Not audited: listing the links a recruiter minted is not the same as
 * watching a recording, and the audit that matters here is written when an
 * external viewer opens one.
 */
export const getRecordingShareLinks = catchAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('Invalid pipeline id.', 400);
  if (!canViewRecordings(req.user?.role)) {
    throw new AppError('You do not have permission to view interview recordings.', 403);
  }
  const links = await listShareLinks(id);
  return success(res, links, 'Recording share links retrieved');
});

/**
 * POST /api/pipeline/:id/share-links/:linkId/revoke
 * Withdraw one link. Refusal is immediate, not at next expiry.
 *
 * This is the control that makes decision #7 defensible: a no-login URL to a
 * video of a real person is only acceptable if the person who sent it can take
 * it back the moment they realise they should not have.
 */
export const revokeRecordingShareLink = catchAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const linkId = parseInt(req.params.linkId, 10);
  if (Number.isNaN(id) || Number.isNaN(linkId)) throw new AppError('Invalid id.', 400);
  if (!canViewRecordings(req.user?.role)) {
    throw new AppError('You do not have permission to manage recording links.', 403);
  }
  const result = await revokeShareLink(id, linkId, req.user);
  return success(res, result, result.already_revoked ? 'That link was already revoked' : 'Share link revoked');
});

/**
 * GET /api/pipeline/:id/recordings/:recordingId/stream
 * Streams the recording through the ATS.
 *
 * PROXIED RATHER THAN REDIRECTED, for three reasons:
 *   1. The Graph content URL only works with the application's own token. A
 *      redirect would either leak that token to the browser or 401.
 *   2. It keeps the permission check on every byte served, not just on the page
 *      that offered the link.
 *   3. It is what makes the audit trail real — a redirect would record that
 *      someone was given a link, not that they opened the recording.
 *
 * Range headers are passed through in both directions so the player can seek
 * without downloading a 400 MB file first.
 */
export const streamPipelineRecording = catchAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const recordingId = parseInt(req.params.recordingId, 10);
  if (Number.isNaN(id) || Number.isNaN(recordingId)) throw new AppError('Invalid id.', 400);
  if (!canViewRecordings(req.user?.role)) {
    throw new AppError('You do not have permission to view interview recordings.', 403);
  }

  const row = await getRecordingForStream(id, recordingId);

  // Audited BEFORE the bytes go out: a viewer who closes the tab mid-download
  // has still watched, and an audit written only on success would quietly miss
  // exactly the cases most worth having a record of.
  await logRecordingView(row, req.user);

  // Our archived copy when we have one, the Teams original otherwise — see
  // resolveStreamSource() for why that order matters.
  const { url, source } = resolveStreamSource(row);
  const token = await getAccessToken();
  const upstream = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      // Seeking: hand the upstream the browser's byte range untouched.
      ...(req.headers.range ? { Range: req.headers.range } : {}),
    },
  });

  if (!upstream.ok && upstream.status !== 206) {
    logger.error(`Recording stream: ${source} source returned ${upstream.status} for recording ${recordingId}.`);
    // 404 upstream means the meeting aged out (Microsoft stops serving a
    // meeting's artifacts ~60 days on), which is a different story for the user
    // than "you may not see this".
    throw new AppError(
      upstream.status === 404
        ? 'This recording is no longer available from Microsoft Teams.'
        : 'The recording could not be loaded.',
      upstream.status === 404 ? 404 : 502
    );
  }

  res.status(upstream.status === 206 ? 206 : 200);
  for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const value = upstream.headers.get(header);
    if (value) res.setHeader(header, value);
  }
  // Never cached by a shared proxy: this is footage of a named individual.
  res.setHeader('Cache-Control', 'private, no-store');

  if (!upstream.body) return res.end();
  // Web stream → Node stream. Errors mid-flight are logged rather than thrown:
  // the response is already committed, so there is no status code left to send.
  const { Readable } = await import('node:stream');
  Readable.fromWeb(upstream.body)
    .on('error', (err) => {
      logger.warn(`Recording stream: aborted for recording ${recordingId} — ${err.message}`);
      res.destroy();
    })
    .pipe(res);
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

/**
 * POST /api/pipeline/:id/zeko-report-link
 * The no-login url for one AI screening round's full report.
 *
 * POST rather than GET because the first call for a round CREATES something that
 * outlives the request — a permanent, public Zeko url for a real person's
 * screening report. Later calls return the stored one, but a reader that can
 * publish on its first use is not a GET.
 */
export const getZekoSharedReportLink = catchAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('Invalid pipeline id.', 400);

  const stageKey = req.body?.stageKey || req.query?.stageKey || null;
  const link = await pipelineService.getZekoSharedReportLink(id, { stageKey });
  return success(res, link, link.cached ? 'Report link ready' : 'Report link created');
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
