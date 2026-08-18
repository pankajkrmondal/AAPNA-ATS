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
  Button,
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
import KpiCard from '../components/common/KpiCard';

const { Title, Text } = Typography;

/** Shared card chrome — matches the Vendor Upload (VendorPortal) screen. */
const SECTION_CARD_STYLE = {
  background: 'var(--colorBgContainer)',
  border: '1px solid var(--border-light)',
  borderRadius: 12,
  marginBottom: 24,
  boxShadow: 'var(--shadow-sm)',
  overflow: 'hidden',
};

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

/** KPI card definitions — keyed to fields on the dashboard `stats` object. */
const KPI_CARDS = [
  {
    key: 'total',
    label: 'Total Candidates',
    icon: <TeamOutlined />,
    color: '#4f2fb8',
    tint: 'rgba(79,47,184,0.12)',
    accent: 'linear-gradient(90deg,#4f2fb8,#6c62d2)',
  },
  {
    key: 'thisMonth',
    label: 'Added This Month',
    icon: <RiseOutlined />,
    color: '#4f2fb8',
    tint: 'rgba(79,47,184,0.12)',
    accent: 'linear-gradient(90deg,#4f2fb8,#8b7bea)',
  },
  {
    key: 'withPosition',
    label: 'With Position Applied',
    icon: <AimOutlined />,
    color: '#b6883a',
    tint: 'rgba(182,136,58,0.14)',
    accent: 'linear-gradient(90deg,#b6883a,#d2a85a)',
  },
];

/** Recruiter-only KPI: duplicates awaiting review (from the upload job tracker). */
const PENDING_REVIEW_CARD = {
  key: 'pendingReview',
  label: 'Pending Review',
  icon: <WarningOutlined />,
  color: '#c0392b',
  tint: 'rgba(192,57,43,0.12)',
  accent: 'linear-gradient(90deg,#c0392b,#e0654f)',
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

/** Pipeline stage tiles — order, label, colour, icon. */
const PIPELINE_STAGES = [
  { key: 'selected', label: 'Selected / Joined', color: '#4f2fb8', icon: <CheckCircleOutlined /> },
  { key: 'inProcess', label: 'In Process', color: '#4f2fb8', icon: <SyncOutlined /> },
  { key: 'onHold', label: 'On Hold', color: '#b6883a', icon: <PauseCircleOutlined /> },
  { key: 'rejected', label: 'Rejected / Dropped', color: '#c0392b', icon: <CloseCircleOutlined /> },
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
        <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
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
    <div className="page-enter" style={{ maxWidth: 1100, margin: '0 auto', padding: '0 0 40px' }}>
      {/* Page Header */}
      <div
        style={{
          marginBottom: 24,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
          alignItems: 'flex-end',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <Title level={3} style={{ margin: 0, fontWeight: 700 }}>
            {isStaff ? 'Vendor Dashboard' : `Welcome${user?.first_name ? `, ${user.first_name}` : ''}`}
          </Title>
          <Text style={{ fontSize: 13, color: 'var(--text-2)', fontFamily: 'monospace' }}>
            {isStaff
              ? (selectedVendor ? 'Reviewing a single vendor — clear to see all vendors' : 'Overview across all vendors — filter to drill into one')
              : "Status overview of the candidates you've submitted"}
          </Text>
        </div>

        {isStaff && (
          <Select
            showSearch
            allowClear
            value={selectedVendor}
            onChange={(val) => setSelectedVendor(val || null)}
            placeholder="All Vendors"
            suffixIcon={<ShopOutlined />}
            optionFilterProp="label"
            style={{ minWidth: 280 }}
            options={vendors.map((v) => ({ label: v.name, value: v.email }))}
          />
        )}
      </div>

      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={load}>
              Retry
            </Button>
          }
          style={{ marginBottom: 24, borderRadius: 10 }}
        />
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '80px 0' }}>
          <Spin size="large" />
        </div>
      ) : (
        <>
          {/* ═══════ SECTION 1: SUMMARY STATS ═══════ */}
          <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
            {(isStaff ? [...KPI_CARDS, PENDING_REVIEW_CARD] : KPI_CARDS).map((kpi, i, arr) => (
              <Col xs={24} sm={arr.length >= 4 ? 6 : 8} key={kpi.key}>
                <KpiCard
                  index={i}
                  icon={kpi.icon}
                  label={kpi.label}
                  value={stats[kpi.key] || 0}
                  color={kpi.color}
                  tint={kpi.tint}
                  accent={kpi.accent}
                />
              </Col>
            ))}
          </Row>

          {/* ═══════ SECTION 2: HIRING PIPELINE ═══════ */}
          <Card className="animate-fade-in-up stagger-2" bordered={false} style={SECTION_CARD_STYLE} styles={{ body: { padding: 0 } }}>
            <div style={{ height: 3, background: 'linear-gradient(90deg, #4f2fb8, #4f2fb8)' }} />
            <div style={{ padding: '24px 28px 28px' }}>
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--text-secondary)',
                  display: 'block',
                  marginBottom: 20,
                }}
              >
                Hiring Pipeline
              </Text>

              {stats.total > 0 ? (
                <Row gutter={[20, 20]} align="middle">
                  {/* Selection-rate gauge */}
                  <Col xs={24} md={7} style={{ textAlign: 'center' }} className="animate-scale-in">
                    <Progress
                      type="dashboard"
                      percent={selectionRate}
                      strokeColor="#4f2fb8"
                      trailColor={isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)'}
                      size={130}
                      format={(p) => (
                        <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)' }}>{p}%</span>
                      )}
                    />
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginTop: 6 }}>
                      Selection Rate
                    </div>
                    <Tooltip title="Selected ÷ (Selected + Rejected)">
                      <div style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'monospace' }}>
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
                            className="pipeline-tile"
                            style={{
                              borderRadius: 10,
                              border: `1px solid ${st.color}33`,
                              background: `${st.color}0d`,
                              padding: '12px 14px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 12,
                              animationDelay: `${0.15 + idx * 0.06}s`,
                            }}
                          >
                            <span style={{ color: st.color, fontSize: 20, lineHeight: 1 }}>{st.icon}</span>
                            <div>
                              <div style={{ fontSize: 22, fontWeight: 700, color: st.color, lineHeight: 1.1 }}>
                                {pipeline[st.key]}
                              </div>
                              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-2)' }}>
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
                <div style={{ marginTop: 22, borderTop: '1px solid var(--border-light)', paddingTop: 16 }}>
                  <Text style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-secondary)', display: 'block', marginBottom: 10 }}>
                    Current stage
                    <Tooltip title="Where candidates are right now, from the Candidate Pipeline. The tiles above summarise final outcomes instead, which is why the totals differ.">
                      <span style={{ marginLeft: 6, cursor: 'help', opacity: 0.6 }}>ⓘ</span>
                    </Tooltip>
                  </Text>
                  <Space size={[8, 10]} wrap>
                    {(byStage.stages || []).map((s) => (
                      <Tag key={s.stage_key} color="blue" style={{ padding: '4px 10px', fontSize: 13, borderRadius: 8 }}>
                        {s.stage_label}: <strong>{s.count}</strong>
                      </Tag>
                    ))}
                    {byStage.closed > 0 && (
                      <Tooltip title="Journeys that have reached a final outcome — joined, withdrawn, rejected outright.">
                        <Tag color="purple" style={{ padding: '4px 10px', fontSize: 13, borderRadius: 8 }}>
                          Closed: <strong>{byStage.closed}</strong>
                        </Tag>
                      </Tooltip>
                    )}
                    {byStage.untracked > 0 && (
                      <Tooltip title="Submitted but never entered the pipeline — not yet shortlisted, or uploaded before the stage engine existed. Their Status column is the only signal available.">
                        <Tag style={{ padding: '4px 10px', fontSize: 13, borderRadius: 8 }}>
                          Not in pipeline: <strong>{byStage.untracked}</strong>
                        </Tag>
                      </Tooltip>
                    )}
                  </Space>
                </div>
              )}

              {/* Detailed raw status breakdown */}
              {stats.byFinalStatus && stats.byFinalStatus.length > 0 && (
                <div style={{ marginTop: 22, borderTop: '1px solid var(--border-light)', paddingTop: 16 }}>
                  <Text style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-secondary)', display: 'block', marginBottom: 10 }}>
                    Detailed status
                  </Text>
                  <Space size={[8, 10]} wrap>
                    {stats.byFinalStatus.map((item) => (
                      <Tag
                        key={item.status}
                        color={statusColor(item.status)}
                        style={{ padding: '4px 10px', fontSize: 13, borderRadius: 8 }}
                      >
                        {item.status}: <strong>{item.count}</strong>
                      </Tag>
                    ))}
                  </Space>
                </div>
              )}
            </div>
          </Card>

          {/* ═══════ SECTION 3: RECENT SUBMISSIONS ═══════ */}
          <Card className="animate-fade-in-up stagger-4" bordered={false} style={{ ...SECTION_CARD_STYLE, marginBottom: 0 }}>
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 12,
              marginBottom: 20,
            }}>
              <div>
                <Text strong style={{ fontSize: 16, display: 'block' }}>
                  Recent Submissions
                </Text>
                <Text style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: 'monospace' }}>
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
          </Card>
        </>
      )}
    </div>
  );
}
