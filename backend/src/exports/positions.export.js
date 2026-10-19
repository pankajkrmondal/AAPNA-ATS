/**
 * Analytics "Positions" CSV (N39) — one row per requisition, the same rows as
 * the tab, with one column per pipeline stage.
 *
 * The stage columns depend on the active stages, so the columns are built
 * from the loaded overview (runExport takes them up front). Pure — the
 * controller loads the overview and passes it in.
 */

/** ?status=open|closed|all — the tab's status filter, so the CSV matches the screen. */
export function filterPositions(rows, status) {
  const s = String(status || 'all').toLowerCase();
  if (s === 'open') return rows.filter((r) => r.status === 'Open' || r.status === 'Paused');
  if (s === 'closed') return rows.filter((r) => r.status === 'Filled' || r.status === 'Closed');
  return rows;
}

/** @param {Array<{ stage_key: string, label: string }>} stages */
export function positionsColumns(stages = []) {
  return [
    { header: 'MRF', key: 'ref' },
    { header: 'Position', key: 'role' },
    { header: 'Status', key: 'status' },
    { header: 'Opened', key: 'opened_at' },
    { header: 'Days Open', key: 'days_open', numeric: true },
    { header: 'Openings', key: 'openings', numeric: true },
    { header: 'Shortlisted', key: 'shortlisted', numeric: true },
    { header: 'In Pipeline Now', key: 'in_pipeline', numeric: true },
    { header: 'Moved Forward', key: 'moved_forward', numeric: true },
    ...stages.map((s) => ({ header: `Reached: ${s.label}`, key: `stage_${s.stage_key}`, numeric: true })),
    { header: 'Offers Made', key: 'offers_made', numeric: true },
    { header: 'Offers Accepted', key: 'offers_accepted', numeric: true },
    { header: 'Joined', key: 'joined', numeric: true },
    { header: 'Hired', key: 'hired', numeric: true },
    { header: 'Joining Ratio (%)', key: 'joining_ratio', numeric: true },
    { header: 'Closed On', key: 'closed_at' },
    { header: 'Closure Reason', key: 'closure_reason' },
  ];
}

const isoDay = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** Flatten stage_counts into `stage_<key>` columns; dates as YYYY-MM-DD (machine dates, as other exports). */
export function positionsCsvRows(rows = []) {
  return rows.map((r) => {
    const { stage_counts: stageCounts = {}, ...rest } = r;
    const flat = { ...rest, opened_at: isoDay(r.opened_at), closed_at: isoDay(r.closed_at) };
    for (const [key, n] of Object.entries(stageCounts)) flat[`stage_${key}`] = n;
    return flat;
  });
}

export default { filterPositions, positionsColumns, positionsCsvRows };
