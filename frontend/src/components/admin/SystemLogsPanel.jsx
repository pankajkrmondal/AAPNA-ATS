/**
 * SystemLogsPanel — Super Admin → Logs & errors (N42).
 *
 * The developer's view of what went wrong, without logging in to the server:
 *
 *   - Errors     backend 5xx errors, failed jobs, crashes and browser errors,
 *                grouped so a repeat shows as one row with a count;
 *   - Find a ref paste the ref HR quotes ("ref: K7Q2MX") and see that
 *                request's errors and every log line it wrote, including its
 *                calls to Graph, Zeko, the AI service and Cohere;
 *   - Jobs       last run, last success and last failure of each scheduled job;
 *   - Health     live checks of the database, Redis, the upload queue and the
 *                Microsoft login.
 *
 * Super Admin only, enforced server-side (restrictTo('superadmin')): errors
 * cover every company. Everything shown was masked when it was written.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Table, Card, Space, Select, Input, Button, Tag, Typography, Alert, Tabs, Empty, Tooltip, Descriptions,
} from 'antd';
import {
  ReloadOutlined, SearchOutlined, CheckCircleFilled, CloseCircleFilled, WarningOutlined,
} from '@ant-design/icons';
import adminService from '../../services/adminService';
import { fmtDateTime, fmtRelative } from '../../utils/dateFormat';

const { Text, Paragraph } = Typography;

const SOURCE_META = {
  backend: { label: 'Server', color: 'volcano', hint: 'An API request failed with a server error (5xx), or the server crashed.' },
  job: { label: 'Job', color: 'purple', hint: 'A scheduled job (reminders, mailbox poll, Zeko sync…) failed.' },
  frontend: { label: 'Browser', color: 'geekblue', hint: "A screen crashed or a call failed in someone's browser." },
};

const LEVEL_COLOR = { error: 'red', warn: 'orange', info: 'blue', http: 'default', debug: 'default' };

const preStyle = {
  margin: 0,
  maxHeight: 260,
  overflow: 'auto',
  fontSize: 12,
  lineHeight: 1.45,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  background: 'var(--surface-2, rgba(127,127,127,0.08))',
  padding: 10,
  borderRadius: 6,
};

function SourceTag({ source }) {
  const meta = SOURCE_META[source] || { label: source, color: 'default', hint: '' };
  return <Tooltip title={meta.hint}><Tag color={meta.color}>{meta.label}</Tag></Tooltip>;
}

function When({ value }) {
  if (!value) return <Text type="secondary">—</Text>;
  return <Tooltip title={fmtDateTime(value)}><span>{fmtRelative(value)}</span></Tooltip>;
}

/** A ref that opens Find a ref when clicked. */
function RefLink({ value, onOpen }) {
  if (!value) return <Text type="secondary">—</Text>;
  return (
    <Button type="link" size="small" style={{ padding: 0, fontFamily: 'monospace' }} onClick={() => onOpen(value)}>
      {value}
    </Button>
  );
}

// ── Errors ────────────────────────────────────────────────────────────

function Occurrences({ fingerprint, days, env, onOpenRef }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    adminService.getErrors({ fingerprint, days, ...(env ? { env } : {}) })
      .then((res) => { if (live) setRows(res.data?.data || []); })
      .catch((err) => { if (live) setError(err?.message || 'Could not load the occurrences.'); });
    return () => { live = false; };
  }, [fingerprint, days, env]);

  if (error) return <Alert type="error" showIcon message={error} />;
  return (
    <Table
      size="small"
      rowKey="id"
      loading={rows === null}
      dataSource={rows || []}
      pagination={{ pageSize: 10, hideOnSinglePage: true }}
      columns={[
        { title: 'When', dataIndex: 'created_at', width: 170, render: (v) => fmtDateTime(v) },
        { title: 'Ref', dataIndex: 'request_id', width: 190, render: (v) => <RefLink value={v} onOpen={onOpenRef} /> },
        {
          title: 'User',
          dataIndex: 'user_name',
          width: 170,
          render: (v, r) => (r.user_id ? <span>{v || `User #${r.user_id}`}{r.user_role ? <Text type="secondary"> · {r.user_role}</Text> : null}</span> : <Text type="secondary">—</Text>),
        },
        { title: 'Env', dataIndex: 'env', width: 100 },
        { title: 'Message', dataIndex: 'message', ellipsis: true },
      ]}
      expandable={{
        expandedRowRender: (r) => (
          <Space direction="vertical" style={{ width: '100%' }}>
            {r.route ? <Text type="secondary">Route: <Text code>{r.route}</Text></Text> : null}
            {r.meta ? <Text type="secondary">Details: <Text code>{JSON.stringify(r.meta)}</Text></Text> : null}
            <pre style={preStyle}>{r.stack || r.message}</pre>
          </Space>
        ),
      }}
    />
  );
}

function ErrorsTab({ onOpenRef }) {
  const [filters, setFilters] = useState({ days: 7 });
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined && v !== ''));
      const res = await adminService.getErrors(params);
      setRows(res.data?.data || []);
    } catch (err) {
      setError(err?.message || 'Could not load the errors.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Space wrap>
        <Select
          style={{ width: 150 }}
          value={filters.source ?? ''}
          onChange={(v) => setFilters((f) => ({ ...f, source: v || undefined }))}
          options={[
            { value: '', label: 'All sources' },
            { value: 'backend', label: 'Server' },
            { value: 'job', label: 'Jobs' },
            { value: 'frontend', label: 'Browser' },
          ]}
        />
        <Select
          style={{ width: 150 }}
          value={filters.env ?? ''}
          onChange={(v) => setFilters((f) => ({ ...f, env: v || undefined }))}
          options={[
            { value: '', label: 'All environments' },
            { value: 'production', label: 'Production' },
            { value: 'staging', label: 'Staging' },
            { value: 'development', label: 'Development (local)' },
          ]}
        />
        <Select
          style={{ width: 140 }}
          value={filters.days}
          onChange={(v) => setFilters((f) => ({ ...f, days: v }))}
          options={[
            { value: 1, label: 'Last 24 hours' },
            { value: 7, label: 'Last 7 days' },
            { value: 30, label: 'Last 30 days' },
          ]}
        />
        <Input.Search
          allowClear
          placeholder="Search message or route"
          style={{ width: 260 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onSearch={(v) => setFilters((f) => ({ ...f, q: v || undefined }))}
        />
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Refresh</Button>
      </Space>

      {error && <Alert type="error" showIcon message={error} />}

      <Table
        rowKey="fingerprint"
        size="middle"
        loading={loading}
        dataSource={rows}
        pagination={{ pageSize: 25, hideOnSinglePage: true }}
        locale={{ emptyText: <Empty description="No errors in this period. Kept for 30 days." /> }}
        columns={[
          { title: 'Last seen', dataIndex: 'last_seen', width: 120, render: (v) => <When value={v} /> },
          { title: 'Source', dataIndex: 'source', width: 95, render: (v) => <SourceTag source={v} /> },
          { title: 'Error', dataIndex: 'message', ellipsis: true, render: (v) => <Tooltip title={v}><span>{v}</span></Tooltip> },
          { title: 'Where', dataIndex: 'route', width: 230, ellipsis: true, render: (v) => (v ? <Text code>{v}</Text> : '—') },
          { title: 'Times', dataIndex: 'count', width: 75, align: 'right' },
          { title: 'Users', dataIndex: 'users', width: 70, align: 'right' },
          { title: 'Env', dataIndex: 'env', width: 100 },
          { title: 'Latest ref', dataIndex: 'last_ref', width: 190, render: (v) => <RefLink value={v} onOpen={onOpenRef} /> },
        ]}
        expandable={{
          expandedRowRender: (r) => <Occurrences fingerprint={r.fingerprint} days={filters.days} env={filters.env} onOpenRef={onOpenRef} />,
        }}
      />
    </Space>
  );
}

// ── Find a ref ────────────────────────────────────────────────────────

function FindRefTab({ initialRef }) {
  const [value, setValue] = useState(initialRef || '');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const find = useCallback(async (raw) => {
    const ref = String(raw || '').trim().replace(/^\(?ref:\s*/i, '').replace(/\)$/, '');
    if (!ref) return;
    setValue(ref);
    setLoading(true);
    setError('');
    try {
      const res = await adminService.findRef(ref);
      setResult(res.data?.data || null);
    } catch (err) {
      setResult(null);
      setError(err?.message || 'Could not search for that reference.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (initialRef) find(initialRef); }, [initialRef, find]);

  const external = (result?.lines || []).filter((l) => /\[external\]/.test(l.message));

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Paragraph type="secondary" style={{ margin: 0 }}>
        Paste the reference from the error message (for example <Text code>K7Q2MX</Text>) or from an alert email.
        You get the request, the user, the error with its stack, and every outside call it made.
      </Paragraph>
      <Input.Search
        size="large"
        enterButton={<><SearchOutlined /> Find</>}
        placeholder="ref: K7Q2MX"
        value={value}
        loading={loading}
        onChange={(e) => setValue(e.target.value)}
        onSearch={find}
        style={{ maxWidth: 480 }}
      />
      {error && <Alert type="error" showIcon message={error} />}

      {result && (
        <>
          <Descriptions size="small" column={{ xs: 1, sm: 2, md: 4 }} bordered>
            <Descriptions.Item label="Ref"><Text code>{result.ref}</Text></Descriptions.Item>
            <Descriptions.Item label="Stored errors">{result.errors.length}</Descriptions.Item>
            <Descriptions.Item label="Log lines">{result.lines.length}{result.truncated ? ' (first 500)' : ''}</Descriptions.Item>
            <Descriptions.Item label="Outside calls">{external.length}</Descriptions.Item>
          </Descriptions>
          {result.timedOut && <Alert type="warning" showIcon message="The log search stopped after 5 seconds; older log files were not read." />}
          {!result.errors.length && !result.lines.length && (
            <Alert
              type="info"
              showIcon
              message="Nothing found for this reference"
              description="Check the characters (no O/0 or I/1 in refs), or the request may be older than the log files kept on this server (about 50 MB). Errors are kept 30 days."
            />
          )}

          {result.errors.map((e) => (
            <Card
              key={e.id}
              size="small"
              title={<Space><SourceTag source={e.source} /><span>{e.message}</span></Space>}
              extra={<Text type="secondary">{fmtDateTime(e.created_at)}</Text>}
            >
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text type="secondary">
                  {e.user_id ? <>User: <b>{e.user_name || `#${e.user_id}`}</b>{e.user_role ? ` (${e.user_role})` : ''} · </> : null}
                  {e.route ? <>Where: <Text code>{e.route}</Text> · </> : null}
                  Env: {e.env}
                </Text>
                {e.meta ? <Text type="secondary">Details: <Text code>{JSON.stringify(e.meta)}</Text></Text> : null}
                <pre style={preStyle}>{e.stack || e.message}</pre>
              </Space>
            </Card>
          ))}

          {result.lines.length > 0 && (
            <Table
              size="small"
              rowKey={(r, i) => `${r.file}-${r.timestamp}-${i}`}
              dataSource={result.lines}
              pagination={{ pageSize: 50, hideOnSinglePage: true }}
              columns={[
                { title: 'Time', dataIndex: 'timestamp', width: 175, render: (v) => (v ? fmtDateTime(v) : '—') },
                { title: 'Level', dataIndex: 'level', width: 80, render: (v) => (v ? <Tag color={LEVEL_COLOR[v] || 'default'}>{v}</Tag> : null) },
                {
                  title: 'Log line',
                  dataIndex: 'message',
                  render: (v) => <span style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-word' }}>{v}</span>,
                },
                { title: 'File', dataIndex: 'file', width: 120, render: (v) => <Text type="secondary">{v}</Text> },
              ]}
            />
          )}
        </>
      )}
    </Space>
  );
}

// ── Jobs ──────────────────────────────────────────────────────────────

function JobsTab({ onOpenRef }) {
  const [rows, setRows] = useState([]);
  const [currentEnv, setCurrentEnv] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminService.getJobs();
      setRows(res.data?.data || []);
      setCurrentEnv(res.data?.currentEnv || '');
    } catch (err) {
      setError(err?.message || 'Could not load the jobs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const failing = rows.filter((r) => r.failing && r.env === currentEnv).length;

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
        <Paragraph type="secondary" style={{ margin: 0 }}>
          Each scheduled job records every run. A job is <b>failing</b> when its last run failed. Developers get an alert email the first time (then at most hourly).
          This server is <Text code>{currentEnv || '…'}</Text>; a local backend running against the same database shows as <Text code>development</Text>.
        </Paragraph>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Refresh</Button>
      </Space>
      {error && <Alert type="error" showIcon message={error} />}
      {failing > 0 && <Alert type="warning" showIcon icon={<WarningOutlined />} message={`${failing} job(s) failing on ${currentEnv}`} />}
      <Table
        rowKey={(r) => `${r.env}.${r.job}`}
        size="middle"
        loading={loading}
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: <Empty description="No job has run since this release. Jobs record their first run on their next schedule." /> }}
        onRow={(r) => ({ style: r.env !== currentEnv ? { opacity: 0.6 } : undefined })}
        columns={[
          { title: 'Job', dataIndex: 'job', render: (v) => <Text strong>{v}</Text> },
          { title: 'Env', dataIndex: 'env', width: 110 },
          {
            title: 'Status',
            width: 110,
            render: (_, r) => (r.failing
              ? <Tag color="red">Failing</Tag>
              : r.lastOkAt ? <Tag color="green">OK</Tag> : <Tag>No runs</Tag>),
          },
          { title: 'Last run', dataIndex: 'lastRunAt', width: 120, render: (v) => <When value={v} /> },
          { title: 'Last success', dataIndex: 'lastOkAt', width: 120, render: (v) => <When value={v} /> },
          { title: 'Last failure', dataIndex: 'lastFailAt', width: 120, render: (v) => <When value={v} /> },
          {
            title: 'Last error',
            dataIndex: 'lastError',
            ellipsis: true,
            render: (v, r) => (v ? (
              <Space size={4}>
                <Tooltip title={v}><span>{v}</span></Tooltip>
                <RefLink value={r.lastFailRef} onOpen={onOpenRef} />
              </Space>
            ) : <Text type="secondary">—</Text>),
          },
          { title: 'Took', dataIndex: 'lastDurationMs', width: 90, align: 'right', render: (v) => (v == null ? '—' : v < 1000 ? `${v} ms` : `${(v / 1000).toFixed(1)} s`) },
        ]}
      />
    </Space>
  );
}

// ── Health ────────────────────────────────────────────────────────────

function HealthTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminService.getDeepHealth();
      setData(res.data?.data || null);
    } catch (err) {
      // 503 = at least one check failed; the body still has every result.
      if (err?.data?.data?.checks) setData(err.data.data);
      else { setData(null); setError(err?.message || 'Could not run the health checks.'); }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { run(); }, [run]);

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
        <Paragraph type="secondary" style={{ margin: 0 }}>
          Live checks from this server, run now. Each part is checked on its own, with a 5-second limit.
        </Paragraph>
        <Button icon={<ReloadOutlined />} onClick={run} loading={loading}>Run checks</Button>
      </Space>
      {error && <Alert type="error" showIcon message={error} />}
      {data && (
        <>
          <Alert
            type={data.ok ? 'success' : 'error'}
            showIcon
            message={data.ok ? 'Everything is up' : 'Something is down — see below'}
            description={`${data.env} · up ${Math.round((data.uptimeSeconds || 0) / 60)} min · checked ${fmtDateTime(data.checkedAt)}`}
          />
          <Table
            rowKey="name"
            size="middle"
            pagination={false}
            dataSource={data.checks}
            columns={[
              {
                title: 'Part',
                dataIndex: 'name',
                render: (v, r) => (
                  <Space>
                    {r.ok ? <CheckCircleFilled style={{ color: 'var(--success, #52c41a)' }} /> : <CloseCircleFilled style={{ color: 'var(--danger, #ff4d4f)' }} />}
                    <Text strong style={{ textTransform: 'capitalize' }}>{v}</Text>
                  </Space>
                ),
              },
              { title: 'Result', render: (_, r) => (r.ok ? r.detail : <Text type="danger">{r.error}</Text>) },
              { title: 'Took', dataIndex: 'ms', width: 90, align: 'right', render: (v) => `${v} ms` },
            ]}
          />
        </>
      )}
    </Space>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────

export default function SystemLogsPanel() {
  const [tab, setTab] = useState('errors');
  const [refToOpen, setRefToOpen] = useState('');

  const openRef = useCallback((ref) => {
    setRefToOpen(ref);
    setTab('ref');
  }, []);

  return (
    <Card className="glass-card" style={{ borderRadius: 14 }}>
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: 'errors', label: 'Errors', children: <ErrorsTab onOpenRef={openRef} /> },
          { key: 'ref', label: 'Find a ref', children: <FindRefTab key={refToOpen} initialRef={refToOpen} /> },
          { key: 'jobs', label: 'Jobs', children: <JobsTab onOpenRef={openRef} /> },
          { key: 'health', label: 'Health', children: <HealthTab /> },
        ]}
      />
    </Card>
  );
}
