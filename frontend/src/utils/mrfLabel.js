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

/** "budget_withdrawn" -> "Budget Withdrawn" (same rule as GET /api/mrf/closure-reasons). */
export function closureReasonLabel(reason) {
  if (!reason) return '';
  return String(reason).split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export default { mrfOptionLabel, closureReasonLabel };
