/**
 * The role report (L06): one open position's view as a CSV — the "This week"
 * sentence, the numbers against the previous period, needs attention, the
 * daily table, what happened, upcoming interviews and the open-to-close
 * journey. It is the daily hiring-manager update in one file.
 *
 * Section / Item / Detail / Value rows, like the MRF detail export, so one file
 * holds every part and still opens as a plain table. Pure: the controller
 * loads the role view (openPositions.service.getRoleDetail) and passes it in.
 */
import { fmtDate, fmtDateTimeIst } from '../utils/dateFormat.js';

export const columns = [
  { header: 'Section', key: 'section' },
  { header: 'Item', key: 'item' },
  { header: 'Detail', key: 'detail' },
  { header: 'Value', key: 'value' },
];

const KPI_LABELS = {
  applied: 'Applied', responded: 'Responded', shortlisted: 'Shortlisted', rejected: 'Rejected',
  moved_forward: 'Moved forward', interviews: 'Interviews', offers: 'Offers',
};

/** @param {object} d the getRoleDetail() result */
export function roleReportRows(d) {
  const p = d.position;
  const rows = [];
  const add = (section, item, detail = '', value = '') => rows.push({ section, item, detail, value });

  add('Position', p.role, p.ref, p.status);
  add('Position', 'Period', d.range.label, d.previous?.label ? `compared with ${d.previous.label}` : '');
  add('Position', 'Opened', fmtDate(p.opened_at), p.days_open == null ? '' : `${p.days_open} days open`);
  add('Position', 'Openings filled', '', `${p.filled} of ${p.openings ?? '?'}`);
  add('Position', 'Health', (p.health?.reasons || []).join('; '), p.health?.label || '');
  add('Summary', 'This period', d.summary_text, '');

  for (const k of d.kpis) {
    add('Numbers', KPI_LABELS[k.key] || k.key, k.previous == null ? '' : `previous period ${k.previous}`, k.value);
  }
  add('Numbers', 'Shortlist rate', 'shortlisted ÷ applied', p.shortlist_pct == null ? '' : `${p.shortlist_pct}%`);
  add('Numbers', 'Response rate', 'responded ÷ applied', p.response_pct == null ? '' : `${p.response_pct}%`);
  for (const [key, label] of Object.entries(d.source_labels || {})) add('Applied by source', label, '', p.sources?.[key] ?? 0);

  for (const s of d.attention.stuck) add('Needs attention', 'Stuck', `${s.candidate_name} · ${s.stage}`, `${s.days} days`);
  for (const f of d.attention.feedback) add('Needs attention', 'Feedback overdue', `${f.candidate_name} · ${f.stage}${f.interviewer ? ` · ${f.interviewer}` : ''}`, `sent ${fmtDate(f.sent_at)}`);
  for (const o of d.attention.offers) add('Needs attention', 'Offer awaiting approval', o.candidate_name, `requested ${fmtDate(o.requested_at)}`);
  if (d.attention.responded_not_reviewed) add('Needs attention', 'Responded, not yet reviewed', 'in JD screening', d.attention.responded_not_reviewed);

  for (const s of d.series) {
    const day = s.weekly ? `${fmtDate(s.from)} – ${fmtDate(s.to)}` : fmtDate(s.from);
    const parts = Object.entries(s.sources).filter(([, n]) => n).map(([k, n]) => `${d.source_labels?.[k] || k} ${n}`);
    add('Daily', day, `${parts.join(', ') || 'no applicants'}; shortlisted ${s.shortlisted}`, s.applied);
  }

  for (const a of d.activity.items) add('What happened', a.day_only ? fmtDate(a.at) : fmtDateTimeIst(a.at), a.text, a.by || '');
  for (const u of d.upcoming) add('Upcoming interviews', fmtDateTimeIst(u.at), `${u.candidate_name} · ${u.stage}`, u.kind === 'zeko' ? 'Zeko' : 'Teams');
  for (const m of d.milestones) {
    add('Journey', m.label, m.at ? fmtDate(m.at) : 'not yet', m.days_after_previous == null ? '' : `+${m.days_after_previous} days`);
  }
  return rows;
}

export default { columns, roleReportRows };
