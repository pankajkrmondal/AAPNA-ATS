/**
 * Small pieces shared by the Open Positions board, the role view, the
 * Dashboard pulse and the Pipeline role header (L06): the date range presets,
 * the health dot, the change arrow, the source colours and deep links.
 */
import { Tag, Tooltip, Typography } from 'antd';
import dayjs from 'dayjs';

const { Text } = Typography;

/**
 * Semantic palette, shared with the Dashboard / HR Upload / Vendor screens.
 * Colour carries MEANING here rather than decoration — gold reads as positive,
 * red as rejected/failed, blue as in-flight, amber as waiting on someone. Kept
 * as one map so a tile, a tag and a table cell for the same concept cannot
 * drift to different colours.
 */
export const ACCENT = {
  positive: { color: 'var(--kpi-a)', tint: 'var(--kpi-a-tint)', accent: 'linear-gradient(90deg,var(--kpi-a),var(--kpi-a-2))' },
  negative: { color: 'var(--kpi-d)', tint: 'var(--kpi-d-tint)', accent: 'linear-gradient(90deg,var(--kpi-d),var(--kpi-d-2))' },
  progress: { color: 'var(--kpi-b)', tint: 'var(--kpi-b-tint)', accent: 'linear-gradient(90deg,var(--kpi-b),var(--kpi-b-2))' },
  waiting: { color: 'var(--kpi-e)', tint: 'var(--kpi-e-tint)', accent: 'linear-gradient(90deg,var(--kpi-e),var(--kpi-e-2))' },
  neutral: { color: 'var(--text-2)', tint: 'color-mix(in srgb, var(--text-2) 12%, transparent)', accent: 'linear-gradient(90deg,var(--text-2),var(--text-3))' },
  success: { color: 'var(--kpi-c)', tint: 'var(--kpi-c-tint)', accent: 'linear-gradient(90deg,var(--kpi-c),var(--kpi-c-2))' },
};

/**
 * Card header used across all four tabs: a coloured rule + title, so every
 * panel is scannable at a glance and colour-coded to what it reports on.
 */
export function SectionTitle({ children, accent = ACCENT.positive, hint }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <span style={{
        width: 4, height: 18, borderRadius: 3, background: accent.accent, flexShrink: 0,
      }}
      />
      <span>
        <Text strong style={{ fontSize: 15 }}>{children}</Text>
        {hint && (
          <Text type="secondary" style={{ fontSize: 12, marginLeft: 8, fontWeight: 400 }}>{hint}</Text>
        )}
      </span>
    </span>
  );
}


/** The range bar's presets (decision D1: Last 7 days by default). */
export const RANGE_PRESETS = [
  { value: '7', label: '7 days', days: 7 },
  { value: '30', label: '30 days', days: 30 },
  { value: '60', label: '60 days', days: 60 },
  { value: '90', label: '90 days', days: 90 },
  { value: '365', label: '365 days', days: 365 },
  { value: 'all', label: 'All' },
];
export const DEFAULT_RANGE = { preset: '7', from: null, to: null };

/**
 * API params for a range state: { from, to } as YYYY-MM-DD, or {} for All.
 * Presets count back from today, today included.
 */
export function rangeParams(range) {
  if (!range || range.preset === 'all') return {};
  if (range.preset === 'custom') {
    return range.from && range.to ? { from: range.from.format('YYYY-MM-DD'), to: range.to.format('YYYY-MM-DD') } : {};
  }
  const p = RANGE_PRESETS.find((x) => x.value === range.preset);
  const to = dayjs();
  const from = to.subtract((p?.days || 7) - 1, 'day');
  return { from: from.format('YYYY-MM-DD'), to: to.format('YYYY-MM-DD') };
}

/** "16 Oct 2026 – 22 Oct 2026" / "All time". */
export function rangeText(range) {
  const p = rangeParams(range);
  if (!p.from) return 'All time';
  const f = dayjs(p.from).format('DD MMM YYYY');
  const t = dayjs(p.to).format('DD MMM YYYY');
  return f === t ? f : `${f} – ${t}`;
}

export const SOURCE_KEYS = ['hr_upload', 'vendor', 'recruiter', 'other'];
export const SOURCE_COLOR = {
  hr_upload: 'var(--op-src-hr)',
  vendor: 'var(--op-src-vendor)',
  recruiter: 'var(--op-src-recruiter)',
  other: 'var(--op-src-other)',
};
export const SOURCE_LABEL_FALLBACK = {
  hr_upload: 'HR upload',
  vendor: 'Vendor',
  recruiter: 'Added by recruiter',
  other: 'Mailbox, website & older uploads',
};

const HEALTH_STYLE = {
  at_risk: { dot: 'var(--op-risk)', tint: 'var(--op-risk-tint)', ink: 'var(--op-risk-ink)' },
  watch: { dot: 'var(--op-watch)', tint: 'var(--op-watch-tint)', ink: 'var(--op-watch-ink)' },
  on_track: { dot: 'var(--op-ok)', tint: 'var(--op-ok-tint)', ink: 'var(--op-ok-ink)' },
  paused: { dot: 'var(--op-muted)', tint: 'transparent', ink: 'var(--text-2)' },
  closed: { dot: 'var(--op-muted)', tint: 'transparent', ink: 'var(--text-2)' },
};

/** The health dot + word, with the reasons on hover (W2). Never colour alone. */
export function HealthDot({ health, chip = false, size = 10 }) {
  if (!health) return null;
  const st = HEALTH_STYLE[health.status] || HEALTH_STYLE.closed;
  const body = (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: st.ink,
        ...(chip ? { background: st.tint, padding: '2px 10px', borderRadius: 20 } : {}),
        whiteSpace: 'nowrap',
      }}
      data-testid="health-dot"
    >
      <span style={{ width: size, height: size, borderRadius: size, background: st.dot, flex: 'none' }} />
      {health.label}
    </span>
  );
  if (!health.reasons?.length) return body;
  return (
    <Tooltip title={<div>{health.reasons.map((r) => <div key={r}>{r}</div>)}</div>}>
      <span tabIndex={0}>{body}</span>
    </Tooltip>
  );
}

/** Small flag chips under a board row (the health reasons). */
export function HealthFlags({ health }) {
  if (!health?.reasons?.length || health.status === 'closed') return null;
  const st = HEALTH_STYLE[health.status] || HEALTH_STYLE.watch;
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6 }}>
      {health.reasons.map((r) => (
        <Tag key={r} style={{ margin: 0, borderRadius: 20, fontSize: 11.5, fontWeight: 600, background: st.tint, color: st.ink, border: 'none' }}>{r}</Tag>
      ))}
    </span>
  );
}

/** "▲ 21" / "▼ 15" against the previous period; nothing when there is no previous. */
export function Delta({ value, previous, goodWhenUp = true, style }) {
  if (previous == null || value == null) return null;
  const d = Number(value) - Number(previous);
  if (d === 0) return <Text type="secondary" style={{ fontSize: 11.5, ...style }}>no change</Text>;
  const up = d > 0;
  const good = goodWhenUp ? up : !up;
  return (
    <span style={{ fontSize: 11.5, fontWeight: 600, color: good ? 'var(--op-ok-ink)' : 'var(--op-risk-ink)', ...style }}>
      {up ? '▲' : '▼'} {Math.abs(d)}
    </span>
  );
}

/** The NOW badge on live-snapshot numbers (decision D6). */
export function NowBadge() {
  return (
    <Tooltip title="A snapshot of today. It does not follow the date range.">
      <Tag color="blue" style={{ fontSize: 10, fontWeight: 700, lineHeight: '16px', padding: '0 5px', marginInlineStart: 6, marginInlineEnd: 0 }}>NOW</Tag>
    </Tooltip>
  );
}

/** Where a candidate row opens: the Pipeline drawer, else the candidate profile. */
export function candidateLink(row) {
  if (row?.pipeline_id) return `/pipeline?candidate=${row.pipeline_id}`;
  if (row?.cv_id) return `/candidates/${row.cv_id}`;
  return null;
}

/** Deep link to one role's view on Analytics. */
export const roleAnalyticsLink = (mrfId) => `/analytics?tab=open&mrf=${mrfId}`;
