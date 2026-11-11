/**
 * Completed forms (U10): the forms candidates completed in a range, grouped by
 * JD. Feeds Analytics → "Completed forms" and the 09:00 IST bell note
 * (jobs/completedFormsDigest.js). The rules are in completedForms.helpers.js.
 *
 * Deliberately does NOT import pipeline.service.js (it opens Redis on import),
 * same as openPositions.service.js.
 */
import prisma from '../config/database.js';
import { LEGACY_MRF_CLOSED_STATUS } from '../config/pipelineStages.js';
import { completedFormsWithMrf } from './mrfApplicants.service.js';
import { groupCompletedForms } from './completedForms.helpers.js';
import { rangeForResponse } from '../utils/analyticsRange.js';

/**
 * The board's MRF set, the same rule as openPositions.service.js loadBoard():
 * every approved MRF, open or closed, plus any MRF with a journey. Only the
 * fields the applicant links need.
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
    select: { id: true, position_hiring_for: true, created_at: true },
  });
}

/**
 * @param {ReturnType<import('../utils/analyticsRange.js').makeRange>} range
 * @returns {Promise<{ range: object, total: number, jd_count: number, groups: Array }>}
 */
export async function getCompletedForms(range) {
  const mrfs = await boardMrfSet();
  const rows = await completedFormsWithMrf(
    mrfs.map((m) => ({ id: m.id, role: m.position_hiring_for, openedAt: m.created_at })),
    range,
  );
  const titles = new Map(mrfs.map((m) => [String(m.id), m.position_hiring_for]));
  const grouped = groupCompletedForms(rows, (id) => titles.get(id));
  return { range: rangeForResponse(range), ...grouped };
}

export default { getCompletedForms };
