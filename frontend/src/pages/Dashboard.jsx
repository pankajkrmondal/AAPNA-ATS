/**
 * Dashboard — recruiter command centre.
 *
 * Built frontend-only on existing endpoints (see useDashboardData). Composed as four
 * bands, each a 24-column row: COMMAND (hero) · SIGNAL (four uniform KPIs) ·
 * ANALYSIS (trends, action queue, funnel, talent, agenda) · ACTIVITY (recruiter
 * breakdown, live feed, latest uploads, quick actions).
 *
 * Every widget has a fixed home. An earlier version moved widgets between rows
 * depending on whether data existed, which made the page's shape change with the
 * data — widgets own their empty states instead.
 *
 * Metric explanations live in constants/metricDefinitions.js and render through
 * <MetricInfo>, not as inline tooltip prose. Everything those tooltips show is written
 * for the recruiter reading the screen — no endpoint paths, no table or column names,
 * no roadmap notes. See the header of that file.
 *
 * THE GLOBAL FILTERS (range + role, both owned here) reach every graph on the page:
 * the four KPI card sparklines, Hiring Trends, and Talent Insights. They deliberately
 * do NOT change the KPI headline numbers, which are lifetime totals from the server —
 * so each card's footnote and hover text say which period they are describing, and the
 * range control's own tooltip says the totals stay put. A filter that silently moves
 * some numbers and not others is worse than one that explains itself.
 */
import { useMemo, useRef, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Row, Col, Card, Typography, Tooltip } from 'antd';
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
} from '@ant-design/icons';
import dayjs from 'dayjs';
import useAuth from '../hooks/useAuth';
import useBrand from '../hooks/useBrand';
import useDashboardData from '../hooks/useDashboardData';
import useLiveActivity from '../hooks/useLiveActivity';
import usePointerSpotlight from '../hooks/usePointerSpotlight';
import {
  sparkPoints,
  cumulativePoints,
  sampleCoversWindow,
  periodOverPeriod,
} from '../utils/dashboardAggregations';

import StatCard from '../components/common/StatCard';
import DashboardHero from '../components/dashboard/DashboardHero';
import HiringTrendsCard from '../components/dashboard/HiringTrendsCard';
import ConversionFunnelCard from '../components/dashboard/ConversionFunnelCard';
import TopRolesSkillsCard from '../components/dashboard/TopRolesSkillsCard';
import RecruiterBreakdownCard from '../components/dashboard/RecruiterBreakdownCard';
import ActionCenterCard from '../components/dashboard/ActionCenterCard';
import LiveActivityFeed from '../components/dashboard/LiveActivityFeed';
import UpcomingInterviews from '../components/dashboard/UpcomingInterviews';
import LatestUploads from '../components/dashboard/LatestUploads';
import CommandPalette from '../components/dashboard/CommandPalette';

const { Title, Text } = Typography;

/** Quick-action shortcuts — each gated by the same module permission keys as before. */
const QUICK_ACTIONS = [
  { label: 'Candidate Screening', url: '/filtering', moduleKey: 'candidate_screening', icon: <FilterOutlined />, color: '#d97706', desc: 'Find the best-fit candidates with AI skill matching, custom score criteria, and advanced filters.' },
  { label: 'Recruitment Analytics', url: '/analytics', moduleKey: 'screening_analytics', icon: <BarChartOutlined />, color: '#e11d48', desc: 'Track recruitment performance — shortlisted, rejected, on-hold and total candidate insights.' },
  { label: 'New MRF Request', url: '/mrf', moduleKey: 'new_mrf', icon: <PlusOutlined />, color: '#7a922e', desc: 'Raise a new Manpower Requisition Form to kick off hiring for a specific role.' },
  { label: 'Search & Edit Candidates', url: '/candidates', moduleKey: 'search_candidates', icon: <SearchOutlined />, color: '#7a922e', desc: 'Search the candidate database, open profiles, and update candidate information.' },
  { label: 'HR Manual Upload', url: '/hr-upload', moduleKey: 'hr_manual_upload', icon: <UploadOutlined />, color: '#2563eb', desc: 'Manually upload candidate resumes to parse and store them for future hiring.' },
  { label: 'Vendor Upload', url: '/vendor', moduleKey: 'vendor_upload', icon: <CloudUploadOutlined />, color: '#4f46e5', desc: 'Upload and manage vendor-sourced resumes and documents for third-party hiring.' },
  { label: 'System Configuration', url: '/settings', moduleKey: 'system_config', icon: <SettingOutlined />, color: '#b45309', desc: 'Configure system processes, automation rules, and recruitment settings.' },
];

// KPI_TOOLTIPS used to live here as a local const keyed by display string. Those
// definitions now live in constants/metricDefinitions.js so that one registry covers
// every number on the page (and every number the backend insight work will add),
// rather than tooltip prose being scattered across ten widget files.

export default function Dashboard() {
  const { user } = useAuth();
  const { brand } = useBrand();
  const navigate = useNavigate();

  /** Cursor-tracked spotlight for every `.spotlight` surface on the page. One
   *  delegated listener here rather than a handler per card — see the hook. */
  const pageRef = useRef(null);
  usePointerSpotlight(pageRef);

  // ── Advanced data (existing endpoints, parallel) + live socket feed ──
  const {
    stats, funnel, candidates: aggCandidates, pendingMrfs, pipeline, roles,
    recruiterBreakdown, loading: statsLoading,
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

  // The dashboard's own paginated candidate fetch is gone: it duplicated
  // /candidates (worse — no search, no filters) and ran a second query on every
  // visit for decoration. LatestUploads now shows five rows from the purpose-built
  // /dashboard/recent-uploads endpoint and links to the real records surface.

  // Module permission check (admins bypass)
  const isModuleEnabled = (moduleKey) => {
    if ((user?.role || '').toLowerCase() === 'admin') return true;
    return (user?.permissions || []).includes(moduleKey);
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

  // Daily series over the SELECTED window, from the role-filtered set — see the KPI
  // note below for why both of those matter.
  const addedPoints = useMemo(
    () => sparkPoints(filteredCandidates, rangeDays),
    [filteredCandidates, rangeDays],
  );
  const addedInRange = useMemo(
    () => addedPoints.reduce((a, p) => a + p.value, 0),
    [addedPoints],
  );
  const wow = useMemo(
    () => periodOverPeriod(filteredCandidates, rangeDays),
    [filteredCandidates, rangeDays],
  );

  // Action-center derived counts
  const awaitingScreening = Math.max(0, (funnel.sourced || 0) - (funnel.aiScreened || 0));
  const interviewsToday = useMemo(() => {
    const tk = dayjs().format('YYYY-MM-DD');
    return (pipeline || []).filter(
      (r) => r.interview_start_at && dayjs(r.interview_start_at).format('YYYY-MM-DD') === tk,
    ).length;
  }, [pipeline]);

  /** KPI cards — UNIFORM anatomy: icon, delta chip, label, value, footnote, sparkline.
   *
   *  Every card carries a REAL series over the SELECTED window, derived from a batch
   *  this page already fetches. Two things about that are load-bearing:
   *
   *  1. THE GRAPHS FOLLOW THE FILTERS. They used to be pinned to `sparkSeries(…, 7)`
   *     on the unfiltered candidate list, so moving the range control between 7d/30d/
   *     90d or picking a role changed the chart below and left all four card graphs
   *     sitting there identical. A control that visibly does nothing reads as a broken
   *     page. Range and role now flow into every series, delta and footnote here.
   *  2. NO TWO CARDS DRAW THE SAME LINE. Total Candidates and Today's Uploads were
   *     handed the same array — literally the same variable — so half the row was a
   *     duplicate. Total Candidates now plots the running TOTAL (the headline number's
   *     own history), which is what that card's line should have been all along.
   *
   *  That running total is only truthful when the sample reaches back past the start
   *  of the window and no role filter is narrowing it against an all-roles total, so
   *  it falls back to the per-day rate when either fails. Whichever it is, the card's
   *  `chart` sentence says so in words rather than leaving the reader to guess. */
  const mrfPoints = useMemo(() => {
    const rows = (pendingMrfs || [])
      .filter((m) => !role || (m.role || '').toLowerCase() === role.toLowerCase())
      .map((m) => ({ createdAt: m.created_at || m.createdAt }));
    return sparkPoints(rows, rangeDays);
  }, [pendingMrfs, rangeDays, role]);

  const shortlistPoints = useMemo(() => {
    const rows = (pipeline || [])
      .filter((p) => !role || (p.job_title || p.role || '').toLowerCase() === role.toLowerCase())
      .map((p) => ({ createdAt: p.created_at || p.createdAt || p.modified_at }));
    return sparkPoints(rows, rangeDays);
  }, [pipeline, rangeDays, role]);

  // Running total for the Total Candidates card — see the note above for the guards.
  const totalIsCumulative = !role && sampleCoversWindow(normCandidates, rangeDays);
  const totalPoints = useMemo(
    () => (totalIsCumulative
      ? cumulativePoints(normCandidates, rangeDays, stats.totalCandidates)
      : addedPoints),
    [totalIsCumulative, normCandidates, rangeDays, stats.totalCandidates, addedPoints],
  );

  const shortlistRate = funnel.sourced
    ? Math.round((stats.shortlisted / funnel.sourced) * 100)
    : null;

  /** One phrasing of the selected period, so every footnote and hover on the row
   *  describes it in the same words. */
  const rangeLabel = `the last ${rangeDays} days`;
  /** Appended ONLY to figures that are genuinely role-filtered. The counts that come
   *  from the server (open requisitions, shortlist rate) cover all roles whatever the
   *  picker says, and labelling them "Java Developer only" would be a plain untruth —
   *  they carry "all roles" instead so the difference is visible rather than implied. */
  const roleSuffix = role ? ` · ${role} only` : '';
  const allRolesSuffix = role ? ' · all roles' : '';

  const kpiCards = [
    {
      metric: 'totalCandidates',
      title: 'Total Candidates',
      value: stats.totalCandidates,
      icon: <TeamOutlined />,
      color: '#7a922e',
      delta: wow.deltaPct !== null
        ? {
          value: wow.deltaPct,
          label: `${wow.current} added in ${rangeLabel}, against ${wow.previous} in the ${rangeDays} days before that`,
        }
        : null,
      footnote: `${addedInRange.toLocaleString()} added in ${rangeLabel}${roleSuffix}`,
      sparklineData: totalPoints,
      sparklineUnit: totalIsCumulative ? 'candidates in total' : 'added',
      chart: totalIsCumulative
        ? `How the total has grown day by day over ${rangeLabel}.`
        : `New candidates added per day over ${rangeLabel}${role ? `, for ${role}` : ''}. The number above covers all roles and all time.`,
    },
    {
      metric: 'activeMRFs',
      title: 'Active MRFs',
      value: stats.activeMRFs,
      icon: <FileTextOutlined />,
      color: '#2563eb',
      footnote: `${stats.pendingApprovalMRFs} awaiting approval${allRolesSuffix}`,
      sparklineData: mrfPoints,
      sparklineUnit: 'raised',
      chart: `New requisitions raised per day over ${rangeLabel}${role ? `, for ${role}` : ''}. The number above is every open requisition, however old.`,
    },
    {
      metric: 'todayUploads',
      title: "Today's Uploads",
      value: stats.todayUploads,
      icon: <CalendarOutlined />,
      color: '#d97706',
      footnote: `${addedInRange.toLocaleString()} in ${rangeLabel}${roleSuffix}`,
      sparklineData: addedPoints,
      sparklineUnit: 'uploaded',
      chart: `Uploads per day over ${rangeLabel}${role ? `, for ${role}` : ''}, so today reads in context.`,
    },
    {
      metric: 'shortlisted',
      title: 'Shortlisted',
      value: stats.shortlisted,
      icon: <CheckCircleOutlined />,
      color: '#16a34a',
      footnote: shortlistRate !== null ? `${shortlistRate}% of sourced${allRolesSuffix}` : 'of all sourced candidates',
      sparklineData: shortlistPoints,
      sparklineUnit: 'entered the pipeline',
      chart: `Candidates entering the interview pipeline per day over ${rangeLabel}${role ? `, for ${role}` : ''}. The number above is everyone currently shortlisted.`,
    },
  ];


  /** Greeting name — the person's FULL name as recorded, not just their first field.
   *
   *  History, because this has been wrong twice:
   *   1. It was `user?.firstName || user?.username`. `firstName` (camelCase) does not
   *      exist — /auth/me spreads the raw rpa_users row, so the fields are
   *      `first_name` / `last_name`. It therefore always fell through to the username
   *      and rendered "Good evening, harish.mopuri".
   *   2. Fixing it to read `first_name` surfaced a second problem: some records hold an
   *      abbreviated first name (e.g. "Har"), so greeting on that field alone still
   *      looked truncated.
   *
   *  Using first + last shows everything on record. If the result still looks short,
   *  the name in the user record itself is short — correct it in Admin Portal > Users;
   *  no display logic can recover a name the row does not contain. */
  const greetingName = useMemo(() => {
    const first = (user?.first_name ?? user?.firstName ?? '').toString().trim();
    const last = (user?.last_name ?? user?.lastName ?? '').toString().trim();
    const full = [first, last].filter(Boolean).join(' ');
    if (full) return full;

    // No name on record: fall back to the login handle, but make it addressable —
    // "harish.mopuri" becomes "Harish" rather than being shown raw.
    const handle = (user?.username || '').trim();
    if (!handle) return 'there';
    const token = handle.split(/[._\-\s]+/).filter(Boolean)[0] || handle;
    return token.charAt(0).toUpperCase() + token.slice(1);
  }, [user]);

  return (
    <div ref={pageRef} className="animate-fade-in" style={{ maxWidth: 1320, margin: '0 auto' }}>
      {/* ---- Hero ---- */}
      <DashboardHero
        firstName={greetingName}
        eyebrow={brand.heroEyebrow}
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

      {/* ---- SIGNAL BAND: four KPIs, identical anatomy ---- */}
      <Row gutter={[20, 20]} className="dash-band">
        {kpiCards.map((kpi, idx) => (
          <Col xs={24} sm={12} xl={6} key={kpi.title}>
            <div className={`animate-fade-in-up stagger-${idx + 1}`} style={{ height: '100%' }}>
              <StatCard
                metric={kpi.metric}
                title={kpi.title}
                value={kpi.value}
                icon={kpi.icon}
                color={kpi.color}
                loading={statsLoading}
                delta={kpi.delta}
                footnote={kpi.footnote}
                sparklineData={kpi.sparklineData}
                sparklineUnit={kpi.sparklineUnit}
                sparklineSummary={kpi.chart}
                chartNote={kpi.chart}
              />
            </div>
          </Col>
        ))}
      </Row>

      {/* ---- ANALYSIS BAND ----
           Every band below is a 24-column row that sums to 24 at xl, on a repeating
           16/8 rhythm with one 8/8/8. The previous layout changed shape four times
           (16/8 → 8/8/8 → 24 → conditional 8/16) and moved widgets between rows
           depending on whether data existed, which is what made the page read as
           assembled rather than composed. Widgets now have fixed homes and render
           their own empty states. */}
      <Row gutter={[20, 20]} className="dash-band">
        <Col xs={24} xl={16}>
          <HiringTrendsCard candidates={filteredCandidates} rangeDays={rangeDays} role={role} loading={statsLoading} />
        </Col>
        <Col xs={24} xl={8}>
          <ActionCenterCard
            pendingMrfCount={stats.pendingApprovalMRFs}
            reviewCount={reviewCount}
            awaitingScreening={awaitingScreening}
            interviewsToday={interviewsToday}
            onNavigate={navigate}
          />
        </Col>
      </Row>

      <Row gutter={[20, 20]} className="dash-band">
        <Col xs={24} lg={12} xl={8}>
          <ConversionFunnelCard funnel={funnel} pipeline={pipeline} loading={statsLoading} />
        </Col>
        <Col xs={24} lg={12} xl={8}>
          <TopRolesSkillsCard candidates={filteredCandidates} />
        </Col>
        <Col xs={24} xl={8}>
          <UpcomingInterviews pipeline={pipeline} onNavigate={navigate} />
        </Col>
      </Row>

      {/* ---- ACTIVITY BAND ---- */}
      <Row gutter={[20, 20]} className="dash-band">
        <Col xs={24} xl={16}>
          <RecruiterBreakdownCard data={recruiterBreakdown} />
        </Col>
        <Col xs={24} xl={8}>
          <LiveActivityFeed events={liveEvents} />
        </Col>
      </Row>

      <Row gutter={[20, 20]} className="dash-band">
        <Col xs={24} xl={16}>
          <LatestUploads onNavigate={navigate} />
        </Col>
        <Col xs={24} xl={8}>
          {/* Quick actions as a single-column launcher. In a 2-column grid the seven
              items always left a permanent empty cell; one column has no hole at any
              count, and a vertical list is the better pattern for a launcher anyway. */}
          <Card bordered={false} className="glass-card dash-chart-card spotlight" styles={{ body: { padding: 22 } }}>
            <div className="dash-card-head">
              <div>
                <Title level={5} style={{ margin: 0 }}>Quick Actions</Title>
                <Text type="secondary" style={{ fontSize: 12.5 }}>Jump into your modules</Text>
              </div>
            </div>
            <div className="dash-qa">
              {QUICK_ACTIONS.map((action) => {
                const enabled = isModuleEnabled(action.moduleKey);
                const tip = enabled ? action.desc : `${action.desc} — you don't have access to this module.`;
                return (
                  <Tooltip key={action.moduleKey} title={tip} mouseEnterDelay={0.3} placement="left" overlayStyle={{ maxWidth: 260 }}>
                    <div
                      className={`quick-action-row ${enabled ? 'enabled' : ''}`}
                      role="button"
                      tabIndex={enabled ? 0 : -1}
                      aria-disabled={!enabled}
                      onClick={() => enabled && navigate(action.url)}
                      onKeyDown={(e) => { if (enabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); navigate(action.url); } }}
                      style={{ '--qa-color': action.color, opacity: enabled ? 1 : 0.5, cursor: enabled ? 'pointer' : 'not-allowed' }}
                    >
                      <span className="quick-action-row__icon">{action.icon}</span>
                      <Text style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{action.label}</Text>
                      {enabled
                        ? <ArrowRightOutlined className="qa-arrow" style={{ color: action.color, fontSize: 12 }} />
                        : <LockOutlined style={{ color: 'var(--text-2)', fontSize: 12 }} />}
                    </div>
                  </Tooltip>
                );
              })}
            </div>
          </Card>
        </Col>
      </Row>

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
