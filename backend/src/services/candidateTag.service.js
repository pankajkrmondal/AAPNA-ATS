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
  tagChangeBlock, tagActions,
} from '../utils/candidateTag.js';
import { cleanMoveReason } from '../utils/journeyMove.js';

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

// ── Remove / switch a wrong tag (L02-B, Harish 22 Oct 2026) ──────────────

function parseCvId(value) {
  const s = String(value ?? '').trim();
  if (!/^\d+$/.test(s) || !/[1-9]/.test(s)) throw new AppError('Invalid candidate id.', 400);
  return BigInt(s);
}

/** mrf id string -> open pipeline id, for one candidate. */
async function openJourneysByMrf(cvId, db = prisma) {
  const rows = await db.rpa_candidate_pipeline.findMany({
    where: { cv_id: cvId, final_outcome: null, mrf_id: { not: null } },
    select: { id: true, mrf_id: true },
  });
  return new Map(rows.map((r) => [String(r.mrf_id), Number(r.id)]));
}

/** The audit trail for tag changes: the app's actor-attributed log. Best effort. */
function auditTagChange(status, message, user) {
  return prisma.rpa_processing_log.create({
    data: {
      source: 'JD_TAG',
      status,
      logMessage: message.slice(0, 2000),
      actor_email: user?.email || null,
      actor_context: `${user?.role || 'unknown'} (${user?.username || user?.id || 'unknown'})`,
      createdAt: new Date(),
    },
  }).catch((err) => logger.warn(`[jd tag] audit write failed: ${err.message}`));
}

/**
 * Every JD a candidate is tagged to, with what each chip allows (L02-B).
 * GET /api/candidates/:id/tags
 */
export async function listCandidateTags(rawCvId) {
  const cvId = parseCvId(rawCvId);
  const [rows, open] = await Promise.all([
    prisma.rpa_candidate_mrf_tags.findMany({
      where: { cv_id: cvId },
      orderBy: { tagged_at: 'desc' },
      select: {
        mrf_id: true, source: true, tagged_at: true, tagged_by: true,
        mrf: { select: { position_hiring_for: true, date_of_request: true } },
      },
    }),
    openJourneysByMrf(cvId),
  ]);
  const tags = rows.map((r) => ({
    mrf_id: Number(r.mrf_id),
    role: r.mrf?.position_hiring_for || `MRF-${r.mrf_id}`,
    mrf_date: r.mrf?.date_of_request || null,
    source: r.source,
    tagged_at: r.tagged_at,
    tagged_by: r.tagged_by,
  }));
  return { cv_id: Number(cvId), tags: tagActions(tags, open) };
}

/**
 * Remove one wrong tag. Refused for the candidate's only tag (switch it
 * instead) and for a JD they are in the pipeline for (Move instead).
 * DELETE /api/candidates/:id/tags/:mrfId  body { reason }
 */
export async function untagCandidate({ cvId: rawCvId, mrfId: rawMrfId, reason: rawReason, user = {} }) {
  const cvId = parseCvId(rawCvId);
  const mrfId = parseMrfId(rawMrfId);
  if (!mrfId) throw new AppError('Invalid JD.', 400);
  const reason = cleanMoveReason(rawReason);
  if (!reason) throw new AppError('A reason is required.', 400);

  await prisma.$transaction(async (tx) => {
    const tags = await tx.rpa_candidate_mrf_tags.findMany({ where: { cv_id: cvId }, select: { mrf_id: true } });
    const block = tagChangeBlock({ action: 'remove', tags, mrfId, openJourneyMrfIds: new Set((await openJourneysByMrf(cvId, tx)).keys()) });
    if (block) throw new AppError(block.message, block.status);
    await tx.rpa_candidate_mrf_tags.deleteMany({ where: { cv_id: cvId, mrf_id: mrfId } });
  });
  await clearScreeningRoleCache();
  await auditTagChange('removed', `cv ${cvId}: tag to MRF-${mrfId} removed. Reason: ${reason}`, user);
  logger.info(`[jd tag] cv ${cvId}: tag to MRF ${mrfId} removed by ${user?.username || user?.email || 'unknown'}.`);
  return listCandidateTags(cvId);
}

/**
 * Switch one tag to the right JD, whatever made it (upload included). For a
 * JD the candidate is in the pipeline for, use Move to another JD.
 * POST /api/candidates/:id/tags/:mrfId/switch  body { to_mrf_id, reason }
 */
export async function switchCandidateTag({ cvId: rawCvId, fromMrfId: rawFrom, toMrfId: rawTo, reason: rawReason, user = {} }) {
  const cvId = parseCvId(rawCvId);
  const fromMrfId = parseMrfId(rawFrom);
  const toMrfId = parseMrfId(rawTo);
  if (!fromMrfId) throw new AppError('Invalid JD.', 400);
  if (!toMrfId) throw new AppError('Pick the right JD.', 400);
  if (fromMrfId === toMrfId) throw new AppError('The candidate is already tagged to this JD.', 409);
  const reason = cleanMoveReason(rawReason);
  if (!reason) throw new AppError('A reason is required.', 400);

  const target = await prisma.rpa_mrf.findUnique({ where: { id: toMrfId }, select: MRF_OPEN_SELECT });
  const targetBlock = mrfCandidateBlock(target, toMrfId);
  if (targetBlock) throw new AppError(targetBlock.message, targetBlock.status);

  await prisma.$transaction(async (tx) => {
    const tags = await tx.rpa_candidate_mrf_tags.findMany({ where: { cv_id: cvId }, select: { mrf_id: true } });
    const block = tagChangeBlock({ action: 'switch', tags, mrfId: fromMrfId, openJourneyMrfIds: new Set((await openJourneysByMrf(cvId, tx)).keys()) });
    if (block) throw new AppError(block.message, block.status);
    await tx.rpa_candidate_mrf_tags.deleteMany({ where: { cv_id: cvId, mrf_id: fromMrfId } });
    await tagCandidates({ cvIds: [cvId], mrfId: toMrfId, source: TAG_SOURCES.CHANGE_JD, actor: user }, { db: tx, clearCache: false });
  });
  await clearScreeningRoleCache();
  await auditTagChange('switched', `cv ${cvId}: tag switched from MRF-${fromMrfId} to MRF-${toMrfId}. Reason: ${reason}`, user);
  logger.info(`[jd tag] cv ${cvId}: tag switched from MRF ${fromMrfId} to MRF ${toMrfId} by ${user?.username || user?.email || 'unknown'}.`);
  return listCandidateTags(cvId);
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
