/**
 * Move to another JD (L02-A, design approved 22 Oct 2026).
 *
 * Closes the candidate's journey on its JD silently (moved_to_other_jd: no
 * candidate email, no vendor email) and opens a new journey on another JD,
 * from the first stage or a chosen one. The new journey records where it came
 * from (moved_from_pipeline_id) and the old journey keeps all its results;
 * the drawer shows them under "Earlier roles for this candidate"
 * (getRelatedJourneys). Nothing is copied or deleted.
 *
 * Rules: utils/journeyMove.js. Change JD (G3, changeJd.service.js) stays the
 * tool for a shortlist with nothing set up yet.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import { FINAL_OUTCOMES, STAGE_KEYS, stagePendingLabelFor } from '../config/pipelineStages.js';
import { clearScreeningRoleCache } from './candidateSync.service.js';
import { tagCandidatesSafe } from './candidateTag.service.js';
import { createPipelineJourney, setFinalOutcome, reopenJourney } from './pipeline.service.js';
import { sendShortlistEmail } from './screening.service.js';
import { getMrfJdAttachment } from './jdAttachment.service.js';
import { mrfCandidateBlock, MRF_OPEN_SELECT, parseMrfId, TAG_SOURCES } from '../utils/candidateTag.js';
import {
  cleanMoveReason, moveJourneyBlock, landingStages, resolveLandingStage, moveNotes, movedEmailLeadHtml,
} from '../utils/journeyMove.js';

function parsePipelineId(value) {
  const s = String(value ?? '').trim();
  if (!/^\d+$/.test(s) || !/[1-9]/.test(s)) throw new AppError('Invalid pipeline id.', 400);
  return BigInt(s);
}

const actorId = (user) => (Number.isInteger(user?.id) ? user.id : null);

/** The journey with its shortlist row and MRF. */
async function loadJourney(pipelineId) {
  return prisma.rpa_candidate_pipeline.findUnique({
    where: { id: pipelineId },
    include: { rpa_shortlisted_candidates: { include: { mrf: { select: { id: true, position_hiring_for: true } } } } },
  });
}

const roleOf = (journey) => journey?.rpa_shortlisted_candidates?.mrf?.position_hiring_for
  || journey?.rpa_shortlisted_candidates?.position_applied
  || 'Role not recorded';

async function boardStages() {
  const rows = await prisma.rpa_pipeline_stages.findMany({
    select: { stage_key: true, label: true, sort_order: true, is_active: true },
  });
  return landingStages(rows);
}

/** Every MRF the candidate is on (a journey or a shortlist row): never a target. */
async function mrfsCandidateIsOn(cvId) {
  const [journeys, shortlists] = await Promise.all([
    prisma.rpa_candidate_pipeline.findMany({ where: { cv_id: cvId, mrf_id: { not: null } }, select: { mrf_id: true } }),
    prisma.rpa_shortlisted_candidates.findMany({ where: { cv_id: cvId, mrf_id: { not: null } }, select: { mrf_id: true } }),
  ]);
  return new Set([...journeys, ...shortlists].map((r) => String(r.mrf_id)));
}

async function hasOffer(pipelineId) {
  return (await prisma.rpa_offers.count({ where: { pipeline_id: pipelineId } })) > 0;
}

/**
 * What the Move dialog needs before the recruiter picks.
 * GET /api/pipeline/:id/move-jd
 */
export async function getMoveJdStatus(rawPipelineId) {
  const pipelineId = parsePipelineId(rawPipelineId);
  const journey = await loadJourney(pipelineId);
  if (!journey) throw new AppError('Pipeline journey not found.', 404);
  const [offer, stages, excluded] = await Promise.all([
    hasOffer(pipelineId),
    boardStages(),
    journey.cv_id ? mrfsCandidateIsOn(journey.cv_id) : Promise.resolve(new Set()),
  ]);
  const block = moveJourneyBlock({ journey, hasOffer: offer });
  const current = stages.find((s) => s.stage_key === journey.current_stage_key);
  return {
    pipeline_id: Number(pipelineId),
    cv_id: journey.cv_id != null ? Number(journey.cv_id) : null,
    candidate_name: journey.rpa_shortlisted_candidates?.candidate_name || null,
    current: {
      mrf_id: journey.mrf_id != null ? Number(journey.mrf_id) : null,
      role: roleOf(journey),
      stage_key: journey.current_stage_key,
      stage_label: current?.label || journey.current_stage_key,
    },
    allowed: !block,
    block,
    excluded_mrf_ids: [...excluded].map(Number),
    stages,
    first_stage_key: stages[0]?.stage_key || null,
  };
}

/**
 * Move one journey to another JD.
 * POST /api/pipeline/:id/move-jd
 *
 * @param {{ pipelineId: unknown, targetMrfId: unknown, landingStageKey?: string|null, reason: unknown,
 *           notifyCandidate?: boolean, user: { id?: number, username?: string, email?: string } }} params
 * @returns {Promise<{ from_pipeline_id: number, to_pipeline_id: number, to_mrf_id: number, role: string,
 *           landing_stage_key: string, email: 'not_requested'|'sent'|'failed', email_failure?: object }>}
 */
export async function moveJourneyToMrf({
  pipelineId: rawPipelineId, targetMrfId: rawTargetMrfId, landingStageKey = null, reason: rawReason,
  notifyCandidate = false, user = {},
}) {
  const pipelineId = parsePipelineId(rawPipelineId);
  const targetMrfId = parseMrfId(rawTargetMrfId);
  if (!targetMrfId) throw new AppError('Pick the JD to move the candidate to.', 400);
  const reason = cleanMoveReason(rawReason);
  if (!reason) throw new AppError('A reason is required.', 400);

  const journey = await loadJourney(pipelineId);
  const block = moveJourneyBlock({ journey, hasOffer: journey ? await hasOffer(pipelineId) : false });
  if (block) throw new AppError(block.message, block.code === 'not_found' ? 404 : 409);
  const cvId = journey.cv_id;

  const target = await prisma.rpa_mrf.findUnique({ where: { id: targetMrfId }, select: MRF_OPEN_SELECT });
  const targetBlock = mrfCandidateBlock(target, targetMrfId);
  if (targetBlock) throw new AppError(targetBlock.message, targetBlock.status);
  const newRole = target.position_hiring_for || `MRF-${targetMrfId}`;
  if (journey.mrf_id != null && BigInt(journey.mrf_id) === targetMrfId) {
    throw new AppError('The candidate is already on this JD.', 409);
  }

  const stages = await boardStages();
  const landing = resolveLandingStage(stages, landingStageKey);
  if (!landing) throw new AppError(`"${landingStageKey}" is not an active pipeline stage.`, 400);
  const startFromScratch = landing.stage_key === stages[0].stage_key;
  const fromStage = stages.find((s) => s.stage_key === journey.current_stage_key);
  const notes = moveNotes({
    fromRole: roleOf(journey),
    fromMrfId: journey.mrf_id != null ? Number(journey.mrf_id) : '?',
    fromStageLabel: fromStage?.label || journey.current_stage_key,
    toRole: newRole,
    toMrfId: Number(targetMrfId),
    toStageLabel: landing.label,
    startFromScratch,
    reason,
  });

  const record = await prisma.rpa_cv.findUnique({ where: { id: cvId }, select: { Name: true, EmailID: true } });
  const candidateName = record?.Name || journey.rpa_shortlisted_candidates?.candidate_name || 'Candidate';
  const candidateEmail = record?.EmailID || journey.rpa_shortlisted_candidates?.candidate_email || '';

  // Step 1: the new shortlist row, under the same lock as shortlistCandidates
  // for (candidate, new JD), so an "Add to JD" racing the move cannot put the
  // candidate there twice. Written before the old journey is closed: if the
  // candidate turns out to be on the new JD already, nothing has changed yet.
  const shortlist = await prisma.$transaction(async (tx) => {
    const lockKey = `shortlist:${cvId}:${targetMrfId}`;
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${lockKey}))) l`;
    const [onJourney, onShortlist] = await Promise.all([
      tx.rpa_candidate_pipeline.count({ where: { cv_id: cvId, mrf_id: targetMrfId } }),
      tx.rpa_shortlisted_candidates.count({ where: { cv_id: cvId, mrf_id: targetMrfId } }),
    ]);
    if (onJourney + onShortlist > 0) {
      throw new AppError(`This candidate is already on "${newRole}" (MRF-${targetMrfId}). Open that record instead.`, 409);
    }
    return tx.rpa_shortlisted_candidates.create({
      data: {
        cv_id: cvId,
        mrf_id: targetMrfId,
        candidate_name: candidateName,
        candidate_email: candidateEmail,
        position_applied: newRole.slice(0, 255),
        shortlisted_by: user?.username || user?.email || 'recruiter',
        shortlisted_at: new Date(),
        pipeline_status: 'shortlisted',
      },
    });
  });

  // Step 2: close the old journey. Silent for the candidate and the vendor;
  // its own claim makes a second click fail here, before anything else.
  try {
    await setFinalOutcome(Number(pipelineId), {
      finalOutcomeKey: FINAL_OUTCOMES.MOVED_TO_OTHER_JD,
      notes: notes.closeNote,
      actedBy: actorId(user),
      notifyCandidate: false,
      notifyVendor: false,
    });
  } catch (err) {
    await prisma.rpa_shortlisted_candidates.delete({ where: { id: shortlist.id } }).catch((e) => {
      logger.error(`[move jd] could not remove shortlist ${shortlist.id} after a failed close: ${e.message}`);
    });
    throw err;
  }

  // Step 3: the new journey. On failure the old journey is reopened and the
  // new shortlist row removed, so the candidate is never left on neither JD.
  let created;
  try {
    created = await createPipelineJourney({
      cvId,
      mrfId: targetMrfId,
      shortlistId: shortlist.id,
      source: journey.source || 'recruiter',
      actedBy: actorId(user),
      move: {
        fromPipelineId: pipelineId,
        startStageKey: landing.stage_key,
        attribution: { source: journey.source || 'recruiter', vendor_email: journey.vendor_email || null },
        entryNote: notes.entryNote,
      },
    });
  } catch (err) {
    logger.error(`[move jd] journey ${pipelineId}: new journey on MRF ${targetMrfId} failed, putting the old one back: ${err.message}`);
    await reopenJourney(Number(pipelineId), { reason: `Move to "${newRole}" failed: ${err.message}`.slice(0, 500), actedBy: actorId(user) })
      .catch((e) => logger.error(`[move jd] could not reopen journey ${pipelineId}: ${e.message}`));
    await prisma.rpa_shortlisted_candidates.delete({ where: { id: shortlist.id } })
      .catch((e) => logger.error(`[move jd] could not remove shortlist ${shortlist.id}: ${e.message}`));
    throw new AppError(`The candidate could not be moved, so nothing changed: ${err.message}`, 500);
  }

  // Step 4: tag, the candidate-wide status, the screening cache. Best effort:
  // the move itself is done.
  await tagCandidatesSafe({ cvIds: [cvId], mrfId: targetMrfId, source: TAG_SOURCES.MOVE, actor: user }, { clearCache: false });
  try {
    const status = landing.stage_key === STAGE_KEYS.ZEKO_HR ? 'Stage 0 - Resume Shortlisted' : stagePendingLabelFor(landing.stage_key);
    await prisma.rpa_cv.update({ where: { id: cvId }, data: { FinalStatus: status } });
  } catch (err) {
    logger.error(`[move jd] FinalStatus write failed for cv ${cvId}: ${err.message}`);
  }
  await clearScreeningRoleCache();
  logger.info(`[move jd] cv ${cvId}: journey ${pipelineId} (MRF ${journey.mrf_id ?? 'none'}) moved to journey ${created.id} (MRF ${targetMrfId}, ${landing.stage_key}) by ${user?.username || user?.email || 'unknown'}.`);

  const response = {
    from_pipeline_id: Number(pipelineId),
    to_pipeline_id: Number(created.id),
    to_mrf_id: Number(targetMrfId),
    role: newRole,
    landing_stage_key: landing.stage_key,
    email: 'not_requested',
  };
  if (!notifyCandidate) return response;

  // Optional: the shortlist email for the new role, its JD attached, with a
  // line saying they are now considered for it.
  const template = await prisma.rpa_email_templates.findFirst({ where: { category: 'shortlist', is_active: true } });
  if (!template) {
    response.email = 'failed';
    response.email_failure = { reason: 'Shortlist email template not found.' };
    return response;
  }
  const outcome = await sendShortlistEmail({
    c: { Name: candidateName, EmailID: candidateEmail },
    candidateId: cvId,
    shortlist: { id: shortlist.id },
    mrfRef: targetMrfId,
    searchType: 'jd',
    roleName: newRole,
    template,
    jd: await getMrfJdAttachment(targetMrfId),
    leadHtml: movedEmailLeadHtml(newRole),
  });
  response.email = outcome.sent ? 'sent' : 'failed';
  if (!outcome.sent) response.email_failure = outcome.failure;
  return response;
}

export default { getMoveJdStatus, moveJourneyToMrf };
