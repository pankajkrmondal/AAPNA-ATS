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
} from 'antd';
import {
  ReloadOutlined,
  ShopOutlined,
  TeamOutlined,
  RiseOutlined,
  AimOutlined,
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

/** Map a FinalStatus value to a tag colour for quick visual scanning. */
function statusColor(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('select') || s.includes('hired') || s.includes('offer')) return 'green';
  if (s.includes('reject')) return 'red';
  if (s.includes('hold')) return 'orange';
  if (s.includes('pending') || s === '') return 'default';
  return 'blue';
}

export default function VendorDashboard() {
  const { user } = useAuth();
  const role = (user?.role || '').toLowerCase();
  // Internal staff review a chosen vendor; vendors view their own submissions.
  const isStaff = ['admin', 'superadmin', 'recruiter'].includes(role);

  const [loading, setLoading] = useState(!isStaff);
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
    // Staff must select a vendor before any data is fetched.
    if (isStaff && !selectedVendor) {
      setStats(EMPTY_STATS);
      setRecent([]);
      setError(null);
      setLoading(false);
      return;
    }
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
      render: (v) => <Tag color={statusColor(v)}>{v && v.trim() !== '' ? v : 'Pending'}</Tag>,
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

  const needsVendorSelection = isStaff && !selectedVendor;

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
              ? 'Review the candidate submissions of a selected vendor'
              : "Status overview of the candidates you've submitted"}
          </Text>
        </div>

        {isStaff && (
          <Select
            showSearch
            allowClear
            value={selectedVendor}
            onChange={(val) => setSelectedVendor(val || null)}
            placeholder="Select a vendor"
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

      {needsVendorSelection ? (
        <Card bordered={false} style={SECTION_CARD_STYLE} styles={{ body: { padding: 0 } }}>
          <div style={{ height: 3, background: 'linear-gradient(90deg, #7a922e, #92a63c)' }} />
          <div style={{ padding: '48px 28px' }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Select a vendor above to view their candidate submissions"
            />
          </div>
        </Card>
      ) : loading ? (
        <div style={{ textAlign: 'center', padding: '80px 0' }}>
          <Spin size="large" />
        </div>
      ) : (
        <>
          {/* ═══════ SECTION 1: SUMMARY STATS ═══════ */}
          <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
            {KPI_CARDS.map((kpi, i) => (
              <Col xs={24} sm={8} key={kpi.key}>
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

          {/* ═══════ SECTION 2: STATUS BREAKDOWN ═══════ */}
          <Card bordered={false} style={SECTION_CARD_STYLE} styles={{ body: { padding: 0 } }}>
            <div style={{ height: 3, background: 'linear-gradient(90deg, #7a922e, #92a63c)' }} />
            <div style={{ padding: '24px 28px 28px' }}>
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--text-secondary)',
                  display: 'block',
                  marginBottom: 16,
                }}
              >
                Candidates by Status
              </Text>
              {stats.byFinalStatus && stats.byFinalStatus.length > 0 ? (
                <Space size={[10, 12]} wrap>
                  {stats.byFinalStatus.map((item) => (
                    <Tag
                      key={item.status}
                      color={statusColor(item.status)}
                      style={{ padding: '5px 12px', fontSize: 14, borderRadius: 8 }}
                    >
                      {item.status}: <strong>{item.count}</strong>
                    </Tag>
                  ))}
                </Space>
              ) : (
                <Empty description="No candidates submitted yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </div>
          </Card>

          {/* ═══════ SECTION 3: RECENT SUBMISSIONS ═══════ */}
          <Card bordered={false} style={{ ...SECTION_CARD_STYLE, marginBottom: 0 }}>
            <div style={{ marginBottom: 20 }}>
              <Text strong style={{ fontSize: 16, display: 'block' }}>
                Recent Submissions
              </Text>
              <Text style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: 'monospace' }}>
                {isStaff ? "This vendor's most recent candidates." : 'Your most recently uploaded candidates.'}
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
