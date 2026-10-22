/**
 * PositionsTab — Analytics "Open Positions" board (N39, reworked for L06 on the
 * design approved 22 Oct 2026).
 *
 * One row per requisition for the page's date range: health (W2), applicants
 * (by source on hover, against the previous period), responded, shortlisted,
 * rejected, moved forward, offers, joined, the live "Now" numbers and the
 * ratios. Every underlined number opens its candidates (W1); the role name
 * opens the role view. Open is the default filter; Closed / All stay.
 *
 * Data: GET /api/pipeline/analytics/positions?from&to (openPositions.service.js).
 */
import { useEffect, useMemo, useState } from 'react';
import { Alert, Col, Row, Segmented, Space, Table, Tag, Tooltip, Typography } from 'antd';
import {
  AlertOutlined, ApartmentOutlined, CheckCircleOutlined, MailOutlined, ProfileOutlined, TeamOutlined,
} from '@ant-design/icons';
import KpiCard from '../common/KpiCard';
import pipelineService from '../../services/pipeline';
import ExportButton from '../common/ExportButton';
import MetricInfo from '../common/MetricInfo';
import { fmtDate, NO_DATE } from '../../utils/dateFormat';
import { closureReasonLabel } from '../../utils/mrfLabel';
import {
  ACCENT, Delta, HealthDot, HealthFlags, NowBadge, SOURCE_KEYS, SOURCE_LABEL_FALLBACK, rangeParams,
} from './openPositionsShared';

const { Text } = Typography;

const STATUS_FILTERS = [
  { label: 'Open', value: 'open' },
  { label: 'Closed', value: 'closed' },
  { label: 'All', value: 'all' },
];
const STATUS_COLOR = { Open: 'green', Paused: 'orange', Filled: 'blue', Closed: 'default' };

const unwrap = (res) => res?.data?.data ?? res?.data ?? null;
const numberSorter = (key) => (a, b) => (a[key] ?? -1) - (b[key] ?? -1);
const titled = (text, metric, now = false) => (
  <span style={{ whiteSpace: 'nowrap' }}>{text}{now && <NowBadge />} {metric && <MetricInfo metric={metric} size={10.5} />}</span>
);

/** A number that opens its candidates (W1). */
function Num({ value, onClick, strong = false }) {
  if (!value) return <Text type="secondary">0</Text>;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text)', font: 'inherit',
        fontWeight: strong ? 700 : 500, textDecoration: 'underline dotted', textUnderlineOffset: 3,
      }}
    >
      {value}
    </button>
  );
}

/**
 * Summary tiles above the board (open positions only): the shared KpiCard, the
 * same strip the Analytics headline uses, with one line of context under each.
 */
function SummaryTiles({ summary }) {
  if (!summary) return null;
  const tiles = [
    { label: 'Open positions', value: summary.open_positions, icon: <ProfileOutlined />, accent: ACCENT.neutral, metric: null,
      note: `${summary.openings} openings · ${summary.filled} filled${summary.paused ? ` · ${summary.paused} paused` : ''}` },
    { label: 'Need attention', value: summary.at_risk + summary.watch, icon: <AlertOutlined />, accent: ACCENT.negative, metric: 'opHealth',
      note: <span><span style={{ color: 'var(--op-risk-ink)', fontWeight: 600 }}>{summary.at_risk} at risk</span> · <span style={{ color: 'var(--op-watch-ink)', fontWeight: 600 }}>{summary.watch} watch</span></span> },
    { label: 'Applied', value: summary.applied, icon: <TeamOutlined />, accent: ACCENT.progress, metric: 'opApplied',
      note: summary.applied_previous == null ? 'all time' : <span><Delta value={summary.applied} previous={summary.applied_previous} /> vs {summary.applied_previous}</span> },
    { label: 'Responded', value: summary.responded, icon: <MailOutlined />, accent: ACCENT.waiting, metric: 'opResponded',
      note: summary.response_pct == null ? '–' : `${summary.response_pct}% of applied` },
    { label: 'Shortlisted', value: summary.shortlisted, icon: <CheckCircleOutlined />, accent: ACCENT.positive, metric: 'opShortlisted',
      note: summary.shortlist_pct == null ? '–' : `${summary.shortlist_pct}% of applied` },
    { label: 'In pipeline · now', value: summary.in_pipeline, icon: <ApartmentOutlined />, accent: ACCENT.success, metric: 'opInPipeline',
      note: `${summary.stuck} stuck · ${summary.awaiting_feedback} awaiting feedback` },
  ];
  return (
    <Row gutter={[16, 16]} style={{ marginBottom: 18 }} data-testid="open-positions-summary">
      {tiles.map((t, i) => (
        <Col xs={12} sm={12} md={8} lg={4} key={t.label}>
          <KpiCard index={i} icon={t.icon} label={t.label} value={t.value ?? 0} metric={t.metric} {...t.accent} />
          <Text type="secondary" style={{ fontSize: 11.5, display: 'block', padding: '6px 4px 0', lineHeight: 1.4 }}>{t.note}</Text>
        </Col>
      ))}
    </Row>
  );
}

/**
 * @param {{ title: React.ReactNode, range: object, onOpenRole: (mrfId: number) => void,
 *   onOpenMetric: (mrfId: number, metric: string) => void }} props  range: the page's range state
 */
export default function PositionsTab({ title, range, onOpenRole, onOpenMetric }) {
  const [state, setState] = useState({ loading: true, errored: false, data: null });
  const [status, setStatus] = useState('open');
  const params = rangeParams(range);
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, errored: false }));
    pipelineService.getPositionsAnalytics(params)
      .then((res) => { if (alive) setState({ loading: false, errored: false, data: unwrap(res) }); })
      .catch(() => { if (alive) setState((s) => ({ ...s, loading: false, errored: true })); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey]);

  const data = state.data;
  const rows = useMemo(() => (data?.rows || []).filter((r) => {
    if (status === 'open') return r.status === 'Open' || r.status === 'Paused';
    if (status === 'closed') return r.status === 'Filled' || r.status === 'Closed';
    return true;
  }), [data, status]);

  const open = (r, metric) => () => onOpenMetric?.(r.mrf_id, metric);
  const sourceLabel = (k) => data?.source_labels?.[k] || SOURCE_LABEL_FALLBACK[k];

  const columns = useMemo(() => [
    {
      title: titled('Health', 'opHealth'),
      key: 'health',
      width: 110,
      fixed: 'left',
      render: (_, r) => <HealthDot health={r.health} />,
    },
    {
      title: 'Role',
      key: 'role',
      fixed: 'left',
      width: 260,
      sorter: (a, b) => a.role.localeCompare(b.role),
      render: (_, r) => (
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <span>
            <a onClick={(e) => { e.stopPropagation(); onOpenRole?.(r.mrf_id); }} style={{ fontWeight: 700 }} data-testid={`open-role-${r.mrf_id}`}>{r.role}</a>
            <Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>{r.ref}</Text>
            {r.status !== 'Open' && <Tag color={STATUS_COLOR[r.status]} style={{ fontSize: 11, marginLeft: 6 }}>{r.status}</Tag>}
          </span>
          {(r.status === 'Open') && <HealthFlags health={r.health} />}
          {r.closure_reason && <Text type="secondary" style={{ fontSize: 12 }}>{r.closed_at ? fmtDate(r.closed_at) : ''} · {closureReasonLabel(r.closure_reason)}</Text>}
        </Space>
      ),
    },
    {
      title: titled('Opened', 'positionsOpened'),
      key: 'opened',
      width: 110,
      sorter: numberSorter('days_open'),
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <span>{r.opened_at ? fmtDate(r.opened_at) : NO_DATE}</span>
          <Text type="secondary" style={{ fontSize: 12 }}>{r.days_open ?? '–'} days</Text>
        </Space>
      ),
    },
    { title: 'Filled', key: 'filled', width: 76, align: 'right', render: (_, r) => `${r.filled} / ${r.openings ?? '?'}` },
    {
      title: titled('Applied', 'opApplied'),
      key: 'applied',
      width: 104,
      align: 'right',
      sorter: numberSorter('applied'),
      render: (_, r) => (
        <Tooltip
          title={(
            <div>
              <div style={{ fontWeight: 700 }}>Applied {r.applied}</div>
              {SOURCE_KEYS.map((k) => <div key={k}>{sourceLabel(k)}: {r.sources?.[k] || 0}</div>)}
              <div style={{ marginTop: 4, opacity: 0.85 }}>Since opened: {r.since_opened?.applied ?? '–'}{r.previous ? ` · previous period: ${r.previous.applied}` : ''}</div>
            </div>
          )}
        >
          <Space direction="vertical" size={0} style={{ alignItems: 'flex-end' }}>
            <Num value={r.applied} onClick={open(r, 'applied')} strong />
            <Delta value={r.applied} previous={r.previous?.applied} />
          </Space>
        </Tooltip>
      ),
    },
    { title: titled('Responded', 'opResponded'), key: 'responded', width: 110, align: 'right', sorter: numberSorter('responded'), render: (_, r) => <Num value={r.responded} onClick={open(r, 'responded')} /> },
    { title: titled('Shortlisted', 'opShortlisted'), key: 'shortlisted', width: 116, align: 'right', sorter: numberSorter('shortlisted'), render: (_, r) => <Num value={r.shortlisted} onClick={open(r, 'shortlisted')} /> },
    { title: titled('Rejected', 'opRejected'), key: 'rejected', width: 100, align: 'right', sorter: numberSorter('rejected'), render: (_, r) => <Num value={r.rejected} onClick={open(r, 'rejected')} /> },
    { title: titled('On hold', 'opOnHold', true), key: 'on_hold', width: 116, align: 'right', render: (_, r) => <Num value={r.on_hold} onClick={open(r, 'on_hold')} /> },
    { title: titled('In pipeline', 'opInPipeline', true), key: 'in_pipeline', width: 130, align: 'right', sorter: numberSorter('in_pipeline'), render: (_, r) => <Num value={r.in_pipeline} onClick={open(r, 'in_pipeline')} /> },
    { title: titled('Moved fwd', 'opMovedForward'), key: 'moved_forward', width: 108, align: 'right', sorter: numberSorter('moved_forward'), render: (_, r) => <Num value={r.moved_forward} onClick={open(r, 'moved_forward')} /> },
    { title: titled('Offers', 'opOffers'), key: 'offers', width: 86, align: 'right', render: (_, r) => <Num value={r.offers} onClick={open(r, 'offers')} /> },
    { title: titled('Joined', 'opJoined'), key: 'joined', width: 86, align: 'right', render: (_, r) => <Num value={r.joined} onClick={open(r, 'joined')} /> },
    { title: titled('Shortlist %', 'opShortlistPct'), key: 'shortlist_pct', width: 116, align: 'right', sorter: numberSorter('shortlist_pct'), render: (_, r) => (r.shortlist_pct == null ? <Text type="secondary">–</Text> : `${r.shortlist_pct}%`) },
    { title: titled('Response %', 'opResponsePct'), key: 'response_pct', width: 116, align: 'right', sorter: numberSorter('response_pct'), render: (_, r) => (r.response_pct == null ? <Text type="secondary">–</Text> : `${r.response_pct}%`) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [data]);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        {title}
        <Space size={10} wrap>
          <Segmented value={status} onChange={setStatus} options={STATUS_FILTERS} data-testid="positions-status-filter" />
          <ExportButton
            tooltip="Downloads one row per requisition for this date range: health, applicants by source, every count on the board and each stage reached."
            request={(cfg) => pipelineService.exportPositionsAnalytics(status, cfg, params)}
            fallbackName="AAPNA-ATS_Open-Positions.csv"
            rowCount={rows.length}
            label="Export"
            size="small"
          />
        </Space>
      </div>
      {state.errored && <Alert type="error" showIcon message="Open positions could not be loaded. Refresh the page to try again." style={{ marginBottom: 12 }} />}
      <SummaryTiles summary={data?.summary} />
      <Table
        rowKey="mrf_id"
        dataSource={rows}
        columns={columns}
        loading={state.loading}
        size="middle"
        scroll={{ x: 'max-content' }}
        pagination={{ pageSize: 15, showSizeChanger: false }}
        onRow={(r) => ({
          onClick: () => onOpenRole?.(r.mrf_id),
          style: { cursor: 'pointer' },
          'data-testid': `positions-row-${r.mrf_id}`,
        })}
        locale={{ emptyText: status === 'open' ? 'No open positions' : 'No positions' }}
      />
      <Text type="secondary" style={{ fontSize: 12 }}>
        Click a role for its view over this range. Every underlined number opens the candidates behind it. Hover Applied for the sources.
      </Text>
    </>
  );
}
