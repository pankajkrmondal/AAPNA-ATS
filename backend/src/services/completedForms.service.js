/**
 * Responded by JD (U10, revised as U10b): who responded in a range, by JD, with
 * the Open Positions Responded column's definition and pairing. Feeds Analytics
 * → Open Positions › Responded and the 09:00 IST bell note
 * (jobs/completedFormsDigest.js). The rules are in completedForms.helpers.js.
 *
 * Deliberately does NOT import pipeline.service.js (it opens Redis on import),
 * same as openPositions.service.js.
 */
import prisma from '../config/database.js';
import { LEGACY_MRF_CLOSED_STATUS } from '../config/pipelineStages.js';
import { respondedByJd } from './mrfApplicants.service.js';
import { positionStatus } from './pipelineAnalytics.helpers.js';
import { groupRespondedByJd, inStatusFilter } from './completedForms.helpers.js';
import { rangeForResponse } from '../utils/analyticsRange.js';

/**
 * The board's MRF set, the same rule as openPositions.service.js loadBoard():
 * every approved MRF, open or closed, plus any MRF with a journey. Only the
 * fields the applicant links and the board status need.
 */
async function boardMrfSet() {
  const journeyMrfs = await prisma.rpa_candidate_pipeline.findMany({
    where: { mrf_id: { not: null } },
    select: { mrf_id: true },
    distinct: ['mrf_id'],
  });
  const journeyMrfIds = journeyMrfs.map((j) => j.mrf_id);
  return prisma.rpa_mrf.findMany({
    where: {
      OR: [
        { approval_status: { in: ['approved', 'completed', LEGACY_MRF_CLOSED_STATUS] } },
        ...(journeyMrfIds.length ? [{ id: { in: journeyMrfIds } }] : []),
      ],
    },
    select: {
      id: true, position_hiring_for: true, created_at: true,
      approval_status: true, filled_at: true, closed_at: true, closure_reason: true, paused_at: true,
    },
  });
}

/**
 * @param {ReturnType<import('../utils/analyticsRange.js').makeRange>} range
 * @param {{ status?: 'open'|'closed'|'all', mrfId?: number|null }} [opts]
 *   status: the board's switch; "No JD yet" is listed for Open and All, not for
 *   Closed. mrfId (U10c): one position only, its role view's Responded section,
 *   whatever its status and without "No JD yet". The pairing still uses the
 *   whole board set (the latest-MRF rule), so its count equals its column.
 * @returns {Promise<{ range: object, status: string, mrf_id: number|null, total: number, jd_count: number, groups: Array }>}
 */
export async function getRespondedByJd(range, { status = 'open', mrfId = null } = {}) {
  const mrfs = await boardMrfSet();
  const scoped = mrfId != null;
  const shownIds = scoped
    ? mrfs.filter((m) => String(m.id) === String(mrfId)).map((m) => m.id)
    : mrfs.filter((m) => inStatusFilter(positionStatus(m), status)).map((m) => m.id);
  const rows = await respondedByJd(
    mrfs.map((m) => ({ id: m.id, role: m.position_hiring_for, openedAt: m.created_at })),
    range,
    { shownIds, unlinked: !scoped && status !== 'closed' },
  );
  const titles = new Map(mrfs.map((m) => [String(m.id), m.position_hiring_for]));
  const grouped = groupRespondedByJd(rows, (id) => titles.get(id));
  return { range: rangeForResponse(range), status: scoped ? 'all' : status, mrf_id: scoped ? Number(mrfId) : null, ...grouped };
}

export default { getRespondedByJd };
