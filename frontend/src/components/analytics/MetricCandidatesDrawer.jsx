/**
 * MetricCandidatesDrawer — "click any number to see the candidates" (L06, W1).
 * Opens from every underlined number on the Open Positions board and the role
 * view. Each row opens the candidate's Pipeline drawer, or their profile when
 * they have no journey for this role.
 *
 * Data: GET /api/pipeline/analytics/positions/:mrfId/candidates?metric=&from&to
 */
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Drawer, Empty, Input, List, Space, Tag, Typography } from 'antd';
import { SearchOutlined, DownloadOutlined, TeamOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import pipelineService from '../../services/pipeline';
import MetricInfo from '../common/MetricInfo';
import { candidateLink } from './openPositionsShared';

const { Text } = Typography;

const METRIC_INFO = {
  applied: 'opApplied', responded: 'opResponded', shortlisted: 'opShortlisted', rejected: 'opRejected',
  moved_forward: 'opMovedForward', interviews: 'opInterviews', offers: 'opOffers', joined: 'opJoined',
  in_pipeline: 'opInPipeline', on_hold: 'opOnHold', stuck: 'opStuck', awaiting_feedback: 'opAwaitingFeedback',
};

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/** Plain CSV of what the drawer shows (the list is already on screen). */
function downloadCsv(data) {
  const lines = [['Candidate', 'Email', 'Detail', 'Now'].map(csvCell).join(',')]
    .concat(data.rows.map((r) => [r.name, r.email, r.detail, r.now].map(csvCell).join(',')));
  const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `AAPNA-ATS_${data.label.replace(/\s+/g, '-')}_MRF-${data.mrf_id}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * @param {{ open: boolean, target: { mrfId: number, metric: string }|null, range: object, onClose: () => void }} props
 *   range: API params ({ from, to } or {})
 */
export default function MetricCandidatesDrawer({ open, target, range, onClose }) {
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: false, error: false, data: null });
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open || !target) return undefined;
    let alive = true;
    setQuery('');
    setState({ loading: true, error: false, data: null });
    pipelineService.getPositionCandidates(target.mrfId, target.metric, range)
      .then((res) => { if (alive) setState({ loading: false, error: false, data: res.data?.data || res.data }); })
      .catch(() => { if (alive) setState({ loading: false, error: true, data: null }); });
    return () => { alive = false; };
  }, [open, target, range]);

  const rows = useMemo(() => {
    const all = state.data?.rows || [];
    const q = query.trim().toLowerCase();
    return q ? all.filter((r) => `${r.name} ${r.email || ''}`.toLowerCase().includes(q)) : all;
  }, [state.data, query]);

  const d = state.data;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={560}
      destroyOnHidden
      title={(
        <Space direction="vertical" size={2}>
          <Space>
            <TeamOutlined />
            <Text strong style={{ fontSize: 16 }}>{d ? `${d.label} · ${d.count}` : 'Candidates'}</Text>
            {target && METRIC_INFO[target.metric] && <MetricInfo metric={METRIC_INFO[target.metric]} />}
          </Space>
          {d && <Text type="secondary" style={{ fontSize: 12.5, fontWeight: 400 }}>{d.role} · MRF-{d.mrf_id} · {d.range.label}</Text>}
        </Space>
      )}
      data-testid="metric-candidates-drawer"
    >
      {state.error && <Alert type="error" showIcon message="These candidates could not be loaded. Try again." />}
      <Space style={{ width: '100%', marginBottom: 12 }}>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Search name or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, minWidth: 300 }}
        />
        <Button icon={<DownloadOutlined />} disabled={!d?.rows?.length} onClick={() => downloadCsv(d)}>Export CSV</Button>
      </Space>
      <List
        loading={state.loading}
        dataSource={rows}
        locale={{ emptyText: <Empty description="No candidates" /> }}
        pagination={rows.length > 25 ? { pageSize: 25, size: 'small' } : false}
        renderItem={(r) => {
          const link = candidateLink(r);
          return (
            <List.Item
              actions={link ? [<Button key="open" type="link" size="small" onClick={() => navigate(link)}>Open →</Button>] : []}
            >
              <List.Item.Meta
                title={<span>{r.name}{r.now && <Tag style={{ marginLeft: 8, borderRadius: 12 }}>{r.now}</Tag>}</span>}
                description={<Text type="secondary" style={{ fontSize: 12.5 }}>{r.detail}</Text>}
              />
            </List.Item>
          );
        }}
      />
      <Text type="secondary" style={{ fontSize: 12 }}>
        &quot;Open&quot; goes to the Pipeline drawer for candidates in the pipeline, and to the candidate profile otherwise.
      </Text>
    </Drawer>
  );
}
