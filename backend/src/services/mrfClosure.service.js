/**
 * mrfClosure.service.js — closes a requisition once its openings are filled.
 *
 * Trigger: a candidate ACCEPTS an offer. The MRF closes only when the number of
 * accepted offers reaches `rpa_mrf.number_of_positions`, so a 3-opening
 * requisition stays open (and stays in the JD dropdown) until all three are
 * filled — the dropdown label literally reads "(3 openings)".
 *
 * Fill state lives in ONE dedicated column, `rpa_mrf.filled_at` (NULL = still
 * hiring). Nothing here writes a status column.
 *
 * That is deliberate and hard-won. This module used to express "filled" by
 * overwriting `rpa_mrf.approval_status` -> 'closed' and
 * `rpa_mrf_jd_send.mrfstatus` -> 'closed', restoring both to a hardcoded
 * 'approved' on re-open. Both writes were lossy:
 *
 *   - 'completed' is the most common real approval_status, and
 *     getApprovedRoles() gates it on approved_by_abhijit while treating plain
 *     'approved' as unconditional. A completed requisition that filled and
 *     re-opened came back as 'approved' — permanently escaping that gate.
 *   - mrfstatus is the protected "raise status" workflow column the MRF page
 *     filters, displays and exports (mrf.controller.js documents it as not
 *     user-writable). The write was an updateMany on a loose non-FK mrf_id, so
 *     one requisition could rewrite dozens of unrelated request rows.
 *
 * Approved and Filled are independent facts. Consumers ask isMrfFilled()
 * (config/pipelineStages.js) rather than inspecting a status string.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import redis from '../config/redis.js';
import { broadcast } from '../socket/index.js';
import { VACATING_OUTCOMES, LEGACY_MRF_CLOSED_STATUS, isMrfFilled } from '../config/pipelineStages.js';
import { notify, NOTIFICATION_TYPES } from './notification.service.js';

/**
 * @deprecated LEGACY READ ONLY — re-exported for callers that still recognise
 * rows closed by the old lossy path. Never write this to a status column.
 */
export const MRF_CLOSED_STATUS = LEGACY_MRF_CLOSED_STATUS;

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
      select: { id: true, approval_status: true, filled_at: true, number_of_positions: true, position_hiring_for: true },
    });
    if (!mrf) return { closed: false, reason: 'not_found' };
    if (isMrfFilled(mrf)) return { closed: false, reason: 'already_closed' };

    // A requisition with no stated count still fills with one hire.
    const openings = mrf.number_of_positions && mrf.number_of_positions > 0 ? mrf.number_of_positions : 1;
    const accepted = await countAcceptedHires(mrf.id);
    if (accepted < openings) {
      return { closed: false, accepted, openings, reason: 'openings_remaining' };
    }

    // Conditional claim rather than a plain update: two acceptances landing
    // together would both read "not filled" above and both proceed, sending two
    // "Requisition closed" notifications for one event. Whichever writes first
    // wins; the loser sees count 0 and backs out.
    const claim = await prisma.rpa_mrf.updateMany({
      where: { id: mrf.id, filled_at: null },
      data: { filled_at: new Date() },
    });
    if (claim.count !== 1) {
      return { closed: false, accepted, openings, reason: 'already_closed' };
    }

    // Everything below this point is AFTER the closing write has committed, so
    // each step is individually guarded: a failure here must not report the
    // requisition as still open when the database says otherwise.
    //
    // NOTE: no status column is written — not rpa_mrf.approval_status, not
    // rpa_mrf_jd_send.mrfstatus. See this file's header for why. The MRF page
    // overlays approval_status from the joined rpa_mrf row and derives
    // "Filled" from filled_at, so it needs no mirrored copy.

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

    // Candidates who are STILL RUNNING against this requisition are now
    // chasing a role with no opening left. Nobody was ever told: a recruiter
    // could keep interviewing, scheduling and collecting documents for a role
    // filled last week. The board flags them too (card `mrf_closed`), but that
    // only helps someone already looking — this notification is the moment
    // they can actually act. Best-effort, like everything below the closing
    // write: a counting failure must not misreport the closure.
    let stranded = 0;
    try {
      const openJourneys = await prisma.rpa_candidate_pipeline.count({
        where: { mrf_id: mrf.id, final_outcome: null },
      });
      // The accepted hires are open journeys too, but they are the ones who
      // filled it — they are not stranded.
      stranded = Math.max(0, openJourneys - accepted);
    } catch (err) {
      logger.warn(`MRF ${mrf.id} closed but its in-flight candidate count failed: ${err.message}`);
    }

    // In-app too: the role has just left every JD dropdown, which is a visible
    // change to everyone's screening workflow.
    await notify({
      type: NOTIFICATION_TYPES.MRF_CLOSED,
      title: 'Requisition closed — all openings filled',
      description: `${mrf.position_hiring_for || 'A role'} · ${accepted}/${openings} filled — removed from JD filtering`
        + (stranded > 0
          ? ` · ${stranded} candidate${stranded === 1 ? ' is' : 's are'} still in progress for this role`
          : ''),
      linkPath: '/mrf',
      meta: { mrf_id: Number(mrf.id), openings, accepted, stranded },
    });

    logger.info(
      `MRF ${mrf.id} ("${mrf.position_hiring_for}") marked filled — ${accepted}/${openings} opening(s) filled`
      + `${stranded > 0 ? `, ${stranded} candidate(s) still in progress` : ''}. approval_status left as "${mrf.approval_status}".`
    );
    return { closed: true, accepted, openings, stranded };
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
 * Deliberately conservative: it only re-opens requisitions this module itself
 * marked filled. A requisition a human closed some other way is left alone.
 *
 * Clearing `filled_at` is now the WHOLE operation, which is what makes this
 * correct: the approval status was never touched on the way in, so there is
 * nothing to restore and nothing to guess. The previous version restored a
 * hardcoded 'approved', silently promoting 'completed' requisitions and
 * stripping the approved_by_abhijit gate they are subject to.
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
      select: { id: true, approval_status: true, filled_at: true, number_of_positions: true, position_hiring_for: true },
    });
    if (!mrf) return { reopened: false, reason: 'not_found' };
    if (!isMrfFilled(mrf)) return { reopened: false, reason: 'not_closed' };

    const openings = mrf.number_of_positions && mrf.number_of_positions > 0 ? mrf.number_of_positions : 1;
    const accepted = await countAcceptedHires(mrf.id);
    if (accepted >= openings) {
      return { reopened: false, accepted, openings, reason: 'still_filled' };
    }

    // Clearing the fill marker is the entire re-open. approval_status keeps
    // whatever it legitimately held all along.
    //
    // A row closed by the OLD path (approval_status='closed', filled_at
    // backfilled) cannot be fully repaired here — its real prior status is
    // gone — so it is left for the manual review the DDL README describes
    // rather than being guessed at again.
    await prisma.rpa_mrf.update({
      where: { id: mrf.id },
      data: { filled_at: null },
    });
    if (mrf.approval_status === LEGACY_MRF_CLOSED_STATUS) {
      logger.warn(
        `MRF ${mrf.id} re-opened but still carries the legacy approval_status='closed' — its true prior status was destroyed by the old closure path and must be set by hand (see prisma/ddl/2026-08-11-mrf-filled-at.README.md).`
      );
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
      `MRF ${mrf.id} ("${mrf.position_hiring_for}") re-opened — ${accepted}/${openings} opening(s) filled. approval_status left as "${mrf.approval_status}".`
    );
    return { reopened: true, accepted, openings };
  } catch (err) {
    logger.error(`MRF re-open check failed for MRF ${mrfId}: ${err.message}`);
    return { reopened: false, reason: 'error' };
  }
}
