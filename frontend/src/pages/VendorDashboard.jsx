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
import vendorService from '../services/vendorService';

const { Title, Text } = Typography;

/** Shared card chrome — matches the Vendor Upload (VendorPortal) screen. */
const SECTION_CARD_STYLE = {
  background: '#ffffff',
  border: '1px solid rgba(0,0,0,0.07)',
  borderRadius: 12,
  marginBottom: 24,
  boxShadow: '0 2px 16px rgba(0,0,0,0.04)',
  overflow: 'hidden',
};

const EMPTY_STATS = { total: 0, withPosition: 0, thisMonth: 0, byFinalStatus: [] };

/**
 * Animate a number from 0 up to `target` (eased). Re-runs whenever the target
 * changes — e.g. when staff switch to a different vendor.
 */
function useCountUp(target, duration = 750) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const safeTarget = Number(target) || 0;
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setValue(Math.round(safeTarget * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

/** Elegant animated KPI card — colour-themed via CSS custom properties. */
function KpiCard({ icon, label, value, color, tint, accent, index }) {
  const display = useCountUp(value);
  return (
    <div
      className="kpi-card"
      style={{
        '--kpi-color': color,
        '--kpi-tint': tint,
        '--kpi-accent': accent,
        animationDelay: `${index * 0.08}s`,
      }}
    >
      <span className="kpi-card__glow" />
      <span className="kpi-card__icon">{icon}</span>
      <span className="kpi-card__label">{label}</span>
      <span className="kpi-card__value">{display}</span>
    </div>
  );
}

/** KPI card definitions — keyed to fields on the dashboard `stats` object. */
const KPI_CARDS = [
  {
    key: 'total',
    label: 'Total Candidates',
    icon: <TeamOutlined />,
    color: '#7a922e',
    tint: 'rgba(122,146,46,0.12)',
    accent: 'linear-gradient(90deg,#7a922e,#92a63c)',
  },
  {
    key: 'thisMonth',
    label: 'Added This Month',
    icon: <RiseOutlined />,
    color: '#4a7c59',
    tint: 'rgba(74,124,89,0.12)',
    accent: 'linear-gradient(90deg,#4a7c59,#6aa67c)',
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
  { key: 'selected', label: 'Selected / Joined', color: '#4a7c59', icon: <CheckCircleOutlined /> },
  { key: 'inProcess', label: 'In Process', color: '#7a922e', icon: <SyncOutlined /> },
  { key: 'onHold', label: 'On Hold', color: '#b6883a', icon: <PauseCircleOutlined /> },
  { key: 'rejected', label: 'Rejected / Dropped', color: '#c0392b', icon: <CloseCircleOutlined /> },
  { key: 'pending', label: 'Awaiting Screening', color: '#8a9270', icon: <ClockCircleOutlined /> },
];

export default function VendorDashboard() {
  const { user } = useAuth();
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
      setError(err?.response?.data?.message || 'Failed to load the dashboard. Please try again.');
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

  // Derive a hiring pipeline + selection rate from the status breakdown (no extra API call).
  const pipeline = (() => {
    const b = { selected: 0, inProcess: 0, onHold: 0, rejected: 0, pending: 0 };
    (stats.byFinalStatus || []).forEach(({ status, count }) => {
      b[classifyStatus(status)] += count;
    });
    return b;
  })();
  const decided = pipeline.selected + pipeline.rejected;
  const selectionRate = decided ? Math.round((pipeline.selected / decided) * 100) : 0;

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
            <div style={{ height: 3, background: 'linear-gradient(90deg, #7a922e, #4a7c59)' }} />
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
                      strokeColor="#4a7c59"
                      trailColor="rgba(0,0,0,0.06)"
                      size={130}
                      format={(p) => (
                        <span style={{ fontSize: 24, fontWeight: 700, color: '#3f3f3f' }}>{p}%</span>
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
            <div style={{ marginBottom: 20 }}>
              <Text strong style={{ fontSize: 16, display: 'block' }}>
                Recent Submissions
              </Text>
              <Text style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: 'monospace' }}>
                {isStaff
                  ? (selectedVendor ? "This vendor's most recent candidates." : 'Most recent candidates across all vendors.')
                  : 'Your most recently uploaded candidates.'}
              </Text>
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
