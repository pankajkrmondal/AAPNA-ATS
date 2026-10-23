/**
 * How an MRF is named in every role dropdown (N19): several MRFs can share a
 * role name (four ".NET Developer" requisitions), so the label always carries
 * the reference and the date to tell them apart.
 *
 *   mrfOptionLabel(role) -> '.NET Developer · MRF-41 · 09 Oct 2026 · 2 openings'
 */
import { fmtDate } from './dateFormat';

/**
 * @param {{ id: number, ref?: string, role: string, created_at?: string, number_of_positions?: number }} r
 * @param {{ openings?: boolean }} [opts] include the openings count (default true)
 * @returns {string}
 */
export function mrfOptionLabel(r, { openings = true } = {}) {
  const parts = [r.role, r.ref || `MRF-${r.id}`];
  if (r.created_at) parts.push(fmtDate(r.created_at));
  if (openings && r.number_of_positions != null) {
    const n = Number(r.number_of_positions) || 0;
    parts.push(`${n} opening${n === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}

/**
 * What follows the role for a JD sent without an MRF (L07): its label and its
 * JD date (the created date when none is set). `jd_day` comes from the API as
 * YYYY-MM-DD.
 *
 *   jdSendSuffix(r) -> 'v2 – Oct revision · 18 Oct 2026'
 *
 * @param {{ version_label?: string|null, jd_day?: string|null, created_at?: string }} r
 * @returns {string}
 */
export function jdSendSuffix(r) {
  const parts = [];
  if (r?.version_label) parts.push(r.version_label);
  const day = r?.jd_day || r?.created_at;
  if (day) parts.push(fmtDate(day));
  return parts.join(' · ');
}

/** "budget_withdrawn" -> "Budget Withdrawn" (same rule as GET /api/mrf/closure-reasons). */
export function closureReasonLabel(reason) {
  if (!reason) return '';
  return String(reason).split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export default { mrfOptionLabel, jdSendSuffix, closureReasonLabel };
