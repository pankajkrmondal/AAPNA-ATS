/**
 * The role report (L06): one open position's view as a CSV — the "This week"
 * sentence, the numbers against the previous period, needs attention, the
 * daily table, what happened, upcoming interviews and the open-to-close
 * journey. It is the daily hiring-manager update in one file.
 *
 * Field | Value, like every one-record export (L12, utils/fieldValueExport.js):
 * column A names the line, column B says it in full, and each part of the
 * report is a heading row. roleReportLines() emits sectioned rows and
 * roleReportRows() turns them into that layout. Pure: the controller loads the role view
 * (openPositions.service.getRoleDetail) and passes it in.
 */
import { fmtDate, fmtDateTimeIst } from '../utils/dateFormat.js';
import { FIELD_VALUE_COLUMNS, toFieldValueRows } from '../utils/fieldValueExport.js';

export const columns = FIELD_VALUE_COLUMNS;

/** "14 (previous period 9)" — a value with its qualifier, or whichever exists. */
const withNote = (value, note) => {
  const v = value === null || value === undefined ? '' : String(value);
  const n = note ? String(note) : '';
  if (v && n) return `${v} (${n})`;
  return v || n;
};
const joinDot = (...parts) => parts.filter((x) => x !== null && x !== undefined && x !== '').join(' · ');

const KPI_LABELS = {
  applied: 'Applied', responded: 'Responded', shortlisted: 'Shortlisted', rejected: 'Rejected',
  moved_forward: 'Moved forward', interviews: 'Interviews', offers: 'Offers',
};

/**
 * The report as sectioned Field / Value lines.
 * @param {object} d the getRoleDetail() result
 * @returns {Array<{section: string, field: string, value: *}>}
 */
export function roleReportLines(d) {
  const p = d.position;
  const rows = [];
  const add = (section, field, value = '') => rows.push({ section, field, value });

  add('Position', 'Role', joinDot(p.role, p.ref));
  add('Position', 'Status', p.status);
  add('Position', 'Period', withNote(d.range.label, d.previous?.label ? `compared with ${d.previous.label}` : ''));
  add('Position', 'Opened', withNote(fmtDate(p.opened_at), p.days_open == null ? '' : `${p.days_open} days open`));
  add('Position', 'Openings filled', `${p.filled} of ${p.openings ?? '?'}`);
  add('Position', 'Health', joinDot(p.health?.label, (p.health?.reasons || []).join('; ')));
  add('Summary', 'This period', d.summary_text);

  for (const k of d.kpis) {
    add('Numbers', KPI_LABELS[k.key] || k.key, withNote(k.value, k.previous == null ? '' : `previous period ${k.previous}`));
  }
  add('Numbers', 'Shortlist rate', withNote(p.shortlist_pct == null ? '' : `${p.shortlist_pct}%`, 'shortlisted ÷ applied'));
  add('Numbers', 'Response rate', withNote(p.response_pct == null ? '' : `${p.response_pct}%`, 'responded ÷ applied'));
  for (const [key, label] of Object.entries(d.source_labels || {})) add('Applied by source', label, p.sources?.[key] ?? 0);

  for (const s of d.attention.stuck) add('Needs attention', 'Stuck', joinDot(s.candidate_name, s.stage, `${s.days} days`));
  for (const f of d.attention.feedback) add('Needs attention', 'Feedback overdue', joinDot(f.candidate_name, f.stage, f.interviewer, `sent ${fmtDate(f.sent_at)}`));
  for (const o of d.attention.offers) add('Needs attention', 'Offer awaiting approval', joinDot(o.candidate_name, `requested ${fmtDate(o.requested_at)}`));
  if (d.attention.responded_not_reviewed) add('Needs attention', 'Responded, not yet reviewed', `${d.attention.responded_not_reviewed} in JD screening`);

  for (const s of d.series) {
    const day = s.weekly ? `${fmtDate(s.from)} – ${fmtDate(s.to)}` : fmtDate(s.from);
    const parts = Object.entries(s.sources).filter(([, n]) => n).map(([k, n]) => `${d.source_labels?.[k] || k} ${n}`);
    add('Daily', day, `${s.applied} applied (${parts.join(', ') || 'no applicants'}); shortlisted ${s.shortlisted}`);
  }

  for (const a of d.activity.items) add('What happened', a.day_only ? fmtDate(a.at) : fmtDateTimeIst(a.at), withNote(a.text, a.by ? `by ${a.by}` : ''));
  for (const u of d.upcoming) add('Upcoming interviews', fmtDateTimeIst(u.at), joinDot(u.candidate_name, u.stage, u.kind === 'zeko' ? 'Zeko' : 'Teams'));
  for (const m of d.milestones) {
    add('Journey', m.label, withNote(m.at ? fmtDate(m.at) : 'not yet', m.days_after_previous == null ? '' : `+${m.days_after_previous} days`));
  }
  return rows;
}

/**
 * The rows the CSV writes: Field | Value, with section heading rows.
 * @param {object} d the getRoleDetail() result
 */
export function roleReportRows(d) {
  return toFieldValueRows(roleReportLines(d));
}

export default { columns, roleReportLines, roleReportRows };
