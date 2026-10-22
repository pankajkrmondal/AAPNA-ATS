/**
 * PositionsTab — Analytics "Positions" tab (Phase 3 "Do Now", N39).
 *
 * One row per requisition: when it opened, how long it has been open, how far
 * its candidates got (one column per stage), offers, joiners and the joining
 * ratio, and why it closed. Analytics otherwise shows one MRF at a time; this
 * is the cross-position view the CEO asked for. Clicking a row opens that
 * MRF's funnel on the Pipeline Insights tab.
 *
 * Data: GET /api/pipeline/analytics/positions (counted by positionsOverview,
 * backend/src/services/pipelineAnalytics.helpers.js).
 */
import { useEffect, useMemo, useState } from 'react';
import { Alert, Segmented, Space, Table, Tag, Tooltip, Typography } from 'antd';
import pipelineService from '../../services/pipeline';
import ExportButton from '../common/ExportButton';
import MetricInfo from '../common/MetricInfo';
import { fmtDate, NO_DATE } from '../../utils/dateFormat';
import { closureReasonLabel } from '../../utils/mrfLabel';

const { Text } = Typography;

const STATUS_COLOR = { Open: 'green', Paused: 'orange', Filled: 'blue', Closed: 'default' };
const STATUS_HINT = {
  Open: 'Approved and still hiring.',
  Paused: 'Hiring is paused on this requisition.',
  Filled: 'Every opening has been filled.',
  Closed: 'Closed by the business (budget, role withdrawn, hired elsewhere…).',
};
const STATUS_FILTERS = [
  { label: 'Open', value: 'open' },
  { label: 'Closed', value: 'closed' },
  { label: 'All', value: 'all' },
];

const numberSorter = (key) => (a, b) => (a[key] ?? -1) - (b[key] ?? -1);
const unwrap = (res) => res?.data?.data ?? res?.data ?? null;

/** Column title with its ⓘ explanation. */
const titled = (text, metric) => (
  <span style={{ whiteSpace: 'nowrap' }}>{text} {metric && <MetricInfo metric={metric} size={10.5} />}</span>
);

export default function PositionsTab({ title, onOpenFunnel }) {
  const [state, setState] = useState({ loading: true, errored: false, stages: [], rows: [] });
  const [status, setStatus] = useState('open');

  useEffect(() => {
    let alive = true;
    pipelineService.getPositionsAnalytics()
      .then((res) => {
        const d = unwrap(res) || {};
        if (alive) setState({ loading: false, errored: false, stages: d.stages || [], rows: d.rows || [] });
      })
      .catch(() => { if (alive) setState((s) => ({ ...s, loading: false, errored: true })); });
    return () => { alive = false; };
  }, []);

  const rows = useMemo(() => state.rows.filter((r) => {
    if (status === 'open') return r.status === 'Open' || r.status === 'Paused';
    if (status === 'closed') return r.status === 'Filled' || r.status === 'Closed';
    return true;
  }), [state.rows, status]);

  const columns = useMemo(() => [
    {
      title: 'Position',
      key: 'position',
      fixed: 'left',
      width: 230,
      sorter: (a, b) => a.role.localeCompare(b.role),
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Text strong>{r.role}</Text>
          <Space size={6}>
            <Text type="secondary" style={{ fontSize: 12 }}>{r.ref}</Text>
            <Tooltip title={STATUS_HINT[r.status]}>
              <Tag color={STATUS_COLOR[r.status]} style={{ fontSize: 11, marginInlineEnd: 0 }}>{r.status}</Tag>
            </Tooltip>
          </Space>
        </Space>
      ),
    },
    {
      title: titled('Opened', 'positionsOpened'),
      dataIndex: 'opened_at',
      width: 120,
      sorter: (a, b) => new Date(a.opened_at || 0) - new Date(b.opened_at || 0),
      render: (v) => (v ? fmtDate(v) : NO_DATE),
    },
    { title: titled('Days open', 'positionsDaysOpen'), dataIndex: 'days_open', width: 110, align: 'right', sorter: numberSorter('days_open'), defaultSortOrder: 'descend', render: (v) => v ?? NO_DATE },
    { title: 'Openings', dataIndex: 'openings', width: 95, align: 'right', sorter: numberSorter('openings'), render: (v) => v ?? NO_DATE },
    { title: titled('Shortlisted', 'positionsShortlisted'), dataIndex: 'shortlisted', width: 115, align: 'right', sorter: numberSorter('shortlisted') },
    { title: titled('Moved forward', 'positionsMovedForward'), dataIndex: 'moved_forward', width: 135, align: 'right', sorter: numberSorter('moved_forward') },
    {
      title: titled('Reached each stage', 'positionsStageReach'),
      children: state.stages.map((s) => ({
        title: <Tooltip title={s.label}><span style={{ fontSize: 11.5 }}>{s.label}</span></Tooltip>,
        key: `stage_${s.stage_key}`,
        width: 96,
        align: 'right',
        sorter: (a, b) => (a.stage_counts?.[s.stage_key] || 0) - (b.stage_counts?.[s.stage_key] || 0),
        render: (_, r) => {
          const n = r.stage_counts?.[s.stage_key] || 0;
          return n ? n : <Text type="secondary">0</Text>;
        },
      })),
    },
    { title: 'Offers', dataIndex: 'offers_made', width: 85, align: 'right', sorter: numberSorter('offers_made') },
    { title: 'Accepted', dataIndex: 'offers_accepted', width: 95, align: 'right', sorter: numberSorter('offers_accepted') },
    { title: 'Joined', dataIndex: 'joined', width: 85, align: 'right', sorter: numberSorter('joined') },
    {
      title: titled('Joining ratio', 'positionsJoiningRatio'),
      dataIndex: 'joining_ratio',
      width: 125,
      align: 'right',
      sorter: numberSorter('joining_ratio'),
      render: (v) => (v === null || v === undefined ? NO_DATE : `${v}%`),
    },
    {
      title: 'Closed · reason',
      key: 'closure',
      width: 190,
      render: (_, r) => (r.closed_at || r.closure_reason
        ? <span>{r.closed_at ? fmtDate(r.closed_at) : ''}{r.closure_reason ? ` · ${closureReasonLabel(r.closure_reason)}` : ''}</span>
        : <Text type="secondary">{NO_DATE}</Text>),
    },
  ], [state.stages]);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        {title}
        <Space size={10} wrap>
          <Segmented value={status} onChange={setStatus} options={STATUS_FILTERS} data-testid="positions-status-filter" />
          <ExportButton
            tooltip="Downloads one row per requisition with every stage as its own column — the table below, ready for a spreadsheet."
            request={(cfg) => pipelineService.exportPositionsAnalytics(status, cfg)}
            fallbackName="AAPNA-ATS_Pipeline-Positions.csv"
            rowCount={rows.length}
            label="Export"
            size="small"
          />
        </Space>
      </div>
      {state.errored && <Alert type="error" showIcon message="Positions could not be loaded. Refresh the page to try again." style={{ marginBottom: 12 }} />}
      <Table
        rowKey="mrf_id"
        dataSource={rows}
        columns={columns}
        loading={state.loading}
        size="middle"
        scroll={{ x: 'max-content' }}
        pagination={{ pageSize: 15, showSizeChanger: false }}
        onRow={(r) => ({
          onClick: () => onOpenFunnel?.(r.mrf_id),
          style: { cursor: 'pointer' },
          title: 'Open this position’s funnel',
          'data-testid': `positions-row-${r.mrf_id}`,
        })}
        locale={{ emptyText: status === 'open' ? 'No open positions' : 'No positions' }}
      />
      <Text type="secondary" style={{ fontSize: 12 }}>Click a row to open that position’s funnel in Pipeline Insights.</Text>
    </>
  );
}
