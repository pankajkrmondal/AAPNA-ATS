/**
 * Forms & Links (L08): find, copy or re-send any link the ATS has sent.
 *
 * "If Recruiter wants to access some links, right now, they are not accessible
 * easily… I have sent a link to interviewer post interview, I can't find the
 * link from the app easily." Built to the approved design (23 Oct, D1–D10):
 * docs/Phase 3 Enhancements or Feedback/Forms & Links — design for approval.html.
 *
 *   - four tiles that filter the list (waiting, expiring within 48 h, expired
 *     before a response, email not delivered);
 *   - tabs by recipient, type chips, status, "Sent", "My candidates";
 *   - the list never holds a URL: Copy fetches one and the copy is recorded;
 *   - anything that sends an email asks first;
 *   - MRF approval links are never copied, only re-issued (D3);
 *   - an expired scorecard can be renewed for 7 days (D5);
 *   - complete-profile forms (one per upload) stay hidden until searched (D6).
 *
 * Deep links from the shortcuts: ?q= (Ctrl+K), ?candidate=<pipeline or cv id>
 * (the drawer), ?mrf=<id> (MRF details).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Alert, App as AntApp, Button, Card, Col, Dropdown, Empty, Input, Row, Segmented, Select, Space, Switch, Table, Tag,
  Tooltip, Typography,
} from 'antd';
import {
  ClockCircleOutlined, CloseCircleOutlined, CopyOutlined, DisconnectOutlined, ExportOutlined, LinkOutlined,
  MailOutlined, ReloadOutlined, SearchOutlined, SendOutlined, StopOutlined, SyncOutlined, WarningOutlined,
} from '@ant-design/icons';
import KpiCard from '../components/common/KpiCard';
import formsLinksService from '../services/formsLinksService';
import { fmtDate, fmtDateTime } from '../utils/dateFormat';
import { copyText } from '../utils/clipboard';

const { Title, Text } = Typography;

const TYPE_OPTIONS = [
  { key: 'scorecard', label: 'Scorecard' },
  { key: 'meeting', label: 'Teams meeting' },
  { key: 'recording', label: 'Recording share' },
  { key: 'documents', label: 'Document upload' },
  { key: 'zeko', label: 'Zeko interview' },
  { key: 'evalground', label: 'Evalground test' },
  { key: 'mrf_form', label: 'MRF request form' },
  { key: 'mrf_approval', label: 'MRF approval' },
];

const STATUS_COLORS = {
  Waiting: 'gold', Opened: 'blue', Upcoming: 'blue', Live: 'green', 'Not delivered': 'red', Expired: 'orange',
  'Window closed': 'orange', 'Deadline passed': 'orange', Submitted: 'green', Completed: 'green', Decided: 'green',
  'Result in': 'green', Held: 'default', Closed: 'default', Revoked: 'default',
};

const relative = (d) => {
  if (!d) return '';
  const days = Math.round((new Date(d).getTime() - Date.now()) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
};

export default function FormsLinks() {
  const { message, modal } = AntApp.useApp();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState('all');
  const [types, setTypes] = useState([]);
  const [states, setStates] = useState('open,expired');
  const [tile, setTile] = useState(null);
  const [sentDays, setSentDays] = useState(null);
  const [mine, setMine] = useState(false);
  const [includeProfiles, setIncludeProfiles] = useState(false);
  const [searchInput, setSearchInput] = useState(params.get('q') || '');
  const [search, setSearch] = useState(params.get('q') || '');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [standing, setStanding] = useState(null);
  const candidate = params.get('candidate');
  const mrf = params.get('mrf');
  const mrfRequest = params.get('mrfRequest');

  const load = useCallback(async () => {
    if (tab === 'standing') return;
    setLoading(true);
    setError(null);
    try {
      const res = await formsLinksService.list({
        tab, types: types.join(','), states, tile: tile || undefined, sentDays: sentDays || undefined,
        mine: mine || undefined, search: search || undefined, candidate: candidate || undefined, mrf: mrf || undefined, mrfRequest: mrfRequest || undefined,
        includeProfiles: includeProfiles || undefined, page, pageSize: 10,
      });
      setData(res.data?.data || res.data);
    } catch (err) {
      setError(err?.response?.data?.message || 'The links could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [tab, types, states, tile, sentDays, mine, search, candidate, mrf, mrfRequest, includeProfiles, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (tab !== 'standing' || standing) return;
    formsLinksService.standing().then((r) => setStanding(r.data?.data || r.data)).catch(() => setStanding({ forms: [], mrfs: [] }));
  }, [tab, standing]);

  const resetPage = (fn) => (...args) => { setPage(1); fn(...args); };

  // ── row actions ───────────────────────────────────────────────────────
  /** Standing links are public already, so they are copied straight from the list. */
  const copyPlain = async (url, done) => {
    if (await copyText(url)) message.success(done);
    else message.error('Could not copy to the clipboard.');
  };

  const doCopy = async (row, withMessage) => {
    setBusyKey(row.key);
    try {
      const res = await formsLinksService.copy(row.type, row.id);
      const { url, message: text } = res.data?.data || {};
      const ok = await copyText(withMessage ? text : url);
      if (ok) message.success(withMessage ? 'Message copied. Paste it into WhatsApp or Teams.' : 'Link copied.');
      else message.error('Could not copy to the clipboard.');
    } catch (err) {
      message.error(err?.response?.data?.message || 'Could not copy the link.');
    } finally {
      setBusyKey(null);
    }
  };

  const doOpen = async (row) => {
    setBusyKey(row.key);
    try {
      const res = await formsLinksService.copy(row.type, row.id, { purpose: 'open' });
      const url = res.data?.data?.url;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      message.error(err?.response?.data?.message || 'Could not open the link.');
    } finally {
      setBusyKey(null);
    }
  };

  const confirmThen = (title, content, okText, run, row) => {
    modal.confirm({
      title, content, okText,
      onOk: async () => {
        setBusyKey(row.key);
        try {
          await run();
          await load();
        } catch (err) {
          message.error(err?.response?.data?.message || 'That did not work. Please try again.');
        } finally {
          setBusyKey(null);
        }
      },
    });
  };

  const doResend = (row) => confirmThen(
    'Re-send the email?',
    row.type === 'documents'
      ? `${row.recipientName || 'The candidate'} gets a reminder with the same upload link.`
      : `${row.recipientEmail} gets the same link again by email.`,
    'Re-send',
    async () => { await formsLinksService.resend(row.type, row.id); message.success('Sent again.'); },
    row,
  );
  const doRenew = (row) => confirmThen(
    'Renew for 7 days and re-send?',
    `The same link starts working again for 7 days, and ${row.recipientEmail} gets the email again.`,
    'Renew & re-send',
    async () => { await formsLinksService.renew(row.type, row.id); message.success('Renewed and sent again.'); },
    row,
  );
  const doRevoke = (row) => confirmThen(
    'Revoke this recording link?',
    'It stops working at once for everyone who has it.',
    'Revoke',
    async () => { await formsLinksService.revoke(row.type, row.id); message.success('Link revoked.'); },
    row,
  );
  const doReissue = (row) => confirmThen(
    'Re-send approval links?',
    'Every approver gets a new personal link by email, and the old links stop working. These links are never copied: whoever opens one decides in the approver’s name.',
    'Re-send approval links',
    async () => { await formsLinksService.resend(row.type, row.id); message.success('New approval links sent.'); },
    row,
  );

  const actionsFor = (row) => {
    const a = new Set(row.actions || []);
    const busy = busyKey === row.key;
    return (
      <Space size={6} wrap>
        {a.has('copy') && (
          <Dropdown.Button
            size="small"
            loading={busy}
            onClick={() => doCopy(row, false)}
            menu={{ items: [{ key: 'msg', label: 'Copy with message', icon: <MailOutlined /> }], onClick: () => doCopy(row, true) }}
          >
            <CopyOutlined /> {row.type === 'meeting' ? 'Copy join link' : 'Copy link'}
          </Dropdown.Button>
        )}
        {a.has('join') && <Button size="small" icon={<ExportOutlined />} onClick={() => doOpen(row)}>Join</Button>}
        {a.has('open') && <Button size="small" icon={<ExportOutlined />} onClick={() => doOpen(row)}>Open</Button>}
        {a.has('resend') && <Button size="small" icon={<SendOutlined />} loading={busy && !a.has('copy')} onClick={() => doResend(row)}>Re-send</Button>}
        {a.has('renew') && <Button size="small" type="primary" icon={<SyncOutlined />} loading={busy} onClick={() => doRenew(row)}>Renew &amp; re-send</Button>}
        {a.has('revoke') && <Button size="small" danger icon={<StopOutlined />} onClick={() => doRevoke(row)}>Revoke</Button>}
        {a.has('reissue') && <Button size="small" icon={<SendOutlined />} loading={busy} onClick={() => doReissue(row)}>Re-send approval links</Button>}
      </Space>
    );
  };

  const candidateLink = (c) => {
    if (!c?.name) return <Text type="secondary">—</Text>;
    if (c.pipelineId) return <Link to={`/pipeline?candidate=${c.pipelineId}`}>{c.name}</Link>;
    if (c.cvId) return <Link to={`/candidates/${c.cvId}`}>{c.name}</Link>;
    return c.name;
  };

  const columns = [
    {
      title: 'Link', key: 'link', width: 185,
      render: (_, r) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.title}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>{r.sub}</Text>
        </div>
      ),
    },
    {
      title: 'Sent to', key: 'to', width: 175,
      render: (_, r) => (
        <div>
          <div>{r.recipientName || '—'}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>{r.recipientEmail}</Text>
        </div>
      ),
    },
    {
      title: 'Candidate · role', key: 'cand', width: 175,
      render: (_, r) => (
        <div>
          <div>{candidateLink(r.candidate)}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>{[r.role, r.mrfRef].filter(Boolean).join(' · ')}</Text>
        </div>
      ),
    },
    {
      title: 'Sent', key: 'sent', width: 125,
      render: (_, r) => (
        <div>
          <div>{r.sentAt ? fmtDateTime(r.sentAt) : '—'}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>{r.sentBy || ''}</Text>
        </div>
      ),
    },
    {
      title: 'Status', key: 'status', width: 130,
      render: (_, r) => (
        <div>
          <Tag color={STATUS_COLORS[r.status] || (r.status?.startsWith('Opened') ? 'blue' : r.status?.startsWith('Not opened') ? 'gold' : 'default')}>{r.status}</Tag>
          <div><Text type="secondary" style={{ fontSize: 12 }}>{r.detail}</Text></div>
        </div>
      ),
    },
    {
      title: 'Expires', key: 'exp', width: 96,
      render: (_, r) => (r.expiresAt ? (
        <div>
          <div>{fmtDate(r.expiresAt)}</div>
          <Text style={{ fontSize: 12, color: r.flags?.expiring48h ? 'var(--warning, #ad4e00)' : r.state === 'expired' ? 'var(--danger, #cf1322)' : 'var(--text-3)' }}>{relative(r.expiresAt)}</Text>
        </div>
      ) : <Text type="secondary" style={{ fontSize: 12 }}>No expiry</Text>),
    },
    // Pinned right with a fixed width, so the buttons are never clipped.
    { title: 'Actions', key: 'actions', width: 200, fixed: 'right', render: (_, r) => actionsFor(r) },
  ];

  const tiles = data?.tiles || {};
  const tabCounts = data?.tabCounts || {};
  const typeCounts = data?.typeCounts || {};
  const tabOptions = [
    { label: `All ${tabCounts.all ?? ''}`, value: 'all' },
    { label: `Interviewers ${tabCounts.interviewers ?? ''}`, value: 'interviewers' },
    { label: `Candidates ${tabCounts.candidates ?? ''}`, value: 'candidates' },
    { label: `Hiring managers & approvers ${tabCounts.hm_approvers ?? ''}`, value: 'hm_approvers' },
    { label: 'Standing forms', value: 'standing' },
  ];

  const tileCards = [
    { key: 'waiting', label: 'Waiting for a response', value: tiles.waiting, icon: <ClockCircleOutlined />, k: 'b' },
    { key: 'expiring48h', label: 'Expiring within 48 h', value: tiles.expiring48h, icon: <WarningOutlined />, k: 'e' },
    { key: 'expiredNoResponse', label: 'Expired before a response', value: tiles.expiredNoResponse, icon: <CloseCircleOutlined />, k: 'd' },
    { key: 'notDelivered', label: 'Email not delivered', value: tiles.notDelivered, icon: <DisconnectOutlined />, k: 'd' },
  ];

  const filtersActive = Boolean(types.length || tile || sentDays || mine || search || candidate || mrf || states !== 'open,expired');
  const clearAll = () => {
    setTypes([]); setTile(null); setSentDays(null); setMine(false); setSearch(''); setSearchInput(''); setStates('open,expired'); setPage(1);
    setParams({});
  };

  const standingTab = useMemo(() => (
    <div>
      <Title level={5} style={{ marginTop: 4 }}>Forms anyone can use</Title>
      <Row gutter={[12, 12]}>
        {(standing?.forms || []).map((f) => (
          <Col xs={24} md={8} key={f.key}>
            <Card size="small" className="glass-card">
              <div style={{ fontWeight: 600 }}>{f.title}</div>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', margin: '4px 0 8px' }}>{f.body}</Text>
              <Text code style={{ fontSize: 11 }}>{f.url}</Text>
              <Space style={{ marginTop: 8, display: 'flex' }}>
                <Button size="small" icon={<CopyOutlined />} onClick={() => copyPlain(f.url, 'Link copied.')}>Copy link</Button>
                <Button size="small" icon={<ExportOutlined />} href={f.url} target="_blank" rel="noopener noreferrer">Open</Button>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>
      <Title level={5} style={{ marginTop: 20 }}>Job descriptions and test papers <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>open MRFs only</Text></Title>
      <Table
        size="small"
        rowKey="mrfId"
        dataSource={standing?.mrfs || []}
        pagination={{ pageSize: 10, showSizeChanger: false }}
        columns={[
          { title: 'Role', dataIndex: 'role' },
          { title: 'MRF', dataIndex: 'mrfRef', width: 110 },
          { title: 'Raised', key: 'date', width: 120, render: (_, m) => (m.date ? fmtDate(m.date) : '—') },
          {
            title: 'Job description', key: 'jd', render: (_, m) => (m.jdUrl ? (
              <Space size={6}>
                <Button size="small" icon={<CopyOutlined />} onClick={() => copyPlain(m.jdUrl, 'JD link copied.')}>Copy JD link</Button>
                <Button size="small" href={m.jdUrl} target="_blank" rel="noopener noreferrer">Open</Button>
              </Space>
            ) : <Text type="secondary" style={{ fontSize: 12 }}>No JD on this MRF</Text>),
          },
          {
            title: 'Test paper', key: 'test', render: (_, m) => (m.testUrl ? (
              <Space size={6}>
                <Button size="small" icon={<CopyOutlined />} onClick={() => copyPlain(m.testUrl, 'Test link copied.')}>Copy test link</Button>
                <Button size="small" href={m.testUrl} target="_blank" rel="noopener noreferrer">Open</Button>
              </Space>
            ) : <Text type="secondary" style={{ fontSize: 12 }}>No test paper on this MRF</Text>),
          },
        ]}
      />
      <Text type="secondary" style={{ fontSize: 12 }}>
        Personal links (scorecards, approvals, document uploads, profile forms) never appear on this tab. They live in the other tabs, with their status and expiry.
      </Text>
    </div>
  ), [standing]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page-enter" style={{ maxWidth: 1240, margin: '0 auto', padding: '0 0 40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <Title level={3} style={{ margin: 0, fontFamily: 'var(--font-heading)' }}><LinkOutlined /> Forms &amp; Links</Title>
          <Text type="secondary">Find, copy or re-send any link the ATS has sent: scorecards, meetings, document uploads, MRF forms and more.</Text>
        </div>
        <div style={{ display: 'flex', gap: 8, flex: '0 1 480px', minWidth: 0, maxWidth: '100%' }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Search by candidate, interviewer, approver, email, role or MRF"
            style={{ flex: 1, minWidth: 0 }}
            value={searchInput}
            onChange={(e) => { setSearchInput(e.target.value); if (!e.target.value) { setSearch(''); setPage(1); } }}
            onPressEnter={() => { setSearch(searchInput.trim()); setPage(1); }}
          />
          <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
        </div>
      </div>

      {data && data.seePipeline === false && (
        <Alert
          type="info" showIcon style={{ marginBottom: 12 }}
          message="You see MRF and standing links only. Scorecards, meetings, documents, tests and recordings appear for people who can open the Candidate Pipeline. Ask an admin if you need them."
        />
      )}
      {(candidate || mrf) && (
        <Alert
          type="info" showIcon style={{ marginBottom: 12 }}
          message={candidate ? 'Showing the links for one candidate.' : 'Showing the links for one MRF.'}
          action={<Button size="small" onClick={() => setParams({})}>Show all links</Button>}
        />
      )}

      {tab !== 'standing' && (
        <>
          <Row gutter={[12, 12]} style={{ marginBottom: 6 }}>
            {tileCards.map((t, i) => (
              <Col xs={12} md={6} key={t.key}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => { setPage(1); setTile(tile === t.key ? null : t.key); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); setTile(tile === t.key ? null : t.key); } }}
                  style={{ cursor: 'pointer', outline: tile === t.key ? '2px solid var(--brand-primary)' : 'none', borderRadius: 14 }}
                >
                  <KpiCard
                    index={i} icon={t.icon} label={t.label} value={t.value ?? 0}
                    color={`var(--kpi-${t.k})`} tint={`var(--kpi-${t.k}-tint)`} accent={`linear-gradient(90deg,var(--kpi-${t.k}),var(--kpi-${t.k}-2))`}
                  />
                </div>
              </Col>
            ))}
          </Row>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>Each tile filters the list below.</Text>
        </>
      )}

      <Card bordered={false} className="glass-card">
        {/* Segmented controls do not wrap; on a phone they scroll inside their row. */}
        <div style={{ overflowX: 'auto', maxWidth: '100%', marginBottom: 14 }}>
          <Segmented options={tabOptions} value={tab} onChange={resetPage(setTab)} />
        </div>

        {tab === 'standing' ? standingTab : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
              <Text type="secondary" style={{ fontSize: 12, marginRight: 4 }}>Type</Text>
              {TYPE_OPTIONS.map((t) => (
                <Tag.CheckableTag
                  key={t.key}
                  checked={types.includes(t.key)}
                  onChange={(on) => { setPage(1); setTypes(on ? [...types, t.key] : types.filter((x) => x !== t.key)); }}
                >
                  {t.label} {typeCounts[t.key] ?? 0}
                </Tag.CheckableTag>
              ))}
              <Tooltip title="The ATS sends one automatically to every upload with missing details, so they are hidden while browsing. Search for a candidate to find theirs.">
                <Tag.CheckableTag checked={includeProfiles} onChange={(on) => { setPage(1); setIncludeProfiles(on); }}>
                  Complete-profile form {includeProfiles || search ? (typeCounts.profile ?? 0) : '(hidden)'}
                </Tag.CheckableTag>
              </Tooltip>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 12 }}>
              <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
              <Segmented
                size="small"
                value={tile ? 'tile' : states}
                onChange={(v) => { setTile(null); setPage(1); setStates(v); }}
                options={[
                  { label: 'Open & expired', value: 'open,expired' },
                  { label: 'Open', value: 'open' },
                  { label: 'Expired', value: 'expired' },
                  { label: 'Done', value: 'done' },
                  { label: 'Closed', value: 'closed' },
                  { label: 'All', value: 'all' },
                  ...(tile ? [{ label: 'Tile filter', value: 'tile', disabled: true }] : []),
                ]}
              />
              </div>
              <Select
                size="small" style={{ width: 150 }} value={sentDays || 'any'}
                onChange={(v) => { setPage(1); setSentDays(v === 'any' ? null : v); }}
                options={[
                  { label: 'Sent: any time', value: 'any' }, { label: 'Last 7 days', value: 7 },
                  { label: 'Last 30 days', value: 30 }, { label: 'Last 90 days', value: 90 },
                ]}
              />
              <span style={{ fontSize: 13 }}>
                <Switch size="small" checked={mine} onChange={(v) => { setPage(1); setMine(v); }} style={{ marginRight: 6 }} />
                My candidates
              </span>
              {filtersActive && <Button size="small" type="link" onClick={clearAll}>Clear filters</Button>}
            </div>

            {error ? (
              <Alert
                type="error" showIcon message="The links could not be loaded"
                description="Nothing was changed. Try again; if it keeps failing, tell the team."
                action={<Button size="small" onClick={load}>Try again</Button>}
              />
            ) : (
              <Table
                rowKey="key"
                size="small"
                loading={loading}
                columns={columns}
                dataSource={data?.rows || []}
                scroll={{ x: 1086 }}
                locale={{
                  emptyText: (
                    <Empty
                      description={search
                        ? `No links match "${search}". Search covers every link type and every date, including complete-profile forms.`
                        : states === 'open,expired' && !tile ? 'No links are waiting for a response.' : 'No links match these filters.'}
                    >
                      {search
                        ? <Button size="small" onClick={() => { setSearch(''); setSearchInput(''); }}>Clear search</Button>
                        : <Button size="small" onClick={() => { setTile(null); setStates('all'); }}>Show all links</Button>}
                    </Empty>
                  ),
                }}
                pagination={{
                  current: page, pageSize: 10, total: data?.total || 0, showSizeChanger: false,
                  onChange: setPage,
                  showTotal: (t) => `${t} link${t === 1 ? '' : 's'}${states === 'open,expired' && !tile ? ' that may need action' : ''} · newest first`,
                }}
              />
            )}
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
              The list never holds the links themselves. A link is fetched when you click Copy, and each copy is noted on the candidate&apos;s timeline.
            </Text>
          </>
        )}
      </Card>
    </div>
  );
}
