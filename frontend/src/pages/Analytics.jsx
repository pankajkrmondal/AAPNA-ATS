import { useState, useEffect, useMemo } from 'react';
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
  Button
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
  RiseOutlined
} from '@ant-design/icons';
import screeningService from '../services/screeningService';
import DeliveryMonitoring from '../components/email/DeliveryMonitoring';
// Phase 3 walkthrough prototype tab — remove with the prototype page.
import { CandidatePipelineAnalyticsPreview } from './CandidatePipelinePrototype';

const { Title, Text } = Typography;

/**
 * Analytics.jsx — "Recruitment Analytics", the curated analytics-only page.
 *
 * Rebuilt from the pre-rebrand page (preserved as `AnalyticsLegacy.jsx`,
 * still reachable at /analytics-legacy) by dropping everything operational
 * — candidate search/status editing, Zeko interview scheduling/cancelling,
 * the Outlook conversation viewer — and keeping only what's genuinely
 * analytics, plus a new mock "Recruiter Insights (Preview)" tab.
 *
 * This page is interim, not a final destination: it's expected to be
 * deprecated once Phase 3 Module 1 ships the real Pipeline Tracker and
 * pipeline analytics becomes a live tab here instead of a mock preview
 * (see docs/phase3/03-DEVELOPMENT-PLAN.md).
 */

const RECRUITER_STAGE_DAYS = [
  { stage: 'Shortlisted', days: 3 },
  { stage: 'HR Screening (Zeko)', days: 4 },
  { stage: 'IQ / Tech Assessment', days: 5 },
  { stage: 'Functional (Zeko)', days: 3 },
  { stage: 'Interview Rounds', days: 8 },
  { stage: 'Offer', days: 4 },
];
const TOTAL_TIME_TO_HIRE = RECRUITER_STAGE_DAYS.reduce((sum, s) => sum + s.days, 0);
const MAX_STAGE_DAYS = Math.max(...RECRUITER_STAGE_DAYS.map((s) => s.days));

const SOURCE_BREAKDOWN = [
  { key: 'hr', source: 'HR upload', submitted: 64, shortlisted: 26, rejected: 30, onHold: 8 },
  { key: 'vendor', source: 'Placement vendor', submitted: 41, shortlisted: 14, rejected: 22, onHold: 5 },
  { key: 'email', source: 'Email intake', submitted: 22, shortlisted: 6, rejected: 13, onHold: 3 },
];

const VENDOR_LEADERBOARD = [
  { key: 'v1', vendor: 'TechBridge Solutions', submitted: 27, shortlisted: 11 },
  { key: 'v2', vendor: 'Talent Hive', submitted: 19, shortlisted: 6 },
  { key: 'v3', vendor: 'Prime Staffing Co.', submitted: 14, shortlisted: 3 },
];

/**
 * RecruiterInsightsPreview — new mock/illustrative panels (time-to-hire,
 * source-of-hire, vendor performance). 100% static sample data, same spirit
 * as CandidatePipelineAnalyticsPreview — not wired to real records yet.
 */
function RecruiterInsightsPreview() {
  return (
    <>
      <Alert type="warning" showIcon style={{ marginBottom: 14 }}
        message="Preview — mock data illustrating what recruiter-facing hiring-trend analytics could show; not wired to live records yet." />
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="Time-to-hire" extra={<Text type="secondary" style={{ fontSize: 12 }}>avg days per stage</Text>}
            style={{ marginBottom: 16 }}>
            <Statistic title="Average days, shortlist to offer" value={TOTAL_TIME_TO_HIRE} suffix="days" style={{ marginBottom: 16 }} />
            <Space direction="vertical" size={7} style={{ width: '100%' }}>
              {RECRUITER_STAGE_DAYS.map(({ stage, days }) => (
                <Row key={stage} gutter={10} align="middle" wrap={false}>
                  <Col flex="170px" style={{ textAlign: 'right' }}>
                    <Text type="secondary" style={{ fontSize: 12.5 }}>{stage}</Text>
                  </Col>
                  <Col flex="auto">
                    <div style={{ height: 18, width: `${Math.max((days / MAX_STAGE_DAYS) * 100, 4)}%`, background: 'var(--gold, #7a922e)', borderRadius: '0 4px 4px 0', opacity: 0.85 }} />
                  </Col>
                  <Col flex="60px"><Text strong>{days}d</Text></Col>
                </Row>
              ))}
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Vendor performance" extra={<Text type="secondary" style={{ fontSize: 12 }}>leaderboard</Text>}
            style={{ marginBottom: 16 }}>
            <Table size="small" pagination={false} rowKey="key"
              columns={[
                { title: 'Vendor', dataIndex: 'vendor' },
                { title: 'Submitted', dataIndex: 'submitted', align: 'center', width: 100 },
                { title: 'Shortlisted', dataIndex: 'shortlisted', align: 'center', width: 100 },
                {
                  title: 'Shortlist rate', key: 'rate', align: 'center', width: 120,
                  render: (_, r) => <Tag color="green">{Math.round((r.shortlisted / r.submitted) * 100)}%</Tag>,
                },
              ]}
              dataSource={VENDOR_LEADERBOARD} />
          </Card>
        </Col>
      </Row>
      <Card title="Source of hire" extra={<Text type="secondary" style={{ fontSize: 12 }}>conversion by source</Text>}>
        <Table size="small" pagination={false} rowKey="key"
          columns={[
            { title: 'Source', dataIndex: 'source' },
            { title: 'Submitted', dataIndex: 'submitted', align: 'center' },
            { title: 'Shortlisted', dataIndex: 'shortlisted', align: 'center' },
            { title: 'Rejected', dataIndex: 'rejected', align: 'center' },
            { title: 'On Hold', dataIndex: 'onHold', align: 'center' },
            {
              title: 'Shortlist rate', key: 'rate', align: 'center',
              render: (_, r) => <Tag color="blue">{Math.round((r.shortlisted / r.submitted) * 100)}%</Tag>,
            },
          ]}
          dataSource={SOURCE_BREAKDOWN} />
      </Card>
    </>
  );
}

export default function Analytics() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({ pipeline: [], candidates: [], tiles: {} });
  const [activeTab, setActiveTab] = useState('analytics');

  useEffect(() => {
    fetchMainData();
  }, []);

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
      render: (text) => <Tag color="default">MRF #{text || 'N/A'}</Tag>
    },
    {
      title: 'Shortlisted',
      dataIndex: 'shortlisted',
      key: 'shortlisted',
      align: 'center',
      render: (count) => <Badge count={count} showZero color="var(--gold)" />
    },
    {
      title: 'Rejected',
      dataIndex: 'rejected',
      key: 'rejected',
      align: 'center',
      render: (count) => <Badge count={count} showZero color="var(--red)" />
    },
    {
      title: 'On Hold',
      dataIndex: 'on_hold',
      key: 'on_hold',
      align: 'center',
      render: (count) => <Badge count={count} showZero color="#95a5a6" />
    },
    {
      title: 'Total Candidates',
      dataIndex: 'total',
      key: 'total',
      align: 'center',
      render: (count) => <Text strong style={{ fontSize: 14 }}>{count}</Text>
    }
  ];

  // Tile items
  const tilesData = [
    { title: 'Shortlisted', value: data.tiles?.shortlisted || 0, icon: <TeamOutlined />, color: 'var(--gold)', bg: 'rgba(122, 146, 46, 0.08)' },
    { title: 'Rejected', value: data.tiles?.rejected || 0, icon: <CloseCircleOutlined />, color: 'var(--red)', bg: 'rgba(192, 57, 43, 0.08)' },
    { title: 'On Hold', value: data.tiles?.on_hold || 0, icon: <ClockCircleOutlined />, color: '#95a5a6', bg: 'rgba(149, 165, 166, 0.08)' },
    { title: 'Total', value: data.tiles?.total || 0, icon: <BarChartOutlined />, color: 'var(--text)', bg: 'var(--gold-subtle)' },
    { title: 'Zeko Sent', value: data.tiles?.zeko_sent || 0, icon: <SendOutlined />, color: '#185fa5', bg: 'rgba(24, 95, 165, 0.08)' },
    { title: 'Zeko Passed', value: data.tiles?.zeko_passed || 0, icon: <CheckCircleOutlined />, color: '#27ae60', bg: 'rgba(39, 174, 96, 0.08)' },
  ];

  return (
    <div className="stagger-children" style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* Page Header */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Title level={3} style={{ fontWeight: 800, margin: 0 }}>
            Recruitment Analytics
          </Title>
          <Text type="secondary">
            Track recruitment performance and hiring trends across roles, sources, and vendors.
          </Text>
        </div>
        <Button
          type="primary"
          onClick={fetchMainData}
          loading={loading}
          style={{ background: 'var(--gold)', borderColor: 'var(--gold)', height: 40, borderRadius: 8 }}
        >
          Refresh Data
        </Button>
      </div>

      {/* Stats Tiles */}
      <Row gutter={[16, 16]} style={{ marginBottom: 28 }}>
        {tilesData.map((tile, idx) => (
          <Col xs={12} sm={12} md={8} lg={4} key={idx}>
            <Card
              bordered={false}
              className="glass"
              style={{
                borderRadius: 12,
                background: tile.bg,
                border: '1px solid var(--border-light)',
                padding: '12px 16px',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                boxShadow: 'var(--shadow-sm)'
              }}
              bodyStyle={{ padding: 0, width: '100%' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {tile.title}
                  </Text>
                  <Title level={3} style={{ margin: '4px 0 0', fontWeight: 800, color: tile.color }}>
                    {tile.value}
                  </Title>
                </div>
                <div style={{ fontSize: 24, color: tile.color, opacity: 0.85 }}>
                  {tile.icon}
                </div>
              </div>
            </Card>
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
                <Table
                  dataSource={roleStats}
                  columns={analyticsColumns}
                  loading={loading}
                  pagination={{ pageSize: 10 }}
                  locale={{ emptyText: <Empty description="No shortlisted roles found" /> }}
                />
              )
            },
            {
              // Phase 3 walkthrough prototype tab (mock data) — remove with the prototype page.
              key: 'pipeline',
              label: (
                <span>
                  <ApartmentOutlined className="tab-ico" />
                  Pipeline Insights (Preview)
                </span>
              ),
              children: <CandidatePipelineAnalyticsPreview />
            },
            {
              key: 'recruiterInsights',
              label: (
                <span>
                  <RiseOutlined className="tab-ico" />
                  Recruiter Insights (Preview)
                </span>
              ),
              children: <RecruiterInsightsPreview />
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
