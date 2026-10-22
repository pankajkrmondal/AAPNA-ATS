/**
 * JD tagging writers and readers (Phase 3 section B, N13).
 *
 * A tag (rpa_candidate_mrf_tags) links a candidate to the JD they were
 * uploaded for (N14) or shortlisted to (shortlistCandidates, incl. Search
 * Candidate's Add to JD, N21). The JD tab's "Tagged to this JD only" switch
 * reads them (N15) and Change JD moves them (G3). The pure rules are in
 * utils/candidateTag.js.
 *
 * Every writer takes `db` so a caller can tag inside its own transaction; such
 * a caller passes clearCache: false and clears the screening cache itself once
 * the transaction has committed.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import { clearScreeningRoleCache } from './candidateSync.service.js';
import AppError from '../utils/AppError.js';
import {
  actorColumns, isTagSource, TAG_SOURCES, UPLOAD_TAG_SOURCES, parseMrfId, mrfCandidateBlock, MRF_OPEN_SELECT,
} from '../utils/candidateTag.js';

/**
 * Tag candidates to one JD. Tagging twice is a no-op (unique cv_id + mrf_id),
 * so the first tag's source and date are kept.
 * @param {{ cvIds: Array<number|bigint|string>, mrfId: number|bigint|string, source: string,
 *           actor?: object|string|null, executionId?: string|null }} params
 * @param {{ db?: object, clearCache?: boolean }} [options]
 * @returns {Promise<number>} how many new tags were written
 */
export async function tagCandidates({ cvIds, mrfId, source, actor = null, executionId = null }, { db = prisma, clearCache = true } = {}) {
  if (!mrfId) return 0;
  if (!isTagSource(source)) throw new Error(`Unknown JD tag source "${source}".`);
  const ids = [...new Set((cvIds || []).filter((x) => x !== null && x !== undefined).map((x) => String(x)))];
  if (ids.length === 0) return 0;

  const who = actorColumns(actor);
  const mrf = BigInt(mrfId);
  const { count } = await db.rpa_candidate_mrf_tags.createMany({
    data: ids.map((id) => ({
      cv_id: BigInt(id),
      mrf_id: mrf,
      source,
      upload_execution_id: executionId ? String(executionId).slice(0, 100) : null,
      ...who,
    })),
    skipDuplicates: true,
  });
  if (count > 0 && clearCache) await clearScreeningRoleCache();
  return count;
}

/**
 * tagCandidates for callers whose own work must not fail because of it
 * (uploads, shortlists). Never throws; a failure is logged.
 */
export async function tagCandidatesSafe(params, options) {
  try {
    return await tagCandidates(params, options);
  } catch (err) {
    logger.error(`[jd tag] could not tag ${params?.cvIds?.length ?? 0} candidate(s) to MRF ${params?.mrfId}: ${err.message}`);
    return 0;
  }
}

/**
 * Change JD (G3): the candidate's link moves from one JD to another. The old
 * JD's tag is removed unless an upload made it, because "uploaded for JD A"
 * stays true even when the shortlist was moved to JD B. A null fromMrfId is
 * "Set JD" on a keyword shortlist that had none.
 * @param {{ cvId: number|bigint|string, fromMrfId: number|bigint|string|null,
 *           toMrfId: number|bigint|string, actor?: object|string|null }} params
 * @param {{ db?: object, clearCache?: boolean }} [options]
 */
export async function retagCandidate({ cvId, fromMrfId, toMrfId, actor = null }, { db = prisma, clearCache = true } = {}) {
  const cv = BigInt(cvId);
  if (fromMrfId) {
    await db.rpa_candidate_mrf_tags.deleteMany({
      where: { cv_id: cv, mrf_id: BigInt(fromMrfId), source: { notIn: UPLOAD_TAG_SOURCES } },
    });
  }
  await tagCandidates(
    { cvIds: [cv], mrfId: toMrfId, source: TAG_SOURCES.CHANGE_JD, actor },
    { db, clearCache: false },
  );
  if (clearCache) await clearScreeningRoleCache();
}

/**
 * The tag of each given candidate on one JD, for the "Tagged" chip.
 * @returns {Promise<Map<string, { source: string, tagged_at: Date, tagged_by: string|null }>>} keyed by cv id string
 */
export async function tagsForMrf(mrfId, cvIds) {
  const ids = (cvIds || []).filter((x) => x !== null && x !== undefined).map((x) => BigInt(x));
  if (!mrfId || ids.length === 0) return new Map();
  const rows = await prisma.rpa_candidate_mrf_tags.findMany({
    where: { mrf_id: BigInt(mrfId), cv_id: { in: ids } },
    select: { cv_id: true, source: true, tagged_at: true, tagged_by: true },
  });
  return new Map(rows.map((r) => [String(r.cv_id), { source: r.source, tagged_at: r.tagged_at, tagged_by: r.tagged_by }]));
}

/** Every JD a candidate is tagged to, newest first. */
export async function tagsForCandidate(cvId) {
  return prisma.rpa_candidate_mrf_tags.findMany({
    where: { cv_id: BigInt(cvId) },
    orderBy: { tagged_at: 'desc' },
    select: { mrf_id: true, source: true, tagged_at: true, tagged_by: true },
  });
}

/**
 * The JD an upload is made for (N14), checked before anything is saved: the
 * picker's value as a BigInt, or null for "no JD". A value that is not a JD
 * id, or a JD that cannot take candidates, is refused with the reason.
 * @param {unknown} rawMrfId the form field
 * @returns {Promise<bigint|null>}
 */
export async function resolveUploadMrf(rawMrfId) {
  const blank = rawMrfId === undefined || rawMrfId === null || String(rawMrfId).trim() === '';
  if (blank) return null;
  const mrfId = parseMrfId(rawMrfId);
  if (!mrfId) throw new AppError('The selected JD is not valid. Pick it again from the list.', 400);
  const mrf = await prisma.rpa_mrf.findUnique({ where: { id: mrfId }, select: MRF_OPEN_SELECT });
  const block = mrfCandidateBlock(mrf, mrfId);
  if (block) throw new AppError(block.message, block.status);
  return mrfId;
}
