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
import pipelineService from '../services/pipeline';
import DeliveryMonitoring from '../components/email/DeliveryMonitoring';

const { Title, Text } = Typography;

/**
 * Analytics.jsx — "Recruitment Analytics", the curated analytics-only page.
 *
 * Rebuilt from the pre-rebrand page (preserved as `AnalyticsLegacy.jsx`,
 * still reachable at /analytics-legacy) by dropping everything operational
 * — candidate search/status editing, Zeko interview scheduling/cancelling,
 * the Outlook conversation viewer — and keeping only what's genuinely
 * analytics.
 *
 * "Pipeline Insights" and "Recruiter Insights" below are wired to the real
 * Phase 3 Module 1 backend (/api/pipeline/analytics, pipeline.service.js's
 * getPipelineAnalytics) — they replaced the hardcoded mock data that lived
 * here before Module 1 shipped.
 */

const SHARED_SOURCE = <Text type="secondary" style={{ fontSize: 12 }}>from the Pipeline Tracker</Text>;

/**
 * PipelineInsights — stage funnel, stuck candidates, rejection reasons.
 * Sourced from GET /api/pipeline/analytics (pipeline.service.js).
 */
function PipelineInsights() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await pipelineService.getAnalytics();
        if (!cancelled) setData(res.data?.data || res.data);
      } catch (err) {
        if (!cancelled) setErrored(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (errored) {
    return <Alert type="error" showIcon message="Failed to load pipeline analytics." />;
  }

  const tiles = data?.tiles || {};
  const funnel = data?.funnel || { stages: [], mrf_label: null };
  const maxFunnel = Math.max(1, ...(funnel.stages.map((f) => f.count)));

  return (
    <>
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} lg={6}><Card loading={loading}><Statistic title="Active in pipeline" value={tiles.active_in_pipeline ?? 0} /></Card></Col>
        <Col xs={12} lg={6}>
          <Card loading={loading}>
            <Statistic title="Awaiting feedback" value={tiles.awaiting_feedback ?? 0} />
            <Text type="secondary" style={{ fontSize: 11.5 }}>Needs Module 3 (scorecards) to populate</Text>
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card loading={loading}>
            <Statistic title={`On hold > ${tiles.hold_threshold_days ?? 30} days`} value={tiles.on_hold_over_threshold ?? 0} />
          </Card>
        </Col>
        <Col xs={12} lg={6}><Card loading={loading}><Statistic title="Offers pending" value={tiles.offers_pending ?? 0} /></Card></Col>
      </Row>

      <Card
        title={funnel.mrf_label ? `Stage funnel — ${funnel.mrf_label}` : 'Stage funnel'}
        loading={loading}
        style={{ marginBottom: 16 }}
      >
        {funnel.stages.length === 0 ? (
          <Empty description="No candidates in the pipeline yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Space direction="vertical" size={7} style={{ width: '100%' }}>
            {funnel.stages.map((f, i) => (
              <Row key={f.stage_key} gutter={10} align="middle" wrap={false}>
                <Col flex="180px" style={{ textAlign: 'right' }}>
                  <Text type="secondary" style={{ fontSize: 12.5 }}>{f.label}</Text>
                </Col>
                <Col flex="auto">
                  <div style={{ height: 20, width: `${Math.max((f.count / maxFunnel) * 100, 2)}%`, background: 'var(--gold, #7a922e)', borderRadius: '0 4px 4px 0', opacity: 0.88 }} />
                </Col>
                <Col flex="110px">
                  <Text strong>{f.count}</Text>
                  {i > 0 && funnel.stages[i - 1].count > 0 && (
                    <Text type="secondary" style={{ fontSize: 12 }}> · {Math.round((f.count / funnel.stages[i - 1].count) * 100)}%</Text>
                  )}
                </Col>
              </Row>
            ))}
          </Space>
        )}
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="Stuck candidates" extra={SHARED_SOURCE} loading={loading}>
            <Table size="small" pagination={false} rowKey="pipeline_id"
              columns={[
                { title: 'Candidate', dataIndex: 'candidate_name' },
                { title: 'Stage', dataIndex: 'stage' },
                { title: 'Days', dataIndex: 'days', width: 60 },
                { title: 'Status', dataIndex: 'blocked_on', render: (b) => <Tag color="gold">{b}</Tag> },
              ]}
              dataSource={data?.stuckCandidates || []}
              locale={{ emptyText: <Empty description="No stuck candidates" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={`Rejection reasons — last ${data?.rejectionWindowDays ?? 30} days`} extra={SHARED_SOURCE} loading={loading}>
            <Table size="small" pagination={false} rowKey="reason"
              columns={[
                { title: 'Reason', dataIndex: 'reason' },
                { title: 'Count', dataIndex: 'count', width: 70 },
                { title: 'Most common stage', dataIndex: 'most_common_stage' },
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
 * RecruiterInsights — time-to-hire, vendor performance, source-of-hire.
 * Sourced from GET /api/pipeline/analytics (pipeline.service.js).
 */
function RecruiterInsights() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await pipelineService.getAnalytics();
        if (!cancelled) setData(res.data?.data || res.data);
      } catch (err) {
        if (!cancelled) setErrored(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

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
          <Card title="Time-to-hire" extra={<Text type="secondary" style={{ fontSize: 12 }}>avg days per stage, closed journeys only</Text>}
            loading={loading} style={{ marginBottom: 16 }}>
            <Statistic title="Average days, shortlist to offer" value={timeToHire.total_days} suffix="days" style={{ marginBottom: 16 }} />
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
                      <div style={{ height: 18, width: `${Math.max((avg_days / maxStageDays) * 100, 4)}%`, background: 'var(--gold, #7a922e)', borderRadius: '0 4px 4px 0', opacity: 0.85 }} />
                    </Col>
                    <Col flex="60px"><Text strong>{avg_days}d</Text></Col>
                  </Row>
                ))}
              </Space>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Vendor performance" extra={<Text type="secondary" style={{ fontSize: 12 }}>leaderboard</Text>}
            loading={loading} style={{ marginBottom: 16 }}>
            <Table size="small" pagination={false} rowKey="vendor_email"
              columns={[
                { title: 'Vendor', dataIndex: 'vendor_email' },
                { title: 'Submitted', dataIndex: 'submitted', align: 'center', width: 100 },
                { title: 'Shortlisted', dataIndex: 'shortlisted', align: 'center', width: 100 },
                {
                  title: 'Shortlist rate', dataIndex: 'shortlist_rate', align: 'center', width: 120,
                  render: (rate) => <Tag color="green">{rate}%</Tag>,
                },
              ]}
              dataSource={vendorPerformance}
              locale={{ emptyText: <Empty description="No vendor-sourced journeys yet" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
          </Card>
        </Col>
      </Row>
      <Card title="Source of hire" extra={<Text type="secondary" style={{ fontSize: 12 }}>conversion by source</Text>} loading={loading}>
        <Table size="small" pagination={false} rowKey="source"
          columns={[
            { title: 'Source', dataIndex: 'source' },
            { title: 'Submitted', dataIndex: 'submitted', align: 'center' },
            { title: 'Shortlisted', dataIndex: 'shortlisted', align: 'center' },
            { title: 'Rejected', dataIndex: 'rejected', align: 'center' },
            { title: 'On Hold', dataIndex: 'on_hold', align: 'center' },
            {
              title: 'Shortlist rate', dataIndex: 'shortlist_rate', align: 'center',
              render: (rate) => <Tag color="blue">{rate}%</Tag>,
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
              // Phase 3 Module 1 — real pipeline analytics (GET /api/pipeline/analytics).
              key: 'pipeline',
              label: (
                <span>
                  <ApartmentOutlined className="tab-ico" />
                  Pipeline Insights
                </span>
              ),
              children: <PipelineInsights />
            },
            {
              key: 'recruiterInsights',
              label: (
                <span>
                  <RiseOutlined className="tab-ico" />
                  Recruiter Insights
                </span>
              ),
              children: <RecruiterInsights />
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
