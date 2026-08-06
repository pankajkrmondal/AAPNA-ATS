/**
 * mrfClosure.service.js — closes a requisition once its openings are filled.
 *
 * Trigger: a candidate ACCEPTS an offer. The MRF closes only when the number of
 * accepted offers reaches `rpa_mrf.number_of_positions`, so a 3-opening
 * requisition stays open (and stays in the JD dropdown) until all three are
 * filled — the dropdown label literally reads "(3 openings)".
 *
 * Closure is written to the two status columns that already exist rather than
 * new ones:
 *   rpa_mrf.approval_status        -> 'closed'
 *   rpa_mrf_jd_send.mrfstatus      -> 'closed'   (the New MRF Request row)
 *
 * Setting rpa_mrf.approval_status='closed' removes the role from JD filtering
 * everywhere for free: getApprovedRoles() (screening.service.js) whitelists only
 * 'approved' and 'completed', and the dashboard's Active-MRF tile counts only
 * pending/waiting/approved. Nothing else needs a new filter.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import redis from '../config/redis.js';
import { broadcast } from '../socket/index.js';
import { FINAL_OUTCOMES } from '../config/pipelineStages.js';
import { notify, NOTIFICATION_TYPES } from './notification.service.js';

/** The status both tables carry once a requisition is filled. */
export const MRF_CLOSED_STATUS = 'closed';

/**
 * Closure outcomes that FREE the opening the candidate was holding — they
 * accepted, but never joined or did not stay. Any other outcome (or none yet)
 * means the seat is still theirs.
 */
const VACATING_OUTCOMES = Object.freeze([
  FINAL_OUTCOMES.BACKED_OUT,
  FINAL_OUTCOMES.DID_NOT_JOIN,
  FINAL_OUTCOMES.JOINED_AND_LEFT,
  FINAL_OUTCOMES.CANDIDATE_WITHDRAWN,
]);

/**
 * How many candidates have accepted an offer against this requisition.
 * Counted through the journey's mrf_id, which is the column the pipeline board
 * filters on.
 *
 * @param {number|bigint} mrfId
 * @returns {Promise<number>}
 */
export async function countAcceptedHires(mrfId) {
  return prisma.rpa_offers.count({
    where: {
      candidate_decision: 'accepted',
      rpa_candidate_pipeline: {
        mrf_id: BigInt(mrfId),
        // An acceptance only holds an opening while the hire is still on. If the
        // journey was later closed as backed-out / did-not-join / joined-and-left,
        // the seat is free again — otherwise a candidate who never turned up
        // would keep the requisition shut for good.
        NOT: { final_outcome: { in: [...VACATING_OUTCOMES] } },
      },
    },
  });
}

/**
 * Closes the requisition if every opening is now filled. Safe to call on every
 * acceptance: it is a no-op when the MRF is already closed, when openings
 * remain, or when the journey has no MRF (keyword shortlists carry mrf_id=null).
 *
 * Never throws — an offer acceptance must be recorded even if closing the
 * requisition fails.
 *
 * @param {number|bigint|null} mrfId
 * @returns {Promise<{closed: boolean, accepted?: number, openings?: number, reason?: string}>}
 */
export async function closeMrfIfFilled(mrfId) {
  if (!mrfId) return { closed: false, reason: 'no_mrf' };

  try {
    const mrf = await prisma.rpa_mrf.findUnique({
      where: { id: BigInt(mrfId) },
      select: { id: true, approval_status: true, number_of_positions: true, position_hiring_for: true },
    });
    if (!mrf) return { closed: false, reason: 'not_found' };
    if (mrf.approval_status === MRF_CLOSED_STATUS) return { closed: false, reason: 'already_closed' };

    // A requisition with no stated count still fills with one hire.
    const openings = mrf.number_of_positions && mrf.number_of_positions > 0 ? mrf.number_of_positions : 1;
    const accepted = await countAcceptedHires(mrf.id);
    if (accepted < openings) {
      return { closed: false, accepted, openings, reason: 'openings_remaining' };
    }

    await prisma.rpa_mrf.update({
      where: { id: mrf.id },
      data: { approval_status: MRF_CLOSED_STATUS },
    });

    // Everything below this point is AFTER the closing write has committed, so
    // each step is individually guarded: a failure here must not report the
    // requisition as still open when the database says otherwise.

    // Mirror it onto the New MRF Request row so the MRF page shows it closed.
    // rpa_mrf_jd_send.mrf_id is a loose Int (no FK), so this is a plain match
    // and legitimately affects zero rows for an MRF raised outside that flow.
    let mirrored = { count: 0 };
    try {
      mirrored = await prisma.rpa_mrf_jd_send.updateMany({
        where: { mrf_id: Number(mrf.id) },
        data: { mrfstatus: MRF_CLOSED_STATUS },
      });
    } catch (err) {
      logger.warn(`MRF ${mrf.id} closed but its New MRF Request row was not updated: ${err.message}`);
    }

    // Drop this role's cached candidate search (same key screening.service.js
    // writes) so a stale entry can't resurrect the closed requisition.
    try {
      await redis.del(`screening:role:${mrf.id}`);
    } catch (err) {
      logger.warn(`MRF ${mrf.id} closed but its Redis role cache was not cleared: ${err.message}`);
    }

    // The screening roles dropdown is cached client-side with staleTime:Infinity
    // (useScreeningData.js), so without a nudge an open page keeps offering a
    // role that is no longer hiring. Best-effort: a socket failure must not
    // undo the closure.
    try {
      broadcast('mrf:closed', {
        mrf_id: Number(mrf.id),
        position: mrf.position_hiring_for,
        openings,
      });
    } catch (err) {
      logger.warn(`MRF ${mrf.id} closed but the mrf:closed broadcast failed: ${err.message}`);
    }

    // In-app too: the role has just left every JD dropdown, which is a visible
    // change to everyone's screening workflow.
    await notify({
      type: NOTIFICATION_TYPES.MRF_CLOSED,
      title: 'Requisition closed — all openings filled',
      description: `${mrf.position_hiring_for || 'A role'} · ${accepted}/${openings} filled — removed from JD filtering`,
      linkPath: '/mrf',
      meta: { mrf_id: Number(mrf.id), openings, accepted },
    });

    logger.info(
      `MRF ${mrf.id} ("${mrf.position_hiring_for}") closed — ${accepted}/${openings} opening(s) filled (${mirrored.count} request row(s) mirrored).`
    );
    return { closed: true, accepted, openings };
  } catch (err) {
    logger.error(`MRF closure check failed for MRF ${mrfId}: ${err.message}`);
    return { closed: false, reason: 'error' };
  }
}

/**
 * The mirror image of closeMrfIfFilled: re-opens a requisition that was
 * auto-closed but no longer has enough accepted hires to justify it.
 *
 * Needed because acceptance is reversible. A candidate who accepted and then
 * backed out used to leave the requisition closed forever — the role stayed out
 * of JD filtering and recruiters had to notice and fix it by hand, at exactly
 * the moment they most needed to fill it again.
 *
 * Deliberately conservative: it only re-opens requisitions sitting in the
 * `closed` status this module itself sets. A requisition closed by a human for
 * any other reason is left alone.
 *
 * Never throws, for the same reason closeMrfIfFilled doesn't — the decision
 * being recorded matters more than the requisition bookkeeping.
 *
 * @param {number|bigint|null} mrfId
 * @returns {Promise<{reopened: boolean, accepted?: number, openings?: number, reason?: string}>}
 */
export async function reopenMrfIfUnfilled(mrfId) {
  if (!mrfId) return { reopened: false, reason: 'no_mrf' };

  try {
    const mrf = await prisma.rpa_mrf.findUnique({
      where: { id: BigInt(mrfId) },
      select: { id: true, approval_status: true, number_of_positions: true, position_hiring_for: true },
    });
    if (!mrf) return { reopened: false, reason: 'not_found' };
    if (mrf.approval_status !== MRF_CLOSED_STATUS) return { reopened: false, reason: 'not_closed' };

    const openings = mrf.number_of_positions && mrf.number_of_positions > 0 ? mrf.number_of_positions : 1;
    const accepted = await countAcceptedHires(mrf.id);
    if (accepted >= openings) {
      return { reopened: false, accepted, openings, reason: 'still_filled' };
    }

    // 'approved' is the state an MRF is in while it is actively hiring — the
    // status it held before closeMrfIfFilled overwrote it.
    await prisma.rpa_mrf.update({
      where: { id: mrf.id },
      data: { approval_status: 'approved' },
    });

    let mirrored = { count: 0 };
    try {
      mirrored = await prisma.rpa_mrf_jd_send.updateMany({
        where: { mrf_id: Number(mrf.id) },
        data: { mrfstatus: 'approved' },
      });
    } catch (err) {
      logger.warn(`MRF ${mrf.id} re-opened but its New MRF Request row was not updated: ${err.message}`);
    }

    // Same cache + broadcast hygiene as the closing path, so the role comes back
    // into the JD dropdowns without anyone reloading.
    try {
      await redis.del(`screening:role:${mrf.id}`);
    } catch (err) {
      logger.warn(`MRF ${mrf.id} re-opened but its Redis role cache was not cleared: ${err.message}`);
    }
    try {
      broadcast('mrf:closed', { mrf_id: Number(mrf.id), position: mrf.position_hiring_for, openings, reopened: true });
    } catch (err) {
      logger.warn(`MRF ${mrf.id} re-opened but the broadcast failed: ${err.message}`);
    }

    await notify({
      type: NOTIFICATION_TYPES.MRF_CLOSED,
      title: 'Requisition re-opened — an opening is free again',
      description: `${mrf.position_hiring_for || 'A role'} · ${accepted}/${openings} filled — back in JD filtering`,
      linkPath: '/mrf',
      meta: { mrf_id: Number(mrf.id), openings, accepted, reopened: true },
    });

    logger.info(
      `MRF ${mrf.id} ("${mrf.position_hiring_for}") re-opened — ${accepted}/${openings} opening(s) filled (${mirrored.count} request row(s) mirrored).`
    );
    return { reopened: true, accepted, openings };
  } catch (err) {
    logger.error(`MRF re-open check failed for MRF ${mrfId}: ${err.message}`);
    return { reopened: false, reason: 'error' };
  }
}
