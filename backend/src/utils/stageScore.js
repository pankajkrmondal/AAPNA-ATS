/**
 * "Approve without score" rules (Phase 3 "Do Now", N25). Pure, so node:test
 * can load it; the database lookups live in pipeline.service.js stageHasScore().
 *
 * Which evidence counts as "the score" for a stage:
 *   - Zeko rounds (zeko_hr, zeko_fn): a Zeko interview result;
 *   - assessment: an imported assessment result;
 *   - interview rounds: at least one SUBMITTED scorecard for that stage.
 * Shortlist, documents and offer expect no score, so approving them never
 * needs the note.
 */

export const MIN_NO_SCORE_NOTE_LENGTH = 10;

const ZEKO_STAGES = new Set(['zeko_hr', 'zeko_fn']);
const SCORECARD_STAGES = new Set(['tech1', 'tech2', 'tech3', 'hr_round', 'ceo', 'client']);

/**
 * @param {string} stageKey
 * @returns {'zeko'|'assessment'|'scorecard'|null} null = no score expected
 */
export function scoreSourceFor(stageKey) {
  if (ZEKO_STAGES.has(stageKey)) return 'zeko';
  if (stageKey === 'assessment') return 'assessment';
  if (SCORECARD_STAGES.has(stageKey)) return 'scorecard';
  return null;
}

/**
 * Validation message for approving a stage that has no score, or null when
 * the approval may go ahead.
 * @param {{ hasScore: boolean|null, notes: string|null|undefined }} p
 *   hasScore null = this stage expects no score
 */
export function noScoreNoteError({ hasScore, notes }) {
  if (hasScore !== false) return null;
  if (String(notes || '').trim().length >= MIN_NO_SCORE_NOTE_LENGTH) return null;
  return `This round has no score yet. To approve without one, add a note of at least ${MIN_NO_SCORE_NOTE_LENGTH} characters explaining why.`;
}
