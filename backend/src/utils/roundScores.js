/**
 * Per-round scores for the pipeline drawer (N28) — pure, no prisma, so the
 * round scoping can be unit-tested without a database.
 *
 * Every round keeps its own scores after it has passed. The rule that matters
 * is the one from the 24/25-Aug incidents (pipeline.service.js, findZekoRoundResult
 * and the rpa_cv note in getPipelineDetail): a score is shown only under the
 * round that produced it. Each Zeko round is looked up by its OWN stage key, and
 * a round with no result of its own shows no score — never the other round's.
 */

import { ZEKO_STAGE_KEYS } from '../config/pipelineStages.js';

/**
 * Drawer-shaped Zeko scores from one rpa_zeko_interview_results row, or null
 * when the row carries no score at all.
 * @param {object|null} result
 */
export function zekoScoresFromResult(result) {
  if (!result) return null;
  const { scores_overallscore: overall, scores_technicalscore: coding, scores_communicationscore: comms } = result;
  if (overall == null && coding == null && comms == null) return null;
  return { ZekoInterviewScore: overall, ZekoCodingScore: coding, ZekoCommunicationScore: comms };
}

/**
 * Both Zeko rounds, each from its own lookup.
 * @param {(stageKey: string) => Promise<{round: object|null, result: object|null}>} findRound
 *   the round-scoped lookup (pipeline.service.js findZekoRoundResult)
 * @returns {Promise<Record<string, {round: object, scores: object|null, reportLink: string|null, sharedReportLink: string|null}|null>>}
 *   keyed by stage key ('zeko_hr', 'zeko_fn'); null for a round never assigned
 */
export async function buildZekoRounds(findRound) {
  const entries = await Promise.all(ZEKO_STAGE_KEYS.map(async (stageKey) => {
    const { round, result } = await findRound(stageKey);
    if (!round) return [stageKey, null];
    return [stageKey, {
      round,
      scores: zekoScoresFromResult(result),
      reportLink: result?.reportlink || null,
      sharedReportLink: result?.shared_report_link || null,
    }];
  }));
  return Object.fromEntries(entries);
}

/**
 * The legacy score columns on rpa_cv, as Excel uploads and Search Candidate
 * write them, in the order the drawer lists them. The Zeko ones are the
 * candidate-level copy (one set for both rounds; the Zeko sync also writes
 * them), so the drawer shows them here as recorded, never under a round.
 */
export const UPLOADED_SCORE_FIELDS = Object.freeze([
  { key: 'Heat', label: 'Heat' },
  { key: 'IQScore', label: 'IQ score' },
  { key: 'TechScore', label: 'Tech score' },
  { key: 'ZekoInterviewScore', label: 'Zeko interview' },
  { key: 'ZekoCodingScore', label: 'Zeko coding' },
  { key: 'ZekoCommunicationScore', label: 'Zeko communication' },
  { key: 'TechRoundOne', label: 'Tech round 1' },
  { key: 'TechRoundTwo', label: 'Tech round 2' },
  { key: 'TechRoundThree', label: 'Tech round 3' },
  { key: 'HRInterview', label: 'HR interview' },
  { key: 'ManagerialOrCEOFeedback', label: 'Managerial / CEO feedback' },
  { key: 'HRQuickcomments', label: 'HR quick comments' },
  // FinalStatus is left out: the pipeline writes it on every outcome, so it is
  // a status, not an uploaded score.
]);

/**
 * The read-only "Uploaded scores" list: only the fields that hold something.
 * Decimals arrive from Prisma as Decimal objects, so every value is stringified.
 * @param {object|null} cv - rpa_cv row with the UPLOADED_SCORE_FIELDS columns
 * @returns {{ key: string, label: string, value: string }[]}
 */
export function uploadedScoresFromCv(cv) {
  if (!cv) return [];
  return UPLOADED_SCORE_FIELDS
    .map(({ key, label }) => ({ key, label, value: cv[key] == null ? '' : String(cv[key]).trim() }))
    .filter((f) => f.value !== '');
}
