/**
 * RoleDetailDrawer — one open position over the chosen range (L06, approved
 * design 22 Oct 2026; restyled 23 Oct to the app's own design: the drawer
 * header follows PipelineDrawer, panels are `.panel-shell` cards with the
 * Analytics SectionTitle, KPIs are the shared KpiCard, the funnel matches
 * Pipeline Insights, the chart is Recharts with the Dashboard tooltip).
 *
 * Contents: the "This week" sentence with Copy (W3), KPIs against the
 * previous period, Needs attention (W4), applications per day by source, the
 * funnel since opened, upcoming interviews, what happened, and the
 * open-to-close journey. Every number opens its candidates (W1).
 *
 * Data: GET /api/pipeline/analytics/positions/:mrfId?from&to
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Col, Drawer, Empty, List, Row, Segmented, Skeleton, Space, Steps, Table, Tag, Typography, message,
} from 'antd';
import {
  CopyOutlined, ProfileOutlined, TeamOutlined, MailOutlined, CheckCircleOutlined, CloseCircleOutlined,
  RiseOutlined, SolutionOutlined, FileDoneOutlined, ApartmentOutlined,
} from '@ant-design/icons';
import {
  Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis,
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import pipelineService from '../../services/pipeline';
import ExportButton from '../common/ExportButton';
import KpiCard from '../common/KpiCard';
import { fmtDate, fmtDateTime } from '../../utils/dateFormat';
import {
  ACCENT, Delta, HealthDot, NowBadge, SectionTitle, SOURCE_COLOR, SOURCE_KEYS, SOURCE_LABEL_FALLBACK,
  candidateLink, rangeParams,
} from './openPositionsShared';

const { Text } = Typography;

const prefersReducedMotion = () => typeof window !== 'undefined'
  && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const KPI_META = {
  applied: { label: 'Applied', metric: 'opApplied', icon: <TeamOutlined />, accent: ACCENT.neutral },
  responded: { label: 'Responded', metric: 'opResponded', icon: <MailOutlined />, accent: ACCENT.progress },
  shortlisted: { label: 'Shortlisted', metric: 'opShortlisted', icon: <CheckCircleOutlined />, accent: ACCENT.positive },
  rejected: { label: 'Rejected', metric: 'opRejected', icon: <CloseCircleOutlined />, accent: ACCENT.negative, goodWhenUp: false },
  moved_forward: { label: 'Moved forward', metric: 'opMovedForward', icon: <RiseOutlined />, accent: ACCENT.success },
  interviews: { label: 'Interviews', metric: 'opInterviews', icon: <SolutionOutlined />, accent: ACCENT.waiting },
  offers: { label: 'Offers', metric: 'opOffers', icon: <FileDoneOutlined />, accent: ACCENT.positive },
};

/** A number that opens its candidates (W1). */
function MetricLink({ value, onClick, strong = true }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text)', font: 'inherit',
        fontWeight: strong ? 700 : 500, textDecoration: 'underline dotted', textUnderlineOffset: 3,
      }}
    >
      {value ?? 0}
    </button>
  );
}

/** Recharts tooltip in the Dashboard's style (.dash-chart-tip). */
function SourceTip({ active, payload, sourceLabels }) {
  if (!active || !payload?.length) return null;
  const s = payload[0].payload;
  return (
    <div className="dash-chart-tip">
      <div className="dash-chart-tip__label">{s.weekly ? `${fmtDate(s.from)} – ${fmtDate(s.to)}` : fmtDate(s.from)}</div>
      <div className="dash-chart-tip__value">{s.applied} applied</div>
      {SOURCE_KEYS.map((k) => (
        <div key={k} className="dash-chart-tip__note" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: SOURCE_COLOR[k] }} />
          {sourceLabels(k)}: {s.sources[k] || 0}
        </div>
      ))}
      <div className="dash-chart-tip__note">Shortlisted: {s.shortlisted}</div>
    </div>
  );
}

/** Applications per day (or week, past two months), stacked by source. */
function SourceChart({ series, sourceLabels: labels }) {
  const [view, setView] = useState('chart');
  const label = (k) => labels?.[k] || SOURCE_LABEL_FALLBACK[k];
  const weekly = series.some((s) => s.weekly);
  const totals = Object.fromEntries(SOURCE_KEYS.map((k) => [k, series.reduce((n, s) => n + (s.sources[k] || 0), 0)]));
  const data = useMemo(() => series.map((s) => ({
    ...s,
    ...Object.fromEntries(SOURCE_KEYS.map((k) => [k, s.sources[k] || 0])),
    tick: weekly ? fmtDate(s.from).slice(0, 6) : fmtDate(s.from).slice(0, 6),
  })), [series, weekly]);
  const peak = Math.max(1, ...series.map((s) => s.applied));

  return (
    <Card
      className="panel-shell"
      title={<SectionTitle accent={ACCENT.progress} hint="hover a bar for its split">{`Applications per ${weekly ? 'week' : 'day'}, by source`}</SectionTitle>}
      extra={<Segmented size="small" value={view} onChange={setView} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />}
    >
      <Space size={16} wrap style={{ marginBottom: 8 }}>
        {SOURCE_KEYS.map((k) => (
          <Space key={k} size={6}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: SOURCE_COLOR[k], display: 'inline-block' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>{label(k)} <Text strong style={{ fontSize: 12 }}>{totals[k]}</Text></Text>
          </Space>
        ))}
      </Space>
      {view === 'table' ? (
        <Table
          size="small"
          pagination={false}
          rowKey="key"
          dataSource={series}
          scroll={{ y: 260 }}
          columns={[
            { title: weekly ? 'Week of' : 'Day', dataIndex: 'from', render: (v) => fmtDate(v) },
            ...SOURCE_KEYS.map((k) => ({ title: label(k), key: k, align: 'right', render: (_, s) => s.sources[k] || 0 })),
            { title: 'Total', dataIndex: 'applied', align: 'right' },
            { title: 'Shortlisted', dataIndex: 'shortlisted', align: 'right' },
          ]}
        />
      ) : (
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: -18 }} barCategoryGap="22%">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
              <XAxis
                dataKey="tick"
                tick={{ fontSize: 11, fill: 'var(--text-2)' }}
                interval={Math.max(0, Math.floor(data.length / 8) - 1)}
                tickLine={false}
                axisLine={{ stroke: 'var(--border-light)' }}
              />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-2)' }} tickLine={false} axisLine={false} allowDecimals={false} domain={[0, peak + 1]} width={42} />
              <RTooltip content={<SourceTip sourceLabels={label} />} cursor={{ fill: 'var(--gold-subtle)' }} />
              {SOURCE_KEYS.map((k, i) => (
                <Bar
                  key={k}
                  dataKey={k}
                  stackId="applied"
                  fill={SOURCE_COLOR[k]}
                  stroke="var(--ink-2)"
                  strokeWidth={1}
                  radius={i === SOURCE_KEYS.length - 1 ? [4, 4, 0, 0] : 0}
                  isAnimationActive={!prefersReducedMotion()}
                  maxBarSize={44}
                >
                  {i === SOURCE_KEYS.length - 1 && (
                    <LabelList dataKey="applied" position="top" style={{ fontSize: 11, fontWeight: 600, fill: 'var(--text)' }} formatter={(v) => (v ? v : '')} />
                  )}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

/**
 * @param {{ open: boolean, mrfId: number|null, range: object, onClose: () => void,
 *   onOpenMetric: (mrfId: number, metric: string) => void }} props  range: the page's range state
 */
export default function RoleDetailDrawer({ open, mrfId, range, onClose, onOpenMetric }) {
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: false, error: false, data: null });
  const params = rangeParams(range);
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    if (!open || !mrfId) return undefined;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: false }));
    pipelineService.getPositionDetail(mrfId, params)
      .then((res) => { if (alive) setState({ loading: false, error: false, data: res.data?.data || res.data }); })
      .catch(() => { if (alive) setState({ loading: false, error: true, data: null }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mrfId, paramsKey]);

  const d = state.data;
  const p = d?.position;
  const metric = (m) => () => onOpenMetric?.(mrfId, m);
  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(`${p.role} (${p.ref}) · ${d.range.label}\n${d.summary_text}`);
      message.success('Copied. Paste it into the hiring-manager update.');
    } catch {
      message.error('Could not copy. Select the text and copy it instead.');
    }
  };

  const attentionItems = () => {
    const a = d.attention;
    const items = [];
    if (a.stuck.length) items.push({ key: 'stuck', title: `${a.stuck.length} stuck for 10 days or more`, desc: a.stuck.slice(0, 3).map((s) => `${s.candidate_name} (${s.stage}, ${s.days} d)`).join(', ') + (a.stuck.length > 3 ? '…' : ''), metric: 'stuck' });
    if (a.feedback.length) items.push({ key: 'fb', title: `${a.feedback.length} feedback overdue`, desc: a.feedback.slice(0, 3).map((f) => `${f.candidate_name} (${f.stage}${f.interviewer ? `, ${f.interviewer}` : ''})`).join(', '), metric: 'awaiting_feedback' });
    if (a.offers.length) items.push({ key: 'offer', title: `${a.offers.length} offer${a.offers.length === 1 ? '' : 's'} awaiting approval`, desc: `requested ${a.offers.map((o) => fmtDate(o.requested_at)).join(', ')}`, metric: 'offers_awaiting_approval' });
    if (a.responded_not_reviewed) items.push({ key: 'nr', title: `${a.responded_not_reviewed} responded, not yet reviewed`, desc: 'in JD screening', link: '/filtering' });
    for (const i of a.interviews_today) items.push({ key: `t${i.at}${i.candidate_name}`, title: 'Interview today', desc: `${fmtDateTime(i.at)} · ${i.stage} · ${i.candidate_name}`, link: i.pipeline_id ? `/pipeline?candidate=${i.pipeline_id}` : null });
    return items;
  };

  const funnel = d?.funnel ? d.funnel.filter((f, i) => f.count > 0 || i < 2) : [];
  const maxFunnel = Math.max(1, ...funnel.map((f) => f.count));
  const reached = d?.milestones ? d.milestones.reduce((last, m, i) => (m.at ? i : last), -1) : -1;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={1040}
      destroyOnHidden
      data-testid="role-detail-drawer"
      title={p && (
        <Space direction="vertical" size={2}>
          <Space wrap>
            <ProfileOutlined />
            <Text strong style={{ fontSize: 16 }}>{p.role}</Text>
            <Tag style={{ marginInlineEnd: 0 }}>{p.ref}</Tag>
            <HealthDot health={p.health} chip />
          </Space>
          <Text type="secondary" style={{ fontSize: 12.5, fontWeight: 400 }}>
            Opened {p.opened_at ? fmtDate(p.opened_at) : '–'} · {p.days_open ?? '–'} days open · {p.filled} of {p.openings ?? '?'} filled
            {' · '}{d.range.label}{d.previous?.from ? ` vs ${d.previous.label}` : ''}
          </Text>
        </Space>
      )}
      extra={p && (
        <Space wrap>
          <Button icon={<ApartmentOutlined />} onClick={() => navigate(`/pipeline?mrf=${mrfId}`)}>Open in Pipeline</Button>
          <ExportButton
            tooltip="The role report as a spreadsheet: this period's numbers, the daily table, what happened and the journey."
            request={(cfg) => pipelineService.exportPositionReport(mrfId, params, cfg)}
            fallbackName={`AAPNA-ATS_Role-Report_${p.ref}.csv`}
            label="Role report"
          />
        </Space>
      )}
    >
      {state.error && <Alert type="error" showIcon message="This position could not be loaded. Try again." />}
      {!d && state.loading && <Skeleton active paragraph={{ rows: 12 }} />}
      {d && (
        <Space direction="vertical" size={16} style={{ width: '100%', opacity: state.loading ? 0.6 : 1 }}>
          <div
            style={{
              background: 'var(--gold-bg)', border: '1px solid var(--color-primary-border)', borderRadius: 14,
              padding: '14px 18px', display: 'flex', gap: 14, alignItems: 'flex-start',
            }}
          >
            <div style={{ flex: 1 }}>
              <Text strong style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gold-dark)' }}>
                {d.range.days === 7 ? 'This week' : d.range.label}
              </Text>
              <div style={{ fontSize: 14, lineHeight: 1.6, marginTop: 4, color: 'var(--text)' }} data-testid="role-summary-text">{d.summary_text}</div>
            </div>
            <Button icon={<CopyOutlined />} onClick={copySummary}>Copy for HM update</Button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
            {d.kpis.map((k, i) => {
              const m = KPI_META[k.key];
              return (
                <div key={k.key}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={metric(k.key)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') metric(k.key)(); }}
                    style={{ cursor: 'pointer' }}
                    title={`Open the ${m.label.toLowerCase()} candidates`}
                  >
                    <KpiCard index={i} icon={m.icon} label={m.label} value={k.value ?? 0} metric={m.metric} {...m.accent} />
                  </div>
                  <div style={{ padding: '6px 4px 0' }}>
                    {k.previous == null
                      ? <Text type="secondary" style={{ fontSize: 11.5 }}>no earlier period</Text>
                      : <><Delta value={k.value} previous={k.previous} goodWhenUp={m.goodWhenUp !== false} /> <Text type="secondary" style={{ fontSize: 11.5 }}>vs {k.previous}</Text></>}
                  </div>
                </div>
              );
            })}
          </div>

          <Card className="panel-shell" title={<SectionTitle accent={ACCENT.waiting}>Needs attention <NowBadge /></SectionTitle>}>
            {(() => {
              const items = attentionItems();
              if (!items.length) return <Text type="secondary">Nothing is waiting on this role.</Text>;
              return (
                <List
                  size="small"
                  dataSource={items}
                  renderItem={(it) => (
                    <List.Item
                      actions={(it.metric || it.link) ? [
                        <Button key="open" type="link" size="small" onClick={() => (it.metric ? onOpenMetric?.(mrfId, it.metric) : navigate(it.link))}>Open →</Button>,
                      ] : []}
                    >
                      <List.Item.Meta title={<Text strong style={{ fontSize: 13.5 }}>{it.title}</Text>} description={<Text type="secondary" style={{ fontSize: 12.5 }}>{it.desc}</Text>} />
                    </List.Item>
                  )}
                />
              );
            })()}
          </Card>

          {d.series?.length ? <SourceChart series={d.series} sourceLabels={d.source_labels} /> : null}

          <Row gutter={[16, 16]}>
            <Col xs={24} lg={13}>
              <Card className="panel-shell" style={{ height: '100%' }} title={<SectionTitle accent={ACCENT.positive} hint="since opened">Stage funnel</SectionTitle>}>
                <Space direction="vertical" size={9} style={{ width: '100%' }}>
                  {funnel.map((f, i) => {
                    const conversion = i > 0 && funnel[i - 1].count > 0 ? Math.round((f.count / funnel[i - 1].count) * 100) : null;
                    const metricFor = { applied: 'applied', responded: 'responded' }[f.key];
                    return (
                      <Row key={f.key} gutter={10} align="middle" wrap={false}>
                        <Col flex="150px" style={{ textAlign: 'right' }}>
                          <Text type="secondary" style={{ fontSize: 12.5 }}>{f.label}</Text>
                        </Col>
                        <Col flex="auto">
                          <div style={{ height: 22, width: '100%', background: 'var(--ink-3)', borderRadius: 6, overflow: 'hidden' }}>
                            <div style={{
                              height: '100%', width: `${Math.max((f.count / maxFunnel) * 100, f.count ? 2 : 0)}%`,
                              background: 'linear-gradient(90deg,var(--kpi-a),var(--kpi-a-2))', borderRadius: 6,
                              transition: 'width 0.6s cubic-bezier(0.22,1,0.36,1)',
                            }}
                            />
                          </div>
                        </Col>
                        <Col flex="100px">
                          {metricFor ? <MetricLink value={f.count} onClick={metric(metricFor)} /> : <Text strong style={{ fontSize: 14 }}>{f.count}</Text>}
                          {conversion !== null && (
                            <Tag
                              style={{
                                marginLeft: 6, fontSize: 11, border: 'none',
                                background: conversion < 50 ? 'var(--kpi-d-tint)' : 'var(--kpi-a-tint)',
                                color: conversion < 50 ? 'var(--kpi-d)' : 'var(--gold-dark)',
                              }}
                            >
                              {conversion}%
                            </Tag>
                          )}
                        </Col>
                      </Row>
                    );
                  })}
                </Space>
              </Card>
            </Col>
            <Col xs={24} lg={11}>
              <Card className="panel-shell" style={{ height: '100%' }} title={<SectionTitle accent={ACCENT.progress}>Upcoming interviews <NowBadge /></SectionTitle>}>
                {d.upcoming.length ? (
                  <List
                    size="small"
                    dataSource={d.upcoming.slice(0, 8)}
                    renderItem={(u) => (
                      <List.Item>
                        <List.Item.Meta
                          title={<Text strong style={{ fontSize: 13 }}>{u.candidate_name}</Text>}
                          description={<Text type="secondary" style={{ fontSize: 12.5 }}>{fmtDateTime(u.at)} · {u.stage}{u.kind === 'teams' ? ' · Teams' : ''}</Text>}
                        />
                      </List.Item>
                    )}
                  />
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No interviews in the next 7 days" />}
              </Card>
            </Col>
          </Row>

          <Card className="panel-shell" title={<SectionTitle accent={ACCENT.neutral} hint={d.range.label}>What happened</SectionTitle>}>
            {d.activity.items.length ? (
              <>
                <List
                  size="small"
                  dataSource={d.activity.items.slice(0, 20)}
                  renderItem={(a) => {
                    const link = candidateLink(a);
                    return (
                      <List.Item extra={a.by ? <Text type="secondary" style={{ fontSize: 12 }}>by {a.by}</Text> : null}>
                        <Space size={12} align="start">
                          <Text type="secondary" style={{ fontSize: 12, minWidth: 150, display: 'inline-block' }}>{a.day_only ? fmtDate(a.at) : fmtDateTime(a.at)}</Text>
                          {link
                            ? <Button type="link" size="small" style={{ padding: 0, height: 'auto', whiteSpace: 'normal', textAlign: 'left' }} onClick={() => navigate(link)}>{a.text}</Button>
                            : <Text style={{ fontSize: 13 }}>{a.text}</Text>}
                        </Space>
                      </List.Item>
                    );
                  }}
                />
                {d.activity.total > 20 && <Text type="secondary" style={{ fontSize: 12 }}>Showing the latest 20 of {d.activity.total}. The role report has the rest.</Text>}
              </>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing happened in this period" />}
          </Card>

          <Card className="panel-shell" title={<SectionTitle accent={ACCENT.success}>Position journey · open to close</SectionTitle>}>
            <Steps
              size="small"
              progressDot
              current={Math.max(0, reached)}
              responsive
              items={d.milestones.map((m) => ({
                title: <span style={{ fontSize: 12.5 }}>{m.label}</span>,
                description: (
                  <Text type="secondary" style={{ fontSize: 11.5 }}>
                    {m.at ? fmtDate(m.at) : 'not yet'}{m.days_after_previous != null ? ` · +${m.days_after_previous} d` : ''}
                  </Text>
                ),
                status: m.at ? 'finish' : 'wait',
              }))}
            />
          </Card>
        </Space>
      )}
    </Drawer>
  );
}
