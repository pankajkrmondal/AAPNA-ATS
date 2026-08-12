/**
 * pipelineStages.js — Canonical stage/outcome keys and write-back helpers for
 * the Phase 3 stage engine (Module 1).
 *
 * Single source of truth for stage/outcome string constants used across
 * pipeline.service.js, stageNotification.service.js, and the seed script.
 * Mirrors the pattern in config/roles.js (frozen constant objects + small
 * pure helpers) rather than hard-coding strings at call sites.
 *
 * The actual stage/outcome ROWS live in rpa_pipeline_stages / rpa_stage_outcomes
 * (admin-customizable, RT ask 2026-07-13) — these constants are the keys the
 * codebase itself branches on (Zeko stage detection, legacy write-back, etc.),
 * not a hard-coded replacement for the DB-driven config.
 */

export const STAGE_KEYS = Object.freeze({
  SHORTLIST: 'shortlist',
  ZEKO_HR: 'zeko_hr',
  ASSESSMENT: 'assessment',
  ZEKO_FUNCTIONAL: 'zeko_fn',
  TECH1: 'tech1',
  TECH2: 'tech2',
  TECH3: 'tech3',
  HR_ROUND: 'hr_round',
  CEO: 'ceo',
  CLIENT: 'client',
  DOCUMENTS: 'documents',
  OFFER: 'offer',
});

/** Stage keys whose stage_type is 'zeko' — used to detect "is this a Zeko stage?" without a DB round-trip. */
export const ZEKO_STAGE_KEYS = Object.freeze([STAGE_KEYS.ZEKO_HR, STAGE_KEYS.ZEKO_FUNCTIONAL]);

/**
 * Values stored in rpa_zeko_candidate_pipeline.stage — which Zeko interview
 * ROUND a row belongs to. Distinct from STAGE_KEYS (the pipeline board's stage
 * keys): 'hr' predates the stage engine and is the column default, so it is
 * kept verbatim rather than renamed to 'zeko_hr'.
 *
 * Both rounds draw on the same Zeko job catalog; the round is what separates
 * the two rows for one candidate (unique key: candidate_id + zeko_job_id + stage).
 */
export const ZEKO_ROUND_STAGES = Object.freeze({
  HR: 'hr',
  FUNCTIONAL: 'functional',
});

/** Maps a pipeline board stage key onto the Zeko round value stored on the row. */
const BOARD_KEY_TO_ROUND = Object.freeze({
  [STAGE_KEYS.ZEKO_HR]: ZEKO_ROUND_STAGES.HR,
  [STAGE_KEYS.ZEKO_FUNCTIONAL]: ZEKO_ROUND_STAGES.FUNCTIONAL,
});

/**
 * Coerces any accepted spelling of a Zeko round onto a canonical stored value.
 * Accepts both the board stage key ('zeko_hr'/'zeko_fn') and the stored round
 * value ('hr'/'functional'), so callers on either side of the boundary work.
 *
 * @param {string} [stage] - board stage key or stored round value
 * @returns {string} 'hr' | 'functional' (defaults to 'hr')
 */
export function normalizeZekoRoundStage(stage) {
  if (!stage) return ZEKO_ROUND_STAGES.HR;
  const raw = String(stage).toLowerCase();
  if (BOARD_KEY_TO_ROUND[raw]) return BOARD_KEY_TO_ROUND[raw];
  return Object.values(ZEKO_ROUND_STAGES).includes(raw) ? raw : ZEKO_ROUND_STAGES.HR;
}

export const STAGE_OUTCOMES = Object.freeze({
  APPROVED: 'approved',
  REJECTED: 'rejected',
  HOLD: 'hold',
  FUTURE_PROSPECT: 'future_prospect',
});

/**
 * Values stored in rpa_pipeline_stage_events.event_type.
 *
 * 'entered', 'skip' and 'outcome' are STAGE TRANSITIONS — they move a journey.
 * 'note' is an annotation written liberally by the M3/M4/M5 services (scorecard
 * dispatched, interview rescheduled, documents requested, offer raised) and
 * must never be read as movement.
 *
 * 'skip' is an ARRIVAL, not a bypass of one: it is written in place of
 * 'entered' when a candidate lands in a stage having skipped an optional one
 * before it (see setStageOutcome/advanceStage). The row names the stage the
 * candidate arrived IN, which is why isStageArrival() treats it like 'entered'
 * — assessmentImport.service.js already pairs them the same way.
 *
 * That distinction is the whole reason these live here rather than as inline
 * strings: analytics measured stage durations and staleness from one event to
 * the NEXT EVENT OF ANY TYPE, so a scorecard email reset a 40-day-stalled
 * candidate's clock to zero. Anything computing elapsed time between events
 * must filter on isTransitionEvent() first.
 */
export const EVENT_TYPES = Object.freeze({
  ENTERED: 'entered',
  SKIP: 'skip',
  OUTCOME: 'outcome',
  NOTE: 'note',
});

/** The event types that actually move a journey. See EVENT_TYPES. */
export const TRANSITION_EVENT_TYPES = Object.freeze([
  EVENT_TYPES.ENTERED,
  EVENT_TYPES.SKIP,
  EVENT_TYPES.OUTCOME,
]);

/** The event types that put a candidate INTO a stage (i.e. start its clock). */
export const STAGE_ARRIVAL_EVENT_TYPES = Object.freeze([EVENT_TYPES.ENTERED, EVENT_TYPES.SKIP]);

/**
 * True if an event moved the journey (as opposed to annotating it).
 * @param {{ event_type?: string }|null} ev
 * @returns {boolean}
 */
export function isTransitionEvent(ev) {
  return TRANSITION_EVENT_TYPES.includes(ev?.event_type);
}

/**
 * True if an event marks the candidate ARRIVING in a stage — the moment that
 * stage's clock starts. Both 'entered' and 'skip' qualify.
 * @param {{ event_type?: string }|null} ev
 * @returns {boolean}
 */
export function isStageArrival(ev) {
  return STAGE_ARRIVAL_EVENT_TYPES.includes(ev?.event_type);
}

/** The 8 closure outcomes (Q12), modeled as terminal outcomes on the offer stage. */
export const FINAL_OUTCOMES = Object.freeze({
  APPROVED: 'closure_approved',
  REJECTED: 'closure_rejected',
  ON_HOLD: 'closure_on_hold',
  CANDIDATE_WITHDRAWN: 'candidate_withdrawn',
  JOINED: 'joined',
  DID_NOT_JOIN: 'did_not_join',
  JOINED_AND_LEFT: 'joined_and_left',
  BACKED_OUT: 'backed_out',
});

/**
 * The closure outcomes that FREE the requisition opening a candidate was
 * holding — they accepted, but never joined or did not stay. Any other outcome
 * (or none yet) means the seat is still theirs.
 *
 * Lives here, in pure config, rather than beside the closure machinery,
 * because BOTH paths that can free a seat have to agree on it: offer.service's
 * decision reversal and pipeline.service's setFinalOutcome. Those two drifted
 * apart once already — only the first re-opened the requisition — so this is
 * deliberately a single shared list, not a constant either service owns.
 * Being import-free also keeps it testable without dragging in Redis/sockets.
 */
export const VACATING_OUTCOMES = Object.freeze([
  FINAL_OUTCOMES.BACKED_OUT,
  FINAL_OUTCOMES.DID_NOT_JOIN,
  FINAL_OUTCOMES.JOINED_AND_LEFT,
  FINAL_OUTCOMES.CANDIDATE_WITHDRAWN,
]);

/**
 * The closure outcomes that count as a HIRE for conversion analytics —
 * the offer was accepted and the candidate joined.
 *
 * Deliberately narrower than "not rejected": JOINED_AND_LEFT is excluded
 * because someone who left is not a successful hire for a source/vendor
 * leaderboard, and counting them there would flatter whoever sourced them.
 * Shared by source-of-hire and vendor-performance so the two cannot disagree
 * about what "hired" means.
 */
export const HIRED_OUTCOMES = Object.freeze([
  FINAL_OUTCOMES.APPROVED,
  FINAL_OUTCOMES.JOINED,
]);

/**
 * The value `approval_status` used to be overwritten with to mean "filled".
 *
 * LEGACY READ ONLY. Nothing may write this again: expressing fill state by
 * clobbering the approval column destroyed the real status ('completed' came
 * back as 'approved', escaping the approved_by_abhijit gate). Fill state now
 * lives in its own column, `rpa_mrf.filled_at`. This constant exists so rows
 * closed by the old code are still recognised as filled.
 */
export const LEGACY_MRF_CLOSED_STATUS = 'closed';

/**
 * Whether a requisition's openings are all filled.
 *
 * One definition shared by every consumer (JD dropdown, dashboard active
 * tile, pipeline board card) so they cannot disagree about what "filled"
 * means — three separate inline checks is how the close and re-open paths
 * drifted apart before.
 *
 * @param {{ filled_at?: Date|string|null, approval_status?: string|null }|null} mrf
 * @returns {boolean}
 */
export function isMrfFilled(mrf) {
  if (!mrf) return false;
  if (mrf.filled_at != null) return true;
  // Pre-migration rows, closed by the old lossy path.
  return mrf.approval_status === LEGACY_MRF_CLOSED_STATUS;
}

const STAGE_LABELS = Object.freeze({
  [STAGE_KEYS.SHORTLIST]: 'Shortlisted',
  [STAGE_KEYS.ZEKO_HR]: 'Zeko HR Screening',
  [STAGE_KEYS.ASSESSMENT]: 'IQ / Tech Assessment',
  [STAGE_KEYS.ZEKO_FUNCTIONAL]: 'Zeko Functional Screening',
  [STAGE_KEYS.TECH1]: 'Technical Round 1',
  [STAGE_KEYS.TECH2]: 'Technical Round 2',
  [STAGE_KEYS.TECH3]: 'Technical Round 3',
  [STAGE_KEYS.HR_ROUND]: 'HR Round',
  [STAGE_KEYS.CEO]: 'CEO / Final Round',
  [STAGE_KEYS.CLIENT]: 'Client Interview',
  [STAGE_KEYS.DOCUMENTS]: 'Documents',
  [STAGE_KEYS.OFFER]: 'Offer',
});

/**
 * Builds the exact legacy status text `classifyStatus()` in
 * frontend/src/pages/VendorDashboard.jsx (~line 130) already recognizes, so
 * writing this string into rpa_cv.FinalStatus keeps the legacy dashboard
 * working unchanged (03-DEVELOPMENT-PLAN.md §M1 "Backward-compatibility").
 *
 * RT is explicit (2026-07-14) that stage-prefixed labels like
 * "Zeko HR Screening Pending"/"...Approved" are DELIBERATE, not a legacy shim
 * to simplify away — exports/backups must show exactly which stage a profile
 * died at.
 *
 * @param {string} stageKey - one of STAGE_KEYS
 * @param {string} outcomeKey - one of STAGE_OUTCOMES / FINAL_OUTCOMES
 * @returns {string} e.g. "Zeko HR Screening Approved", "Documents On Hold"
 */
export function finalStatusLabelFor(stageKey, outcomeKey) {
  const stageLabel = STAGE_LABELS[stageKey] || stageKey;

  // Assessment (Evalground) is a deliberate exception to the otherwise-uniform
  // "{stage label} {outcome}" convention above: "Evalground Test Failed" is
  // already a pre-existing legacy status string this codebase anticipates
  // (see frontend/src/pages/VendorDashboard.jsx's classifyStatus() comment) —
  // this keeps the M2 import feature's writeback consistent with that legacy
  // vocabulary instead of introducing "IQ / Tech Assessment Rejected".
  if (stageKey === STAGE_KEYS.ASSESSMENT) {
    switch (outcomeKey) {
      case STAGE_OUTCOMES.APPROVED:
        return 'Evalground Test Passed';
      case STAGE_OUTCOMES.REJECTED:
        return 'Evalground Test Failed';
      case STAGE_OUTCOMES.HOLD:
        return 'Evalground Test on Hold';
      default:
        break;
    }
  }

  switch (outcomeKey) {
    case STAGE_OUTCOMES.APPROVED:
      return `${stageLabel} Approved`;
    case STAGE_OUTCOMES.REJECTED:
      return `${stageLabel} Rejected`;
    case STAGE_OUTCOMES.HOLD:
      return `${stageLabel} On Hold`;
    case STAGE_OUTCOMES.FUTURE_PROSPECT:
      return `${stageLabel} — Future Prospect`;
    case FINAL_OUTCOMES.APPROVED:
      return 'Approved';
    case FINAL_OUTCOMES.REJECTED:
      return 'Rejected';
    case FINAL_OUTCOMES.ON_HOLD:
      return 'On Hold';
    case FINAL_OUTCOMES.CANDIDATE_WITHDRAWN:
      return 'Candidate Withdrew';
    case FINAL_OUTCOMES.JOINED:
      return 'Joined';
    case FINAL_OUTCOMES.DID_NOT_JOIN:
      return 'Did Not Join';
    case FINAL_OUTCOMES.JOINED_AND_LEFT:
      return 'Joined and Left';
    case FINAL_OUTCOMES.BACKED_OUT:
      return 'Backed Out';
    default:
      return `${stageLabel} ${outcomeKey}`;
  }
}

/**
 * Maps a stage×outcome pair onto the 3-value legacy vocabulary of
 * rpa_shortlisted_candidates.pipeline_status, plus the new 'future_prospect'
 * value the column already accepts (confirmed: no CHECK constraint in the
 * live staging DB — see backend/prisma/ddl/2026-07-21-pipeline-stage-engine.README.md).
 *
 * @param {string} outcomeKey - one of STAGE_OUTCOMES
 * @returns {string|null} 'shortlisted' | 'rejected' | 'on_hold' | 'future_prospect', or null if not applicable
 */
export function shortlistStatusFor(outcomeKey) {
  switch (outcomeKey) {
    case STAGE_OUTCOMES.APPROVED:
      return 'shortlisted';
    case STAGE_OUTCOMES.REJECTED:
      return 'rejected';
    case STAGE_OUTCOMES.HOLD:
      return 'on_hold';
    case STAGE_OUTCOMES.FUTURE_PROSPECT:
      return 'future_prospect';
    default:
      return null;
  }
}

/**
 * True if a stage key is one of the two Zeko-integrated stages. Used to
 * decide whether a stage outcome should also reconcile against
 * rpa_zeko_candidate_pipeline (score / cheat-probability once available —
 * see docs/phase3/ZEKO-GAP-ANALYSIS.md).
 * @param {string} stageKey
 * @returns {boolean}
 */
export function isZekoStage(stageKey) {
  return ZEKO_STAGE_KEYS.includes(stageKey);
}
