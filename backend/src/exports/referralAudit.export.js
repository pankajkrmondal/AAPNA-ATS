/**
 * Referral Log CSV — the audit trail behind the referral flag.
 *
 * ADMIN-TIER ONLY, like the screen it backs (admin.routes.js applies
 * restrictTo('admin','superadmin') to the whole router). This file is a list of
 * precisely what R6 says most people should not see, gathered in one place, so
 * it is the one export in this codebase whose AUDIENCE is the control.
 *
 * The `where` is built by referral.service.js and shared with the paginated
 * screen, so the CSV can never contain rows the report did not — the same rule
 * pipeline.export.js states for the board.
 *
 * `acted_ip` is stored on every row but is NOT a column here. It is corroboration
 * for an investigation, not something to spread across a spreadsheet that gets
 * mailed around; read it from the table when an investigation actually needs it.
 */
import prisma from '../config/database.js';
import { buildAuditWhere } from '../services/referral.service.js';

/** What each action meant, in words, so the file reads without the schema. */
const ACTION_LABEL = {
  marked: 'Marked as referral',
  updated: 'Referrer / note changed',
  removed: 'Referral REMOVED',
};

export const columns = [
  { header: 'When', key: 'acted_at', type: 'datetime' },
  { header: 'Action', value: (r) => ACTION_LABEL[r.action] || r.action },
  { header: 'Candidate', key: 'candidate_name' },
  { header: 'Candidate Email', key: 'candidate_email' },
  { header: 'Candidate ID', value: (r) => (r.cv_id === null ? '(candidate deleted)' : String(r.cv_id)) },
  { header: 'Referrer (before)', key: 'old_referred_by' },
  { header: 'Referrer (after)', key: 'new_referred_by' },
  { header: 'Note', key: 'note' },
  // Only ever set on a removal. It is the whole point of the row: a referral was
  // taken off a candidate, and this says who said why.
  { header: 'Removal Reason', key: 'reason' },
  { header: 'Done By', key: 'acted_by_name' },
  { header: 'Done By (email)', key: 'acted_by_email' },
];

/** The report's filters, as the screen sends them. */
export function parseFilters(req) {
  const {
    action, acted_by: actedBy, candidate, referrer, from, to, cv_id: cvId,
  } = req.query;

  return {
    action: action || undefined,
    actedBy: actedBy || undefined,
    candidate: candidate || undefined,
    referrer: referrer || undefined,
    from: from || undefined,
    to: to || undefined,
    cvId: cvId || undefined,
  };
}

/** @type {import('./runExport.js').ExportSpec['fetch']} */
export async function fetch({ filters, max }) {
  return prisma.rpa_referral_audit.findMany({
    where: buildAuditWhere(filters),
    orderBy: { acted_at: 'desc' },
    take: max,
  });
}

export default { columns, parseFilters, fetch };
