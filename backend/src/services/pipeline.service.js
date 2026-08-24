import prisma from '../config/database.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import {
  STAGE_KEYS,
  STAGE_OUTCOMES,
  FINAL_OUTCOMES,
  finalStatusLabelFor,
  shortlistStatusFor,
  isZekoStage,
  normalizeZekoRoundStage,
  VACATING_OUTCOMES,
  isMrfFilled,
} from '../config/pipelineStages.js';
import { sendStageOutcomeEmail, sendAdHocCandidateEmail, previewOutcomeEmail } from './stageNotification.service.js';
import { isSchedulableStage, mrfRoundHints, getLiveSchedule, getSchedulesByStage, OCCURRENCE_STATUS } from './interviewSchedule.service.js';
import { SCORECARD_STATUS } from './interviewScorecard.service.js';
// Pure analytics arithmetic lives in its own dependency-free module so it can
// be unit-tested — importing this service opens Redis and hangs `node --test`.
import {
  MS_PER_DAY,
  stageClockStart,
  stageDurations,
  bucketFor,
} from './pipelineAnalytics.helpers.js';
import { notify, NOTIFICATION_TYPES } from './notification.service.js';
import { reopenMrfIfUnfilled } from './mrfClosure.service.js';
import { activeVendorFor, VENDOR_LOCK_FROZEN } from '../utils/vendorLock.js';
import { notifyVendor, VENDOR_EVENTS } from './vendorNotification.service.js';
import { REAPPLICATION_COOLING_OFF_MONTHS, getReapplicationCutoff } from '../utils/rejectionCooldown.js';
import { emailCandidates } from '../utils/emailMatch.js';

// Interview booking lives in its own service; re-exported so the pipeline
// controller keeps a single service import for everything on this route.
export {
  scheduleInterviewRound,
  cancelInterviewRound,
  rescheduleInterviewRound,
  previewScheduleEmails,
  previewCancelEmails,
  previewRescheduleEmails,
  markInterviewOccurrence,
  listUnresolvedInterviews,
} from './interviewSchedule.service.js';

// Interviewer scorecard (Module 3) — dispatch + per-candidate report, re-exported
// for the same single-import convention on the pipeline route.
export {
  dispatchScorecards,
  getCandidateScorecardReport,
} from './interviewScorecard.service.js';

/**
 * pipeline.service.js — Phase 3 Module 1 stage engine.
 *
 * One row per candidate-per-MRF journey (rpa_candidate_pipeline), driven by
 * the admin-configurable rpa_pipeline_stages / rpa_stage_outcomes tables.
 * See docs/phase3/03-DEVELOPMENT-PLAN.md §M1 and docs/phase3/ZEKO-GAP-ANALYSIS.md.
 *
 * Concurrent-MRF note (Q24, resolved 2026-07-21: "once per journey"): each
 * journey already gets its own rpa_shortlisted_candidates row (unique on
 * cv_id+mrf_id — see shortlistCandidates in screening.service.js), and Zeko
 * assignment (assignCandidateToZekoJob) keys off that shortlist row's id, not
 * the raw candidate. So a candidate active on two MRFs naturally gets two
 * independent Zeko pipeline rows, two invites, two results — no extra
 * "shared vs. per-journey" branching is needed in THIS service; the existing
 * per-shortlist-row design already implements "once per journey".
 */

const serializeBigInts = (obj) => JSON.parse(JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? Number(v) : v)));

/**
 * Refuses to act on a journey that has already been closed.
 *
 * Closure (`final_outcome` + `closed_at`) is the end of the record: the
 * candidate joined, withdrew, was rejected outright, or the requisition moved
 * on. Nothing was stopping a closed journey from being advanced, given a new
 * stage outcome, or — worse — emailed again months later, because every entry
 * point only checked that the row existed.
 *
 * Exported so the offer and document services enforce the same rule; they act
 * on the same journeys through their own entry points.
 *
 * @param {{id: bigint|number, final_outcome: string|null}} pipeline
 * @param {string} action - what the caller was trying to do, for the message
 * @throws {AppError} 409 when the journey is closed
 */
export function assertJourneyOpen(pipeline, action = 'change this candidate') {
  if (pipeline?.final_outcome) {
    throw new AppError(
      `This candidate's record was closed as "${finalStatusLabelFor(pipeline.current_stage_key, pipeline.final_outcome)}". Reopen it before you ${action}.`,
      409
    );
  }
}

/**
 * Resolves the vendor a NEW journey belongs to, from the candidate's live
 * 90-day ownership lock (M6, 2026-08-12).
 *
 * Read once here and snapshotted onto the journey, which is what makes both
 * halves of the rule work:
 *  - a stale attribution from a lapsed lock never triggers vendor mail — the
 *    leak RT reported on 2026-07-22, where a keyword-search shortlist cc'd a
 *    vendor who had submitted the candidate years earlier;
 *  - a lock lapsing mid-journey does not cut the vendor off from a journey they
 *    started, because nothing re-reads it after this point.
 *
 * @param {bigint} cvIdBig
 * @returns {Promise<{ source: 'vendor', vendor_email: string }|null>}
 */
/**
 * The most recent Stage 1+ rejection for a candidate inside the re-application
 * window, or null.
 *
 * Exported because the vendor upload path needs the same question answered for
 * a different purpose: createPipelineJourney() REFUSES on a hit, while the
 * upload path only FLAGS it (see hrUpload.service.js). A vendor submitting a
 * recently-rejected candidate is not doing anything forbidden — they usually
 * have no idea — so the resume is still accepted and the recruiter is simply
 * told before they spend time on it.
 *
 * @param {bigint|number} cvId
 * @param {number} [months]
 * @returns {Promise<{current_stage_key: string, modified_at: Date}|null>}
 */
export async function findRecentRejection(cvId, months = REAPPLICATION_COOLING_OFF_MONTHS) {
  return prisma.rpa_candidate_pipeline.findFirst({
    where: {
      cv_id: BigInt(cvId),
      current_stage_status: 'rejected',
      modified_at: { gt: getReapplicationCutoff(months) },
    },
    orderBy: { modified_at: 'desc' },
    select: { current_stage_key: true, modified_at: true },
  });
}

async function vendorAttributionFor(cvIdBig) {
  const cv = await prisma.rpa_cv.findUnique({
    where: { id: cvIdBig },
    select: { VendorEmail: true, vendorName: true, lockForNinetyDays: true },
  });
  const owner = activeVendorFor(cv);
  return owner ? { source: 'vendor', vendor_email: owner.vendorEmail } : null;
}

/**
 * Board data for the Pipeline Tracker: one row per journey, grouped by stage,
 * with the filters the UI needs (position/MRF, stage, status, source/vendor,
 * aging, on-hold only).
 * @param {object} filters - { positionId, source, onHoldOnly, stuckDays }
 * @returns {Promise<{ stages: object[], columns: object[] }>}
 */
export async function listPipeline(filters = {}) {
  const stages = await prisma.rpa_pipeline_stages.findMany({
    where: { is_active: true },
    orderBy: { sort_order: 'asc' },
  });

  const where = {};
  if (filters.source) where.source = filters.source;
  if (filters.onHoldOnly) where.current_stage_status = 'hold';
  if (filters.mrfId) where.mrf_id = BigInt(filters.mrfId);
  // A closed journey is finished work. setFinalOutcome's own notification says
  // "the card is about to leave the board" — it never did, because nothing
  // filtered on final_outcome, so finished candidates piled up in their last
  // column forever. Hidden by default; `includeClosed` brings them back for
  // anyone who wants the history.
  if (!filters.includeClosed) where.final_outcome = null;

  const journeys = await prisma.rpa_candidate_pipeline.findMany({
    where,
    include: {
      rpa_shortlisted_candidates: { include: { mrf: true } },
      rpa_pipeline_stage_events: { orderBy: { created_at: 'desc' }, take: 1 },
    },
    orderBy: { modified_at: 'desc' },
  });

  // "2 MRFs" concurrency badge (Q13): group active journeys by cv_id.
  const activeByCv = new Map();
  for (const j of journeys) {
    if (j.current_stage_status === 'in_progress' || j.current_stage_status === 'hold') {
      const key = String(j.cv_id);
      activeByCv.set(key, (activeByCv.get(key) || 0) + 1);
    }
  }

  // Real Zeko-score presence for in-progress Zeko-stage cards only — drives
  // the "ready for decision" vs. "awaiting interview" card chip honestly,
  // without fabricating a richer lifecycle than the data actually supports.
  const zekoCvIds = journeys
    .filter((j) => (j.current_stage_key === 'zeko_hr' || j.current_stage_key === 'zeko_fn') && j.current_stage_status === 'in_progress' && j.cv_id)
    .map((j) => j.cv_id);
  const zekoScoredCvIds = new Set();
  if (zekoCvIds.length > 0) {
    const scored = await prisma.rpa_cv.findMany({
      where: {
        id: { in: zekoCvIds },
        OR: [{ ZekoInterviewScore: { not: null } }, { ZekoCodingScore: { not: null } }, { ZekoCommunicationScore: { not: null } }],
      },
      select: { id: true },
    });
    scored.forEach((cv) => zekoScoredCvIds.add(String(cv.id)));
  }

  // Real "invited" state for in-progress Zeko cards — from the existing
  // assignCandidateToZekoJob/scheduleInterview flow (Candidate Screening),
  // keyed by shortlist_id (rpa_zeko_candidate_pipeline.candidate_id).
  // Matched per ROUND ('hr' vs 'functional'): a candidate invited for HR
  // screening must not read as already invited once they reach functional.
  const zekoJourneys = journeys.filter(
    (j) => isZekoStage(j.current_stage_key) && j.current_stage_status === 'in_progress' && j.shortlist_id
  );
  // Set of `${shortlist_id}:${round}` pairs that have a real invite sent.
  const invitedRoundKeys = new Set();
  if (zekoJourneys.length > 0) {
    const invited = await prisma.rpa_zeko_candidate_pipeline.findMany({
      where: {
        candidate_id: { in: zekoJourneys.map((j) => j.shortlist_id) },
        stage: { in: [...new Set(zekoJourneys.map((j) => normalizeZekoRoundStage(j.current_stage_key)))] },
        status: { not: 'cancelled' },
        link_sent_at: { not: null },
      },
      select: { candidate_id: true, stage: true },
    });
    invited.forEach((row) => invitedRoundKeys.add(`${row.candidate_id}:${row.stage}`));
  }

  // Real "scheduled" state for in-progress technical-round cards (tech1/tech2) —
  // a live booking in rpa_interview_schedule for the candidate's current stage.
  // Keyed by pipeline id + stage_key since that table references the pipeline
  // journey directly (unlike the Zeko table, keyed by shortlist_id).
  const scheduledJourneys = journeys.filter(
    (j) => isSchedulableStage(j.current_stage_key) && j.current_stage_status === 'in_progress'
  );
  const scheduledKeys = new Set();
  if (scheduledJourneys.length > 0) {
    const booked = await prisma.rpa_interview_schedule.findMany({
      where: {
        pipeline_id: { in: scheduledJourneys.map((j) => j.id) },
        status: { not: 'cancelled' },
      },
      select: { pipeline_id: true, stage_key: true },
    });
    booked.forEach((row) => scheduledKeys.add(`${row.pipeline_id}:${row.stage_key}`));
  }

  // Real Evalground-result presence for in-progress Assessment-stage cards
  // (Phase 3 M2) — drives the "Evalground test pending" board badge honestly,
  // same pattern as zekoScoredCvIds above. Keyed by pipeline_id (not cv_id):
  // a candidate with two concurrent journeys only clears "pending" on the
  // journey the import actually matched (Q24 concurrent-journey rule).
  const assessmentPipelineIds = journeys
    .filter((j) => j.current_stage_key === 'assessment' && j.current_stage_status === 'in_progress')
    .map((j) => j.id);
  const assessmentResultPipelineIds = new Set();
  if (assessmentPipelineIds.length > 0) {
    const results = await prisma.rpa_assessment_results.findMany({
      where: { pipeline_id: { in: assessmentPipelineIds }, status: { in: ['matched', 'score_overwritten'] } },
      select: { pipeline_id: true },
    });
    results.forEach((r) => assessmentResultPipelineIds.add(String(r.pipeline_id)));
  }

  const now = Date.now();
  const cards = journeys.map((j) => {
    const lastEvent = j.rpa_pipeline_stage_events[0];
    const daysInStage = lastEvent
      ? Math.floor((now - new Date(lastEvent.created_at).getTime()) / (1000 * 60 * 60 * 24))
      : Math.floor((now - new Date(j.modified_at).getTime()) / (1000 * 60 * 60 * 24));

    const onZekoStage = isZekoStage(j.current_stage_key);
    const readyForDecision = onZekoStage && j.current_stage_status === 'in_progress' && zekoScoredCvIds.has(String(j.cv_id));
    const invited = onZekoStage
      && j.current_stage_status === 'in_progress'
      && invitedRoundKeys.has(`${j.shortlist_id}:${normalizeZekoRoundStage(j.current_stage_key)}`);
    // Technical rounds: a live booking means the card is "Scheduled".
    const scheduled = isSchedulableStage(j.current_stage_key)
      && j.current_stage_status === 'in_progress'
      && scheduledKeys.has(`${j.id}:${j.current_stage_key}`);
    const assessmentPending = j.current_stage_key === 'assessment' && j.current_stage_status === 'in_progress' && !assessmentResultPipelineIds.has(String(j.id));

    return {
      id: Number(j.id),
      cv_id: j.cv_id ? Number(j.cv_id) : null,
      mrf_id: j.mrf_id ? Number(j.mrf_id) : null,
      candidate_name: j.rpa_shortlisted_candidates?.candidate_name || null,
      candidate_email: j.rpa_shortlisted_candidates?.candidate_email || null,
      position: j.rpa_shortlisted_candidates?.mrf?.position_hiring_for
        || j.rpa_shortlisted_candidates?.position_applied
        || null,
      current_stage_key: j.current_stage_key,
      current_stage_status: j.current_stage_status,
      ready_for_decision: readyForDecision,
      invited,
      scheduled,
      assessment_pending: assessmentPending,
      final_outcome: j.final_outcome,
      // The requisition this candidate is running against has already been
      // filled. Free to compute — the MRF is loaded with the journey above —
      // and it is the only signal that a candidate is chasing a role that no
      // longer has an opening. Keyword shortlists carry no MRF, so they are
      // never flagged.
      mrf_closed: isMrfFilled(j.rpa_shortlisted_candidates?.mrf),
      source: j.source,
      vendor_email: j.vendor_email,
      is_paused: j.is_paused,
      days_in_stage: daysInStage,
      concurrent_journeys: activeByCv.get(String(j.cv_id)) || 1,
      last_event_at: lastEvent?.created_at || j.modified_at,
    };
  });

  let filtered = filters.stuckDays
    ? cards.filter((c) => c.days_in_stage >= Number(filters.stuckDays))
    : cards;
  if (filters.position) {
    filtered = filtered.filter((c) => c.position === filters.position);
  }

  const columns = stages.map((s) => ({
    stage_key: s.stage_key,
    label: s.label,
    is_optional: s.is_optional,
    stage_type: s.stage_type,
    cards: filtered.filter((c) => c.current_stage_key === s.stage_key),
  }));

  const positions = [...new Set(cards.map((c) => c.position).filter(Boolean))].sort();

  return {
    stages: serializeBigInts(stages),
    columns: serializeBigInts(columns),
    positions,
    total: cards.length,
    filteredTotal: filtered.length,
  };
}

/**
 * Full detail for one journey: the row, its outcome sets for the current
 * stage, its event timeline, and its emails — feeds the per-round drawer.
 * @param {number} pipelineId
 */
export async function getPipelineDetail(pipelineId) {
  const pipeline = await prisma.rpa_candidate_pipeline.findUnique({
    where: { id: BigInt(pipelineId) },
    include: {
      rpa_shortlisted_candidates: { include: { mrf: true } },
      rpa_pipeline_stage_events: {
        orderBy: { created_at: 'asc' },
        include: { rpa_outcome_reasons: true, rpa_users: { select: { id: true, username: true } } },
      },
    },
  });
  if (!pipeline) {
    throw new AppError('Pipeline journey not found.', 404);
  }

  const outcomes = await prisma.rpa_stage_outcomes.findMany({
    where: { stage_key: pipeline.current_stage_key, is_active: true },
    orderBy: { sort_order: 'asc' },
  });

  const reasons = await prisma.rpa_outcome_reasons.findMany({
    where: {
      is_active: true,
      OR: [{ stage_key: pipeline.current_stage_key }, { stage_key: null }],
    },
    orderBy: { sort_order: 'asc' },
  });

  // Real Zeko scores + resume link (no mock) — one lookup when there's a cv_id.
  // This is a fallback only: rpa_cv holds ONE set of Zeko score columns per
  // CANDIDATE, not per round, so a candidate who has completed both Zeko
  // rounds would show whichever round synced last here. The round-scoped
  // rpa_zeko_interview_results lookup below overrides this with the correct
  // per-round numbers whenever one exists.
  let zekoScores = null;
  let cvFileUrl = null;
  if (pipeline.cv_id) {
    const cv = await prisma.rpa_cv.findUnique({
      where: { id: pipeline.cv_id },
      select: { ZekoInterviewScore: true, ZekoCodingScore: true, ZekoCommunicationScore: true, cvFileUrl: true },
    });
    if (cv?.ZekoInterviewScore != null || cv?.ZekoCodingScore != null || cv?.ZekoCommunicationScore != null) {
      zekoScores = cv;
    }
    cvFileUrl = cv?.cvFileUrl || null;
  }

  // Screening context (v8+ prototype direction): shortlisting happens on
  // Candidate Screening, not as a pipeline stage — shown as a persistent,
  // read-only header line in the drawer instead of a stage-1 "Shortlisted"
  // column. Only real fields — no invented JD-match score (no such field
  // exists anywhere in the schema; the prototype's jdMatch is mock-only).
  const screening = pipeline.rpa_shortlisted_candidates
    ? {
        shortlistedAt: pipeline.rpa_shortlisted_candidates.shortlisted_at,
        shortlistedBy: pipeline.rpa_shortlisted_candidates.shortlisted_by,
        notes: pipeline.rpa_shortlisted_candidates.recruiter_notes,
        noticeEmailSent: !!pipeline.rpa_shortlisted_candidates.email_sent,
        noticeEmailSentAt: pipeline.rpa_shortlisted_candidates.email_sent_at,
      }
    : null;

  // Real Zeko invite/schedule status for whichever Zeko round the candidate is
  // currently on — from the same assignCandidateToZekoJob/scheduleInterview
  // flow Candidate Screening uses (screening.service.js). Both rounds draw on
  // the same Zeko job catalog and are told apart by the row's `stage`
  // ('hr' vs 'functional'), so functional screening reads its own row and can
  // never pick up the HR round's schedule.
  let zekoHrPipeline = null;
  let zekoReportLink = null;
  if (isZekoStage(pipeline.current_stage_key) && pipeline.shortlist_id) {
    zekoHrPipeline = await prisma.rpa_zeko_candidate_pipeline.findFirst({
      where: {
        candidate_id: pipeline.shortlist_id,
        stage: normalizeZekoRoundStage(pipeline.current_stage_key),
        status: { not: 'cancelled' },
      },
      orderBy: { created_at: 'desc' },
    });

    // reportLink lives in a separate table, keyed by Zeko's own external
    // interview id (zekoHrPipeline.pipeline_id) — NOT this journey's id.
    // fetchInterviewResults() (zeko.service.js) writes both under that same
    // external id when the hourly poll syncs a completed interview's score.
    //
    // That interview id is the JOB's interview, shared by EVERY candidate
    // booked against that job, so rpa_zeko_interview_results holds one row per
    // candidate under the same pipeline_id. Filtering on pipeline_id alone
    // therefore returned whichever candidate happened to sync last — showing a
    // stranger's score and, worse, a "View full report on Zeko" link opening
    // another candidate's report (RT, 2026-08-24: Haris M's HR round rendered
    // Samarth Tiwari's 0 and report link). The candidate's own address is what
    // identifies their row, matched the same way fetchInterviewResults() picks
    // their entry out of the interview's roster.
    if (zekoHrPipeline) {
      const wantedEmails = emailCandidates(
        zekoHrPipeline.candidate_email || pipeline.rpa_shortlisted_candidates?.candidate_email
      );
      // No address to match on means we cannot prove a row is this candidate's,
      // so the round honestly reports no result rather than guessing.
      const zekoResult = wantedEmails.length
        ? await prisma.rpa_zeko_interview_results.findFirst({
            where: {
              pipeline_id: zekoHrPipeline.pipeline_id,
              OR: wantedEmails.map((email) => ({ candidate_email: { equals: email, mode: 'insensitive' } })),
            },
            orderBy: { created_at: 'desc' },
          })
        : null;
      zekoReportLink = zekoResult?.reportlink || null;

      // Prefer this round's own synced result over the rpa_cv fallback above
      // — this row is keyed by THIS round's external interview id, so it
      // can't be clobbered by the other Zeko round syncing later.
      if (zekoResult && (zekoResult.scores_overallscore != null || zekoResult.scores_technicalscore != null || zekoResult.scores_communicationscore != null)) {
        zekoScores = {
          ZekoInterviewScore: zekoResult.scores_overallscore,
          ZekoCodingScore: zekoResult.scores_technicalscore,
          ZekoCommunicationScore: zekoResult.scores_communicationscore,
        };
      }
    }
  }

  // Scheduled interview rounds: the MRF names who interviews and their
  // preferred window — free text shown to the recruiter as hints — plus the
  // live booking, if one exists.
  //
  // Bookings for EVERY round are loaded, not just the current one: a finished
  // tech1 still needs its schedule when the candidate has moved on to tech2,
  // otherwise its column reads "Not scheduled yet". `interviewSchedule` stays
  // as the current round's row so existing callers are unaffected.
  const interviewSchedules = await getSchedulesByStage(pipeline.id);
  let interviewSchedule = null;
  let mrfInterviewHints = null;
  if (isSchedulableStage(pipeline.current_stage_key)) {
    mrfInterviewHints = mrfRoundHints(pipeline.rpa_shortlisted_candidates?.mrf, pipeline.current_stage_key);
    interviewSchedule = interviewSchedules[pipeline.current_stage_key] || null;
  }

  // The offer record drives the Offer round's own action bar (request approval →
  // approve → record shared → decision). Always loaded rather than gated on the
  // current stage, so a closed journey's drawer still shows what was offered.
  const offer = await prisma.rpa_offers.findUnique({ where: { pipeline_id: pipeline.id } });

  return serializeBigInts({
    pipeline,
    currentStageOutcomes: outcomes,
    reasons,
    zekoScores,
    cvFileUrl,
    screening,
    zekoHrPipeline,
    zekoReportLink,
    interviewSchedule,
    interviewSchedules,
    mrfInterviewHints,
    offer,
  });
}

/**
 * Compiles (without sending) the outcome email a given outcome on the
 * candidate's CURRENT stage would produce — feeds the drawer's "Record
 * round outcome" modal so the recruiter edits the exact text before send,
 * matching CandidatePipelinePrototype.jsx's decision-modal pattern.
 * @param {number} pipelineId
 * @param {string} outcomeKey
 * @returns {Promise<{ subject: string, body: string, wrapper: object, templateId: number|null, templateName: string|null }>}
 *   `body` is the editable fragment; `wrapper` is the branded header/footer the
 *   modal renders around it (see emailLayout.service.js).
 */
export async function getOutcomePreview(pipelineId, outcomeKey) {
  const pipeline = await prisma.rpa_candidate_pipeline.findUnique({
    where: { id: BigInt(pipelineId) },
    include: { rpa_shortlisted_candidates: { include: { mrf: true } } },
  });
  if (!pipeline) {
    throw new AppError('Pipeline journey not found.', 404);
  }
  const stageRow = await prisma.rpa_pipeline_stages.findUnique({ where: { stage_key: pipeline.current_stage_key } });
  return previewOutcomeEmail({
    stageKey: pipeline.current_stage_key,
    outcomeKey,
    stageLabel: stageRow?.label || pipeline.current_stage_key,
    candidate: { name: pipeline.rpa_shortlisted_candidates?.candidate_name },
    positionLabel: pipeline.rpa_shortlisted_candidates?.mrf?.position_hiring_for
      || pipeline.rpa_shortlisted_candidates?.position_applied
      || 'the role',
  });
}

/**
 * Records an outcome on the candidate's CURRENT stage: writes the event,
 * writes back to the legacy rpa_cv.FinalStatus / rpa_shortlisted_candidates.
 * pipeline_status columns for backward compatibility, then dispatches the
 * outcome email AFTER commit (send failure never rolls back state — result
 * is recorded on the event after the fact via a best-effort update).
 *
 * Approve auto-advances to the next active stage in the SAME transaction —
 * matches CandidatePipelinePrototype.jsx's "Approve round" button, which
 * both records the decision and moves the candidate forward in one action;
 * there is no separate "Advance to next stage" step anymore. Approving on
 * the terminal stage (no next stage) just marks 'approved' with nothing to
 * advance to — not an error.
 *
 * Reject/Hold require a reason (mandatory — L5/Q19); "Other" reasons store
 * the typed text and the UI must render that text, never the literal word
 * "Other" (Q19, RT 2026-07-14).
 *
 * @param {number} pipelineId
 * @param {object} params
 * @param {string} params.outcomeKey - a rpa_stage_outcomes.outcome_key for the current stage
 * @param {number|null} [params.reasonId] - required for reject/hold unless otherText given
 * @param {string|null} [params.otherText] - free-text reason when "Other reasons" is picked
 * @param {string|null} [params.notes]
 * @param {string|null} [params.emailSubject] - recruiter-edited subject from the preview step; falls back to server compile if omitted
 * @param {string|null} [params.emailBody] - recruiter-edited body from the preview step; falls back to server compile if omitted
 * @param {boolean} [params.skipOptionalNext] - when approving and the resolved next stage is
 *   optional, land two stages ahead instead of one and log the bypassed stage as a 'skip'
 *   event (02-BUSINESS-DESIGN.md §2 rule 2) rather than 'entered'. Ignored otherwise.
 * @param {string|null} [params.expectedStageKey] - the stage the CLIENT was displaying when the
 *   recruiter decided. Guards against a stale tab; see the note below. Optional for backwards
 *   compatibility with direct service callers (jobs, scripts, tests).
 * @param {number} params.actedBy - rpa_users.id
 * @returns {Promise<object>} the updated pipeline row + event
 */
export async function setStageOutcome(pipelineId, { outcomeKey, reasonId = null, otherText = null, notes = null, emailSubject = null, emailBody = null, skipOptionalNext = false, expectedStageKey = null, actedBy }) {
  const pipeline = await prisma.rpa_candidate_pipeline.findUnique({
    where: { id: BigInt(pipelineId) },
    include: { rpa_shortlisted_candidates: true },
  });
  if (!pipeline) {
    throw new AppError('Pipeline journey not found.', 404);
  }
  assertJourneyOpen(pipeline, 'record another outcome');

  // STALE-TAB GUARD (defect D3, 2026-08-20).
  //
  // Distinct from the conditional claim further down, and BOTH are needed —
  // they close different windows:
  //
  //   - The claim below compares the row against what THIS REQUEST read a few
  //     milliseconds earlier. That catches two requests interleaving inside the
  //     transaction window (PIPE-03), and nothing else.
  //   - This check compares the row against what the USER'S SCREEN was showing.
  //     That catches a tab left open while someone else acted — seconds or
  //     minutes, not milliseconds.
  //
  // Without this, a stale tab's approval was accepted with 200 and advanced the
  // candidate a SECOND time: zeko_hr -> assessment (tab A), then
  // assessment -> zeko_fn (tab B, still displaying zeko_hr). A stage was skipped
  // with nobody deciding to skip it, two outcome emails went to the candidate,
  // and the audit trail recorded an HR-screening decision that advanced past a
  // stage the candidate never entered. The claim could not see it: by the time
  // tab B arrived nothing was racing, and its request was internally consistent.
  //
  // The stage has to come from the CLIENT for this to mean anything — deriving
  // it from the database is what made the original guard blind to staleness.
  // scheduleInterview() already takes stage_key from the client for the same
  // reason (SCHED-03).
  //
  // Optional by design: omitting it keeps the old behaviour for direct service
  // callers. Only the HTTP path (a real browser with a real screen) sends it.
  if (expectedStageKey && expectedStageKey !== pipeline.current_stage_key) {
    throw new AppError(
      'Someone else moved this candidate while you were deciding. Reopen the candidate to see where they are now.',
      409
    );
  }

  const outcome = await prisma.rpa_stage_outcomes.findUnique({
    where: { stage_key_outcome_key: { stage_key: pipeline.current_stage_key, outcome_key: outcomeKey } },
  });
  if (!outcome || !outcome.is_active) {
    throw new AppError(`Outcome "${outcomeKey}" is not configured for stage "${pipeline.current_stage_key}".`, 400);
  }

  const isRejectOrHold = outcomeKey === STAGE_OUTCOMES.REJECTED || outcomeKey === STAGE_OUTCOMES.HOLD;
  if (isRejectOrHold && !reasonId && !otherText) {
    throw new AppError('A reason is required for Reject/Hold outcomes.', 400);
  }

  let reasonRow = null;
  if (reasonId) {
    reasonRow = await prisma.rpa_outcome_reasons.findUnique({ where: { id: BigInt(reasonId) } });
    if (reasonRow?.is_other && !otherText) {
      throw new AppError('Free-text reason is required when "Other reasons" is selected.', 400);
    }
  }

  const statusLabel = finalStatusLabelFor(pipeline.current_stage_key, outcomeKey);
  const nextStageStatus = outcomeKey === STAGE_OUTCOMES.APPROVED
    ? 'approved'
    : outcomeKey === STAGE_OUTCOMES.REJECTED
      ? 'rejected'
      : outcomeKey === STAGE_OUTCOMES.HOLD
        ? 'hold'
        : 'in_progress'; // future_prospect and similar non-terminal-non-advance outcomes

  // Approve auto-advances: resolve the next active stage now so the outcome
  // event and the stage move commit together. When that next stage is
  // optional and the recruiter chose to skip it up front (Q: Tech3 vs HR
  // Round at Tech2-approval time), land one stage further and log the
  // bypassed stage as a 'skip' event instead of 'entered' — same audit trail
  // advanceStage(skip:true) already produces for a candidate skipping from
  // an optional stage they're already sitting on.
  let nextStage = null;
  let skippedStage = null;
  if (outcomeKey === STAGE_OUTCOMES.APPROVED) {
    const stages = await prisma.rpa_pipeline_stages.findMany({ where: { is_active: true }, orderBy: { sort_order: 'asc' } });
    const currentIdx = stages.findIndex((s) => s.stage_key === pipeline.current_stage_key);
    // currentIdx === -1 means the candidate is sitting on a stage that is no
    // longer active — an admin deactivated it underneath them. Silently
    // recording "approved" with nowhere to go would strand the journey with no
    // sign anything was wrong, so it is an explicit error instead.
    if (currentIdx === -1) {
      throw new AppError(
        `Stage "${pipeline.current_stage_key}" is no longer active, so this candidate cannot be advanced. Re-activate the stage, or move the candidate first.`,
        409
      );
    }
    if (currentIdx < stages.length - 1) {
      nextStage = stages[currentIdx + 1];
      if (skipOptionalNext && nextStage.is_optional && currentIdx + 2 < stages.length) {
        skippedStage = nextStage;
        nextStage = stages[currentIdx + 2];
      }
    }
  }

  const pipelineUpdateData = nextStage
    ? { current_stage_key: nextStage.stage_key, current_stage_status: 'in_progress', modified_at: new Date() }
    : { current_stage_status: nextStageStatus, modified_at: new Date() };

  // Single transaction: update pipeline row + insert outcome event (+ the
  // "entered next stage" event, if approve auto-advanced) + legacy write-backs.
  //
  // The pipeline update is CONDITIONAL on current_stage_key still being what we
  // read at the top. Everything above — the outcome lookup, the next-stage
  // resolution — was computed from that read, so if another recruiter recorded
  // an outcome in the meantime this transaction would advance the candidate a
  // second time and send a second email. updateMany returns a count instead of
  // throwing on no-match, which is what lets us detect that and 409 below.
  // Interactive rather than array form: the claim can fail, and when it does the
  // outcome/entered events must roll back with it. Throwing inside the callback
  // is what aborts the whole thing — an array transaction has no way to.
  const { updatedPipeline, event } = await prisma.$transaction(async (tx) => {
    const claim = await tx.rpa_candidate_pipeline.updateMany({
      where: { id: pipeline.id, current_stage_key: pipeline.current_stage_key, final_outcome: null },
      data: pipelineUpdateData,
    });
    if (claim.count !== 1) {
      throw new AppError(
        'Someone else moved this candidate while you were deciding. Reopen the candidate to see where they are now.',
        409
      );
    }

    const outcomeEvent = await tx.rpa_pipeline_stage_events.create({
      data: {
        pipeline_id: pipeline.id,
        stage_key: pipeline.current_stage_key,
        event_type: 'outcome',
        outcome: outcomeKey,
        reason_id: reasonId ? BigInt(reasonId) : null,
        reason_text: reasonRow?.is_other ? otherText : null,
        status_label: statusLabel,
        notes,
        acted_by: actedBy || null,
      },
    });

    if (nextStage) {
      await tx.rpa_pipeline_stage_events.create({
        data: {
          pipeline_id: pipeline.id,
          stage_key: nextStage.stage_key,
          event_type: skippedStage ? 'skip' : 'entered',
          notes: skippedStage ? `Skipped optional stage ${skippedStage.stage_key} (${skippedStage.label})` : null,
          acted_by: actedBy || null,
        },
      });
    }

    // updateMany returns a count, not the row — re-read inside the transaction
    // so callers still get the post-update row they had before.
    const row = await tx.rpa_candidate_pipeline.findUnique({ where: { id: pipeline.id } });
    return { updatedPipeline: row, event: outcomeEvent };
  });

  // Legacy write-back — best effort, never blocks the transaction above.
  try {
    if (pipeline.cv_id) {
      await prisma.$executeRaw`UPDATE rpa_cv SET "FinalStatus" = ${statusLabel} WHERE id = ${pipeline.cv_id};`;
    }
    if (pipeline.shortlist_id) {
      const legacyStatus = shortlistStatusFor(outcomeKey);
      if (legacyStatus) {
        await prisma.rpa_shortlisted_candidates.update({
          where: { id: pipeline.shortlist_id },
          data: { pipeline_status: legacyStatus },
        });
      }
    }
  } catch (err) {
    logger.error(`Legacy write-back failed for pipeline ${pipelineId}: ${err.message}`);
  }

  // Email dispatched AFTER commit — failure never rolls back the state above.
  // Sends the recruiter-edited subject/body from the preview step verbatim
  // when provided; falls back to a fresh server-side compile otherwise.
  const stageRow = await prisma.rpa_pipeline_stages.findUnique({ where: { stage_key: pipeline.current_stage_key } });
  const emailResult = await sendStageOutcomeEmail({
    pipelineRow: updatedPipeline,
    stageKey: pipeline.current_stage_key,
    outcomeKey,
    stageLabel: stageRow?.label || pipeline.current_stage_key,
    candidate: {
      name: pipeline.rpa_shortlisted_candidates?.candidate_name,
      email: pipeline.rpa_shortlisted_candidates?.candidate_email,
    },
    positionLabel: pipeline.rpa_shortlisted_candidates?.position_applied || 'the role',
    subjectOverride: emailSubject,
    bodyOverride: emailBody,
  });

  // The vendor half of Q5 — a separate generated status line, never the
  // candidate's body (which may be recruiter-edited). Suppressed at the
  // Documents stage and reduced to a milestone at Offer, inside notifyVendor().
  await notifyVendor({
    pipelineRow: updatedPipeline,
    candidate: { name: pipeline.rpa_shortlisted_candidates?.candidate_name },
    eventType: VENDOR_EVENTS.STAGE_OUTCOME,
    stageKey: pipeline.current_stage_key,
    stageLabel: stageRow?.label || pipeline.current_stage_key,
    outcomeKey,
    positionLabel: pipeline.rpa_shortlisted_candidates?.position_applied || 'the role',
  });

  await prisma.rpa_pipeline_stage_events.update({
    where: { id: event.id },
    data: { email_sent: emailResult.sent, email_error: emailResult.error },
  });

  if (nextStage) {
    logger.info(
      skippedStage
        ? `Pipeline ${pipelineId} approved ${pipeline.current_stage_key}, skipped optional ${skippedStage.stage_key}, and advanced to ${nextStage.stage_key}.`
        : `Pipeline ${pipelineId} approved and auto-advanced ${pipeline.current_stage_key} -> ${nextStage.stage_key}.`
    );
  }

  // In-app notification. The actor already knows what they just did, so they
  // are excluded; everyone else on the team sees the decision land.
  const candidateName = pipeline.rpa_shortlisted_candidates?.candidate_name || 'A candidate';
  const outcomeWord = outcomeKey === 'approved' ? 'approved' : outcomeKey === 'rejected' ? 'rejected' : outcomeKey === 'hold' ? 'put on hold' : outcomeKey;
  await notify({
    type: NOTIFICATION_TYPES.PIPELINE_OUTCOME,
    title: `${stageRow?.label || pipeline.current_stage_key} — ${outcomeWord}`,
    description: `${candidateName}${nextStage ? ` · now at ${nextStage.label}` : ''}`,
    pipelineId: pipeline.id,
    meta: { stage_key: pipeline.current_stage_key, outcome_key: outcomeKey },
    excludeUserId: actedBy || null,
  });

  return serializeBigInts({ pipeline: updatedPipeline, event: { ...event, email_sent: emailResult.sent, email_error: emailResult.error } });
}

/**
 * Moves an "advance" outcome's journey to the next active stage in sort order.
 * Optional stages (Tech 3, Client Interview) can be skipped explicitly — the
 * skip is logged with who/when (02-BUSINESS-DESIGN.md §2 rule 2).
 * @param {number} pipelineId
 * @param {object} params
 * @param {boolean} [params.skip] - true if advancing past an optional stage without running it
 * @param {number} params.actedBy
 */
export async function advanceStage(pipelineId, { skip = false, actedBy } = {}) {
  const pipeline = await prisma.rpa_candidate_pipeline.findUnique({ where: { id: BigInt(pipelineId) } });
  if (!pipeline) {
    throw new AppError('Pipeline journey not found.', 404);
  }
  assertJourneyOpen(pipeline, 'move them to the next stage');

  const stages = await prisma.rpa_pipeline_stages.findMany({
    where: { is_active: true },
    orderBy: { sort_order: 'asc' },
  });
  const currentIdx = stages.findIndex((s) => s.stage_key === pipeline.current_stage_key);
  // Separate messages: "already at the end" is a normal thing to try, whereas a
  // stage that vanished from under the candidate is a configuration problem.
  if (currentIdx === -1) {
    throw new AppError(
      `Stage "${pipeline.current_stage_key}" is no longer active, so this candidate cannot be advanced. Re-activate the stage, or move the candidate first.`,
      409
    );
  }
  if (currentIdx === stages.length - 1) {
    throw new AppError('No next stage available (already at the final stage).', 400);
  }

  const nextStage = stages[currentIdx + 1];

  // Same claim-then-act guard as setStageOutcome: two people advancing the same
  // candidate at once must not skip a stage between them.
  const updatedPipeline = await prisma.$transaction(async (tx) => {
    const claim = await tx.rpa_candidate_pipeline.updateMany({
      where: { id: pipeline.id, current_stage_key: pipeline.current_stage_key, final_outcome: null },
      data: { current_stage_key: nextStage.stage_key, current_stage_status: 'in_progress', modified_at: new Date() },
    });
    if (claim.count !== 1) {
      throw new AppError(
        'Someone else moved this candidate while you were deciding. Reopen the candidate to see where they are now.',
        409
      );
    }
    await tx.rpa_pipeline_stage_events.create({
      data: {
        pipeline_id: pipeline.id,
        stage_key: nextStage.stage_key,
        event_type: skip ? 'skip' : 'entered',
        notes: skip ? `Skipped optional stage from ${pipeline.current_stage_key}` : null,
        acted_by: actedBy || null,
      },
    });
    return tx.rpa_candidate_pipeline.findUnique({ where: { id: pipeline.id } });
  });

  logger.info(`Pipeline ${pipelineId} advanced ${pipeline.current_stage_key} -> ${nextStage.stage_key} (skip=${skip}).`);
  return serializeBigInts(updatedPipeline);
}

/**
 * Sets the closure/final outcome (Q12 — 8 closure statuses) and closes the
 * journey. Auto-close 90 days after Joined (unless Joined-and-Left first) is
 * a separate cron job (M5), not this function.
 * @param {number} pipelineId
 * @param {object} params
 * @param {string} params.finalOutcomeKey - one of FINAL_OUTCOMES
 * @param {string|null} [params.notes]
 * @param {number} params.actedBy
 * @param {boolean} [params.notifyCandidate=true] - false for machine-driven
 *   closures (jobs/offerSweep.js's 90-day auto-close). A cron tidying up a
 *   record months later must never be the thing that emails a candidate; a
 *   human recording a closure decision still can.
 */
export async function setFinalOutcome(pipelineId, { finalOutcomeKey, notes = null, actedBy, notifyCandidate = true }) {
  // The key was previously written through unvalidated: finalStatusLabelFor()
  // falls through to `${stageLabel} ${outcomeKey}` for anything it doesn't
  // recognise, so a typo — or a hand-rolled API call — landed arbitrary text in
  // final_outcome AND in the legacy rpa_cv.FinalStatus the vendor dashboard
  // classifies on.
  const ALLOWED_FINAL_OUTCOMES = Object.values(FINAL_OUTCOMES);
  if (!ALLOWED_FINAL_OUTCOMES.includes(finalOutcomeKey)) {
    throw new AppError(
      `"${finalOutcomeKey}" is not a valid closure outcome. Expected one of: ${ALLOWED_FINAL_OUTCOMES.join(', ')}.`,
      400
    );
  }

  const pipeline = await prisma.rpa_candidate_pipeline.findUnique({
    where: { id: BigInt(pipelineId) },
    include: { rpa_shortlisted_candidates: true },
  });
  if (!pipeline) {
    throw new AppError('Pipeline journey not found.', 404);
  }
  assertJourneyOpen(pipeline, 'close it again');

  const statusLabel = finalStatusLabelFor(pipeline.current_stage_key, finalOutcomeKey);

  const { updatedPipeline, event } = await prisma.$transaction(async (tx) => {
    // Claim the closure: `final_outcome: null` in the filter means a second
    // closure racing this one (a recruiter and the auto-close sweep on the same
    // record, say) loses rather than overwriting the first verdict.
    const claim = await tx.rpa_candidate_pipeline.updateMany({
      where: { id: pipeline.id, final_outcome: null },
      data: { final_outcome: finalOutcomeKey, closed_at: new Date(), modified_at: new Date() },
    });
    if (claim.count !== 1) {
      throw new AppError('This candidate\'s record has already been closed.', 409);
    }
    const closureEvent = await tx.rpa_pipeline_stage_events.create({
      data: {
        pipeline_id: pipeline.id,
        stage_key: pipeline.current_stage_key,
        event_type: 'outcome',
        outcome: finalOutcomeKey,
        status_label: statusLabel,
        notes,
        acted_by: actedBy || null,
      },
    });

    const row = await tx.rpa_candidate_pipeline.findUnique({ where: { id: pipeline.id } });
    return { updatedPipeline: row, event: closureEvent };
  });

  try {
    if (pipeline.cv_id) {
      await prisma.$executeRaw`UPDATE rpa_cv SET "FinalStatus" = ${statusLabel} WHERE id = ${pipeline.cv_id};`;
    }
  } catch (err) {
    logger.error(`Legacy FinalStatus write-back failed for pipeline ${pipelineId}: ${err.message}`);
  }

  // 90-day lock vs closure (M6 audit, 2026-08-12). Someone we actually hired is
  // not a lead any more, but their ownership lock kept ticking down as if they
  // were: once it lapsed, a second vendor could re-submit them, have a recruiter
  // merge the duplicate, and take attribution for a placement they had no part
  // in — and the first vendor's claim would vanish silently.
  //
  // Freezing the lock on a successful hire stops the clock at the moment the
  // question is settled. Only for JOINED: every other closure means the seat is
  // open again and the candidate genuinely is back in the market, so their lock
  // should expire normally.
  if (finalOutcomeKey === FINAL_OUTCOMES.JOINED && pipeline.cv_id) {
    try {
      const frozen = await prisma.rpa_cv.updateMany({
        where: { id: pipeline.cv_id, VendorEmail: { not: null } },
        data: { lockForNinetyDays: VENDOR_LOCK_FROZEN },
      });
      if (frozen.count > 0) {
        logger.info(`Vendor lock frozen on cv ${pipeline.cv_id} — placed candidate, attribution is now permanent.`);
      }
    } catch (err) {
      // Never let an ownership bookkeeping failure undo a recorded hire.
      logger.error(`Vendor lock freeze failed for pipeline ${pipelineId}: ${err.message}`);
    }
  }

  // The journey is over, so any outstanding no-login document upload link for it
  // is too. Best effort: a closure must not fail because the candidate never had
  // a document request raised.
  try {
    await prisma.rpa_document_requests.updateMany({
      where: { pipeline_id: pipeline.id, token_status: { not: 'closed' } },
      data: { token_status: 'closed', modified_at: new Date() },
    });
  } catch (err) {
    logger.error(`Closure: document link could not be closed for pipeline ${pipelineId}: ${err.message}`);
  }

  // Closing a journey as backed-out / did-not-join / joined-and-left /
  // withdrawn FREES the opening that candidate was holding, so a requisition
  // auto-closed on the strength of their acceptance has to come back.
  //
  // offer.service.js already does this when an acceptance is AMENDED to
  // declined, but that is only one of the two doors: the outcome is far more
  // often recorded here, by closing the journey. Without this the role stayed
  // out of JD filtering permanently, with no in-app way to reopen it —
  // precisely when it most needed re-filling. reopenMrfIfUnfilled is
  // idempotent, null-safe and never throws, so no extra guarding is needed.
  if (VACATING_OUTCOMES.includes(finalOutcomeKey)) {
    const mrfReopen = await reopenMrfIfUnfilled(pipeline.mrf_id);
    if (mrfReopen.reopened) {
      try {
        await prisma.rpa_pipeline_stage_events.create({
          data: {
            pipeline_id: pipeline.id,
            stage_key: pipeline.current_stage_key,
            event_type: 'note',
            notes: `Requisition re-opened — ${mrfReopen.accepted}/${mrfReopen.openings} opening(s) now filled`,
            acted_by: actedBy || null,
          },
        });
      } catch (err) {
        logger.error(`Closure: re-open audit note failed for pipeline ${pipelineId}: ${err.message}`);
      }
    }
  }

  const emailResult = notifyCandidate
    ? await sendStageOutcomeEmail({
      pipelineRow: updatedPipeline,
      stageKey: pipeline.current_stage_key,
      outcomeKey: finalOutcomeKey,
      stageLabel: 'Closure',
      candidate: {
        name: pipeline.rpa_shortlisted_candidates?.candidate_name,
        email: pipeline.rpa_shortlisted_candidates?.candidate_email,
      },
      positionLabel: pipeline.rpa_shortlisted_candidates?.position_applied || 'the role',
    })
    : { sent: false, error: null, messageId: null };

  // The vendor hears about closure even when the candidate deliberately does
  // not. SILENT_FINAL_OUTCOMES exists because there is nothing to tell someone
  // who backed out that they don't already know — but their vendor was never in
  // that conversation, and "did this placement land?" is the one question they
  // are actually tracking. Independent of notifyCandidate for the same reason.
  await notifyVendor({
    pipelineRow: updatedPipeline,
    candidate: { name: pipeline.rpa_shortlisted_candidates?.candidate_name },
    eventType: VENDOR_EVENTS.CLOSURE,
    stageKey: pipeline.current_stage_key,
    stageLabel: 'Closure',
    outcomeKey: finalOutcomeKey,
    positionLabel: pipeline.rpa_shortlisted_candidates?.position_applied || 'the role',
  });

  await prisma.rpa_pipeline_stage_events.update({
    where: { id: event.id },
    data: { email_sent: emailResult.sent, email_error: emailResult.error },
  });

  // The journey is over — tell the team, since the card is about to leave the
  // board and this is the last chance to see it happened.
  await notify({
    type: NOTIFICATION_TYPES.PIPELINE_CLOSURE,
    title: `Candidate record closed — ${statusLabel}`,
    description: pipeline.rpa_shortlisted_candidates?.candidate_name || 'A candidate',
    pipelineId: pipeline.id,
    meta: { final_outcome: finalOutcomeKey },
    excludeUserId: actedBy || null,
  });

  return serializeBigInts(updatedPipeline);
}

/**
 * Ad-hoc per-candidate email (RT ask, 2026-07-14): send-time override, either
 * templated as-is or fully recruiter-edited.
 * @param {number} pipelineId
 * @param {{ subject: string, body: string }} params
 */
export async function sendAdHocEmail(pipelineId, { subject, body }) {
  const pipeline = await prisma.rpa_candidate_pipeline.findUnique({
    where: { id: BigInt(pipelineId) },
    include: { rpa_shortlisted_candidates: true },
  });
  if (!pipeline) {
    throw new AppError('Pipeline journey not found.', 404);
  }
  assertJourneyOpen(pipeline, 'email them');

  const result = await sendAdHocCandidateEmail({
    pipelineRow: pipeline,
    candidate: {
      name: pipeline.rpa_shortlisted_candidates?.candidate_name,
      email: pipeline.rpa_shortlisted_candidates?.candidate_email,
    },
    subject,
    body,
  });

  // The vendor learns that contact happened, not what was said. `body` here is
  // free text a recruiter typed — the exact content the old cc would have
  // forwarded verbatim.
  await notifyVendor({
    pipelineRow: pipeline,
    candidate: { name: pipeline.rpa_shortlisted_candidates?.candidate_name },
    eventType: VENDOR_EVENTS.ADHOC_CONTACT,
    stageKey: pipeline.current_stage_key,
    positionLabel: pipeline.rpa_shortlisted_candidates?.position_applied || 'the role',
  });

  await prisma.rpa_pipeline_stage_events.create({
    data: {
      pipeline_id: pipeline.id,
      stage_key: pipeline.current_stage_key,
      event_type: 'note',
      notes: `Ad-hoc email sent: "${subject}"`,
      email_sent: result.sent,
      email_error: result.error,
    },
  });

  return result;
}

/**
 * Creates a new candidate-per-MRF journey. Called from screening.service.js's
 * shortlistCandidates. Enforces the cooling-off guard (Q11/Q23): blocks/warns
 * if this cv_id was rejected at Stage 1+ within the configured window, but
 * never touches an existing active journey for the same candidate.
 *
 * Vendor attribution is NOT a parameter (M6, 2026-08-12). It is resolved here
 * from the candidate's live 90-day lock — see vendorAttributionFor() — so the
 * caller and the journey can never disagree about who owns the candidate. The
 * `source` passed in is the intake path; a live lock overrides it with
 * 'vendor', which is what the vendor notification, the board's vendor filter
 * and the analytics vendor-performance table all key off.
 *
 * @param {object} params
 * @param {bigint|number|null} params.cvId
 * @param {bigint|number|null} params.mrfId
 * @param {number|null} params.shortlistId
 * @param {string} params.source - recruiter | bulk_excel | screening_shortlist | email_intake
 * @param {number} [params.coolingOffMonths] - default 6 (Q11)
 * @returns {Promise<object>} the created (or existing) pipeline row
 */
export async function createPipelineJourney({
  cvId,
  mrfId,
  shortlistId,
  source,
  coolingOffMonths = REAPPLICATION_COOLING_OFF_MONTHS,
}) {
  if (!cvId) {
    throw new AppError('cvId is required to create a pipeline journey.', 400);
  }
  const cvIdBig = BigInt(cvId);
  const mrfIdBig = mrfId ? BigInt(mrfId) : null;

  // Cooling-off guard (Q11): any pipeline rejection within the window blocks a
  // NEW journey (shortlisting itself happens on Candidate Screening, not in
  // this pipeline, so there's no "Stage 0" exemption anymore — every journey
  // here starts at HR Screening); it never touches an existing active one (Q23).
  const priorRejection = await findRecentRejection(cvIdBig, coolingOffMonths);
  if (priorRejection) {
    throw new AppError(
      `Candidate is in a ${coolingOffMonths}-month re-application cooling-off period (rejected at "${priorRejection.current_stage_key}" on ${priorRejection.modified_at.toISOString().slice(0, 10)}).`,
      409
    );
  }

  const existing = await prisma.rpa_candidate_pipeline.findFirst({
    where: mrfIdBig ? { cv_id: cvIdBig, mrf_id: mrfIdBig } : { cv_id: cvIdBig, mrf_id: null },
  });
  if (existing) {
    return serializeBigInts(existing);
  }

  // Shortlisting into a requisition whose openings are already filled is
  // ALLOWED — a backup candidate, or a role about to be re-opened, are both
  // legitimate. It is usually a stale cached JD dropdown though (the roles
  // list is held client-side with staleTime:Infinity), so record it: the
  // board flags the card "Role filled", and this makes it traceable
  // server-side rather than silent.
  if (mrfIdBig) {
    try {
      const mrf = await prisma.rpa_mrf.findUnique({
        where: { id: mrfIdBig },
        select: { filled_at: true, approval_status: true, position_hiring_for: true },
      });
      if (isMrfFilled(mrf)) {
        logger.warn(
          `Journey created for cv ${cvIdBig} against MRF ${mrfIdBig} ("${mrf.position_hiring_for}") whose openings are already filled — likely a stale roles dropdown.`
        );
      }
    } catch (err) {
      // Advisory only: never block a shortlist over a logging lookup.
      logger.warn(`Filled-requisition check failed for MRF ${mrfIdBig}: ${err.message}`);
    }
  }

  // Who owns this candidate right now, per the 90-day lock. A live lock
  // overrides the intake source with 'vendor' and pins the vendor onto the row.
  const vendorAttribution = await vendorAttributionFor(cvIdBig);

  const created = await prisma.rpa_candidate_pipeline.create({
    data: {
      cv_id: cvIdBig,
      mrf_id: mrfIdBig,
      shortlist_id: shortlistId || null,
      current_stage_key: STAGE_KEYS.ZEKO_HR,
      current_stage_status: 'in_progress',
      source,
      vendor_email: null,
      ...vendorAttribution,
    },
  });

  if (vendorAttribution) {
    logger.info(
      `Journey ${created.id} attributed to vendor ${vendorAttribution.vendor_email} (90-day lock active on cv ${cvIdBig}).`
    );
  }

  await prisma.rpa_pipeline_stage_events.create({
    data: {
      pipeline_id: created.id,
      stage_key: STAGE_KEYS.ZEKO_HR,
      event_type: 'entered',
      notes: 'Entered pipeline — already shortlisted on Candidate Screening.',
    },
  });

  return serializeBigInts(created);
}

/**
 * Real pipeline analytics — replaces the hardcoded mock data in
 * CandidatePipelineAnalyticsPreview (Pipeline Insights) and
 * RecruiterInsightsPreview (Recruiter Insights) on the Analytics page.
 *
 * @param {object} [params]
 * @param {number|null} [params.mrfId] - scope the stage funnel to one MRF; otherwise the MRF with the most journeys is used
 * @param {number} [params.rejectionWindowDays] - default 30, for the rejection-reasons breakdown
 * @param {number} [params.stuckThresholdDays] - default 10, for the "stuck" tile/table
 * @param {number} [params.holdThresholdDays] - default 30, for the "on hold > N days" tile
 * @param {number|null} [params.topN] - how many rows the ranked tables keep.
 *   The screen shows the top 10; a CSV export passes null for the COMPLETE
 *   ranked list, because a 10-row file is useless for the analysis someone
 *   exports in order to do.
 */
export async function getPipelineAnalytics({
  mrfId = null,
  rejectionWindowDays = 30,
  stuckThresholdDays = 10,
  holdThresholdDays = 30,
  topN = 10,
} = {}) {
  /** Apply the ranked-table cap, or keep everything when topN is null. */
  const capped = (rows) => (topN == null ? rows : rows.slice(0, topN));
  const stages = await prisma.rpa_pipeline_stages.findMany({
    where: { is_active: true },
    orderBy: { sort_order: 'asc' },
  });

  const allJourneys = await prisma.rpa_candidate_pipeline.findMany({
    include: {
      rpa_shortlisted_candidates: true,
      rpa_pipeline_stage_events: { orderBy: { created_at: 'asc' } },
    },
  });

  const now = Date.now();
  const daysSince = (d) => Math.floor((now - new Date(d).getTime()) / MS_PER_DAY);

  // ── Top tiles: active in pipeline, awaiting feedback, on-hold > N days, offers pending ──
  const activeInPipeline = allJourneys.filter((j) => !j.final_outcome).length;

  // "Awaiting feedback" — interviews that happened, whose scorecard is still out.
  //
  // This was hardcoded to 0 with a comment saying Module 3 wasn't built. M3a
  // shipped, so the tile was quietly reporting zero over real outstanding cards.
  //
  // Bounded on token_expires_at because status only flips to 'expired' lazily,
  // when someone opens a stale link (getScorecardByToken) — a card nobody ever
  // opens stays 'pending' forever, and without this the tile would ratchet up
  // and never come down.
  const awaitingRows = await prisma.rpa_interview_scorecard.findMany({
    where: {
      status: SCORECARD_STATUS.PENDING,
      sent_at: { not: null },
      token_expires_at: { gt: new Date() },
      rpa_interview_schedule: { occurrence_status: OCCURRENCE_STATUS.HELD, cancelled_at: null },
      rpa_candidate_pipeline: { final_outcome: null },
    },
    select: { pipeline_id: true },
  });
  // Counted as CANDIDATES, not cards: a 3-person panel is one candidate waiting,
  // and every neighbouring tile counts candidates. The card count rides along
  // separately so a panel round doesn't look undercounted on screen.
  const awaitingFeedback = new Set(awaitingRows.map((r) => String(r.pipeline_id))).size;
  const awaitingFeedbackCards = awaitingRows.length;

  const onHoldOverThreshold = allJourneys.filter((j) => {
    if (j.current_stage_status !== STAGE_OUTCOMES.HOLD) return false;
    return daysSince(stageClockStart(j)) > holdThresholdDays;
  }).length;
  const offersPending = allJourneys.filter(
    (j) => j.current_stage_key === STAGE_KEYS.OFFER && !j.final_outcome
  ).length;

  // ── Stage funnel: counts of journeys that have EVER entered each stage, for one MRF ──
  // The funnel shows ONE requisition. Counting journeys per MRF happens either
  // way now: when no mrf_id is given it picks the busiest, and the same tally
  // populates the selector so the user can see the funnel is a choice among
  // several rather than the whole picture.
  const mrfJourneyCounts = new Map();
  for (const j of allJourneys) {
    if (!j.mrf_id) continue;
    const key = String(j.mrf_id);
    mrfJourneyCounts.set(key, (mrfJourneyCounts.get(key) || 0) + 1);
  }

  let funnelMrfId = mrfId;
  const funnelAutoSelected = !funnelMrfId;
  if (!funnelMrfId) {
    let best = null;
    for (const [key, count] of mrfJourneyCounts) {
      if (!best || count > best.count) best = { key, count };
    }
    funnelMrfId = best ? Number(best.key) : null;
  }

  // Label every selectable requisition, so the dropdown reads like the rest of
  // the app ("Role (MRF-110)") instead of bare ids. One query for the whole
  // list rather than one per row. The explicitly-requested MRF is included even
  // if it has no journeys yet — otherwise asking for it would render an
  // unlabelled "MRF-123" heading over an empty funnel.
  const selectableMrfIds = [...new Set([
    ...mrfJourneyCounts.keys(),
    ...(funnelMrfId ? [String(funnelMrfId)] : []),
  ])].map((k) => BigInt(k));
  const selectableMrfs = selectableMrfIds.length
    ? await prisma.rpa_mrf.findMany({
      where: { id: { in: selectableMrfIds } },
      select: { id: true, position_hiring_for: true },
    })
    : [];
  const mrfLabelFor = (id) => {
    const row = selectableMrfs.find((m) => Number(m.id) === Number(id));
    return row ? `${row.position_hiring_for || 'Role'} (MRF-${id})` : `MRF-${id}`;
  };
  const availableMrfs = [...mrfJourneyCounts.entries()]
    .map(([key, count]) => ({
      mrf_id: Number(key),
      label: mrfLabelFor(key),
      journey_count: count,
    }))
    .sort((a, b) => b.journey_count - a.journey_count);

  let funnelMrfLabel = null;
  let funnel = [];
  if (funnelMrfId) {
    funnelMrfLabel = mrfLabelFor(funnelMrfId);

    const mrfJourneys = allJourneys.filter((j) => j.mrf_id && Number(j.mrf_id) === funnelMrfId);
    funnel = stages.map((s) => ({
      stage_key: s.stage_key,
      label: s.label,
      // A journey "reached" a stage if it has any event at that stage, OR it is
      // currently sitting past it (current_stage sort_order >= this stage's).
      count: mrfJourneys.filter((j) => {
        const reachedViaEvent = j.rpa_pipeline_stage_events.some((ev) => ev.stage_key === s.stage_key);
        if (reachedViaEvent) return true;
        const currentStage = stages.find((st) => st.stage_key === j.current_stage_key);
        return currentStage && currentStage.sort_order >= s.sort_order;
      }).length,
    })).filter((f) => f.count > 0 || stages.findIndex((s) => s.stage_key === f.stage_key) === 0);
  }

  // ── Stuck candidates: journeys sitting in their current stage past the threshold ──
  const stuckCandidates = allJourneys
    .filter((j) => !j.final_outcome)
    .map((j) => {
      const days = daysSince(stageClockStart(j));
      const stageLabel = stages.find((s) => s.stage_key === j.current_stage_key)?.label || j.current_stage_key;
      return {
        pipeline_id: Number(j.id),
        candidate_name: j.rpa_shortlisted_candidates?.candidate_name || 'Unknown',
        stage: stageLabel,
        days,
        blocked_on: j.current_stage_status === 'hold' ? 'On Hold — manual review' : 'In progress',
      };
    })
    .filter((row) => row.days >= stuckThresholdDays)
    .sort((a, b) => b.days - a.days);
  const stuckCandidatesTop = capped(stuckCandidates);

  // ── Rejection reasons — last N days ──
  const rejectionCutoff = new Date(now - rejectionWindowDays * 24 * 60 * 60 * 1000);
  const rejectionEvents = await prisma.rpa_pipeline_stage_events.findMany({
    where: { outcome: STAGE_OUTCOMES.REJECTED, created_at: { gt: rejectionCutoff } },
    include: { rpa_outcome_reasons: true },
  });
  const reasonCounts = new Map();
  for (const ev of rejectionEvents) {
    const label = ev.rpa_outcome_reasons?.is_other ? (ev.reason_text || 'Other reasons') : (ev.rpa_outcome_reasons?.reason_label || 'Unspecified');
    const stageLabel = stages.find((s) => s.stage_key === ev.stage_key)?.label || ev.stage_key;
    const key = label;
    if (!reasonCounts.has(key)) {
      reasonCounts.set(key, { reason: label, count: 0, stageCounts: new Map() });
    }
    const entry = reasonCounts.get(key);
    entry.count += 1;
    entry.stageCounts.set(stageLabel, (entry.stageCounts.get(stageLabel) || 0) + 1);
  }
  const rejectionReasons = [...reasonCounts.values()]
    .map((entry) => {
      let mostCommonStage = null;
      let max = 0;
      for (const [stage, count] of entry.stageCounts) {
        if (count > max) { max = count; mostCommonStage = stage; }
      }
      return { reason: entry.reason, count: entry.count, most_common_stage: mostCommonStage };
    })
    .sort((a, b) => b.count - a.count);
  const rejectionReasonsTop = capped(rejectionReasons);

  // ── Time-to-hire: average days spent in each stage, across CLOSED (final_outcome) journeys ──
  const closedJourneys = allJourneys.filter((j) => j.final_outcome);
  const stageDurationTotals = new Map(); // stage_key -> { totalDays, count }
  for (const j of closedJourneys) {
    // stageDurations() measures entered → next TRANSITION, skipping notes.
    for (const [key, days] of stageDurations(j.rpa_pipeline_stage_events, j.closed_at || j.modified_at)) {
      if (!stageDurationTotals.has(key)) stageDurationTotals.set(key, { totalDays: 0, count: 0 });
      const agg = stageDurationTotals.get(key);
      agg.totalDays += days;
      agg.count += 1;
    }
  }
  const timeToHire = stages
    .map((s) => {
      const agg = stageDurationTotals.get(s.stage_key);
      const avgDays = agg && agg.count > 0 ? Math.round((agg.totalDays / agg.count) * 10) / 10 : 0;
      return { stage_key: s.stage_key, label: s.label, avg_days: avgDays };
    })
    .filter((row) => row.avg_days > 0);
  const totalTimeToHire = Math.round(timeToHire.reduce((sum, r) => sum + r.avg_days, 0));

  // ── Vendor performance: how many of a vendor's candidates are in the pipeline ──
  //
  // Deliberately NO shortlist_rate. The old one incremented `submitted` and
  // `shortlisted` on the same row, so it read 100% for every vendor forever —
  // real data, meaningless metric.
  //
  // The honest denominator (CVs the vendor actually sent) lives in
  // rpa_upload_jobs, but that join is not viable: of 31 vendor upload jobs on
  // staging only 7 carry a cv_id, and exactly 1 joins to a pipeline row. A rate
  // built on 23% coverage would invent a number, so the column is dropped
  // rather than relabelled — the figure was the problem, not its name.
  // Revisit if cv_id backfill lands; the query is in docs/Recruitment-Analytics.md.
  const vendorJourneys = allJourneys.filter((j) => j.source === 'vendor' && j.vendor_email);
  const vendorCounts = new Map();
  for (const j of vendorJourneys) {
    const key = String(j.vendor_email).trim().toLowerCase();
    if (!vendorCounts.has(key)) {
      vendorCounts.set(key, { vendor_email: key, in_pipeline: 0, hired: 0, rejected: 0 });
    }
    const entry = vendorCounts.get(key);
    entry.in_pipeline += 1;
    const bucket = bucketFor(j);
    if (bucket === 'hired') entry.hired += 1;
    if (bucket === 'rejected') entry.rejected += 1;
  }
  const vendorPerformance = [...vendorCounts.values()].sort((a, b) => b.in_pipeline - a.in_pipeline);
  const vendorPerformanceTop = capped(vendorPerformance);

  // ── Source of hire: how each intake route CONVERTS ──
  //
  // Reports a hire rate, not a "shortlist rate". Every rpa_candidate_pipeline
  // row already IS a shortlist by construction, so a per-source shortlist rate
  // was definitionally ~100% and ranked nothing. The question worth asking is
  // which source produces hires.
  //
  // Buckets are mutually exclusive (see bucketFor) and therefore sum to
  // `submitted` — the invariant that makes the rate below a real rate.
  const sourceGroups = new Map();
  for (const j of allJourneys) {
    const key = j.source;
    if (!sourceGroups.has(key)) {
      sourceGroups.set(key, {
        source: key, submitted: 0, in_progress: 0, hired: 0, rejected: 0, on_hold: 0, closed_other: 0,
      });
    }
    const entry = sourceGroups.get(key);
    entry.submitted += 1;
    entry[bucketFor(j)] += 1;
  }
  const sourceOfHire = [...sourceGroups.values()].map((s) => ({
    ...s,
    hire_rate: s.submitted > 0 ? Math.round((s.hired / s.submitted) * 100) : 0,
  }));

  return {
    tiles: {
      active_in_pipeline: activeInPipeline,
      awaiting_feedback: awaitingFeedback,
      awaiting_feedback_cards: awaitingFeedbackCards,
      on_hold_over_threshold: onHoldOverThreshold,
      hold_threshold_days: holdThresholdDays,
      offers_pending: offersPending,
    },
    funnel: {
      mrf_id: funnelMrfId,
      mrf_label: funnelMrfLabel,
      stages: funnel,
      // auto_selected tells the UI to say the requisition was CHOSEN for the
      // user (busiest one) rather than requested — an auto-pick presented as a
      // deliberate one reads as "the" funnel instead of "a" funnel.
      auto_selected: funnelAutoSelected,
      available_mrfs: availableMrfs,
    },
    // Ranked tables are capped to `topN` (10 on screen); an export passes
    // topN: null and gets the complete list here.
    stuckCandidates: stuckCandidatesTop,
    rejectionReasons: rejectionReasonsTop,
    rejectionWindowDays,
    timeToHire: { total_days: totalTimeToHire, stages: timeToHire },
    vendorPerformance: vendorPerformanceTop,
    sourceOfHire,
  };
}

export default {
  listPipeline,
  getPipelineDetail,
  getOutcomePreview,
  setStageOutcome,
  advanceStage,
  setFinalOutcome,
  sendAdHocEmail,
  createPipelineJourney,
};
