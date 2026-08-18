import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Card,
  Tabs,
  Typography,
  Row,
  Col,
  Space,
  Tag,
  Badge,
  Statistic,
  Alert,
  message,
  Empty,
  Table,
  Select,
  Tooltip
} from 'antd';
import {
  TeamOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  BarChartOutlined,
  SendOutlined,
  MailOutlined,
  ApartmentOutlined,
  RiseOutlined,
  SolutionOutlined,
  FileDoneOutlined
} from '@ant-design/icons';
import screeningService from '../services/screeningService';
import pipelineService from '../services/pipeline';
import DeliveryMonitoring from '../components/email/DeliveryMonitoring';
import ExportButton from '../components/common/ExportButton';
import KpiCard from '../components/common/KpiCard';
import LoadingOverlay from '../components/common/LoadingOverlay';

const { Title, Text } = Typography;

/**
 * Semantic palette, shared with the Dashboard / HR Upload / Vendor screens.
 * Colour carries MEANING here rather than decoration â€” gold reads as positive,
 * red as rejected/failed, blue as in-flight, amber as waiting on someone. Kept
 * as one map so a tile, a tag and a table cell for the same concept cannot
 * drift to different colours.
 */
const ACCENT = {
  positive: { color: '#7a922e', tint: 'rgba(122,146,46,0.12)', accent: 'linear-gradient(90deg,#7a922e,#92a63c)' },
  negative: { color: '#c0392b', tint: 'rgba(192,57,43,0.12)', accent: 'linear-gradient(90deg,#c0392b,#e0654f)' },
  progress: { color: '#2f6f9f', tint: 'rgba(47,111,159,0.12)', accent: 'linear-gradient(90deg,#2f6f9f,#4f93c4)' },
  waiting: { color: '#b6883a', tint: 'rgba(182,136,58,0.14)', accent: 'linear-gradient(90deg,#b6883a,#d2a85a)' },
  neutral: { color: '#5f6664', tint: 'rgba(95,102,100,0.12)', accent: 'linear-gradient(90deg,#5f6664,#828b88)' },
  success: { color: '#4a7c59', tint: 'rgba(74,124,89,0.12)', accent: 'linear-gradient(90deg,#4a7c59,#6aa67c)' },
};

/**
 * Card header used across all four tabs: a coloured rule + title, so every
 * panel is scannable at a glance and colour-coded to what it reports on.
 */
function SectionTitle({ children, accent = ACCENT.positive, hint }) {
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

/* The panel shell (radius / border / shadow) is now the shared `.panel-shell`
   class in theme/index.css — same values, but reachable by a stylesheet. It was
   duplicated byte-for-byte here and in components/email/DeliveryMonitoring.jsx. */

/**
 * Analytics.jsx â€” "Recruitment Analytics", the curated analytics-only page.
 *
 * Rebuilt from the pre-rebrand "Recruitment Screening Analytics" page by
 * dropping everything operational â€” candidate search/status editing, Zeko
 * interview scheduling/cancelling, the Outlook conversation viewer â€” and
 * keeping only what is genuinely analytics. That old page survived for a while
 * at /analytics-legacy as a fallback and was deleted on 2026-08-12; its
 * operational features live on the screens that own them (Candidate Screening,
 * Candidate Pipeline, Search Candidate). See git history for the original.
 *
 * "Pipeline Insights" and "Recruiter Insights" below are wired to the real
 * Phase 3 Module 1 backend (/api/pipeline/analytics, pipeline.service.js's
 * getPipelineAnalytics) â€” they replaced the hardcoded mock data that lived
 * here before Module 1 shipped.
 */

/* The "from the Candidate Pipeline" provenance note now rides on SectionTitle's
   `hint`, so the standalone SHARED_SOURCE node is gone. */

/**
 * These tables are ranked top-10 summaries on screen, but a 10-row CSV is
 * useless for the analysis someone exports in order to do â€” so the export
 * returns the complete ranked list. Said out loud in the success toast rather
 * than left to be discovered as a discrepancy.
 */
const TOP_TEN_NOTE = 'This is the complete list â€” the table on screen shows only the top 10.';

/**
 * The analysis parameters the backend has always accepted but nothing sent.
 * The defaults here MUST match getPipelineAnalytics()'s own defaults, so the
 * page renders exactly as before until someone changes a control.
 */
const DEFAULT_ANALYTICS_PARAMS = Object.freeze({
  mrf_id: undefined,          // undefined = let the server pick the busiest
  stuck_threshold_days: 10,
  hold_threshold_days: 30,
  rejection_window_days: 30,
});

const daysOptions = (values) => values.map((v) => ({ value: v, label: `${v} days` }));
const STUCK_THRESHOLD_OPTIONS = daysOptions([5, 10, 14, 30]);
const HOLD_THRESHOLD_OPTIONS = daysOptions([7, 30, 60, 90]);
// Mirrors the Email Delivery tab's 7/30/90 selector so the page is consistent.
const REJECTION_WINDOW_OPTIONS = daysOptions([7, 30, 90]);

/**
 * PipelineInsights â€” stage funnel, stuck candidates, rejection reasons.
 * Sourced from GET /api/pipeline/analytics (pipeline.service.js).
 */
function PipelineInsights({ data, loading, errored, params, onParamsChange }) {
  if (errored) {
    return <Alert type="error" showIcon message="Failed to load pipeline analytics." />;
  }

  const tiles = data?.tiles || {};
  const funnel = data?.funnel || { stages: [], mrf_label: null, available_mrfs: [] };
  const maxFunnel = Math.max(1, ...(funnel.stages.map((f) => f.count)));
  const availableMrfs = funnel.available_mrfs || [];

  return (
    <>
      <Row gutter={[16, 16]} style={{ marginBottom: 18 }}>
        <Col xs={12} lg={6}>
          {loading ? <Card loading className="panel-shell" /> : (
            <KpiCard
              index={0}
              icon={<ApartmentOutlined />}
              label="Active in pipeline"
              value={tiles.active_in_pipeline ?? 0}
              {...ACCENT.progress}
            />
          )}
        </Col>
        <Col xs={12} lg={6}>
          {loading ? <Card loading className="panel-shell" /> : (
            <div style={{ position: 'relative' }}>
              <KpiCard
                index={1}
                icon={<SolutionOutlined />}
                label="Awaiting feedback"
                value={tiles.awaiting_feedback ?? 0}
                {...ACCENT.waiting}
              />
              <Text
                type="secondary"
                style={{ fontSize: 11, display: 'block', padding: '6px 24px 0', lineHeight: 1.4 }}
              >
                interviewer scorecard still outstanding
                {/* A panel round issues one card per interviewer, so the card
                    count can exceed the candidate count â€” said out loud so the
                    tile does not look undercounted on the scorecard screen. */}
                {tiles.awaiting_feedback_cards > (tiles.awaiting_feedback ?? 0)
                  && ` Â· ${tiles.awaiting_feedback_cards} cards`}
              </Text>
            </div>
          )}
        </Col>
        <Col xs={12} lg={6}>
          {loading ? <Card loading className="panel-shell" /> : (
            <div style={{ position: 'relative' }}>
              <KpiCard
                index={2}
                icon={<ClockCircleOutlined />}
                label={`On hold > ${tiles.hold_threshold_days ?? 30} days`}
                value={tiles.on_hold_over_threshold ?? 0}
                {...ACCENT.negative}
              />
              <div style={{ padding: '6px 24px 0' }}>
                <Tooltip title="How old a hold has to be before it is counted above. At 30 days the tile shows only candidates parked on hold for more than 30 days â€” the ones likely to need chasing. Lower it to catch holds sooner; raise it to see only the worst cases. Affects this tile only.">
                  <Select
                    size="small"
                    variant="borderless"
                    value={params.hold_threshold_days}
                    onChange={(v) => onParamsChange({ hold_threshold_days: v })}
                    options={HOLD_THRESHOLD_OPTIONS}
                    style={{ marginLeft: -11, cursor: 'help' }}
                  />
                </Tooltip>
              </div>
            </div>
          )}
        </Col>
        <Col xs={12} lg={6}>
          {loading ? <Card loading className="panel-shell" /> : (
            <KpiCard
              index={3}
              icon={<FileDoneOutlined />}
              label="Offers pending"
              value={tiles.offers_pending ?? 0}
              {...ACCENT.positive}
            />
          )}
        </Col>
      </Row>

      <Card
        title={(
          <SectionTitle accent={ACCENT.positive}>
            {funnel.mrf_label ? `Stage funnel â€” ${funnel.mrf_label}` : 'Stage funnel'}
          </SectionTitle>
        )}
        loading={loading}
        className="panel-shell" style={{ marginBottom: 16 }}
        extra={availableMrfs.length > 0 && (
          <Space size={8}>
            {/* An auto-picked requisition presented silently reads as "the"
                funnel rather than one of several â€” say which it is. */}
            {funnel.auto_selected && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                showing the requisition with the most candidates
              </Text>
            )}
            <Tooltip title="Which requisition this funnel shows. The funnel covers one role at a time â€” the number after each name is how many candidates it has. Type to search. Affects the funnel only; the tiles and tables below cover every requisition.">
              <Select
                size="small"
                showSearch
                optionFilterProp="label"
                style={{ minWidth: 260 }}
                value={funnel.mrf_id ?? undefined}
                onChange={(v) => onParamsChange({ mrf_id: v })}
                options={availableMrfs.map((m) => ({
                  value: m.mrf_id,
                  label: `${m.label} Â· ${m.journey_count}`,
                }))}
              />
            </Tooltip>
          </Space>
        )}
      >
        {funnel.stages.length === 0 ? (
          <Empty description="No candidates in the pipeline yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Space direction="vertical" size={9} style={{ width: '100%' }}>
            {funnel.stages.map((f, i) => {
              const conversion = i > 0 && funnel.stages[i - 1].count > 0
                ? Math.round((f.count / funnel.stages[i - 1].count) * 100)
                : null;
              return (
                <Row key={f.stage_key} gutter={10} align="middle" wrap={false}>
                  <Col flex="180px" style={{ textAlign: 'right' }}>
                    <Text type="secondary" style={{ fontSize: 12.5 }}>{f.label}</Text>
                  </Col>
                  <Col flex="auto">
                    {/* Track behind the bar gives the funnel a shape to read
                        against â€” a bare bar on white loses its scale. */}
                    <div style={{
                      height: 22, width: '100%', background: 'var(--ink-3)', borderRadius: 6, overflow: 'hidden',
                    }}
                    >
                      <div style={{
                        height: '100%',
                        width: `${Math.max((f.count / maxFunnel) * 100, 2)}%`,
                        background: 'linear-gradient(90deg,#7a922e,#a8c24a)',
                        borderRadius: 6,
                        transition: 'width 0.6s cubic-bezier(0.22,1,0.36,1)',
                      }}
                      />
                    </div>
                  </Col>
                  <Col flex="120px">
                    <Text strong style={{ fontSize: 14 }}>{f.count}</Text>
                    {conversion !== null && (
                      <Tag
                        style={{
                          marginLeft: 6,
                          fontSize: 11,
                          border: 'none',
                          // A steep drop between stages is the thing worth
                          // noticing, so it is tinted rather than left neutral.
                          background: conversion < 50 ? 'rgba(192,57,43,0.10)' : 'rgba(122,146,46,0.12)',
                          color: conversion < 50 ? '#c0392b' : '#5c7022',
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
        )}
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card
            // The threshold was previously applied but never stated, so the
            // list looked like "all stuck candidates" rather than a cut-off.
            title={(
              <SectionTitle accent={ACCENT.waiting} hint="from the Candidate Pipeline">
                {`Stuck candidates â€” ${params.stuck_threshold_days}+ days`}
              </SectionTitle>
            )}
            className="panel-shell"
            extra={(
              <Space size={8}>
                <Tooltip title="How long a candidate must sit in the same stage before this list flags them. The clock measures time since they last MOVED a stage â€” notes, emails and reminders do not reset it. Lower it to catch delays earlier; raise it to see only the most stalled.">
                  <Select
                    size="small"
                    value={params.stuck_threshold_days}
                    onChange={(v) => onParamsChange({ stuck_threshold_days: v })}
                    options={STUCK_THRESHOLD_OPTIONS}
                    style={{ width: 100, cursor: 'help' }}
                  />
                </Tooltip>
                <ExportButton
                  tooltip="Downloads every candidate stuck past the day threshold â€” name, stage, days waiting and status â€” so you can chase them offline."
                  request={(cfg) => pipelineService.exportAnalytics('stuck', { ...cfg, params })}
                  fallbackName="AAPNA-ATS_Pipeline-Stuck-Candidates.csv"
                  rowCount={data?.stuckCandidates?.length ?? null}
                  fullSetNote={TOP_TEN_NOTE}
                  label="Export"
                  size="small"
                />
              </Space>
            )}
            loading={loading}
          >
            <Table size="small" pagination={false} rowKey="pipeline_id"
              columns={[
                {
                  title: 'Candidate',
                  dataIndex: 'candidate_name',
                  render: (name) => <Text strong style={{ fontSize: 13 }}>{name}</Text>,
                },
                {
                  title: 'Stage',
                  dataIndex: 'stage',
                  render: (s) => <Text type="secondary" style={{ fontSize: 12.5 }}>{s}</Text>,
                },
                {
                  title: 'Days',
                  dataIndex: 'days',
                  width: 76,
                  align: 'center',
                  // The longer someone has been stuck, the harder the number
                  // should be to skim past.
                  render: (d) => (
                    <Text strong style={{ color: d >= 20 ? '#c0392b' : d >= 14 ? '#b6883a' : 'var(--text-2)' }}>
                      {d}d
                    </Text>
                  ),
                },
                {
                  title: 'Status',
                  dataIndex: 'blocked_on',
                  render: (b) => (
                    <Tag
                      style={{
                        border: 'none',
                        background: b?.includes('Hold') ? 'rgba(192,57,43,0.10)' : 'rgba(182,136,58,0.14)',
                        color: b?.includes('Hold') ? '#c0392b' : '#8a6427',
                      }}
                    >
                      {b}
                    </Tag>
                  ),
                },
              ]}
              dataSource={data?.stuckCandidates || []}
              locale={{ emptyText: <Empty description="No stuck candidates" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            title={(
              <SectionTitle accent={ACCENT.negative} hint="from the Candidate Pipeline">
                {`Rejection reasons â€” last ${data?.rejectionWindowDays ?? 30} days`}
              </SectionTitle>
            )}
            className="panel-shell"
            extra={(
              <Space size={8}>
                <Tooltip title="How far back to look for rejections. At 30 days this table counts only rejections recorded in the last 30 days, so recent hiring problems are not diluted by older ones. Widen it for a longer-term view.">
                  <Select
                    size="small"
                    value={params.rejection_window_days}
                    onChange={(v) => onParamsChange({ rejection_window_days: v })}
                    options={REJECTION_WINDOW_OPTIONS}
                    style={{ width: 100, cursor: 'help' }}
                  />
                </Tooltip>
                <ExportButton
                  tooltip="Downloads why candidates were rejected in the selected window â€” each reason, how often it occurred, and the stage it happens at most."
                  request={(cfg) => pipelineService.exportAnalytics('rejection_reasons', { ...cfg, params })}
                  fallbackName="AAPNA-ATS_Pipeline-Rejection-Reasons.csv"
                  rowCount={data?.rejectionReasons?.length ?? null}
                  fullSetNote={TOP_TEN_NOTE}
                  label="Export"
                  size="small"
                />
              </Space>
            )}
            loading={loading}
          >
            <Table size="small" pagination={false} rowKey="reason"
              columns={[
                {
                  title: 'Reason',
                  dataIndex: 'reason',
                  render: (r) => <Text strong style={{ fontSize: 13 }}>{r}</Text>,
                },
                {
                  title: 'Count',
                  dataIndex: 'count',
                  width: 72,
                  align: 'center',
                  render: (c) => (
                    <Tag style={{ border: 'none', background: 'rgba(192,57,43,0.10)', color: '#c0392b', fontWeight: 600 }}>
                      {c}
                    </Tag>
                  ),
                },
                {
                  title: 'Most common stage',
                  dataIndex: 'most_common_stage',
                  render: (s) => <Text type="secondary" style={{ fontSize: 12.5 }}>{s}</Text>,
                },
              ]}
              dataSource={data?.rejectionReasons || []}
              locale={{ emptyText: <Empty description="No rejections in this window" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
          </Card>
        </Col>
      </Row>
    </>
  );
}

/**
 * RecruiterInsights â€” time-to-hire, vendor performance, source-of-hire.
 * Sourced from GET /api/pipeline/analytics (pipeline.service.js).
 */
function RecruiterInsights({ data, loading, errored, params }) {
  if (errored) {
    return <Alert type="error" showIcon message="Failed to load recruiter insights." />;
  }

  const timeToHire = data?.timeToHire || { total_days: 0, stages: [] };
  const maxStageDays = Math.max(1, ...timeToHire.stages.map((s) => s.avg_days));
  const vendorPerformance = data?.vendorPerformance || [];
  const sourceOfHire = data?.sourceOfHire || [];

  return (
    <>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card
            title={<SectionTitle accent={ACCENT.progress}>Time-to-hire</SectionTitle>}
            extra={<Text type="secondary" style={{ fontSize: 12 }}>avg days per stage, closed journeys only</Text>}
            loading={loading}
            className="panel-shell" style={{ marginBottom: 16 }}
          >
            <div style={{
              background: 'var(--ink-3)', borderRadius: 10, padding: '14px 18px', marginBottom: 16,
            }}
            >
              <Statistic
                title="Average days, shortlist to offer"
                value={timeToHire.total_days}
                suffix="days"
                valueStyle={{ color: '#2f6f9f', fontWeight: 800 }}
              />
            </div>
            {timeToHire.stages.length === 0 ? (
              <Empty description="No closed journeys yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Space direction="vertical" size={7} style={{ width: '100%' }}>
                {timeToHire.stages.map(({ stage_key, label, avg_days }) => (
                  <Row key={stage_key} gutter={10} align="middle" wrap={false}>
                    <Col flex="170px" style={{ textAlign: 'right' }}>
                      <Text type="secondary" style={{ fontSize: 12.5 }}>{label}</Text>
                    </Col>
                    <Col flex="auto">
                      <div style={{
                        height: 20, width: '100%', background: 'var(--ink-3)', borderRadius: 6, overflow: 'hidden',
                      }}
                      >
                        <div style={{
                          height: '100%',
                          width: `${Math.max((avg_days / maxStageDays) * 100, 4)}%`,
                          background: 'linear-gradient(90deg,#2f6f9f,#4f93c4)',
                          borderRadius: 6,
                          transition: 'width 0.6s cubic-bezier(0.22,1,0.36,1)',
                        }}
                        />
                      </div>
                    </Col>
                    <Col flex="60px"><Text strong style={{ fontSize: 13 }}>{avg_days}d</Text></Col>
                  </Row>
                ))}
              </Space>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            title={<SectionTitle accent={ACCENT.waiting}>Vendor performance</SectionTitle>}
            className="panel-shell" style={{ marginBottom: 16 }}
            extra={(
              <Space size={8}>
                <Text type="secondary" style={{ fontSize: 12 }}>leaderboard</Text>
                <ExportButton
                  tooltip="Downloads each vendor's candidates â€” how many are in the pipeline, hired and rejected â€” for comparing vendor quality."
                  request={(cfg) => pipelineService.exportAnalytics('vendor_performance', { ...cfg, params })}
                  fallbackName="AAPNA-ATS_Pipeline-Vendor-Performance.csv"
                  rowCount={vendorPerformance?.length ?? null}
                  fullSetNote={TOP_TEN_NOTE}
                  label="Export"
                  size="small"
                />
              </Space>
            )}
            loading={loading}
          >
            {/* No "Shortlist rate" column: it read 100% for every vendor by
                construction. The honest denominator (CVs actually sent) is in
                rpa_upload_jobs, but only 23% of those rows carry a cv_id, so a
                rate there would be invented. See docs/Recruitment-Analytics.md. */}
            <Table size="small" pagination={false} rowKey="vendor_email"
              columns={[
                {
                  title: 'Vendor',
                  dataIndex: 'vendor_email',
                  render: (v) => <Text strong style={{ fontSize: 13 }}>{v}</Text>,
                },
                { title: 'In pipeline', dataIndex: 'in_pipeline', align: 'center', width: 110 },
                {
                  title: 'Hired',
                  dataIndex: 'hired',
                  align: 'center',
                  width: 90,
                  render: (n) => <Text strong style={{ color: n > 0 ? '#4a7c59' : 'var(--text-2)' }}>{n}</Text>,
                },
                {
                  title: 'Rejected',
                  dataIndex: 'rejected',
                  align: 'center',
                  width: 100,
                  render: (n) => <Text style={{ color: n > 0 ? '#c0392b' : 'var(--text-2)' }}>{n}</Text>,
                },
              ]}
              dataSource={vendorPerformance}
              locale={{ emptyText: <Empty description="No vendor-sourced journeys yet" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
          </Card>
        </Col>
      </Row>
      <Card
        title={<SectionTitle accent={ACCENT.success}>Source of hire</SectionTitle>}
        className="panel-shell"
        extra={(
          <Space size={8}>
            <Text type="secondary" style={{ fontSize: 12 }}>conversion by source</Text>
            <ExportButton
              tooltip="Downloads how each intake route converts â€” candidates submitted, in progress, hired, rejected and on hold, per source."
              request={(cfg) => pipelineService.exportAnalytics('source_of_hire', { ...cfg, params })}
              fallbackName="AAPNA-ATS_Pipeline-Source-Of-Hire.csv"
              rowCount={sourceOfHire?.length ?? null}
              label="Export"
              size="small"
            />
          </Space>
        )}
        loading={loading}
      >
        {/* Columns are mutually exclusive and sum to Submitted. The old
            "Shortlist rate" was ~100% for every source because every pipeline
            row IS a shortlist; hire rate is the question worth asking. */}
        <Table size="small" pagination={false} rowKey="source"
          columns={[
            {
              title: 'Source',
              dataIndex: 'source',
              // Stored values are snake_case keys ('screening_shortlist'); the
              // table is read by humans, so present them as words.
              render: (s) => (
                <Text strong style={{ fontSize: 13, textTransform: 'capitalize' }}>
                  {String(s || '').replace(/_/g, ' ')}
                </Text>
              ),
            },
            {
              title: 'Submitted',
              dataIndex: 'submitted',
              align: 'center',
              render: (n) => <Text strong>{n}</Text>,
            },
            {
              title: 'In progress',
              dataIndex: 'in_progress',
              align: 'center',
              render: (n) => <Text style={{ color: n > 0 ? '#2f6f9f' : 'var(--text-2)' }}>{n}</Text>,
            },
            {
              title: 'Hired',
              dataIndex: 'hired',
              align: 'center',
              render: (n) => <Text strong style={{ color: n > 0 ? '#4a7c59' : 'var(--text-2)' }}>{n}</Text>,
            },
            {
              title: 'Rejected',
              dataIndex: 'rejected',
              align: 'center',
              render: (n) => <Text style={{ color: n > 0 ? '#c0392b' : 'var(--text-2)' }}>{n}</Text>,
            },
            {
              title: 'On Hold',
              dataIndex: 'on_hold',
              align: 'center',
              render: (n) => <Text style={{ color: n > 0 ? '#b6883a' : 'var(--text-2)' }}>{n}</Text>,
            },
            {
              title: 'Hire rate',
              dataIndex: 'hire_rate',
              align: 'center',
              render: (rate) => (
                <Tag
                  style={{
                    border: 'none',
                    fontWeight: 600,
                    background: rate > 0 ? 'rgba(74,124,89,0.12)' : 'var(--ink-3)',
                    color: rate > 0 ? '#4a7c59' : 'var(--text-2)',
                  }}
                >
                  {rate}%
                </Tag>
              ),
            },
          ]}
          dataSource={sourceOfHire}
          locale={{ emptyText: <Empty description="No journeys yet" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
      </Card>
    </>
  );
}

export default function Analytics() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({ pipeline: [], candidates: [], tiles: {} });
  const [activeTab, setActiveTab] = useState('analytics');
  // Distinct from pipelineAnalytics.loading: that one drives per-card skeletons
  // on first paint, this one drives the blocking scrim on a user-triggered
  // refetch. Conflating them would put a full-screen overlay over the initial
  // page load.
  const [refetching, setRefetching] = useState(false);

  /**
   * Pipeline analytics is owned HERE, not by the two tabs that render it.
   * Both Pipeline Insights and Recruiter Insights read the same
   * GET /api/pipeline/analytics payload; when each fetched its own, opening the
   * page fired the identical (and expensive) request twice.
   */
  const [pipelineAnalytics, setPipelineAnalytics] = useState({
    data: null, loading: true, errored: false,
  });

  /**
   * The analysis window the two pipeline tabs are showing. These map 1:1 onto
   * query params getPipelineAnalytics has always accepted; until now nothing
   * sent them, so the server defaults were effectively fixed.
   */
  const [analyticsParams, setAnalyticsParams] = useState(DEFAULT_ANALYTICS_PARAMS);

  useEffect(() => {
    fetchMainData();
  }, []);

  // Refetch whenever a control moves. The initial mount runs this too, with the
  // defaults, so there is still exactly ONE request per page load.
  //
  // isInitialAnalyticsLoad separates the two cases: on first paint the cards
  // are skeletons and a scrim on top of them would be noise, but on a control
  // change the user is looking at real numbers that are about to be replaced â€”
  // that needs the overlay, or the swap reads as "nothing happened".
  const isInitialAnalyticsLoad = useRef(true);
  useEffect(() => {
    loadPipelineAnalytics(analyticsParams, { showOverlay: !isInitialAnalyticsLoad.current });
    isInitialAnalyticsLoad.current = false;
  }, [analyticsParams]);

  const fetchMainData = async () => {
    setLoading(true);
    try {
      const res = await screeningService.getZekoPipeline();
      setData(res.data?.data || res.data || { pipeline: [], candidates: [], tiles: {} });
    } catch (err) {
      message.error('Failed to load recruitment analytics.');
    } finally {
      setLoading(false);
    }
  };

  const loadPipelineAnalytics = async (params = analyticsParams, { showOverlay = false } = {}) => {
    if (showOverlay) setRefetching(true);
    setPipelineAnalytics((prev) => ({ ...prev, loading: true, errored: false }));
    try {
      const res = await pipelineService.getAnalytics(params);
      setPipelineAnalytics({ data: res.data?.data || res.data, loading: false, errored: false });
    } catch (err) {
      setPipelineAnalytics({ data: null, loading: false, errored: true });
    } finally {
      if (showOverlay) setRefetching(false);
    }
  };

  /**
   * Merge one control's new value into the current analysis window.
   *
   * Re-selecting the value that is already showing returns the SAME state
   * object, so React bails out and the effect below never re-runs â€” no request,
   * no spinner, no flash. Picking your current requisition out of the dropdown
   * should be a no-op, not a reload of identical data.
   */
  const handleParamsChange = (patch) => {
    setAnalyticsParams((prev) => {
      const unchanged = Object.entries(patch).every(([k, v]) => prev[k] === v);
      return unchanged ? prev : { ...prev, ...patch };
    });
  };

  // Group candidates by Role for the Role Summary tab
  const roleStats = useMemo(() => {
    if (!data.candidates) return [];
    const groups = {};
    data.candidates.forEach((c) => {
      const roleName = c.mrf?.position_hiring_for || c.position_applied || 'Unknown Role';
      const mrfId = c.mrf_id || (c.mrf ? Number(c.mrf.id) : null);
      const status = (c.pipeline_status || 'shortlisted').toLowerCase();

      if (!groups[roleName]) {
        groups[roleName] = {
          key: roleName,
          role: roleName,
          mrf_id: mrfId,
          shortlisted: 0,
          rejected: 0,
          on_hold: 0,
          total: 0
        };
      }

      groups[roleName].total += 1;
      if (status === 'shortlisted') {
        groups[roleName].shortlisted += 1;
      } else if (status === 'rejected') {
        groups[roleName].rejected += 1;
      } else if (status === 'on_hold' || status === 'on hold') {
        groups[roleName].on_hold += 1;
      }
    });
    return Object.values(groups);
  }, [data.candidates]);

  const analyticsColumns = [
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      render: (text) => <Text strong style={{ color: 'var(--text)' }}>{text}</Text>
    },
    {
      title: 'MRF ID',
      dataIndex: 'mrf_id',
      key: 'mrf_id',
      render: (text) => (
        <Tag style={{
          border: 'none', background: 'var(--ink-3)', color: 'var(--text-2)', fontFamily: 'monospace',
        }}
        >
          MRF #{text || 'N/A'}
        </Tag>
      )
    },
    {
      title: 'Shortlisted',
      dataIndex: 'shortlisted',
      key: 'shortlisted',
      align: 'center',
      render: (count) => <Badge count={count} showZero color={ACCENT.positive.color} />
    },
    {
      title: 'Rejected',
      dataIndex: 'rejected',
      key: 'rejected',
      align: 'center',
      render: (count) => <Badge count={count} showZero color={ACCENT.negative.color} />
    },
    {
      title: 'On Hold',
      dataIndex: 'on_hold',
      key: 'on_hold',
      align: 'center',
      render: (count) => <Badge count={count} showZero color={ACCENT.waiting.color} />
    },
    {
      title: 'Total Candidates',
      dataIndex: 'total',
      key: 'total',
      align: 'center',
      render: (count) => <Text strong style={{ fontSize: 14 }}>{count}</Text>
    }
  ];

  // Headline tiles â€” the shared KpiCard used by Dashboard / HR Upload / Vendor,
  // so this page speaks the same visual language as the rest of the app.
  const tilesData = [
    { title: 'Shortlisted', value: data.tiles?.shortlisted || 0, icon: <TeamOutlined />, ...ACCENT.positive },
    { title: 'Rejected', value: data.tiles?.rejected || 0, icon: <CloseCircleOutlined />, ...ACCENT.negative },
    { title: 'On Hold', value: data.tiles?.on_hold || 0, icon: <ClockCircleOutlined />, ...ACCENT.waiting },
    { title: 'Total', value: data.tiles?.total || 0, icon: <BarChartOutlined />, ...ACCENT.neutral },
    { title: 'Zeko Sent', value: data.tiles?.zeko_sent || 0, icon: <SendOutlined />, ...ACCENT.progress },
    { title: 'Zeko Passed', value: data.tiles?.zeko_passed || 0, icon: <CheckCircleOutlined />, ...ACCENT.success },
  ];

  return (
    <div className="stagger-children" style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* Blocking scrim while a control change re-queries. Matches the Candidate
          Screening page so a wait looks the same everywhere in the app. */}
      <LoadingOverlay open={refetching} message="Updating analyticsâ€¦" />

      {/* Page Header. No "Refresh Data" button: the page already refetches
          whenever a control changes, and the Email Delivery tab carries its own
          Refresh for the one surface with a poller behind it. */}
      <div style={{ marginBottom: 24 }}>
        <Title level={3} style={{ fontWeight: 800, margin: 0 }}>
          Recruitment Analytics
        </Title>
        <Text type="secondary">
          Track recruitment performance and hiring trends across roles, sources, and vendors.
        </Text>
        <br />
        {/* These six counts have no date window â€” saying so beats letting
            them be read as "this month". */}
        <Text type="secondary" style={{ fontSize: 12 }}>
          Headline counts below are <strong>all time</strong>, across every requisition.
        </Text>
      </div>

      {/* Headline tiles. Until the first payload lands there is nothing true to
          count up to, so the strip is skeletoned rather than animating from 0 â€”
          a confident "0" mid-fetch is a wrong answer, not a slow one. */}
      <Row gutter={[16, 16]} style={{ marginBottom: 28 }}>
        {tilesData.map((tile, idx) => (
          <Col xs={12} sm={12} md={8} lg={4} key={tile.title}>
            {loading && !data.tiles ? (
              <Card bordered={false} loading className="panel-shell" style={{ height: '100%' }} />
            ) : (
              <KpiCard
                index={idx}
                icon={tile.icon}
                label={tile.title}
                value={tile.value}
                color={tile.color}
                tint={tile.tint}
                accent={tile.accent}
              />
            )}
          </Col>
        ))}
      </Row>

      {/* Main Tabs Container */}
      <Card className="glass" style={{ borderRadius: 16, border: '1px solid var(--border-light)', boxShadow: 'var(--shadow-md)' }}>
        <Tabs
          className="screening-tabs"
          activeKey={activeTab}
          onChange={setActiveTab}
          size="large"
          tabBarStyle={{ marginBottom: 20 }}
          items={[
            {
              key: 'analytics',
              label: (
                <span>
                  <BarChartOutlined className="tab-ico" />
                  Role Summary
                </span>
              ),
              children: (
                <>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 12,
                    marginBottom: 14,
                  }}
                  >
                    <SectionTitle accent={ACCENT.positive} hint="candidate outcomes per requisition">
                      Role summary
                    </SectionTitle>
                    <ExportButton
                      tooltip="Downloads one row per role â€” shortlisted, rejected, on-hold and total candidates for every requisition."
                      request={(cfg) => screeningService.exportRoleSummary(cfg)}
                      fallbackName="AAPNA-ATS_Screening-Role-Summary.csv"
                      rowCount={roleStats.length}
                      label="Export"
                      size="small"
                    />
                  </div>
                  <Table
                    dataSource={roleStats}
                    columns={analyticsColumns}
                    loading={loading}
                    pagination={{ pageSize: 10 }}
                    locale={{ emptyText: <Empty description="No shortlisted roles found" /> }}
                  />
                </>
              )
            },
            {
              // Phase 3 Module 1 â€” real pipeline analytics (GET /api/pipeline/analytics).
              key: 'pipeline',
              label: (
                <span>
                  <ApartmentOutlined className="tab-ico" />
                  Pipeline Insights
                </span>
              ),
              children: (
                <PipelineInsights
                  data={pipelineAnalytics.data}
                  loading={pipelineAnalytics.loading}
                  errored={pipelineAnalytics.errored}
                  params={analyticsParams}
                  onParamsChange={handleParamsChange}
                />
              )
            },
            {
              key: 'recruiterInsights',
              label: (
                <span>
                  <RiseOutlined className="tab-ico" />
                  Recruiter Insights
                </span>
              ),
              children: (
                <RecruiterInsights
                  data={pipelineAnalytics.data}
                  loading={pipelineAnalytics.loading}
                  errored={pipelineAnalytics.errored}
                  params={analyticsParams}
                />
              )
            },
            {
              key: 'emailDelivery',
              label: (
                <span>
                  <MailOutlined className="tab-ico" />
                  Email Delivery
                </span>
              ),
              children: <DeliveryMonitoring />
            }
          ]}
        />
      </Card>
    </div>
  );
}
