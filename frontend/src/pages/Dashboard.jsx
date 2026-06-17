/**
 * Dashboard Page — Modern app-style KPI overview.
 * Greeting header + KPI stat cards + pipeline funnel + quick actions + recent candidates.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Row, Col, Card, Table, Button, Typography, Modal, Space, Tooltip } from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  UploadOutlined,
  SettingOutlined,
  CloudUploadOutlined,
  FilterOutlined,
  BarChartOutlined,
  FileTextOutlined,
  LockOutlined,
  TeamOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ArrowRightOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import useAuth from '../hooks/useAuth';
import candidateService from '../services/candidateService';
import dashboardService from '../services/dashboardService';
import StatCard from '../components/common/StatCard';

const { Title, Text } = Typography;

/** Quick-action shortcuts — each gated by the same module permission keys as before. */
const QUICK_ACTIONS = [
  { label: 'Candidate Screening', url: '/filtering', moduleKey: 'candidate_screening', icon: <FilterOutlined />, color: '#d97706', desc: 'Find the best-fit candidates with AI skill matching, custom score criteria, and advanced filters.' },
  { label: 'Screening Analytics', url: '/analytics', moduleKey: 'screening_analytics', icon: <BarChartOutlined />, color: '#e11d48', desc: 'Track recruitment performance — shortlisted, rejected, on-hold and total candidate insights.' },
  { label: 'New MRF Request', url: '/mrf', moduleKey: 'new_mrf', icon: <PlusOutlined />, color: '#7a922e', desc: 'Raise a new Manpower Requisition Form to kick off hiring for a specific role.' },
  { label: 'Search & Edit Candidates', url: '/candidates', moduleKey: 'search_candidates', icon: <SearchOutlined />, color: '#7a922e', desc: 'Search the candidate database, open profiles, and update candidate information.' },
  { label: 'HR Manual Upload', url: '/hr-upload', moduleKey: 'hr_upload', icon: <UploadOutlined />, color: '#2563eb', desc: 'Manually upload candidate resumes to parse and store them for future hiring.' },
  { label: 'Vendor Upload', url: '/vendor', moduleKey: 'vendor_upload', icon: <CloudUploadOutlined />, color: '#4f46e5', desc: 'Upload and manage vendor-sourced resumes and documents for third-party hiring.' },
  { label: 'System Configuration', url: '/settings', moduleKey: 'system_config', icon: <SettingOutlined />, color: '#b45309', desc: 'Configure system processes, automation rules, and recruitment settings.' },
];

/** Pipeline funnel stages — keys map to the funnel object from dashboardService.getStats(). */
const FUNNEL_STAGES = [
  { key: 'sourced', label: 'Sourced', gradient: 'linear-gradient(90deg, #0284c7 0%, #0ea5e9 100%)', desc: 'Every candidate sourced into the system across all roles and channels.' },
  { key: 'aiScreened', label: 'AI Screened', gradient: 'linear-gradient(90deg, #7a922e 0%, #92a63c 100%)', desc: 'Candidates whose profiles have been analysed and scored by the AI screening engine.' },
  { key: 'shortlisted', label: 'Shortlisted', gradient: 'linear-gradient(90deg, #d97706 0%, #f59e0b 100%)', desc: 'Candidates advanced to the shortlist and approved for the interview pipeline.' },
  { key: 'hired', label: 'Hired', gradient: 'linear-gradient(90deg, #16a34a 0%, #22c55e 100%)', desc: 'Candidates who accepted an offer or have joined.' },
];

/** Detailed explanatory tooltip text for each KPI metric. */
const KPI_TOOLTIPS = {
  'Total Candidates': 'Every CV in the system across all roles and sources.',
  'Active MRFs': 'Manpower Requisition Forms currently pending, awaiting, or approved.',
  "Today's Uploads": 'Candidate CVs added to the system since midnight today.',
  'Shortlisted': 'Candidates moved to a shortlisted / selected pipeline stage.',
};

function greetingForNow() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 10;

  const [stats, setStats] = useState({
    totalCandidates: 0,
    activeMRFs: 0,
    todayUploads: 0,
    shortlisted: 0,
  });
  const [funnelStats, setFunnelStats] = useState({
    sourced: 0,
    aiScreened: 0,
    shortlisted: 0,
    hired: 0,
  });
  const [statsLoading, setStatsLoading] = useState(true);

  // Load dashboard stats (KPIs + funnel)
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await dashboardService.getStats();
        const statsData = res.data?.data || res.data;
        if (statsData) {
          setStats({
            totalCandidates: statsData.totalCandidates || 0,
            activeMRFs: statsData.activeMRFs || 0,
            todayUploads: statsData.todayUploads || 0,
            shortlisted: statsData.shortlisted || 0,
          });
          if (statsData.funnel) setFunnelStats(statsData.funnel);
        }
      } catch (err) {
        console.error('Failed to load dashboard stats', err);
      } finally {
        setStatsLoading(false);
      }
    };
    fetchStats();
  }, []);

  // Load recent candidates
  useEffect(() => {
    const fetchCandidates = async () => {
      setLoading(true);
      try {
        const res = await candidateService.search({}, page, pageSize);
        const candidateList = Array.isArray(res.data?.data)
          ? res.data.data
          : (res.data?.data?.data || res.data?.data?.candidates || res.data || []);

        const paginationObj = res.data?.pagination || res.data?.data?.pagination || {};
        const totalCount = paginationObj.total || res.data?.total || candidateList.length;

        setCandidates(candidateList);
        setTotal(totalCount);
      } catch (err) {
        console.error('Failed to load recent candidates', err);
      } finally {
        setLoading(false);
      }
    };
    fetchCandidates();
  }, [page]);

  // Module permission check
  const isModuleEnabled = (moduleKey) => {
    if ((user?.role || '').toLowerCase() === 'admin') return true;
    return (user?.permissions || []).includes(moduleKey);
  };

  const handleDownloadResume = (cvFileUrl) => {
    if (!cvFileUrl || cvFileUrl === 'null' || cvFileUrl === 'undefined' || String(cvFileUrl).trim() === '') {
      Modal.warning({
        title: '⚠️ Alert',
        content: 'Resume is not available for this candidate right now.',
        okButtonProps: { style: { background: '#7a922e', borderColor: '#7a922e' } },
      });
      return;
    }
    const link = document.createElement('a');
    link.href = cvFileUrl;
    link.download = '';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const kpiCards = [
    { title: 'Total Candidates', value: stats.totalCandidates, icon: <TeamOutlined />, color: '#7a922e' },
    { title: 'Active MRFs', value: stats.activeMRFs, icon: <FileTextOutlined />, color: '#2563eb' },
    { title: "Today's Uploads", value: stats.todayUploads, icon: <CalendarOutlined />, color: '#d97706' },
    { title: 'Shortlisted', value: stats.shortlisted, icon: <CheckCircleOutlined />, color: '#16a34a' },
  ];

  const maxFunnel = Math.max(1, ...FUNNEL_STAGES.map((s) => funnelStats[s.key] || 0));

  const tableColumns = [
    {
      title: 'Name',
      key: 'name',
      render: (_, record) => {
        const nameVal = record.Name || record.name || '—';
        const expVal = record.TotalExperienceYears || record.experience;
        const qualVal = record.HighestQualification || record.education;

        let subtext = '';
        if (expVal) subtext += `${expVal} yrs`;
        if (expVal && qualVal) subtext += ' • ';
        if (qualVal) subtext += qualVal;

        return (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <Text strong style={{ fontSize: 13.5, color: 'var(--text)' }}>{nameVal}</Text>
            {subtext && <Text type="secondary" style={{ fontSize: 11.5, marginTop: 2 }}>{subtext}</Text>}
          </div>
        );
      },
    },
    {
      title: 'Email',
      key: 'email',
      render: (_, record) => {
        const emailVal = record.EmailID || record.email || '—';
        return <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text)' }}>{emailVal}</span>;
      },
    },
    {
      title: 'Role',
      key: 'role',
      render: (_, record) => {
        const roleVal = record.PositionApplied || record.position || '—';
        return <span style={{ color: 'var(--text)', fontWeight: 500 }}>{roleVal}</span>;
      },
    },
    {
      title: 'Applied On',
      key: 'applied_on',
      render: (_, record) => {
        const dateVal = record.createdAt || record.created_at;
        return (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text-2)' }}>
            {dateVal ? dateVal.split('T')[0] : '—'}
          </span>
        );
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      align: 'right',
      render: (_, record) => {
        const fileUrl = record.cvFileUrl || record.cv_file_url || '';
        const isResumeOk = fileUrl && fileUrl !== 'null' && fileUrl !== 'undefined' && String(fileUrl).trim() !== '';
        return (
          <Button
            size="small"
            icon={<FileTextOutlined />}
            onClick={() => handleDownloadResume(fileUrl)}
            style={{
              borderRadius: 6,
              background: isResumeOk ? '#eef3da' : '#f5f5f0',
              color: isResumeOk ? '#7a922e' : '#a0aa84',
              borderColor: isResumeOk ? '#b8cc6e' : '#dde1df',
            }}
            title="Download Resume"
          />
        );
      },
    },
  ];

  const firstName = user?.firstName || user?.username || 'there';

  return (
    <div className="animate-fade-in" style={{ maxWidth: 1320, margin: '0 auto' }}>
      {/* ---- Premium welcome band ---- */}
      <div
        style={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 20,
          padding: '32px 36px',
          marginBottom: 28,
          background:
            'linear-gradient(135deg, var(--colorBgContainer) 0%, var(--gold-bg) 100%)',
          border: '1px solid var(--border-light)',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        {/* Floating decorative accents */}
        <div
          className="animate-float-slow"
          style={{
            position: 'absolute', top: '-40%', right: '-4%', width: 360, height: 360,
            borderRadius: '50%', pointerEvents: 'none', zIndex: 0,
            background: 'radial-gradient(circle, rgba(122, 146, 46,0.14) 0%, transparent 70%)',
          }}
        />
        <div
          style={{
            position: 'absolute', bottom: '-50%', left: '20%', width: 280, height: 280,
            borderRadius: '50%', pointerEvents: 'none', zIndex: 0,
            background: 'radial-gradient(circle, rgba(122,146,46,0.10) 0%, transparent 70%)',
          }}
        />

        <div
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 20,
          }}
        >
          <div style={{ minWidth: 260 }}>
            <span
              style={{
                display: 'inline-block', background: 'var(--colorBgContainer)', color: 'var(--gold)',
                fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase',
                padding: '4px 12px', borderRadius: 999, marginBottom: 14, border: '1px solid var(--border)',
              }}
            >
              AAPNA Recruitment Operations
            </span>
            <Title level={2} style={{ margin: '0 0 8px', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
              {greetingForNow()}, {firstName} 👋
            </Title>
            <Text style={{ fontSize: 15, color: 'var(--text-2)', lineHeight: 1.6 }}>
              Here's what's happening across your recruitment pipeline today.
            </Text>
          </div>

          <Space size={12} wrap>
            {isModuleEnabled('new_mrf') && (
              <Button
                type="primary"
                size="large"
                icon={<PlusOutlined />}
                className="cta-primary"
                onClick={() => navigate('/mrf')}
                style={{ height: 46, borderRadius: 10, fontWeight: 600, paddingInline: 22 }}
              >
                New MRF Request
              </Button>
            )}
            {isModuleEnabled('candidate_screening') && (
              <Button
                size="large"
                icon={<FilterOutlined />}
                className="cta-secondary"
                onClick={() => navigate('/filtering')}
                style={{ height: 46, borderRadius: 10, fontWeight: 600, paddingInline: 22, borderColor: 'var(--gold)', color: 'var(--gold)' }}
              >
                Screen Candidates
              </Button>
            )}
          </Space>
        </div>
      </div>

      {/* ---- KPI cards ---- */}
      <Row gutter={[20, 20]} style={{ marginBottom: 24 }}>
        {kpiCards.map((kpi, idx) => (
          <Col xs={24} sm={12} lg={6} key={kpi.title}>
            <Tooltip title={KPI_TOOLTIPS[kpi.title]} mouseEnterDelay={0.3} overlayStyle={{ maxWidth: 260 }}>
              <div className={`animate-fade-in-up stagger-${idx + 1}`}>
                <StatCard
                  title={kpi.title}
                  value={kpi.value}
                  icon={kpi.icon}
                  color={kpi.color}
                  loading={statsLoading}
                />
              </div>
            </Tooltip>
          </Col>
        ))}
      </Row>

      {/* ---- Funnel + Quick Actions ---- */}
      <Row gutter={[20, 20]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={15}>
          <Card
            bordered={false}
            className="glass-card"
            style={{ height: '100%' }}
            styles={{ body: { padding: 24 } }}
          >
            <Space size={6} align="center" style={{ marginBottom: 2 }}>
              <Title level={5} style={{ margin: 0 }}>Pipeline Funnel</Title>
              <Tooltip title="Live conversion of candidates from sourced through hired, based on current pipeline data." mouseEnterDelay={0.3} overlayStyle={{ maxWidth: 280 }}>
                <InfoCircleOutlined style={{ color: 'var(--text-2)', fontSize: 13, cursor: 'help' }} />
              </Tooltip>
            </Space>
            <Text type="secondary" style={{ fontSize: 13, display: 'block' }}>From sourced to hired</Text>

            <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
              {FUNNEL_STAGES.map((stage) => {
                const val = funnelStats[stage.key] || 0;
                const pct = Math.round((val / maxFunnel) * 100);
                return (
                  <Tooltip key={stage.key} title={stage.desc} mouseEnterDelay={0.3} placement="top" overlayStyle={{ maxWidth: 280 }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <Text style={{ fontSize: 13, fontWeight: 500 }}>{stage.label}</Text>
                        <Text style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--mono)' }}>
                          {val.toLocaleString()}
                        </Text>
                      </div>
                      <div
                        className={statsLoading ? 'shimmer' : ''}
                        style={{
                          height: 14,
                          borderRadius: 999,
                          background: 'var(--gold-subtle)',
                          overflow: 'hidden',
                          boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.08)',
                        }}
                      >
                        {!statsLoading && (
                          <div
                            style={{
                              width: `${pct}%`,
                              minWidth: val > 0 ? 28 : 0,
                              height: '100%',
                              borderRadius: 999,
                              background: stage.gradient,
                              transition: 'width 0.9s var(--ease-out-quint)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'flex-end',
                              paddingRight: 8,
                            }}
                          >
                            {val > 0 && (
                              <span style={{ fontSize: 9.5, fontWeight: 700, color: '#fff', letterSpacing: '0.04em' }}>
                                {pct}%
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </Tooltip>
                );
              })}
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={9}>
          <Card
            bordered={false}
            className="glass-card"
            style={{ height: '100%' }}
            styles={{ body: { padding: 24 } }}
          >
            <Space size={6} align="center" style={{ marginBottom: 16 }}>
              <Title level={5} style={{ margin: 0 }}>Quick Actions</Title>
              <Tooltip title="Jump straight into the recruitment modules you have access to." mouseEnterDelay={0.3} overlayStyle={{ maxWidth: 260 }}>
                <InfoCircleOutlined style={{ color: 'var(--text-2)', fontSize: 13, cursor: 'help' }} />
              </Tooltip>
            </Space>
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              {QUICK_ACTIONS.map((action) => {
                const enabled = isModuleEnabled(action.moduleKey);
                const tip = enabled ? action.desc : `${action.desc} — you don't have access to this module.`;
                return (
                  <Tooltip key={action.moduleKey} title={tip} mouseEnterDelay={0.3} placement="left" overlayStyle={{ maxWidth: 260 }}>
                    <div
                      className={`quick-action-row ${enabled ? 'enabled' : ''}`}
                      onClick={() => enabled && navigate(action.url)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: '1px solid var(--border-light)',
                        cursor: enabled ? 'pointer' : 'not-allowed',
                        opacity: enabled ? 1 : 0.5,
                        background: 'var(--colorBgContainer)',
                      }}
                      onMouseEnter={(e) => { if (enabled) e.currentTarget.style.borderColor = action.color; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-light)'; }}
                    >
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 9,
                          background: `linear-gradient(135deg, ${action.color} 0%, ${action.color}cc 100%)`,
                          color: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 16,
                          flexShrink: 0,
                          boxShadow: `0 3px 8px ${action.color}44`,
                        }}
                      >
                        {action.icon}
                      </div>
                      <Text style={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>{action.label}</Text>
                      {enabled
                        ? <ArrowRightOutlined className="qa-arrow" style={{ color: action.color, fontSize: 12 }} />
                        : <LockOutlined style={{ color: 'var(--text-2)', fontSize: 12 }} />}
                    </div>
                  </Tooltip>
                );
              })}
            </Space>
          </Card>
        </Col>
      </Row>

      {/* ---- Recent Candidates ---- */}
      <Card
        bordered={false}
        style={{
          background: 'var(--colorBgContainer)',
          border: '1px solid var(--border-light)',
          borderRadius: 12,
          boxShadow: 'var(--shadow-sm)',
        }}
        styles={{ body: { padding: 24 } }}
      >
        <Space size={6} align="center" style={{ marginBottom: 16 }}>
          <Title level={5} style={{ margin: 0 }}>Recent Candidates</Title>
          <Tooltip title="The most recently added candidates across all roles. Use the action button to download a résumé." mouseEnterDelay={0.3} overlayStyle={{ maxWidth: 280 }}>
            <InfoCircleOutlined style={{ color: 'var(--text-2)', fontSize: 13, cursor: 'help' }} />
          </Tooltip>
        </Space>
        <Table
          dataSource={candidates}
          columns={tableColumns}
          rowKey={(record) => record.id || record.EmailID || Math.random().toString()}
          loading={loading}
          pagination={{
            current: page,
            pageSize: pageSize,
            total: total,
            onChange: setPage,
            showSizeChanger: false,
          }}
          size="middle"
        />
      </Card>
    </div>
  );
}
