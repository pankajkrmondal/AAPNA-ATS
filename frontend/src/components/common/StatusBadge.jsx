/**
 * StatusBadge — one candidate status, rendered as a filled pill.
 *
 * The nine status colours were literal hexes, so they could follow neither a tenant
 * brand nor dark mode. They are `--status-*` tokens now (theme/index.css), and six of
 * the nine simply alias tokens that already existed — `--kpi-b`, `--brand-primary`,
 * `--status-hold`, `--kpi-c`, `--status-approved`, `--red` — so a change to those
 * reaches these too rather than drifting from them.
 *
 * The label sits ON the fill, so it takes `--brand-on-solid` rather than the white
 * AntD would otherwise pick.
 */
import { Tag } from 'antd';
import '../../styles/components.css';

/** Status key -> label + the token carrying its colour. */
const STATUS_MAP = {
  new: { label: 'New', token: '--status-new' },
  screening: { label: 'Screening', token: '--status-screening' },
  shortlisted: { label: 'Shortlisted', token: '--status-shortlisted' },
  interview: { label: 'Interview', token: '--status-interview' },
  offered: { label: 'Offered', token: '--status-offered' },
  hired: { label: 'Hired', token: '--status-hired' },
  rejected: { label: 'Rejected', token: '--status-rejected' },
  onhold: { label: 'On Hold', token: '--status-onhold' },
  withdrawn: { label: 'Withdrawn', token: '--status-withdrawn' },
};

export default function StatusBadge({ status, style }) {
  const key = (status || '').toLowerCase().replace(/[\s_-]/g, '');
  // An unrecognised status keeps its own text and takes the neutral hold colour, so a
  // new backend status shows up readable rather than unstyled.
  const config = STATUS_MAP[key] || { label: status || 'Unknown', token: '--status-onhold' };

  return (
    <Tag
      className="sb-tag"
      style={{ '--sb-hue': `var(${config.token})`, ...style }}
    >
      {config.label}
    </Tag>
  );
}
