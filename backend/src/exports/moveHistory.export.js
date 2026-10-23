/**
 * Move history CSV (flexible stages, C12): one row per 'moved' event — who moved
 * which candidate, when, from which stage to which, in which direction and how
 * many stages the move jumped. Filterable by date range, user and position.
 *
 * The direction and the skipped count are read from the event's notes, which
 * were written AT THE MOMENT of the move (moveNote() in utils/stageState.js):
 * an admin can reorder stages later, so recomputing them from today's
 * sort_order could turn a forward move into a backward one after the fact.
 */
import prisma from '../config/database.js';

/** Parses "Moved forward from X to Y (skipped 2 stages)". */
export function parseMoveNote(notes) {
  const m = /^Moved (forward|backward)\b/.exec(notes || '');
  const skipped = /\(skipped (\d+) stages?\)/.exec(notes || '');
  return { direction: m ? m[1] : '', skipped: skipped ? Number(skipped[1]) : 0 };
}

const positionOf = (e) => e.rpa_candidate_pipeline?.rpa_shortlisted_candidates?.mrf?.position_hiring_for
  || e.rpa_candidate_pipeline?.rpa_shortlisted_candidates?.position_applied
  || '';

export const columns = [
  { header: 'Candidate', value: (e) => e.rpa_candidate_pipeline?.rpa_shortlisted_candidates?.candidate_name || '' },
  { header: 'Email', value: (e) => e.rpa_candidate_pipeline?.rpa_shortlisted_candidates?.candidate_email || '' },
  {
    header: 'Position / MRF',
    value: (e) => {
      const mrf = e.rpa_candidate_pipeline?.mrf_id;
      return `${positionOf(e)}${mrf ? ` (MRF-${mrf})` : ''}`;
    },
  },
  { header: 'From stage', value: (e) => e._fromLabel },
  { header: 'To stage', value: (e) => e._toLabel },
  { header: 'Direction', value: (e) => e._direction },
  { header: 'Stages skipped', value: (e) => e._skipped, numeric: true },
  // L02-C: moving back into a passed stage to re-do it needs a reason.
  { header: 'Re-do', value: (e) => (/ to re-do it$/.test(e.notes || '') ? 'Yes' : '') },
  { header: 'Reason', value: (e) => e.reason_text || '' },
  { header: 'Moved by', value: (e) => e.rpa_users?.username || '' },
  { header: 'Moved at', key: 'created_at', type: 'datetime' },
];

/** Query params: date_from, date_to (YYYY-MM-DD, inclusive), moved_by (user id), mrf_id. */
export function parseFilters(req) {
  const { date_from: dateFrom, date_to: dateTo, moved_by: movedBy, mrf_id: mrfId } = req.query;
  const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  return {
    dateFrom: day(dateFrom),
    dateTo: day(dateTo),
    movedBy: movedBy && /^\d+$/.test(String(movedBy)) ? Number(movedBy) : undefined,
    mrfId: mrfId && /^\d+$/.test(String(mrfId)) ? String(mrfId) : undefined,
  };
}

/** The Prisma `where` for the filters — shared with the users list below. */
export function buildWhere(filters = {}) {
  const where = { event_type: 'moved' };
  if (filters.dateFrom || filters.dateTo) {
    where.created_at = {};
    // Days are IST calendar days, the timezone everyone using the board is in.
    if (filters.dateFrom) where.created_at.gte = new Date(`${filters.dateFrom}T00:00:00+05:30`);
    if (filters.dateTo) where.created_at.lte = new Date(`${filters.dateTo}T23:59:59.999+05:30`);
  }
  if (filters.movedBy) where.acted_by = filters.movedBy;
  if (filters.mrfId) where.rpa_candidate_pipeline = { mrf_id: BigInt(filters.mrfId) };
  return where;
}

/** @type {import('./runExport.js').ExportSpec['fetch']} */
export async function fetch({ filters, max }) {
  const stages = await prisma.rpa_pipeline_stages.findMany({ select: { stage_key: true, label: true } });
  const labelByKey = Object.fromEntries(stages.map((s) => [s.stage_key, s.label]));
  const events = await prisma.rpa_pipeline_stage_events.findMany({
    where: buildWhere(filters),
    include: {
      rpa_users: { select: { username: true } },
      rpa_candidate_pipeline: {
        select: {
          mrf_id: true,
          rpa_shortlisted_candidates: {
            select: { candidate_name: true, candidate_email: true, position_applied: true, mrf: { select: { position_hiring_for: true } } },
          },
        },
      },
    },
    orderBy: { created_at: 'desc' },
    take: max,
  });
  return events.map((e) => {
    const { direction, skipped } = parseMoveNote(e.notes);
    return Object.assign(e, {
      _fromLabel: labelByKey[e.from_stage_key] || e.from_stage_key || '',
      _toLabel: labelByKey[e.stage_key] || e.stage_key || '',
      _direction: direction,
      _skipped: skipped,
    });
  });
}

/** Everyone who has moved a candidate — feeds the report's "Moved by" filter. */
export async function listMovers() {
  const rows = await prisma.rpa_pipeline_stage_events.findMany({
    where: { event_type: 'moved', acted_by: { not: null } },
    distinct: ['acted_by'],
    select: { acted_by: true, rpa_users: { select: { username: true } } },
  });
  return rows
    .map((r) => ({ id: r.acted_by, username: r.rpa_users?.username || `User ${r.acted_by}` }))
    .sort((a, b) => a.username.localeCompare(b.username));
}

export default { columns, fetch, parseFilters, buildWhere, listMovers, parseMoveNote };
