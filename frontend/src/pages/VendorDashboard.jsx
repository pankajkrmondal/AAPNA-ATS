import { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Typography,
  Table,
  Tag,
  Space,
  Spin,
  Alert,
  Row,
  Col,
  Empty,
  // Button now comes from src/ui — see the import below.
  Select,
  Progress,
  Tooltip,
} from 'antd';
import {
  ReloadOutlined,
  ShopOutlined,
  TeamOutlined,
  RiseOutlined,
  AimOutlined,
  CheckCircleOutlined,
  SyncOutlined,
  PauseCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import useAuth from '../hooks/useAuth';
import useTheme from '../hooks/useTheme';
import vendorService from '../services/vendorService';
import candidateService from '../services/candidateService';
import ExportButton from '../components/common/ExportButton';
// DISABLED 2026-08-29 (Stage 5.5) — replaced by StatTile from src/ui, which merges
// this and the two other stat families. To restore: uncomment and swap the tags back.
// import KpiCard from '../components/common/KpiCard';
import { DesignScope, PageShell, PageHeader, Surface, StatTile, Button } from '../ui';
// After '../ui' so page rules win on equal specificity.
import '../styles/pages/vendor-dashboard.css';

const { Title, Text } = Typography;

/* Card chrome is the shared `.section-card` class in theme/index.css — same
   values, but a stylesheet can reach it, which an inline object cannot. The
   Vendor Upload (VendorPortal) screen mirrors the same shape. */

const EMPTY_STATS = {
  total: 0,
  withPosition: 0,
  thisMonth: 0,
  byFinalStatus: [],
  byStage: { stages: [], closed: 0, untracked: 0 },
};

/** Colour for a journey's stage status — matches the Pipeline Tracker's vocabulary. */
const STAGE_STATUS_COLOR = {
  in_progress: 'blue',
  rejected: 'red',
  hold: 'orange',
  approved: 'green',
};

// A local useCountUp and a local KpiCard used to live here, both byte-for-byte
// equivalent to components/common/KpiCard.jsx and hooks/useCountUp — except that
// neither local copy respected prefers-reduced-motion. Importing the shared ones
// removes the duplication and fixes that.

/**
 * KPI card definitions — keyed to fields on the dashboard `stats` object.
 *
 * `footnote` added 2026-08-31. These tiles were passing only icon/label/value/accent,
 * so they rendered short with an empty lower half next to /dashboard's, which carry the
 * full anatomy. Each footnote states the thing the label leaves ambiguous — what the
 * count is OF, and over what window — rather than restating the label.
 *
 * No `delta` on any of them: this page has no previous-period figure to compare
 * against, and a fabricated one would be worse than the space it fills.
 */
const KPI_CARDS = [
  {
    key: 'total',
    label: 'Total Candidates',
    icon: <TeamOutlined />,
    accent: 'brand',
    footnote: 'All time, across every submission',
  },
  {
    key: 'thisMonth',
    label: 'Added This Month',
    icon: <RiseOutlined />,
    accent: 'success',
    footnote: 'Since the 1st of this month',
  },
  {
    key: 'withPosition',
    label: 'With Position Applied',
    icon: <AimOutlined />,
    accent: 'warning',
    footnote: 'Matched to a specific open role',
  },
];

/** Recruiter-only KPI: duplicates awaiting review (from the upload job tracker). */
const PENDING_REVIEW_CARD = {
  key: 'pendingReview',
  label: 'Pending Review',
  icon: <WarningOutlined />,
  accent: 'danger',
  footnote: 'Duplicates waiting on a decision',
};

/**
 * Bucket a raw FinalStatus into a pipeline stage, per the AAPNA hiring workflow
 * (Stage 0 Resume Screening → Stages 1–9 → Final Outcome). Order matters: lost
 * outcomes are checked before positive/offer keywords so e.g. "Offer Rejected" and
 * "Did Not Join" are not mistaken for wins.
 *
 * LEGACY FALLBACK ONLY (M6, 2026-08-12). Candidates now carry a real stage from
 * rpa_candidate_pipeline (`stage_source: 'pipeline'`), which is what the Stage
 * column and the stage tiles read. This keyword matcher still runs for rows the
 * stage engine never saw — anyone uploaded before it existed, or never
 * shortlisted — where FinalStatus is genuinely the only signal there is. That
 * population never shrinks to zero, so this is permanent, not transitional.
 */
function classifyStatus(status) {
  const s = (status || '').trim().toLowerCase();

  // Not yet screened (Stage 0 / blank → "Awaiting Screening").
  if (!s || s === 'stage 0' || s.includes('resume screening') || s.includes('awaiting')) {
    return 'pending';
  }

  // Lost — we rejected OR the candidate dropped out.
  if (
    s.includes('reject')          // Resume/Offer/Interview/Tech/HR/Client/CEO ... Rejected
    || s.includes('failed')       // Evalground Test Failed
    || s.includes('did not join')
    || s.includes('joined and left')
    || s.includes('withdrew')
    || s.includes('backed out')
    || s.includes('high salary')  // Resume Rejected sub-reasons
    || s.includes('high notice')
    || s.includes('weak communication')
    || s.includes('skills mismatch')
    || s.includes('frequent job')
  ) {
    return 'rejected';
  }

  // Parked.
  if (s.includes('hold') || s.includes('future prospect')) return 'onHold';

  // Positive final outcomes.
  if (s === 'selected' || s.includes('offer accepted') || s === 'joined') return 'selected';

  // Everything else is actively moving through the pipeline — Resume Shortlisted,
  // "... Approved", "... Passed", "... Shared", "Offer Shared", etc.
  return 'inProcess';
}

/** Tag colour derived from the pipeline bucket so tiles and tags stay consistent. */
function statusColor(status) {
  switch (classifyStatus(status)) {
    case 'selected': return 'green';
    case 'rejected': return 'red';
    case 'onHold': return 'orange';
    case 'pending': return 'default';
    default: return 'blue'; // inProcess
  }
}

/** Pipeline stage tiles — order, label, colour, icon.
 *  Colours come from the shared `--status-*` palette (theme/index.css), the same
 *  one the real board uses, so "On Hold" is the same amber in both places. They
 *  used to be four independent hexes here with no dark-mode values. */
const PIPELINE_STAGES = [
  { key: 'selected', label: 'Selected / Joined', color: 'var(--status-approved)', icon: <CheckCircleOutlined /> },
  { key: 'inProcess', label: 'In Process', color: 'var(--brand-primary)', icon: <SyncOutlined /> },
  { key: 'onHold', label: 'On Hold', color: 'var(--status-hold)', icon: <PauseCircleOutlined /> },
  { key: 'rejected', label: 'Rejected / Dropped', color: 'var(--status-rejected)', icon: <CloseCircleOutlined /> },
  { key: 'pending', label: 'Awaiting Screening', color: 'var(--text-3)', icon: <ClockCircleOutlined /> },
];

export default function VendorDashboard() {
  const { user } = useAuth();
  const { isDark } = useTheme();
  const role = (user?.role || '').toLowerCase();
  // Internal staff review a chosen vendor; vendors view their own submissions.
  const isStaff = ['admin', 'superadmin', 'recruiter'].includes(role);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [recent, setRecent] = useState([]);

  // Staff vendor-picker state
  const [vendors, setVendors] = useState([]);
  const [selectedVendor, setSelectedVendor] = useState(null);

  // Load the list of vendors for the staff picker.
  useEffect(() => {
    if (!isStaff) return;
    vendorService
      .getVendors()
      .then((res) => setVendors(res.data?.data || []))
      .catch(() => {
        /* non-fatal — picker just stays empty */
      });
  }, [isStaff]);

  const load = useCallback(async () => {
    // Staff default to an all-vendors overview (no vendor selected); selecting a
    // vendor drills into that vendor. Vendors always see their own.
    setLoading(true);
    setError(null);
    try {
      const res = await vendorService.getDashboard(isStaff ? selectedVendor : undefined);
      const data = res.data?.data || {};
      setStats(data.stats || EMPTY_STATS);
      setRecent(data.recentCandidates || []);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Failed to load the dashboard. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [isStaff, selectedVendor]);

  useEffect(() => {
    load();
  }, [load]);

  const recentColumns = [
    { title: 'Name', dataIndex: 'name', key: 'name', render: (v) => v || '—' },
    { title: 'Position', dataIndex: 'position', key: 'position', render: (v) => v || '—' },
    {
      // The real stage from rpa_candidate_pipeline (M6). Rows the stage engine
      // never saw say so plainly rather than borrowing a stage they don't have.
      title: 'Stage',
      key: 'stage',
      render: (_, row) => {
        if (row.stage_source !== 'pipeline' || !row.stage) {
          return (
            <Tooltip title="This candidate has no pipeline journey — they were uploaded before the stage engine, or have not been shortlisted yet. The Status column is the only signal available.">
              <Tag>Not in pipeline</Tag>
            </Tooltip>
          );
        }
        const { stage_label: label, stage_status: st, final_outcome: closed } = row.stage;
        if (closed) {
          return (
            <Tooltip title={`Journey closed — ${closed.replace(/_/g, ' ')}`}>
              <Tag color="purple">Closed</Tag>
            </Tooltip>
          );
        }
        return (
          <Tooltip title={`Currently at ${label} — ${(st || '').replace(/_/g, ' ')}`}>
            <Tag color={STAGE_STATUS_COLOR[st] || 'default'}>{label}</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: 'Status',
      dataIndex: 'finalStatus',
      key: 'finalStatus',
      render: (v) => <Tag color={statusColor(v)}>{v && v.trim() !== '' ? v : 'Awaiting Screening'}</Tag>,
    },
    {
      title: 'Uploaded At',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v) => (
        <span className="vd-cell-mono">
          {v ? new Date(v).toLocaleDateString() : '—'}
        </span>
      ),
    },
  ];

  // Outcome buckets + selection rate, still derived from the status breakdown:
  // these summarise WHERE CANDIDATES ENDED UP, which FinalStatus records for
  // every candidate including the ones with no journey. The stage breakdown
  // below answers the different question of where live candidates are RIGHT NOW.
  const pipeline = (() => {
    const b = { selected: 0, inProcess: 0, onHold: 0, rejected: 0, pending: 0 };
    (stats.byFinalStatus || []).forEach(({ status, count }) => {
      b[classifyStatus(status)] += count;
    });
    return b;
  })();
  const decided = pipeline.selected + pipeline.rejected;
  const selectionRate = decided ? Math.round((pipeline.selected / decided) * 100) : 0;

  // Real stages from rpa_candidate_pipeline (M6).
  const byStage = stats.byStage || { stages: [], closed: 0, untracked: 0 };
  const trackedTotal = (byStage.stages || []).reduce((sum, s) => sum + s.count, 0) + (byStage.closed || 0);

  return (
    <DesignScope>
      <PageShell width="narrow" className="page-enter">
      {/* Page Header */}
      {/* Page header — 2026-08-31. Was `.vd-page-head` with a `Title level={3}` (20px
          against the lab's 32px) and no eyebrow. The vendor picker moves into the
          `filters` slot rather than `actions`: it changes what the page SHOWS, which is
          exactly the distinction PageHeader draws between the two. */}
      <PageHeader
        eyebrow="Vendors"
        title={isStaff ? 'Vendor Dashboard' : `Welcome${user?.first_name ? `, ${user.first_name}` : ''}`}
        subtitle={isStaff
          ? (selectedVendor ? 'Reviewing a single vendor — clear to see all vendors.' : 'Overview across all vendors — filter to drill into one.')
          : "Status overview of the candidates you've submitted."}
        filters={isStaff ? (
          <Select
            showSearch
            allowClear
            value={selectedVendor}
            onChange={(val) => setSelectedVendor(val || null)}
            placeholder="All Vendors"
            suffixIcon={<ShopOutlined />}
            optionFilterProp="label"
            className="vd-vendor-picker"
            options={vendors.map((v) => ({ label: v.name, value: v.email }))}
          />
        ) : null}
      />

      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          action={
            <Button size="sm" emphasis="soft" icon={<ReloadOutlined />} onClick={load}>
              Retry
            </Button>
          }
          className="vd-alert"
        />
      )}

      {loading ? (
        <div className="vd-loading">
          <Spin size="large" />
        </div>
      ) : (
        <>
          {/* ═══════ SECTION 1: SUMMARY STATS ═══════ */}
          <Row gutter={[16, 16]} className="ui-stagger vd-kpi-row">
            {(isStaff ? [...KPI_CARDS, PENDING_REVIEW_CARD] : KPI_CARDS).map((kpi, i, arr) => (
              <Col xs={24} sm={arr.length >= 4 ? 6 : 8} key={kpi.key}>
                <StatTile
                  icon={kpi.icon}
                  label={kpi.label}
                  value={stats[kpi.key] || 0}
                  accent={kpi.accent}
                  footnote={kpi.footnote}
                  interactive
                  /* `bloom` on the lead tile only, matching the lab — a whole row of
                     them reads as decoration rather than as a focal point. */
                  bloom={i === 0}
                />
              </Col>
            ))}
          </Row>

          {/* ═══════ SECTION 2: HIRING PIPELINE ═══════ */}
          {/* Tier 2 — the pipeline summary is a feature surface, not a records
              list. `.section-card` stays for the shape it carries outside
              `.ats-v2`; `.glass-card` supplies the material inside it. */}
          <Surface tier={2} padding="none" bloom className="animate-fade-in-up stagger-2">
            <div className="vd-card-rail" />
            <div className="vd-card-body">
              <Text className="vd-section-label">
                Hiring Pipeline
              </Text>

              {stats.total > 0 ? (
                <Row gutter={[20, 20]} align="middle">
                  {/* Selection-rate gauge */}
                  <Col xs={24} md={7} className="vd-gauge animate-scale-in">
                    <Progress
                      type="dashboard"
                      percent={selectionRate}
                      strokeColor="var(--kpi-c)"
                      trailColor={isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)'}
                      size={130}
                      format={(p) => (
                        <span className="vd-gauge__pct">{p}%</span>
                      )}
                    />
                    <div className="vd-gauge__label">
                      Selection Rate
                    </div>
                    <Tooltip title="Selected ÷ (Selected + Rejected)">
                      <div className="vd-gauge__note">
                        {pipeline.selected} selected / {decided} decided
                      </div>
                    </Tooltip>
                  </Col>

                  {/* Stage tiles */}
                  <Col xs={24} md={17}>
                    <Row gutter={[12, 12]}>
                      {PIPELINE_STAGES.map((st, idx) => (
                        <Col xs={12} sm={8} key={st.key}>
                          <div
                            className="pipeline-tile vd-tile"
                            style={{
                              '--vd-stage': st.color,
                              animationDelay: `${0.15 + idx * 0.06}s`,
                            }}
                          >
                            <span className="vd-tile__icon">{st.icon}</span>
                            <div>
                              <div className="vd-tile__value">
                                {pipeline[st.key]}
                              </div>
                              <div className="vd-tile__label">
                                {st.label}
                              </div>
                            </div>
                          </div>
                        </Col>
                      ))}
                    </Row>
                  </Col>
                </Row>
              ) : (
                <Empty description="No candidates submitted yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}

              {/* Real stage breakdown, straight from the stage engine (M6).
                  Only rendered when at least one candidate has a journey —
                  before that there is nothing true to say here, and an empty
                  row of zeroes would read as "stuck", not "not started". */}
              {trackedTotal > 0 && (
                <div className="vd-breakdown">
                  <Text className="vd-section-label vd-section-label--tight">
                    Current stage
                    <Tooltip title="Where candidates are right now, from the Candidate Pipeline. The tiles above summarise final outcomes instead, which is why the totals differ.">
                      <span className="vd-info-mark">ⓘ</span>
                    </Tooltip>
                  </Text>
                  <Space size={[8, 10]} wrap>
                    {(byStage.stages || []).map((s) => (
                      <Tag key={s.stage_key} color="blue" className="vd-tag">
                        {s.stage_label}: <strong>{s.count}</strong>
                      </Tag>
                    ))}
                    {byStage.closed > 0 && (
                      <Tooltip title="Journeys that have reached a final outcome — joined, withdrawn, rejected outright.">
                        <Tag color="purple" className="vd-tag">
                          Closed: <strong>{byStage.closed}</strong>
                        </Tag>
                      </Tooltip>
                    )}
                    {byStage.untracked > 0 && (
                      <Tooltip title="Submitted but never entered the pipeline — not yet shortlisted, or uploaded before the stage engine existed. Their Status column is the only signal available.">
                        <Tag className="vd-tag">
                          Not in pipeline: <strong>{byStage.untracked}</strong>
                        </Tag>
                      </Tooltip>
                    )}
                  </Space>
                </div>
              )}

              {/* Detailed raw status breakdown */}
              {stats.byFinalStatus && stats.byFinalStatus.length > 0 && (
                <div className="vd-breakdown">
                  <Text className="vd-section-label vd-section-label--tight">
                    Detailed status
                  </Text>
                  <Space size={[8, 10]} wrap>
                    {stats.byFinalStatus.map((item) => (
                      <Tag
                        key={item.status}
                        color={statusColor(item.status)}
                        className="vd-tag"
                      >
                        {item.status}: <strong>{item.count}</strong>
                      </Tag>
                    ))}
                  </Space>
                </div>
              )}
            </div>
          </Surface>

          {/* ═══════ SECTION 3: RECENT SUBMISSIONS ═══════ */}
          {/* Tier 3 — recent submissions is a records table. */}
          <Surface tier={3} padding="relaxed" className="animate-fade-in-up stagger-4 vd-flush">
            <div className="vd-table-head">
              <div>
                <Text strong className="vd-table-title">
                  Recent Submissions
                </Text>
                <Text className="vd-subtitle">
                  {isStaff
                    ? (selectedVendor ? "This vendor's most recent candidates." : 'Most recent candidates across all vendors.')
                    : 'Your most recently uploaded candidates.'}
                </Text>
              </div>
              {/* This table is only the most recent handful, so the export is
                  the full candidate set behind it, not the five rows shown. */}
              <ExportButton
                request={(cfg) => candidateService.exportCsv(
                  selectedVendor ? { vendorEmail: selectedVendor } : { vendorOnly: 'true' },
                  cfg,
                )}
                fallbackName="AAPNA-ATS_Vendor-Candidates.csv"
                fullSetNote="This is every matching candidate — the table above shows only the most recent."
                label="Export"
                size="small"
              />
            </div>
            <Table
              rowKey={(r) => r.id}
              columns={recentColumns}
              dataSource={recent}
              pagination={false}
              size="small"
              bordered
              locale={{ emptyText: 'No candidates submitted yet' }}
            />
          </Surface>
        </>
      )}
      </PageShell>
    </DesignScope>
  );
}
