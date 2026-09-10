/**
 * ReferralLogPanel — the audit trail behind the referral flag.
 *
 * Admin-tier only, enforced server-side by the router-wide
 * restrictTo('admin','superadmin') on /api/admin. It is here rather than beside
 * the recruiter screens for two reasons: it is an investigation tool rather than
 * daily work, and it is a list of exactly what "nobody in the other people in
 * the system knows that it is a referred person" excludes, gathered in one place.
 *
 * The question it exists to answer is the removal one — "which recruiter took
 * the referral off this candidate, and why?" — so removals get their own count
 * and their own one-click filter rather than being something you page to find.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Table, Card, Space, Select, Input, DatePicker, Button, Tag, Typography, Row, Col, Statistic, Alert,
} from 'antd';
import { ReloadOutlined, ClearOutlined, WarningOutlined } from '@ant-design/icons';
import adminService from '../../services/adminService';
import ExportButton from '../common/ExportButton';

const { Text } = Typography;
const { RangePicker } = DatePicker;

const ACTION_META = {
  marked: { label: 'Marked as referral', color: 'green' },
  updated: { label: 'Referrer / note changed', color: 'blue' },
  removed: { label: 'Referral REMOVED', color: 'red' },
};

const fmt = (v) => (v
  ? new Date(v).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  : '—');

export default function ReferralLogPanel() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [removals, setRemovals] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [filters, setFilters] = useState({
    action: undefined, candidate: '', referrer: '', from: undefined, to: undefined,
  });

  /** Only the set filters, so the export and the screen agree on the query. */
  const activeFilters = Object.fromEntries(
    Object.entries(filters).filter(([, v]) => v !== undefined && v !== ''),
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminService.getReferralLog({ ...activeFilters, page, limit: pageSize });
      const body = res.data || {};
      setRows(body.data || []);
      setTotal(body.pagination?.total || 0);
      setRemovals(body.removals || 0);
    } catch (err) {
      setError(err?.message || 'Could not load the referral log.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(activeFilters), page, pageSize]);

  useEffect(() => { load(); }, [load]);

  const setFilter = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  const clearAll = () => {
    setFilters({ action: undefined, candidate: '', referrer: '', from: undefined, to: undefined });
    setPage(1);
  };

  const columns = [
    { title: 'WHEN', dataIndex: 'acted_at', width: 165, render: (v) => <span style={{ fontSize: 12.5 }}>{fmt(v)}</span> },
    {
      title: 'ACTION',
      dataIndex: 'action',
      width: 175,
      render: (a) => {
        const m = ACTION_META[a] || { label: a, color: 'default' };
        return <Tag color={m.color} style={{ fontWeight: 600, marginInlineEnd: 0 }}>{m.label}</Tag>;
      },
    },
    {
      title: 'CANDIDATE',
      dataIndex: 'candidate_name',
      render: (name, r) => (
        <div>
          <Text strong style={{ fontSize: 13 }}>{name || '—'}</Text>
          {/* An audit row outlives its candidate by design (ON DELETE SET NULL),
              so say so rather than showing a blank id. */}
          {r.cv_id === null && (
            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>candidate deleted</Text>
          )}
        </div>
      ),
    },
    {
      title: 'REFERRER',
      key: 'referrer',
      render: (_, r) => {
        if (r.action === 'removed') {
          return <Text delete type="secondary" style={{ fontSize: 12.5 }}>{r.old_referred_by || '—'}</Text>;
        }
        if (r.action === 'updated' && r.old_referred_by !== r.new_referred_by) {
          return (
            <span style={{ fontSize: 12.5 }}>
              <Text delete type="secondary">{r.old_referred_by || '—'}</Text>
              {' → '}
              <Text strong>{r.new_referred_by || '—'}</Text>
            </span>
          );
        }
        return <Text style={{ fontSize: 12.5 }}>{r.new_referred_by || '—'}</Text>;
      },
    },
    {
      title: 'REASON (removals)',
      dataIndex: 'reason',
      render: (v) => (v ? <Text style={{ fontSize: 12.5, fontStyle: 'italic' }}>{v}</Text> : <Text type="secondary">—</Text>),
    },
    {
      title: 'DONE BY',
      dataIndex: 'acted_by_name',
      width: 160,
      render: (v, r) => (
        <div>
          <Text strong style={{ fontSize: 12.5 }}>{v}</Text>
          {r.acted_by_email && (
            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>{r.acted_by_email}</Text>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="animate-fade-in">
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} sm={12}>
          <Card bordered={false} className="admin-stat">
            <Statistic title="Referral events (matching filters)" value={total} />
          </Card>
        </Col>
        <Col xs={24} sm={12}>
          <Card bordered={false} className="admin-stat">
            <Statistic
              title="Of those, removals"
              value={removals}
              valueStyle={removals > 0 ? { color: 'var(--danger, #cf1322)' } : undefined}
              prefix={removals > 0 ? <WarningOutlined /> : null}
            />
          </Card>
        </Col>
      </Row>

      <Card
        bordered={false}
        style={{ marginBottom: 16 }}
        styles={{ body: { padding: 16 } }}
      >
        <Space wrap size={10} style={{ width: '100%' }}>
          <Select
            allowClear
            placeholder="All actions"
            style={{ minWidth: 200 }}
            value={filters.action}
            onChange={(v) => setFilter({ action: v })}
            options={Object.entries(ACTION_META).map(([value, m]) => ({ value, label: m.label }))}
          />
          <Input
            allowClear
            placeholder="Candidate name"
            style={{ width: 190 }}
            value={filters.candidate}
            onChange={(e) => setFilter({ candidate: e.target.value })}
          />
          <Input
            allowClear
            placeholder="Referrer name"
            style={{ width: 190 }}
            value={filters.referrer}
            onChange={(e) => setFilter({ referrer: e.target.value })}
          />
          <RangePicker
            onChange={(range) => setFilter({
              from: range?.[0] ? range[0].format('YYYY-MM-DD') : undefined,
              to: range?.[1] ? range[1].format('YYYY-MM-DD') : undefined,
            })}
          />
          <Button
            danger={filters.action === 'removed'}
            type={filters.action === 'removed' ? 'primary' : 'default'}
            icon={<WarningOutlined />}
            onClick={() => setFilter({ action: filters.action === 'removed' ? undefined : 'removed' })}
          >
            Removals only
          </Button>
          <Button icon={<ClearOutlined />} onClick={clearAll}>Clear</Button>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Refresh</Button>
          <ExportButton
            request={(cfg) => adminService.exportReferralLog(activeFilters, cfg)}
            fallbackName="AAPNA-ATS_Referral-Log.csv"
            rowCount={total}
            tooltip="Downloads the referral audit trail — every mark, change and removal, with who did it and why."
          />
        </Space>
      </Card>

      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} /> : null}

      <Card bordered={false} styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={loading}
          size="middle"
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            onChange: (p, s) => { setPage(p); setPageSize(s); },
            showTotal: (t, range) => `${range[0]}-${range[1]} of ${t}`,
          }}
          locale={{ emptyText: 'No referral activity matches these filters.' }}
        />
      </Card>
    </div>
  );
}
