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

export const STAGE_OUTCOMES = Object.freeze({
  APPROVED: 'approved',
  REJECTED: 'rejected',
  HOLD: 'hold',
  FUTURE_PROSPECT: 'future_prospect',
});

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
