/**
 * Flexible stage movement rules (docs/phase3/pipeline/FLEXIBLE-STAGE-MOVEMENT-DRAG-DROP-PLAN.md).
 * Pure — no Prisma — so node:test can load it. The service layer
 * (stageState.service.js, pipeline.service.js) gathers the data and these
 * functions decide.
 *
 * Per-stage state lives in rpa_pipeline_stage_state, one row per journey per
 * stage the candidate has been in or moved past. NO ROW = not visited.
 *
 *   active     the stage the candidate is on now
 *   completed  passed (Approved). Can be RE-DONE with a reason (L02-C, 22 Oct
 *              2026, lifting D2), except Documents and Offer
 *   skipped    moved past without doing it. Can be visited later (D2)
 *   rejected   rejected here (the journey is over until reopened)
 *   hold       on hold here
 */
import AppError from './AppError.js';

export const STAGE_STATES = Object.freeze({
  NOT_VISITED: 'not_visited',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  SKIPPED: 'skipped',
  REJECTED: 'rejected',
  HOLD: 'hold',
});

/** The states a candidate may be moved INTO without a reason (D2, C7). */
export const MOVE_TARGET_STATES = Object.freeze([STAGE_STATES.NOT_VISITED, STAGE_STATES.SKIPPED]);

/**
 * Passed stages that can never be re-done (L02-C, Harish 22 Oct 2026):
 * verified documents cannot be un-verified, and a shared offer locks the stage.
 */
export const REDO_EXCLUDED_STAGE_KEYS = Object.freeze(['documents', 'offer']);

/** Whether a passed stage may be re-done (with a reason). */
export function isRedoable(stageKey) {
  return !REDO_EXCLUDED_STAGE_KEYS.includes(stageKey);
}

/**
 * When the current visit to a stage started, if that visit is a RE-DO; null
 * for a first visit. A re-done stage keeps its old completed_at and gets a
 * fresh entered_at, so "entered after it was completed" is a re-do (L02-C).
 * Only re-do visits are time-scoped: a first visit's entered_at can be the
 * backfill time, later than its real activity, so it must not filter anything.
 *
 * @param {{ entered_at?: Date|string|null, completed_at?: Date|string|null } | null | undefined} row
 *   the rpa_pipeline_stage_state row for (journey, stage)
 * @returns {Date|null}
 */
export function redoVisitStart(row) {
  if (!row?.entered_at || !row?.completed_at) return null;
  const entered = new Date(row.entered_at);
  return entered > new Date(row.completed_at) ? entered : null;
}

/** True when `at` belongs to the visit that started at `since` (no since = any time). */
export function inVisit(at, since) {
  if (!since) return true;
  return at != null && new Date(at) >= since;
}

/** Never a board column, so never a move target and never given a state row. */
export const NON_BOARD_STAGE_KEYS = Object.freeze(['shortlist']);

/**
 * The state of the stage a candidate is ON, from the journey's own status.
 * 'approved' only stays on the row when the final stage was approved with
 * nothing after it, so that stage is passed.
 * @param {string} currentStageStatus
 */
export function stateForCurrentStatus(currentStageStatus) {
  switch (currentStageStatus) {
    case 'rejected': return STAGE_STATES.REJECTED;
    case 'hold': return STAGE_STATES.HOLD;
    case 'approved': return STAGE_STATES.COMPLETED;
    default: return STAGE_STATES.ACTIVE;
  }
}

/**
 * Per-stage state worked out from the event history. The same rule as the
 * backfill in prisma/ddl/2026-10-16-flexible-stage-movement.sql, and what the
 * app falls back to for a journey that has no rows yet.
 *
 * @param {object} p
 * @param {{stage_key: string, sort_order: number, is_active?: boolean}[]} p.stages every stage, any order
 * @param {{current_stage_key: string, current_stage_status: string}} p.pipeline
 * @param {{stage_key: string, event_type: string, outcome?: string|null}[]} p.events
 * @returns {Record<string, string>} stage_key -> state (not-visited stages omitted)
 */
export function deriveStageStates({ stages, pipeline, events = [] }) {
  const current = stages.find((s) => s.stage_key === pipeline.current_stage_key);
  const approved = new Set(
    events.filter((e) => e.event_type === 'outcome' && e.outcome === 'approved').map((e) => e.stage_key)
  );
  const states = {};
  for (const s of stages) {
    if (NON_BOARD_STAGE_KEYS.includes(s.stage_key)) continue;
    if (s.stage_key === pipeline.current_stage_key) {
      states[s.stage_key] = stateForCurrentStatus(pipeline.current_stage_status);
    } else if (s.is_active === false) {
      continue;
    } else if (approved.has(s.stage_key)) {
      states[s.stage_key] = STAGE_STATES.COMPLETED;
    } else if (current && s.sort_order < current.sort_order) {
      states[s.stage_key] = STAGE_STATES.SKIPPED;
    }
  }
  return states;
}

/**
 * Who put each stage in its state, read from the event history — for state
 * rows written after the fact (the backfill, and ensureStageStateRows for a
 * journey with no rows yet). Same rule as the UPDATE in
 * prisma/ddl/2026-10-16-flexible-stage-movement.sql:
 *   completed / rejected / hold -> whoever recorded that outcome there, latest;
 *   active / skipped            -> latest arrival (entered/skip/moved) or outcome there.
 * A stage with no attributed event stays unknown (null): a system action, or a
 * stage that was only jumped over.
 *
 * @param {Record<string, string>} states
 * @param {{stage_key: string, event_type: string, outcome?: string|null, acted_by?: number|null, created_at: Date|string}[]} events
 * @returns {Record<string, number|null>}
 */
export function stageActorsFromEvents(states, events = []) {
  const OUTCOME_FOR = { [STAGE_STATES.COMPLETED]: 'approved', [STAGE_STATES.REJECTED]: 'rejected', [STAGE_STATES.HOLD]: 'hold' };
  const newestFirst = [...events]
    .filter((e) => e.acted_by != null)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const out = {};
  for (const [stageKey, status] of Object.entries(states)) {
    const wanted = OUTCOME_FOR[status];
    const ev = newestFirst.find((e) => e.stage_key === stageKey && (wanted
      ? e.event_type === 'outcome' && e.outcome === wanted
      : ['entered', 'skip', 'moved', 'outcome'].includes(e.event_type)));
    out[stageKey] = ev ? ev.acted_by : null;
  }
  return out;
}

/**
 * The state map for a journey: its stored rows when it has any, otherwise the
 * derived fallback. The current stage always follows the journey's own status,
 * so a stale row can never contradict the board.
 * @param {{stage_key: string, status: string}[]} rows
 * @param {() => Record<string, string>} derive
 * @param {{current_stage_key: string, current_stage_status: string}} pipeline
 */
export function resolveStageStates(rows, derive, pipeline) {
  const states = rows && rows.length
    ? Object.fromEntries(rows.filter((r) => r.status !== STAGE_STATES.NOT_VISITED).map((r) => [r.stage_key, r.status]))
    : derive();
  states[pipeline.current_stage_key] = stateForCurrentStatus(pipeline.current_stage_status);
  return states;
}

/** @param {Record<string, string>} states @param {string} key */
export function stageStatusOf(states, key) {
  return states?.[key] || STAGE_STATES.NOT_VISITED;
}

/** @param {string} status */
export function isMoveTarget(status) {
  return MOVE_TARGET_STATES.includes(status || STAGE_STATES.NOT_VISITED);
}

/**
 * Validates a move and describes it. Throws 400 for a target the candidate may
 * not enter; the lock and the stale-tab checks are the caller's.
 *
 * A passed stage is a RE-DO (L02-C): allowed with a reason, never for
 * Documents or Offer.
 *
 * @param {object} p
 * @param {{stage_key: string, label?: string, sort_order: number, is_active?: boolean}[]} p.stages every stage
 * @param {Record<string, string>} p.states
 * @param {{current_stage_key: string}} p.pipeline
 * @param {string} p.targetStageKey
 * @param {string|null} [p.reason] required for a re-do
 * @returns {{ fromStage: object, toStage: object, direction: 'forward'|'backward', between: object[], skippedCount: number, redo: boolean }}
 */
export function planMove({ stages, states, pipeline, targetStageKey, reason = null }) {
  const sorted = [...stages].sort((a, b) => a.sort_order - b.sort_order);
  const toStage = sorted.find((s) => s.stage_key === targetStageKey);
  if (!targetStageKey || !toStage || toStage.is_active === false || NON_BOARD_STAGE_KEYS.includes(targetStageKey)) {
    throw new AppError(`"${targetStageKey}" is not an active pipeline stage.`, 400);
  }
  const fromStage = sorted.find((s) => s.stage_key === pipeline.current_stage_key)
    || { stage_key: pipeline.current_stage_key, label: pipeline.current_stage_key, sort_order: -Infinity };
  if (toStage.stage_key === fromStage.stage_key) {
    throw new AppError(`The candidate is already on ${labelOf(toStage)}.`, 400);
  }
  const targetStatus = stageStatusOf(states, toStage.stage_key);
  const redo = targetStatus === STAGE_STATES.COMPLETED;
  if (redo && !isRedoable(toStage.stage_key)) {
    throw new AppError(`${labelOf(toStage)} was already passed and cannot be re-done.`, 400);
  }
  if (redo && !String(reason || '').trim()) {
    throw new AppError(`The candidate already passed ${labelOf(toStage)}. Give a reason to re-do it.`, 400);
  }
  if (!redo && !isMoveTarget(targetStatus)) {
    throw new AppError(`${labelOf(toStage)} cannot be entered (it is ${targetStatus}).`, 400);
  }

  const direction = toStage.sort_order > fromStage.sort_order ? 'forward' : 'backward';
  const lo = Math.min(toStage.sort_order, fromStage.sort_order);
  const hi = Math.max(toStage.sort_order, fromStage.sort_order);
  const between = sorted.filter((s) => s.is_active !== false
    && !NON_BOARD_STAGE_KEYS.includes(s.stage_key)
    && s.sort_order > lo && s.sort_order < hi);
  // Only a forward move jumps over anything; a passed stage in between was
  // not skipped by this move.
  const skippedCount = direction === 'forward'
    ? between.filter((s) => stageStatusOf(states, s.stage_key) !== STAGE_STATES.COMPLETED).length
    : 0;
  return { fromStage, toStage, direction, between, skippedCount, redo };
}

/**
 * "Moved forward from HR Screening (Zeko) to Technical Round 1 (skipped 2 stages)",
 * or for a re-do "Re-do: moved back from HR Round to Technical Round 1". The
 * prefixes are what moveHistory.export.js parses; a re-do keeps "Moved".
 */
export function moveNote({ fromStage, toStage, direction, skippedCount, redo = false }) {
  const skipped = skippedCount > 0 ? ` (skipped ${skippedCount} stage${skippedCount === 1 ? '' : 's'})` : '';
  const note = `Moved ${direction} from ${labelOf(fromStage)} to ${labelOf(toStage)}${skipped}`;
  return redo ? `${note} to re-do it` : note;
}

/**
 * Where an Approve lands when stages can be visited in any order (C4): the next
 * stage in order the candidate has not passed, or the stage the recruiter
 * picked, which may be any stage not yet passed (D4 lifts the mandatory check).
 *
 * @param {{stage_key: string, label?: string}[]} stages active stages in sort order
 * @param {number} currentIdx index of the stage being approved
 * @param {Record<string, string>} states
 * After a RE-DO (L02-C), Approve goes back to the stage the candidate was moved
 * from (`returnToStageKey`) when that stage is not passed; later passed stages
 * stay passed.
 *
 * @param {{ skipToStageKey?: string|null, returnToStageKey?: string|null }} [opts]
 * @returns {{ nextStage: object|null, skipped: object[] }} skipped = not-passed
 *   stages the landing jumps over, for the 'skip' arrival note
 */
export function resolveFlexibleApproveLanding(stages, currentIdx, states, { skipToStageKey = null, returnToStageKey = null } = {}) {
  const passed = (s) => stageStatusOf(states, s.stage_key) === STAGE_STATES.COMPLETED;
  if (skipToStageKey) {
    const targetIdx = stages.findIndex((s) => s.stage_key === skipToStageKey);
    if (targetIdx === -1 || targetIdx === currentIdx) {
      throw new AppError(`"${skipToStageKey}" is not another active stage for this candidate.`, 400);
    }
    if (!isMoveTarget(stageStatusOf(states, skipToStageKey))) {
      throw new AppError(
        `The candidate already passed ${labelOf(stages[targetIdx])}. A passed stage cannot be entered again.`,
        400
      );
    }
    const skipped = targetIdx > currentIdx ? stages.slice(currentIdx + 1, targetIdx).filter((s) => !passed(s)) : [];
    return { nextStage: stages[targetIdx], skipped };
  }
  if (returnToStageKey) {
    const back = stages.find((s) => s.stage_key === returnToStageKey);
    if (back && back.stage_key !== stages[currentIdx]?.stage_key && isMoveTarget(stageStatusOf(states, back.stage_key))) {
      return { nextStage: back, skipped: [] };
    }
  }
  const next = stages.slice(currentIdx + 1).find((s) => isMoveTarget(stageStatusOf(states, s.stage_key)));
  return { nextStage: next || null, skipped: [] };
}

/**
 * Timestamp columns for a state row written now.
 * @param {string} status
 * @param {Date} now
 */
export function stateRowStamps(status, now) {
  switch (status) {
    case STAGE_STATES.ACTIVE: return { entered_at: now };
    case STAGE_STATES.COMPLETED: return { completed_at: now };
    case STAGE_STATES.SKIPPED: return { skipped_at: now };
    default: return {};
  }
}

/* ── Lock rule (§2, C2) ─────────────────────────────────────────────────── */

const fmtDate = (d) => (d
  ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
  : null);
const on = (d) => (fmtDate(d) ? ` on ${fmtDate(d)}` : '');

export const LOCK_CODES = Object.freeze({
  CLOSED: 'closed',
  PAUSED: 'paused',
  REJECTED: 'rejected',
  HOLD: 'hold',
  ZEKO_INVITED: 'zeko_invited',
  ZEKO_RESULT: 'zeko_result',
  INTERVIEW_BOOKED: 'interview_booked',
  ASSESSMENT_INVITED: 'assessment_invited',
  ASSESSMENT_RESULT: 'assessment_result',
  DOCUMENTS_REQUESTED: 'documents_requested',
  OFFER_SHARED: 'offer_shared',
});

/**
 * Whether the candidate can be moved off their current stage, and why not.
 * Only the CURRENT stage's activity counts (one active stage at a time, D8).
 *
 * @param {object} p
 * @param {{final_outcome?: string|null, is_paused?: boolean, current_stage_status: string}} p.pipeline
 * @param {object} [p.signals] what has started on the current stage
 * @param {{link_sent_at?: Date, interview_start_at?: Date}|null} [p.signals.zekoInvite] not-cancelled Zeko invite with a link sent
 * @param {boolean} [p.signals.zekoScored]
 * @param {{scheduled_start_at?: Date, stage_key?: string}|null} [p.signals.interview] not-cancelled booking
 * @param {{sent_at?: Date}|null} [p.signals.assessmentInvite] latest invite, not withdrawn
 * @param {boolean} [p.signals.assessmentResult]
 * @param {{requested_at?: Date}|null} [p.signals.documentRequest] request whose link is not closed
 * @param {{shared_at?: Date}|null} [p.signals.offerShared]
 * @returns {{ locked: boolean, code: string|null, reason: string|null }}
 */
export function computeStageLock({ pipeline, signals = {} }) {
  const lock = (code, reason) => ({ locked: true, code, reason });
  if (pipeline.final_outcome) return lock(LOCK_CODES.CLOSED, 'This candidate\'s record is closed. Reopen it first.');
  if (pipeline.is_paused) return lock(LOCK_CODES.PAUSED, 'This journey is paused. Resume it first.');
  if (pipeline.current_stage_status === 'rejected') return lock(LOCK_CODES.REJECTED, 'Rejected in this stage.');
  if (pipeline.current_stage_status === 'hold') return lock(LOCK_CODES.HOLD, 'On hold. Take the candidate off hold first.');

  const s = signals;
  if (s.offerShared) return lock(LOCK_CODES.OFFER_SHARED, `Offer shared${on(s.offerShared.shared_at)}.`);
  if (s.documentRequest) {
    return lock(LOCK_CODES.DOCUMENTS_REQUESTED, `Documents requested${on(s.documentRequest.requested_at)}. Cancel the document request to move the candidate.`);
  }
  if (s.interview) {
    const what = s.interview.stage_key === 'client' ? 'Client interview arranged' : 'Interview booked';
    return lock(LOCK_CODES.INTERVIEW_BOOKED, `${what} for ${fmtDate(s.interview.scheduled_start_at) || 'a date'}. Cancel the interview to move the candidate.`);
  }
  if (s.assessmentResult) return lock(LOCK_CODES.ASSESSMENT_RESULT, 'Evalground result received and awaiting a decision.');
  if (s.assessmentInvite) {
    return lock(LOCK_CODES.ASSESSMENT_INVITED, `Evalground invite sent${on(s.assessmentInvite.sent_at)}. Withdraw the invite to move the candidate.`);
  }
  if (s.zekoScored) return lock(LOCK_CODES.ZEKO_RESULT, 'Zeko result received and awaiting a decision.');
  if (s.zekoInvite) {
    return lock(LOCK_CODES.ZEKO_INVITED, `Zeko invite sent${on(s.zekoInvite.link_sent_at)}. Cancel the Zeko interview to move the candidate.`);
  }
  return { locked: false, code: null, reason: null };
}

function labelOf(stage) {
  return stage?.label || stage?.stage_key || 'that stage';
}
