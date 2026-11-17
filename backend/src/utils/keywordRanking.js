/**
 * Keyword-tab result order (U04b, owner decision 13 Nov 2026).
 *
 * The owner saw "java ×0, python ×0" cards above "java ×6, python ×8" ones:
 * the order put the evidence-weighted score first and mentions last. Now,
 * within the activity groups ("Active candidates first", L01, stays):
 *   1. searched skills matched, more first
 *   2. total resume mentions of the searched skills, more first
 *   3. then the old tiebreaks: score, response speed, semantic distance, newest
 *
 * Stars and the Strong / Moderate / Weak chips still come from the score, so a
 * 3★ card can sit above a 4★ one. The JD tab is unchanged (RT's jdRankScore).
 *
 * Pure: no Prisma, unit tested in tests/unit/keywordRanking.test.js.
 */
import { compareActivity, compareResponseSpeed } from './candidateActivity.js';

/**
 * Sort comparator for keyword results.
 *
 * @param {{ev: ?{matchedCount: number, totalMentions: number}, rating: {avgScore: number},
 *          activity: object, distance: number, c: {createdAt?: unknown}}} a
 * @param {typeof a} b
 * @param {boolean} activeFirst
 * @returns {number}
 */
export function compareKeywordResults(a, b, activeFirst) {
  return (activeFirst ? compareActivity(a.activity, b.activity) : 0)
    || (b.ev?.matchedCount ?? 0) - (a.ev?.matchedCount ?? 0)
    || (b.ev?.totalMentions ?? 0) - (a.ev?.totalMentions ?? 0)
    || b.rating.avgScore - a.rating.avgScore
    || (activeFirst ? compareResponseSpeed(a.activity, b.activity) : 0)
    || a.distance - b.distance
    || new Date(b.c.createdAt || 0) - new Date(a.c.createdAt || 0);
}

export default { compareKeywordResults };
