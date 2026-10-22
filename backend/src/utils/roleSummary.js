/**
 * Analytics "Role Summary" grouping (L06). Pure — no Prisma.
 *
 * One row per requisition (MRF id), not per role name: four ".NET Developer"
 * MRFs used to merge into one row showing a single MRF id. Shortlist rows with
 * no MRF (keyword-tab shortlists) are grouped by their role text.
 *
 * This is the ONE copy of the classifier: the browser memo in Analytics.jsx and
 * the CSV's own groupByRole() both used to repeat it (Recruitment-Analytics.md
 * §2.6). The buckets sum to `total` by construction — the final else catches
 * every closure status setFinalOutcome writes, and anything added later.
 */

/** The bucket a shortlist row's status falls in. */
export function roleSummaryBucket(status) {
  const s = String(status || 'shortlisted').toLowerCase();
  if (s === 'shortlisted') return 'shortlisted';
  if (s === 'rejected') return 'rejected';
  if (s === 'on_hold' || s === 'on hold') return 'on_hold';
  if (s === 'future_prospect') return 'future_prospect';
  return 'closed';
}

const emptyRow = (key, role, mrfId) => ({
  key, role, mrf_id: mrfId, shortlisted: 0, rejected: 0, on_hold: 0, future_prospect: 0, closed: 0, total: 0,
});

/**
 * @param {Array<{ mrf_id?: unknown, mrf?: { id?: unknown, position_hiring_for?: string|null }, position_applied?: string|null, pipeline_status?: string|null }>} candidates
 * @returns {Array<{ key: string, role: string, mrf_id: number|null, shortlisted: number, rejected: number, on_hold: number, future_prospect: number, closed: number, total: number }>}
 */
export function groupByMrf(candidates = []) {
  const groups = new Map();
  for (const c of candidates) {
    const rawId = c.mrf_id ?? c.mrf?.id ?? null;
    const mrfId = rawId == null ? null : Number(rawId);
    const role = c.mrf?.position_hiring_for || c.position_applied || 'Unknown Role';
    const key = mrfId != null ? `mrf:${mrfId}` : `role:${String(role).trim().toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, emptyRow(key, role, mrfId));
    const row = groups.get(key);
    row.total += 1;
    row[roleSummaryBucket(c.pipeline_status)] += 1;
  }
  return [...groups.values()];
}

/**
 * Add the board's per-MRF numbers (Total applied, Moved forward, Shortlist %,
 * status) to the grouped rows, and add a zero row for every open MRF with no
 * shortlist rows yet, so an open role with applicants still shows. Open roles
 * first, then the busiest.
 *
 * @param {ReturnType<typeof groupByMrf>} grouped
 * @param {Array<{ mrf_id: number, role: string, status: string, applied: number, moved_forward: number, shortlist_pct: number|null }>} boardRows
 */
export function withBoardNumbers(grouped, boardRows = []) {
  const byId = new Map(boardRows.map((r) => [Number(r.mrf_id), r]));
  const rows = grouped.map((g) => ({ ...g }));
  const seen = new Set(rows.filter((r) => r.mrf_id != null).map((r) => r.mrf_id));
  for (const b of boardRows) {
    if (!seen.has(Number(b.mrf_id)) && (b.status === 'Open' || b.status === 'Paused')) {
      rows.push(emptyRow(`mrf:${b.mrf_id}`, b.role, Number(b.mrf_id)));
    }
  }
  for (const r of rows) {
    const b = r.mrf_id != null ? byId.get(r.mrf_id) : null;
    r.status = b?.status || (r.mrf_id == null ? 'No MRF' : null);
    r.total_applied = b ? b.applied : null;
    r.moved_forward = b ? b.moved_forward : null;
    r.shortlist_pct = b ? b.shortlist_pct : null;
  }
  const isOpen = (r) => r.status === 'Open' || r.status === 'Paused';
  return rows.sort((a, b) => (Number(isOpen(b)) - Number(isOpen(a)))
    || ((b.total_applied ?? -1) - (a.total_applied ?? -1))
    || (b.total - a.total));
}

export default { roleSummaryBucket, groupByMrf, withBoardNumbers };
