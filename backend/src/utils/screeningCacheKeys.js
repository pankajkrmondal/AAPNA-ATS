/**
 * Redis keys for cached JD-screening results (N38). Pure — node:test can load it.
 *
 * The "Added within" filter makes the same MRF return different candidates,
 * so each filter value gets its own key. Only the values the screen offers are
 * cached; anything else is computed fresh. That keeps the set of keys for one
 * MRF finite, so an MRF edit or closure can delete every variant by name
 * (allRoleCacheKeys) instead of scanning Redis.
 *
 * "Tagged to this JD only" (N15) is a second dimension: a tagged-only result
 * gets a ":t" suffix after the "Added within" one.
 *
 * "Active candidates first" (L01) is a third: that order also decides which
 * top 10 get AI insights, so it is cached apart, with an ":a" suffix last. The
 * score-only keys are the ones used before L01, so nothing cached earlier is
 * ever served in the new order.
 */

/** "Added within" choices on both screening tabs: 7 / 10 / 15 days, 1 month, 3 months. */
export const RECENCY_DAY_OPTIONS = Object.freeze([7, 10, 15, 30, 90]);

/** True when a result for this filter value may be cached. */
export const isCacheableRecency = (days) => days == null || RECENCY_DAY_OPTIONS.includes(Number(days));

const suffix = (days, tagged, activeFirst) =>
  `${days == null ? '' : `:d${Number(days)}`}${tagged ? ':t' : ''}${activeFirst ? ':a' : ''}`;

/** Old JD search (SCREENING_V2 off). The unfiltered key is unchanged from before N38. */
export const roleCacheKey = (mrfId, days = null, tagged = false, activeFirst = false) =>
  `screening:role:${mrfId}${suffix(days, tagged, activeFirst)}`;

/** V2 JD search. The unfiltered key is unchanged from before N38. */
export const roleCacheKeyV2 = (mrfId, days = null, tagged = false, activeFirst = false) =>
  `screening:role:v2:${mrfId}${suffix(days, tagged, activeFirst)}`;

/** Every cached JD result for one MRF, both searches, every filter value — for redis.del(...). */
export function allRoleCacheKeys(mrfId) {
  const variants = [null, ...RECENCY_DAY_OPTIONS];
  return [false, true].flatMap((activeFirst) => [false, true].flatMap((tagged) => variants.flatMap((d) => [
    roleCacheKey(mrfId, d, tagged, activeFirst),
    roleCacheKeyV2(mrfId, d, tagged, activeFirst),
  ])));
}
