/**
 * stageMove.js — the client half of the flexible stage movement rules
 * (docs/phase3/pipeline/FLEXIBLE-STAGE-MOVEMENT-DRAG-DROP-PLAN.md). Mirrors
 * backend/src/utils/stageState.js so the popup, the "Move to…" menu and the
 * drag feedback agree with what the server will accept. The server stays the
 * authority: anything it refuses comes back as a 400/409 message.
 */

/** Moves into these stages get the extra "without the interview rounds" warning (C5, C8). */
export const BIG_JUMP_TARGETS = Object.freeze(['documents', 'offer']);

/**
 * Direction and stages skipped for a move, from the board's stage order.
 * @param {{ stages: {stage_key: string}[], fromKey: string, toKey: string, passedStageKeys?: string[] }} p
 * @returns {{ direction: 'forward'|'backward', skippedCount: number, bigJump: boolean }}
 */
export function describeMove({ stages, fromKey, toKey, passedStageKeys = [] }) {
  const keys = stages.map((s) => s.stage_key);
  const from = keys.indexOf(fromKey);
  const to = keys.indexOf(toKey);
  const direction = to > from ? 'forward' : 'backward';
  const skippedCount = direction === 'forward'
    ? keys.slice(from + 1, to).filter((k) => !passedStageKeys.includes(k)).length
    : 0;
  return {
    direction,
    skippedCount,
    bigJump: direction === 'forward' && skippedCount > 0 && BIG_JUMP_TARGETS.includes(toKey),
  };
}

/**
 * Why a card cannot go to a stage, or null when it can.
 * @param {{ current_stage_key: string, passed_stage_keys?: string[] }} card
 * @param {string} stageKey
 * @returns {string|null}
 */
export function moveBlockReason(card, stageKey) {
  if (stageKey === card.current_stage_key) return 'The candidate is already here.';
  if ((card.passed_stage_keys || []).includes(stageKey)) return 'Already passed. A passed stage cannot be entered again.';
  return null;
}

/** Whether the card can be picked up / moved at all. */
export function canMoveCard(card) {
  return !card.lock?.locked && !card.final_outcome;
}
