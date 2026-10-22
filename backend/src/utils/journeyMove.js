/**
 * Move to another JD (L02-A, design approved 22 Oct 2026) — the pure rules.
 * No database, so node:test can load it.
 *
 * A move closes the candidate's journey on one JD silently (final outcome
 * moved_to_other_jd) and opens a fresh journey on another JD, from the first
 * stage ("Start from scratch") or a stage the recruiter picks. Nothing is
 * copied: the old journey keeps its results and the new one shows them under
 * "Earlier roles for this candidate".
 *
 * Change JD (G3) stays the tool for a shortlist with nothing set up yet; it
 * repoints the same journey. Move works at any stage, before an offer.
 */
import { NON_BOARD_STAGE_KEYS } from './stageState.js';

/** Longest reason kept (it is shown in both journeys' history). */
export const MOVE_REASON_MAX = 500;

/**
 * The reason a recruiter typed, trimmed, or null when it is missing.
 * @param {unknown} value
 * @returns {string|null}
 */
export function cleanMoveReason(value) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return text ? text.slice(0, MOVE_REASON_MAX) : null;
}

/**
 * Why this journey cannot be moved, or null when it can.
 * A stage rejection does not block: "rejected for the senior role, right for
 * the junior one" is exactly what a move is for.
 * @param {{ journey: { final_outcome?: string|null, is_paused?: boolean, cv_id?: unknown } | null,
 *           hasOffer?: boolean }} input
 * @returns {{ code: string, message: string } | null}
 */
export function moveJourneyBlock({ journey, hasOffer = false }) {
  if (!journey) return { code: 'not_found', message: 'This candidate record no longer exists.' };
  if (!journey.cv_id) return { code: 'no_candidate', message: 'This record has no candidate attached.' };
  if (journey.final_outcome) {
    return { code: 'closed', message: 'This candidate\'s record is closed. Reopen it first, or add them to the other JD from Search Candidate.' };
  }
  if (journey.is_paused) return { code: 'paused', message: 'This journey is paused. Resume it first.' };
  if (hasOffer) {
    return { code: 'offer', message: 'An offer exists for this JD, so the candidate cannot be moved. Close the record instead.' };
  }
  return null;
}

/**
 * The active board stages in order: what a moved candidate can land on.
 * @param {{ stage_key: string, label?: string, sort_order: number, is_active?: boolean }[]} stages
 */
export function landingStages(stages) {
  return [...(stages || [])]
    .filter((s) => s.is_active !== false && !NON_BOARD_STAGE_KEYS.includes(s.stage_key))
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((s) => ({ stage_key: s.stage_key, label: s.label || s.stage_key }));
}

/**
 * The stage a move lands on: the one asked for, or the first stage when none
 * is ("Start from scratch"). Null when the key is not an active board stage.
 * @param {{ stage_key: string, label: string }[]} boardStages from landingStages()
 * @param {string|null|undefined} key
 */
export function resolveLandingStage(boardStages, key) {
  if (!boardStages?.length) return null;
  if (key === null || key === undefined || key === '') return boardStages[0];
  return boardStages.find((s) => s.stage_key === key) || null;
}

const roleRef = (role, mrfId) => `"${role || 'Untitled role'}" (MRF-${mrfId})`;

/**
 * History notes for both journeys.
 * @returns {{ closeNote: string, entryNote: string }}
 */
export function moveNotes({ fromRole, fromMrfId, fromStageLabel, toRole, toMrfId, toStageLabel, startFromScratch, reason }) {
  const landing = startFromScratch ? `from the start (${toStageLabel})` : `at ${toStageLabel}`;
  return {
    closeNote: `Moved to ${roleRef(toRole, toMrfId)}, ${landing}. Reason: ${reason}`,
    entryNote: `Moved from ${roleRef(fromRole, fromMrfId)} at ${fromStageLabel}, ${landing}. Reason: ${reason}`,
  };
}

/** The intro line of the optional email about the new role. */
export function movedEmailLeadHtml(role) {
  const safe = String(role || 'a new role').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
  return `<p><strong>Please note:</strong> you are now being considered for the role of <strong>${safe}</strong>. `
    + 'Its job description is attached. Your earlier application details stay on file.</p>';
}

export default {
  MOVE_REASON_MAX,
  cleanMoveReason,
  moveJourneyBlock,
  landingStages,
  resolveLandingStage,
  moveNotes,
  movedEmailLeadHtml,
};
