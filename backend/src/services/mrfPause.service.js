/**
 * mrfPause.service.js — pauses a still-open requisition, with a reason.
 *
 * A requisition the recruiter wants to temporarily stop sourcing for — without
 * declaring it closed — had no representation in the system: the only "on
 * hold" option was the manual-closure reason `on_hold_indefinitely`
 * (mrfClosure.service.js), which fully CLOSES the requisition via the same
 * irreversible-until-reopened path as budget_withdrawn or role_withdrawn.
 * See prisma/ddl/2026-08-28-mrf-pause.sql for the full history.
 *
 * Paused lives in its own column set (`paused_at`/`paused_reason`/
 * `paused_by`), independent of `filled_at`/`closed_at`. A paused requisition
 * is still open in every other sense — it is only excluded from new candidate
 * sourcing (getApprovedRoles) while paused_at is set. Nothing here touches
 * approval_status, mrfstatus, filled_at or closed_at.
 *
 * Enforcement scope deliberately mirrors candidate-level pause
 * (pipeline.service.js setJourneyPaused): pausing an MRF stops it appearing
 * for NEW candidate sourcing. It does not block manual recruiter actions on
 * candidates already in progress against it — the same restraint candidate
 * pause itself exercises.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import redis from '../config/redis.js';
import { broadcast } from '../socket/index.js';
import { isMrfPaused, isMrfClosed, isMrfFilled } from '../config/pipelineStages.js';
import { notify, NOTIFICATION_TYPES } from './notification.service.js';

/**
 * Pauses a requisition by hand, with a reason.
 *
 * @param {number|bigint} mrfId
 * @param {object} params
 * @param {string} params.reason
 * @param {number} params.actedBy
 */
export async function pauseMrf(mrfId, { reason, actedBy }) {
  const trimmedReason = (reason || '').trim();
  if (!trimmedReason) {
    throw new AppError('A reason is required to pause a requisition.', 400);
  }

  const mrf = await prisma.rpa_mrf.findUnique({
    where: { id: BigInt(mrfId) },
    select: { id: true, paused_at: true, closed_at: true, filled_at: true, position_hiring_for: true },
  });
  if (!mrf) throw new AppError('Requisition not found.', 404);
  if (isMrfPaused(mrf)) throw new AppError('This requisition is already paused.', 409);
  if (isMrfClosed(mrf)) {
    throw new AppError(
      isMrfFilled(mrf)
        ? 'This requisition is already closed because all its openings were filled — it cannot be paused.'
        : 'This requisition is already closed — it cannot be paused.',
      409
    );
  }

  // Conditional claim, same pattern as every closure write in mrfClosure.service.js.
  const claim = await prisma.rpa_mrf.updateMany({
    where: { id: mrf.id, paused_at: null },
    data: { paused_at: new Date(), paused_reason: trimmedReason, paused_by: actedBy || null },
  });
  if (claim.count !== 1) throw new AppError('This requisition is already paused.', 409);

  try {
    await redis.del(`screening:role:${mrf.id}`);
  } catch (err) {
    logger.warn(`MRF ${mrf.id} paused but its Redis role cache was not cleared: ${err.message}`);
  }
  try {
    broadcast('mrf:paused', { mrf_id: Number(mrf.id), position: mrf.position_hiring_for });
  } catch (err) {
    logger.warn(`MRF ${mrf.id} paused but the mrf:paused broadcast failed: ${err.message}`);
  }

  await notify({
    type: NOTIFICATION_TYPES.MRF_PAUSED,
    title: 'Requisition paused',
    description: `${mrf.position_hiring_for || 'A role'} — paused by a recruiter: ${trimmedReason}`,
    linkPath: '/mrf',
    meta: { mrf_id: Number(mrf.id), paused_reason: trimmedReason },
    excludeUserId: actedBy || null,
  });

  logger.info(`MRF ${mrf.id} ("${mrf.position_hiring_for}") paused by user ${actedBy || 'unknown'} — ${trimmedReason}.`);
  return { paused: true, mrf_id: Number(mrf.id), paused_reason: trimmedReason };
}

/**
 * Resumes a paused requisition.
 *
 * @param {number|bigint} mrfId
 * @param {object} params
 * @param {number} params.actedBy
 */
export async function resumeMrf(mrfId, { actedBy }) {
  const mrf = await prisma.rpa_mrf.findUnique({
    where: { id: BigInt(mrfId) },
    select: { id: true, paused_at: true, position_hiring_for: true },
  });
  if (!mrf) throw new AppError('Requisition not found.', 404);
  if (!isMrfPaused(mrf)) throw new AppError('This requisition is not paused.', 400);

  const claim = await prisma.rpa_mrf.updateMany({
    where: { id: mrf.id, paused_at: { not: null } },
    data: { paused_at: null, paused_reason: null, paused_by: null },
  });
  if (claim.count !== 1) throw new AppError('This requisition is not paused.', 400);

  try {
    await redis.del(`screening:role:${mrf.id}`);
  } catch (err) {
    logger.warn(`MRF ${mrf.id} resumed but its Redis role cache was not cleared: ${err.message}`);
  }
  try {
    broadcast('mrf:resumed', { mrf_id: Number(mrf.id), position: mrf.position_hiring_for });
  } catch (err) {
    logger.warn(`MRF ${mrf.id} resumed but the mrf:resumed broadcast failed: ${err.message}`);
  }

  await notify({
    type: NOTIFICATION_TYPES.MRF_PAUSED,
    title: 'Requisition resumed',
    description: `${mrf.position_hiring_for || 'A role'} — back in JD filtering`,
    linkPath: '/mrf',
    meta: { mrf_id: Number(mrf.id), resumed: true },
    excludeUserId: actedBy || null,
  });

  logger.info(`MRF ${mrf.id} ("${mrf.position_hiring_for}") resumed by user ${actedBy || 'unknown'}.`);
  return { resumed: true, mrf_id: Number(mrf.id) };
}
