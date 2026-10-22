/**
 * Analytics "Open Positions" CSV (N39, L06) — one row per requisition, the
 * same rows as the board for the same date range, with one column per
 * pipeline stage.
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

/**
 * The board's columns (L06): health, the range's numbers, the "Now" snapshot,
 * per-stage reach and the since-opened totals. Column order follows the screen.
 * @param {Array<{ stage_key: string, label: string }>} stages
 */
export function positionsColumns(stages = []) {
  return [
    { header: 'MRF', key: 'ref' },
    { header: 'Position', key: 'role' },
    { header: 'Status', key: 'status' },
    { header: 'Health', key: 'health_label' },
    { header: 'Health Reasons', key: 'health_reasons' },
    { header: 'Opened', key: 'opened_at' },
    { header: 'Days Open', key: 'days_open', numeric: true },
    { header: 'Openings', key: 'openings', numeric: true },
    { header: 'Filled', key: 'filled', numeric: true },
    { header: 'Applied', key: 'applied', numeric: true },
    { header: 'Applied (Previous Period)', key: 'applied_previous', numeric: true },
    { header: 'Applied: HR Upload', key: 'source_hr_upload', numeric: true },
    { header: 'Applied: Vendor', key: 'source_vendor', numeric: true },
    { header: 'Applied: Added by Recruiter', key: 'source_recruiter', numeric: true },
    { header: 'Applied: Mailbox, Website & Older Uploads', key: 'source_other', numeric: true },
    { header: 'Responded', key: 'responded', numeric: true },
    { header: 'Response Rate (%)', key: 'response_pct', numeric: true },
    { header: 'Shortlisted', key: 'shortlisted', numeric: true },
    { header: 'Shortlist Rate (%)', key: 'shortlist_pct', numeric: true },
    { header: 'Rejected', key: 'rejected', numeric: true },
    { header: 'Moved Forward', key: 'moved_forward', numeric: true },
    { header: 'Interviews', key: 'interviews', numeric: true },
    { header: 'Offers', key: 'offers', numeric: true },
    { header: 'Joined', key: 'joined', numeric: true },
    { header: 'In Pipeline Now', key: 'in_pipeline', numeric: true },
    { header: 'On Hold Now', key: 'on_hold', numeric: true },
    { header: 'Stuck Now', key: 'stuck', numeric: true },
    { header: 'Awaiting Feedback Now', key: 'awaiting_feedback', numeric: true },
    { header: 'Offers Awaiting Approval Now', key: 'offers_awaiting_approval', numeric: true },
    ...stages.map((s) => ({ header: `Reached: ${s.label}`, key: `stage_${s.stage_key}`, numeric: true })),
    { header: 'Offers Accepted', key: 'offers_accepted', numeric: true },
    { header: 'Joining Ratio (%)', key: 'joining_ratio', numeric: true },
    { header: 'Applied Since Opened', key: 'applied_all', numeric: true },
    { header: 'Shortlisted Since Opened', key: 'shortlisted_all', numeric: true },
    { header: 'Closed On', key: 'closed_at' },
    { header: 'Closure Reason', key: 'closure_reason' },
  ];
}

const isoDay = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/**
 * Flatten one board row for the CSV: stage_counts into `stage_<key>`, sources
 * into `source_<key>`, health into its label and reasons; dates as YYYY-MM-DD
 * (machine dates, as other exports).
 */
export function positionsCsvRows(rows = []) {
  return rows.map((r) => {
    const { stage_counts: stageCounts = {}, sources = {}, health, previous, since_opened: since, ...rest } = r;
    const flat = {
      ...rest,
      opened_at: isoDay(r.opened_at),
      closed_at: isoDay(r.closed_at),
      health_label: health?.label ?? '',
      health_reasons: (health?.reasons || []).join('; '),
      applied_previous: previous ? previous.applied : null,
      applied_all: since ? since.applied : null,
      shortlisted_all: since ? since.shortlisted : null,
    };
    for (const [key, n] of Object.entries(stageCounts)) flat[`stage_${key}`] = n;
    for (const [key, n] of Object.entries(sources)) flat[`source_${key}`] = n;
    return flat;
  });
}

export default { filterPositions, positionsColumns, positionsCsvRows };
