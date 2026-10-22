/**
 * Keeps the pipeline's copy of a candidate's name and email in step with the
 * candidate record, and drops the caches that would otherwise keep serving the
 * old values (N29). The rules themselves are in utils/candidateSync.js.
 *
 * Called after every write that can change rpa_cv.Name or EmailID: the Search
 * Candidate edit, the public missing-details form, an upload merge and Outlook
 * intake. Kept in its own module so the upload code can call it without an
 * import cycle through candidate.service.js.
 *
 * The audit is docs/reference/candidate-data-copies.md.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import redis from '../config/redis.js';
import { shortlistIdentityPatch } from '../utils/candidateSync.js';

/**
 * Copy rpa_cv.Name / EmailID onto every shortlist row for this candidate.
 * @param {number|bigint|string} cvId
 * @param {{ previousEmails?: string[], db?: object }} [options]
 *   previousEmails - the address(es) the record held before this edit, kept so
 *     the drawer's inbox still finds old threads; db - a transaction client
 * @returns {Promise<number>} how many shortlist rows changed
 */
export async function syncShortlistIdentity(cvId, { previousEmails = [], db = prisma } = {}) {
  const id = BigInt(cvId);
  const [cv, rows] = await Promise.all([
    db.rpa_cv.findUnique({ where: { id }, select: { Name: true, EmailID: true } }),
    db.rpa_shortlisted_candidates.findMany({
      where: { cv_id: id },
      select: { id: true, candidate_name: true, candidate_email: true, candidate_email_all: true },
    }),
  ]);
  if (!cv || rows.length === 0) return 0;

  let changed = 0;
  for (const row of rows) {
    const patch = shortlistIdentityPatch(row, cv, previousEmails);
    if (Object.keys(patch).length === 0) continue;
    await db.rpa_shortlisted_candidates.update({
      where: { id: row.id },
      data: { ...patch, modified_at: new Date() },
    });
    changed += 1;
  }
  if (changed) logger.info(`[candidate sync] cv ${id}: pipeline copy updated on ${changed} shortlist row(s)`);
  return changed;
}

/**
 * syncShortlistIdentity for callers whose own work must not fail because of
 * it (uploads, intake, the public form). Never throws.
 */
export async function syncShortlistIdentitySafe(cvId, options) {
  try {
    return await syncShortlistIdentity(cvId, options);
  } catch (err) {
    logger.error(`[candidate sync] cv ${cvId}: could not update the pipeline copy: ${err.message}`);
    return 0;
  }
}

/**
 * Drop every cached screening result list (both versions: the glob matches
 * screening:role:v2:* too), so the next search reads the edited record.
 * Never throws.
 */
export async function clearScreeningRoleCache() {
  try {
    const keys = await redis.keys('screening:role:*');
    if (keys.length > 0) await redis.del(keys);
    return keys.length;
  } catch (err) {
    logger.warn('Failed to invalidate the screening cache:', { error: err.message });
    return 0;
  }
}

/**
 * Drop one candidate's cached per-MRF insight text (screeningV2.service.js
 * insightKey), which would otherwise describe the record as it was for 7 days.
 * Never throws.
 */
export async function clearCandidateInsightCache(cvId) {
  try {
    const keys = await redis.keys(`insight:mrf:*:cv:${cvId}`);
    if (keys.length > 0) await redis.del(keys);
    return keys.length;
  } catch (err) {
    logger.warn(`Failed to invalidate the insight cache for candidate ${cvId}:`, { error: err.message });
    return 0;
  }
}
