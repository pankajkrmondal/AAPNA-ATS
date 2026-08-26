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

/**
 * The controlled vocabulary for `rpa_mrf.closure_reason` (Q34).
 *
 * Written by BOTH closure paths: closeMrfIfFilled() stamps ALL_OPENINGS_FILLED,
 * a manual close stamps whichever the recruiter picked. Before this existed the
 * system recorded *when* a requisition closed but never *why* — not even for
 * the automatic path.
 *
 * Deliberately not a DB CHECK constraint or an enum: every other status column
 * in this schema is a plain VARCHAR, and a CHECK is what turns "add a reason"
 * into a migration. Validation lives in the service instead.
 */
export const MRF_CLOSURE_REASONS = Object.freeze({
  ALL_OPENINGS_FILLED: 'all_openings_filled',
  BUDGET_WITHDRAWN: 'budget_withdrawn',
  ROLE_WITHDRAWN: 'role_withdrawn',
  HIRED_EXTERNALLY: 'hired_externally',
  ON_HOLD_INDEFINITELY: 'on_hold_indefinitely',
  OTHER: 'other',
});

/**
 * Whether a requisition is CLOSED — filled, or manually closed by a human.
 *
 * This is the "is it still hiring?" question, and it is the one every consumer
 * should ask: the JD dropdown, the dashboard active tile, the pipeline board
 * card. A requisition leaves circulation if EITHER signal is set.
 *
 * Kept separate from isMrfFilled() rather than widening it, because the two
 * genuinely differ and one reader depends on the difference: mrfDetail.export's
 * "Openings Filled: YES/NO" must stay false for a role the business cancelled
 * without hiring anyone. isMrfFilled() therefore still means exactly what its
 * name says.
 *
 * ⚠️ Reads `closed_at` off the row it is given, so ANY `select:` that omits the
 * column makes this return false and a closed requisition silently reappears in
 * JD filtering — the same trap `filled_at` already carries a warning about in
 * exports/mrf.export.js. Select both columns wherever this is called.
 *
 * @param {{ filled_at?: Date|string|null, closed_at?: Date|string|null, approval_status?: string|null }|null} mrf
 * @returns {boolean}
 */
export function isMrfClosed(mrf) {
  if (!mrf) return false;
  if (mrf.closed_at != null) return true;
  return isMrfFilled(mrf);
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
 * Every value shortlistStatusFor() can write.
 *
 * Three readers bucket this column into count strips that must SUM to their
 * total, and all three used to break silently — no error, just columns that
 * stop adding up — whenever this list grew without them:
 *
 *   - `candidateCounts` in backend/src/services/screening.service.js
 *   - `groupByRole()` in backend/src/exports/screening.export.js
 *   - the `roleStats` memo in frontend/src/pages/Analytics.jsx
 *
 * That happened with 'future_prospect', which was written here before it had a
 * bucket: every such candidate landed in `total` and nowhere else. The closure
 * values were the second such growth, and rather than adding five more columns
 * all three readers were given a CATCH-ALL `closed` branch on 2026-08-26 — so
 * the sum now holds by construction and a value added to this list later cannot
 * silently vanish from a strip again.
 *
 * Growing this list is therefore safe for the strips, but still check anything
 * that switches on specific values — see TERMINAL_SHORTLIST_STATUSES below.
 */
export const SHORTLIST_STATUSES = Object.freeze({
  SHORTLISTED: 'shortlisted',
  REJECTED: 'rejected',
  ON_HOLD: 'on_hold',
  FUTURE_PROSPECT: 'future_prospect',
  HIRED: 'hired',
  WITHDRAWN: 'withdrawn',
  BACKED_OUT: 'backed_out',
  DID_NOT_JOIN: 'did_not_join',
  JOINED_AND_LEFT: 'joined_and_left',
});

/**
 * The subset of SHORTLIST_STATUSES that mean "this journey is over".
 *
 * The count strips roll all of these into a single `closed` column rather than
 * carrying nine, but the COLUMN keeps them distinct — see shortlistStatusFor().
 */
export const TERMINAL_SHORTLIST_STATUSES = Object.freeze([
  SHORTLIST_STATUSES.HIRED,
  SHORTLIST_STATUSES.WITHDRAWN,
  SHORTLIST_STATUSES.BACKED_OUT,
  SHORTLIST_STATUSES.DID_NOT_JOIN,
  SHORTLIST_STATUSES.JOINED_AND_LEFT,
]);

/**
 * Maps a stage×outcome OR closure outcome onto the legacy vocabulary of
 * rpa_shortlisted_candidates.pipeline_status (VarChar(50), nullable, no CHECK
 * constraint in the live staging DB — see
 * backend/prisma/ddl/2026-07-21-pipeline-stage-engine.README.md).
 *
 * Accepts both STAGE_OUTCOMES and FINAL_OUTCOMES because both write this column
 * and there is only one column to write. Closure was missing here until
 * 2026-08-26: setStageOutcome wrote both legacy layers, setFinalOutcome wrote
 * only rpa_cv.FinalStatus, so a candidate closed as `joined` still read
 * `pipeline_status = 'shortlisted'` — inflating the dashboard shortlist tile,
 * the recruiter leaderboard and the screening badges with people whose journey
 * was over. See docs/PHASE3-CLOSURE-AUDIT-2026-08-26.md §2.4.
 *
 * The closure outcomes map to DISTINCT values rather than one rolled-up
 * "closed" (product-owner decision, 2026-08-26 — audit §6a). The column is
 * plain VARCHAR(50) with no CHECK constraint, so no DDL is needed to widen the
 * vocabulary, and the distinctness is the point:
 *
 *   - Only `closure_rejected` may write 'rejected'. That value drives the Q11
 *     6-month re-application cooling-off (screening.service.js selects the
 *     cooldown list on pipeline_status = 'rejected'), so routing a withdrawal
 *     or a no-join through it would silently bar someone from re-applying on
 *     the strength of a decision they made themselves.
 *   - `joined` and `closure_approved` share 'hired' because that is one
 *     concept, and 'hired' is a value dashboard.service.js already counts —
 *     nothing wrote it until now.
 *   - The remaining exits stay individually legible, so a report can tell a
 *     backed-out offer from a candidate who never turned up without going back
 *     to rpa_candidate_pipeline.final_outcome.
 *
 * The count strips roll every terminal value into one `closed` column; see
 * TERMINAL_SHORTLIST_STATUSES.
 *
 * @param {string} outcomeKey - one of STAGE_OUTCOMES or FINAL_OUTCOMES
 * @returns {string|null} one of SHORTLIST_STATUSES, or null if not applicable
 */
export function shortlistStatusFor(outcomeKey) {
  switch (outcomeKey) {
    case STAGE_OUTCOMES.APPROVED:
      return SHORTLIST_STATUSES.SHORTLISTED;
    case STAGE_OUTCOMES.REJECTED:
      return SHORTLIST_STATUSES.REJECTED;
    case STAGE_OUTCOMES.HOLD:
      return SHORTLIST_STATUSES.ON_HOLD;
    case STAGE_OUTCOMES.FUTURE_PROSPECT:
      return SHORTLIST_STATUSES.FUTURE_PROSPECT;

    // --- Closure outcomes (Q12). Added 2026-08-26, audit §2.4 / §6a. ---
    case FINAL_OUTCOMES.APPROVED:
    case FINAL_OUTCOMES.JOINED:
      return SHORTLIST_STATUSES.HIRED;
    case FINAL_OUTCOMES.REJECTED:
      return SHORTLIST_STATUSES.REJECTED;
    case FINAL_OUTCOMES.ON_HOLD:
      return SHORTLIST_STATUSES.ON_HOLD;
    case FINAL_OUTCOMES.CANDIDATE_WITHDRAWN:
      return SHORTLIST_STATUSES.WITHDRAWN;
    case FINAL_OUTCOMES.BACKED_OUT:
      return SHORTLIST_STATUSES.BACKED_OUT;
    case FINAL_OUTCOMES.DID_NOT_JOIN:
      return SHORTLIST_STATUSES.DID_NOT_JOIN;
    case FINAL_OUTCOMES.JOINED_AND_LEFT:
      return SHORTLIST_STATUSES.JOINED_AND_LEFT;

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
