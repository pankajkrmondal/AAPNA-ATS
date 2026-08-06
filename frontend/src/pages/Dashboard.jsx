/**
 * Dashboard — Advanced recruiter command center.
 *
 * Built frontend-only on existing endpoints (see useDashboardData): animated hero with
 * global filters + ⌘K palette, KPI cards with sparklines/deltas, hiring trends, conversion
 * funnel, talent insights, action center, live activity feed, upcoming interviews, quick
 * actions, and the original recent-candidates table (preserved with its own pagination).
 */
import { useEffect, useMemo, useState } from 'react';
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
import dayjs from 'dayjs';
import useAuth from '../hooks/useAuth';
import candidateService from '../services/candidateService';
import useDashboardData from '../hooks/useDashboardData';
import useLiveActivity from '../hooks/useLiveActivity';
import {
  sparkSeries,
  weekOverWeek,
  upcomingInterviews,
} from '../utils/dashboardAggregations';

import StatCard from '../components/common/StatCard';
import DashboardHero from '../components/dashboard/DashboardHero';
import HiringTrendsCard from '../components/dashboard/HiringTrendsCard';
import ConversionFunnelCard from '../components/dashboard/ConversionFunnelCard';
import TopRolesSkillsCard from '../components/dashboard/TopRolesSkillsCard';
import ActionCenterCard from '../components/dashboard/ActionCenterCard';
import LiveActivityFeed from '../components/dashboard/LiveActivityFeed';
import UpcomingInterviews from '../components/dashboard/UpcomingInterviews';
import CommandPalette from '../components/dashboard/CommandPalette';

const { Title, Text } = Typography;

/** Quick-action shortcuts — each gated by the same module permission keys as before. */
const QUICK_ACTIONS = [
  { label: 'Candidate Screening', url: '/filtering', moduleKey: 'candidate_screening', icon: <FilterOutlined />, color: '#d97706', desc: 'Find the best-fit candidates with AI skill matching, custom score criteria, and advanced filters.' },
  { label: 'Screening Analytics', url: '/analytics', moduleKey: 'screening_analytics', icon: <BarChartOutlined />, color: '#e11d48', desc: 'Track recruitment performance — shortlisted, rejected, on-hold and total candidate insights.' },
  { label: 'New MRF Request', url: '/mrf', moduleKey: 'new_mrf', icon: <PlusOutlined />, color: '#7a922e', desc: 'Raise a new Manpower Requisition Form to kick off hiring for a specific role.' },
  { label: 'Search & Edit Candidates', url: '/candidates', moduleKey: 'search_candidates', icon: <SearchOutlined />, color: '#7a922e', desc: 'Search the candidate database, open profiles, and update candidate information.' },
  { label: 'HR Manual Upload', url: '/hr-upload', moduleKey: 'hr_manual_upload', icon: <UploadOutlined />, color: '#2563eb', desc: 'Manually upload candidate resumes to parse and store them for future hiring.' },
  { label: 'Vendor Upload', url: '/vendor', moduleKey: 'vendor_upload', icon: <CloudUploadOutlined />, color: '#4f46e5', desc: 'Upload and manage vendor-sourced resumes and documents for third-party hiring.' },
  { label: 'System Configuration', url: '/settings', moduleKey: 'system_config', icon: <SettingOutlined />, color: '#b45309', desc: 'Configure system processes, automation rules, and recruitment settings.' },
];

/** Detailed explanatory tooltip text for each KPI metric. */
const KPI_TOOLTIPS = {
  'Total Candidates': 'Every CV in the system across all roles and sources.',
  'Active MRFs': 'Manpower Requisition Forms currently pending, awaiting, or approved.',
  "Today's Uploads": 'Candidate CVs added to the system since midnight today.',
  'Shortlisted': 'Candidates moved to a shortlisted / selected pipeline stage.',
};

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // ── Advanced data (existing endpoints, parallel) + live socket feed ──
  const {
    stats, funnel, candidates: aggCandidates, pendingMrfs, pipeline, roles, loading: statsLoading,
  } = useDashboardData();
  const { events: liveEvents, reviewCount } = useLiveActivity();

  // ── Global filters ──
  const [rangeDays, setRangeDays] = useState(30);
  const [role, setRole] = useState('');

  // ── ⌘K command palette ──
  const [cmdOpen, setCmdOpen] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Recent candidates table (preserved: its own paginated fetch) ──
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 10;

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

  // Module permission check (admins bypass)
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

  // ── Normalize the aggregation batch (tolerate mapped OR raw DB field names) ──
  const normCandidates = useMemo(
    () => aggCandidates.map((c) => ({
      position: c.position || c.PositionApplied || '',
      skills: c.skills ?? c.Top5KeySkills ?? [],
      createdAt: c.createdAt || c.created_at || c.CreatedAt,
    })),
    [aggCandidates],
  );

  // Apply the role filter for the trend & talent widgets
  const filteredCandidates = useMemo(() => {
    if (!role) return normCandidates;
    const r = role.toLowerCase();
    return normCandidates.filter((c) => (c.position || '').toLowerCase() === r);
  }, [normCandidates, role]);

  // KPI sparkline + week-over-week delta (candidate-based metrics only)
  const spark = useMemo(() => sparkSeries(normCandidates, 7), [normCandidates]);
  const wow = useMemo(() => weekOverWeek(normCandidates), [normCandidates]);

  // Action-center derived counts
  const awaitingScreening = Math.max(0, (funnel.sourced || 0) - (funnel.aiScreened || 0));
  const interviewsToday = useMemo(() => {
    const tk = dayjs().format('YYYY-MM-DD');
    return (pipeline || []).filter(
      (r) => r.interview_start_at && dayjs(r.interview_start_at).format('YYYY-MM-DD') === tk,
    ).length;
  }, [pipeline]);
  const hasUpcoming = useMemo(() => upcomingInterviews(pipeline, 7).length > 0, [pipeline]);

  const kpiCards = [
    { title: 'Total Candidates', value: stats.totalCandidates, icon: <TeamOutlined />, color: '#7a922e', sparklineData: spark, delta: wow.deltaPct !== null ? { value: wow.deltaPct } : null },
    { title: 'Active MRFs', value: stats.activeMRFs, icon: <FileTextOutlined />, color: '#2563eb' },
    { title: "Today's Uploads", value: stats.todayUploads, icon: <CalendarOutlined />, color: '#d97706', sparklineData: spark },
    { title: 'Shortlisted', value: stats.shortlisted, icon: <CheckCircleOutlined />, color: '#16a34a' },
  ];

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
      {/* ---- Hero ---- */}
      <DashboardHero
        firstName={firstName}
        isModuleEnabled={isModuleEnabled}
        onNewMrf={() => navigate('/mrf')}
        onScreen={() => navigate('/filtering')}
        rangeDays={rangeDays}
        onRangeChange={setRangeDays}
        role={role}
        onRoleChange={setRole}
        roles={roles}
        onOpenCommand={() => setCmdOpen(true)}
      />

      {/* ---- KPI cards ---- */}
      <Row gutter={[20, 20]} style={{ marginBottom: 20 }}>
        {kpiCards.map((kpi, idx) => (
          <Col xs={24} sm={12} lg={6} key={kpi.title}>
            <Tooltip title={KPI_TOOLTIPS[kpi.title]} mouseEnterDelay={0.3} overlayStyle={{ maxWidth: 260 }}>
              <div className={`animate-fade-in-up stagger-${idx + 1}`} style={{ height: '100%' }}>
                <StatCard
                  title={kpi.title}
                  value={kpi.value}
                  icon={kpi.icon}
                  color={kpi.color}
                  loading={statsLoading}
                  sparklineData={kpi.sparklineData}
                  delta={kpi.delta}
                />
              </div>
            </Tooltip>
          </Col>
        ))}
      </Row>

      {/* ---- Trends + Action center ---- */}
      <Row gutter={[20, 20]} style={{ marginBottom: 20 }}>
        <Col xs={24} lg={16}>
          <HiringTrendsCard candidates={filteredCandidates} rangeDays={rangeDays} loading={statsLoading} />
        </Col>
        <Col xs={24} lg={8}>
          <ActionCenterCard
            pendingMrfCount={pendingMrfs.length}
            reviewCount={reviewCount}
            awaitingScreening={awaitingScreening}
            interviewsToday={interviewsToday}
            onNavigate={navigate}
          />
        </Col>
      </Row>

      {/* ---- Funnel + Talent insights + Interviews ---- */}
      <Row gutter={[20, 20]} style={{ marginBottom: 20 }}>
        <Col xs={24} lg={8}>
          <ConversionFunnelCard funnel={funnel} pipeline={pipeline} loading={statsLoading} />
        </Col>
        <Col xs={24} lg={8}>
          <TopRolesSkillsCard candidates={filteredCandidates} />
        </Col>
        <Col xs={24} lg={8}>
          {hasUpcoming || pipeline.length > 0
            ? <UpcomingInterviews pipeline={pipeline} onNavigate={navigate} />
            : <LiveActivityFeed events={liveEvents} />}
        </Col>
      </Row>

      {/* ---- Live activity + Quick actions ---- */}
      <Row gutter={[20, 20]} style={{ marginBottom: 20 }}>
        {(hasUpcoming || pipeline.length > 0) && (
          <Col xs={24} lg={8}>
            <LiveActivityFeed events={liveEvents} />
          </Col>
        )}
        <Col xs={24} lg={(hasUpcoming || pipeline.length > 0) ? 16 : 24}>
          <Card bordered={false} className="glass-card dash-chart-card" styles={{ body: { padding: 22 } }}>
            <div className="dash-card-head">
              <div>
                <Title level={5} style={{ margin: 0 }}>Quick Actions</Title>
                <Text type="secondary" style={{ fontSize: 12.5 }}>Jump into your recruitment modules</Text>
              </div>
            </div>
            <Row gutter={[10, 10]} style={{ marginTop: 14 }}>
              {QUICK_ACTIONS.map((action) => {
                const enabled = isModuleEnabled(action.moduleKey);
                const tip = enabled ? action.desc : `${action.desc} — you don't have access to this module.`;
                return (
                  <Col xs={24} sm={12} key={action.moduleKey}>
                    <Tooltip title={tip} mouseEnterDelay={0.3} placement="top" overlayStyle={{ maxWidth: 260 }}>
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
                            width: 36, height: 36, borderRadius: 9,
                            background: `linear-gradient(135deg, ${action.color} 0%, ${action.color}cc 100%)`,
                            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 16, flexShrink: 0, boxShadow: `0 3px 8px ${action.color}44`,
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
                  </Col>
                );
              })}
            </Row>
          </Card>
        </Col>
      </Row>

      {/* ---- Recent Candidates (preserved) ---- */}
      <Card
        bordered={false}
        className="dash-chart-card"
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

      {/* ---- ⌘K Command Palette ---- */}
      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onNavigate={navigate}
        isModuleEnabled={isModuleEnabled}
      />
    </div>
  );
}