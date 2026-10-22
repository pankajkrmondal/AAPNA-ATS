/**
 * Change JD (Phase 3 section G, G3).
 *
 * A candidate shortlisted to the wrong JD from Keyword filtering or Search
 * Candidate gets the right JD in place: the shortlist row and its pipeline
 * journey are repointed, the JD tag moves with them, and the candidate stays at
 * the stage they are on (stages are the same for every JD). A keyword
 * shortlist saved without a JD gets one the same way ("Set JD").
 *
 * Refused once anything was set up under the old JD (utils/changeJd.js), when
 * the candidate is already on the new JD, or when the new JD cannot take
 * candidates. Nothing is sent unless the recruiter ticks "Send corrected
 * shortlist email".
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import { clearScreeningRoleCache } from './candidateSync.service.js';
import { retagCandidate } from './candidateTag.service.js';
import { sendShortlistEmail } from './screening.service.js';
import { getMrfJdAttachment } from './jdAttachment.service.js';
import { mrfCandidateBlock, MRF_OPEN_SELECT, parseMrfId } from '../utils/candidateTag.js';
import { changeJdBlock, cleanChangeJdReason, changeJdNote } from '../utils/changeJd.js';

/** The note put before the intro of a corrected shortlist email. */
const CORRECTION_LEAD_HTML = '<p><strong>Please note:</strong> this email replaces our earlier message, '
  + 'which named a different role. The correct role is below.</p>';

function parseShortlistId(value) {
  const s = String(value ?? '').trim();
  if (!/^\d+$/.test(s) || !/[1-9]/.test(s)) throw new AppError('Invalid shortlist id.', 400);
  return Number(s);
}

/** The shortlist row with its MRF and its journey (null when it has none). */
async function loadShortlist(shortlistId, db = prisma) {
  const shortlist = await db.rpa_shortlisted_candidates.findUnique({
    where: { id: shortlistId },
    include: { mrf: { select: { id: true, position_hiring_for: true } } },
  });
  if (!shortlist) return { shortlist: null, journey: null };
  const journey = await db.rpa_candidate_pipeline.findFirst({
    where: { shortlist_id: shortlistId },
    orderBy: { id: 'asc' },
  });
  return { shortlist, journey };
}

/** What was set up under the journey's JD, on any stage (utils/changeJd.js signals). */
async function activitySignals(journey, shortlistId, db = prisma) {
  const zeko = db.rpa_zeko_candidate_pipeline.count({ where: { candidate_id: shortlistId, status: { not: 'cancelled' } } });
  if (!journey) return { zekoInvite: (await zeko) > 0 };
  const pipelineId = journey.id;
  const [offer, documentRequest, interview, assessmentInvite, assessmentResult, zekoInvite] = await Promise.all([
    db.rpa_offers.count({ where: { pipeline_id: pipelineId } }),
    db.rpa_document_requests.count({ where: { pipeline_id: pipelineId } }),
    db.rpa_interview_schedule.count({ where: { pipeline_id: pipelineId, status: { not: 'cancelled' } } }),
    db.rpa_assessment_invites.count({ where: { pipeline_id: pipelineId, withdrawn_at: null } }),
    db.rpa_assessment_results.count({ where: { pipeline_id: pipelineId, status: { in: ['matched', 'score_overwritten'] } } }),
    zeko,
  ]);
  return {
    offer: offer > 0,
    documentRequest: documentRequest > 0,
    interview: interview > 0,
    assessmentInvite: assessmentInvite > 0,
    assessmentResult: assessmentResult > 0,
    zekoInvite: zekoInvite > 0,
  };
}

/** Every MRF the candidate is already on (a journey or any shortlist row): never a target. */
async function mrfsCandidateIsOn(cvId, db = prisma) {
  const [journeys, shortlists] = await Promise.all([
    db.rpa_candidate_pipeline.findMany({ where: { cv_id: cvId, mrf_id: { not: null } }, select: { mrf_id: true } }),
    db.rpa_shortlisted_candidates.findMany({ where: { cv_id: cvId, mrf_id: { not: null } }, select: { mrf_id: true } }),
  ]);
  return new Set([...journeys, ...shortlists].map((r) => String(r.mrf_id)));
}

/**
 * What the Change JD dialog needs before the recruiter picks: the current JD,
 * whether a change is allowed (and why not), and which JDs to leave out.
 * GET /api/screening/shortlist/:shortlistId/change-jd
 */
export async function getChangeJdStatus(rawShortlistId) {
  const shortlistId = parseShortlistId(rawShortlistId);
  const { shortlist, journey } = await loadShortlist(shortlistId);
  if (!shortlist) throw new AppError('Shortlist not found.', 404);
  const signals = await activitySignals(journey, shortlistId);
  const block = changeJdBlock({ shortlist, journey, signals });
  const excluded = shortlist.cv_id ? await mrfsCandidateIsOn(shortlist.cv_id) : new Set();
  return {
    shortlist_id: shortlistId,
    cv_id: shortlist.cv_id != null ? Number(shortlist.cv_id) : null,
    candidate_name: shortlist.candidate_name,
    current_mrf: shortlist.mrf_id
      ? { id: Number(shortlist.mrf_id), role: shortlist.mrf?.position_hiring_for || shortlist.position_applied || null }
      : null,
    pipeline_id: journey ? Number(journey.id) : null,
    allowed: !block,
    block,
    excluded_mrf_ids: [...excluded].map(Number),
  };
}

/**
 * Replace the JD of one shortlist (and its journey).
 * POST /api/screening/shortlist/:shortlistId/change-jd
 *
 * @param {{ shortlistId: unknown, newMrfId: unknown, reason: unknown, notifyCandidate?: boolean,
 *           user: { id?: number, username?: string, email?: string } }} params
 * @returns {Promise<{ shortlist_id: number, pipeline_id: number|null, from_mrf_id: number|null,
 *           to_mrf_id: number, role: string, email: 'not_requested'|'sent'|'failed', email_failure?: object }>}
 */
export async function changeShortlistJd({ shortlistId: rawShortlistId, newMrfId: rawNewMrfId, reason: rawReason, notifyCandidate = false, user = {} }) {
  const shortlistId = parseShortlistId(rawShortlistId);
  const newMrfId = parseMrfId(rawNewMrfId);
  if (!newMrfId) throw new AppError('Pick the correct JD.', 400);
  const reason = cleanChangeJdReason(rawReason);
  if (!reason) throw new AppError('A reason is required.', 400);

  const target = await prisma.rpa_mrf.findUnique({ where: { id: newMrfId }, select: MRF_OPEN_SELECT });
  const targetBlock = mrfCandidateBlock(target, newMrfId);
  if (targetBlock) throw new AppError(targetBlock.message, targetBlock.status);
  const newRole = target.position_hiring_for || `MRF-${newMrfId}`;

  const result = await prisma.$transaction(async (tx) => {
    const { shortlist, journey } = await loadShortlist(shortlistId, tx);
    if (!shortlist) throw new AppError('Shortlist not found.', 404);
    if (!shortlist.cv_id) throw new AppError('This shortlist has no candidate record.', 409);
    const oldMrfId = shortlist.mrf_id;
    if (oldMrfId != null && BigInt(oldMrfId) === newMrfId) {
      throw new AppError('The candidate is already on this JD.', 409);
    }

    // Same lock key as shortlistCandidates for (candidate, new JD), so an
    // "Add to JD" racing this change cannot put the candidate there twice.
    const lockKey = `shortlist:${shortlist.cv_id}:${newMrfId}`;
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${lockKey}))) l`;

    if ((await mrfsCandidateIsOn(shortlist.cv_id, tx)).has(String(newMrfId))) {
      throw new AppError(`This candidate is already on "${newRole}" (MRF-${newMrfId}), so the JD cannot be changed to it.`, 409);
    }
    const block = changeJdBlock({ shortlist, journey, signals: await activitySignals(journey, shortlistId, tx) });
    if (block) throw new AppError(block.message, 409);

    // Claim on the JD this request saw: a second click (or a second
    // recruiter) finds nothing to update and is told so.
    const claimed = await tx.rpa_shortlisted_candidates.updateMany({
      where: { id: shortlistId, mrf_id: oldMrfId },
      data: { mrf_id: newMrfId, position_applied: newRole.slice(0, 255), modified_at: new Date() },
    });
    if (claimed.count === 0) throw new AppError('This shortlist was just changed by someone else. Reload and try again.', 409);

    if (journey) {
      await tx.rpa_candidate_pipeline.update({
        where: { id: journey.id },
        data: { mrf_id: newMrfId, modified_at: new Date() },
      });
      await tx.rpa_pipeline_stage_events.create({
        data: {
          pipeline_id: journey.id,
          stage_key: journey.current_stage_key,
          event_type: 'note',
          notes: changeJdNote({
            fromRole: shortlist.mrf?.position_hiring_for || shortlist.position_applied,
            fromMrfId: oldMrfId != null ? Number(oldMrfId) : null,
            toRole: newRole,
            toMrfId: Number(newMrfId),
            reason,
          }),
          acted_by: Number.isInteger(user?.id) ? user.id : null,
        },
      });
    }
    await retagCandidate({ cvId: shortlist.cv_id, fromMrfId: oldMrfId, toMrfId: newMrfId, actor: user }, { db: tx, clearCache: false });

    return { shortlist, journey, oldMrfId };
  });

  await clearScreeningRoleCache();
  const { shortlist, journey, oldMrfId } = result;
  logger.info(`[change jd] shortlist ${shortlistId} (cv ${shortlist.cv_id}) moved from MRF ${oldMrfId ?? 'none'} to MRF ${newMrfId} by ${user?.username || user?.email || 'unknown'}.`);

  const response = {
    shortlist_id: shortlistId,
    pipeline_id: journey ? Number(journey.id) : null,
    from_mrf_id: oldMrfId != null ? Number(oldMrfId) : null,
    to_mrf_id: Number(newMrfId),
    role: newRole,
    email: 'not_requested',
  };
  if (!notifyCandidate) return response;

  // The corrected shortlist email: the usual template, the new role and JD,
  // and a line saying it replaces the earlier one.
  const record = await prisma.rpa_cv.findUnique({ where: { id: shortlist.cv_id }, select: { Name: true, EmailID: true } });
  const template = await prisma.rpa_email_templates.findFirst({ where: { category: 'shortlist', is_active: true } });
  if (!record || !template) {
    response.email = 'failed';
    response.email_failure = { reason: !record ? 'Candidate record not found.' : 'Shortlist email template not found.' };
    return response;
  }
  const outcome = await sendShortlistEmail({
    c: { Name: record.Name || 'Candidate', EmailID: record.EmailID || '' },
    candidateId: shortlist.cv_id,
    shortlist: { id: shortlistId },
    mrfRef: newMrfId,
    searchType: 'jd',
    roleName: newRole,
    template,
    jd: await getMrfJdAttachment(newMrfId),
    leadHtml: CORRECTION_LEAD_HTML,
  });
  response.email = outcome.sent ? 'sent' : 'failed';
  if (!outcome.sent) response.email_failure = outcome.failure;
  return response;
}
