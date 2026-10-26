import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Tabs,
  Typography,
  Select,
  Input,
  Button,
  Checkbox,
  Row,
  Col,
  Space,
  Tag,
  Badge,
  Drawer,
  Timeline,
  Collapse,
  Alert,
  DatePicker,
  Form,
  InputNumber,
  Spin,
  Tooltip,
  Divider,
  message,
  Avatar,
  Empty,
  Modal,
  notification,
  Pagination
} from 'antd';
import {
  UserOutlined,
  CalendarOutlined,
  SearchOutlined,
  CloseCircleOutlined,
  CheckCircleOutlined,
  MailOutlined,
  PhoneOutlined,
  EnvironmentOutlined,
  ArrowRightOutlined,
  StarFilled,
  WarningOutlined,
  UnorderedListOutlined,
  ClockCircleOutlined,
  RightOutlined,
  ThunderboltOutlined,
  SolutionOutlined,
  RiseOutlined,
  MessageOutlined,
  FileTextOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import useAuth from '../hooks/useAuth';
import screeningService from '../services/screeningService';
import { useApprovedRoles, useRoleCandidates, screeningKeys } from '../hooks/useScreeningData';
import StatusBadge from '../components/common/StatusBadge';
import SkillTags from '../components/common/SkillTags';
import ExportButton from '../components/common/ExportButton';
import LoadingOverlay from '../components/common/LoadingOverlay';
import DecisionEmailModal from '../components/screening/DecisionEmailModal';
import ShortlistResultModal from '../components/screening/ShortlistResultModal';
import JdTagChip from '../components/screening/JdTagChip';
import ActivityChip, { ACTIVITY_STYLES, activityHint } from '../components/screening/ActivityChip';
import ChangeJdModal from '../components/screening/ChangeJdModal';
import NotShownDrawer from '../components/screening/NotShownDrawer';
import ReferralChip from '../components/candidates/ReferralChip';
import { cleanMsgBody } from '../utils/emailText';
import { fmtDate, fmtDateTime } from '../utils/dateFormat';
import { mrfOptionLabel, closureReasonLabel } from '../utils/mrfLabel';

const { Title, Text, Paragraph } = Typography;

/**
 * Notice period as display text. NoticePeriodDays is the parsed number the
 * filters use; the raw NoticePeriod column is free text ("3 Months",
 * "Immediate"), which used to render as "3 Months days notice".
 */
const formatNotice = (c) => {
  if (!c) return null;
  if (c.NoticePeriodDays != null && c.NoticePeriodDays !== '') {
    const days = Number(c.NoticePeriodDays);
    return days === 0 ? 'Immediate joiner' : `${days} days notice`;
  }
  const raw = c.NoticePeriod == null ? '' : String(c.NoticePeriod).trim();
  if (!raw) return null;
  return /^\d+(\.\d+)?$/.test(raw) ? `${raw} days notice` : `${raw} notice`;
};

/**
 * "Added within" choices, shared by the Keyword and JD tabs (N38). The backend
 * caches JD results only for these values (utils/screeningCacheKeys.js).
 */
const ADDED_WITHIN_OPTIONS = [
  { value: 7, label: 'Last 7 days' },
  { value: 10, label: 'Last 10 days' },
  { value: 15, label: 'Last 15 days' },
  { value: 30, label: 'Last 1 month' },
  { value: 90, label: 'Last 3 months' },
];

/** Education filter checkboxes, grouped by the kind of role they suit. */
const EDUCATION_FILTER_GROUPS = [
  {
    key: 'tech',
    prefix: 'tech_',
    title: 'Technical Roles',
    options: [
      { value: 'tech_cs_it_mca_mtech', label: 'BE/B.Tech (CS/IT)/MCA/M.Tech' },
      { value: 'tech_other_it_msc_ms', label: 'BE/B.Tech (Other)/M.Sc IT/MS IT' },
      { value: 'tech_bca_bsc_it_grad', label: 'BCA/B.Sc IT/CS/IT Graduate' },
      { value: 'tech_non_it_grad', label: 'Non-IT Graduate' },
    ],
  },
  {
    key: 'fin',
    prefix: 'fin_',
    title: 'Accounts & Finance',
    options: [
      { value: 'fin_ca_mba_cma_icwa', label: 'CA/MBA Finance/CMA/ICWA' },
      { value: 'fin_mcom', label: 'M.Com' },
      { value: 'fin_bcom', label: 'B.Com' },
      { value: 'fin_any_other_grad', label: 'Any Other Graduate' },
    ],
  },
  {
    key: 'sales',
    prefix: 'sales_',
    title: 'Sales & HR Roles',
    options: [
      { value: 'sales_mba_be_btech_mca_it', label: 'MBA/BE/B.Tech/MCA/IT Graduate' },
      { value: 'sales_any_postgrad_non_it', label: 'Any Postgraduate (Non-IT)' },
      { value: 'sales_any_grad', label: 'Any Graduate' },
    ],
  },
];

const formatCurrentCompany = (companyStr) => {
  if (!companyStr) return null;
  const str = String(companyStr).trim();
  if (str === 'null' || str === 'undefined' || str === '{}') return null;
  
  // Try to parse it as JSON
  try {
    const parsed = JSON.parse(str);
    if (parsed && typeof parsed === 'object') {
      const name = parsed.Name || parsed.name;
      if (name && String(name).trim() !== 'null' && String(name).trim() !== '') {
        return String(name).trim();
      }
      return null;
    }
  } catch (e) {
    // Not valid JSON, process as plain string
  }

  let cleaned = str
    .replace(/^["'{}\s]+|["'{}\s]+$/g, '')
    .replace(/^Name:\s*/i, '');
  
  if (cleaned.toLowerCase() === 'null' || cleaned === '') {
    return null;
  }
  return cleaned;
};

// Friendly labels for the backend's required_qualification codes (role JD panel).
/** Strict JD search: where the experience band came from (Phase 3 N08). */
const BAND_SOURCE_LABELS = {
  jd: 'From the JD',
  mrf: 'MRF minimum (the JD gives no range)',
  none: 'Not set on the MRF',
};

/** "3 – 6 yrs", or "2 yrs or more" for an open band. */
const formatExperienceBand = (band) => (band.max != null
  ? `${band.min} – ${band.max} yrs`
  : `${band.min} yrs or more`);

const ROLE_QUAL_LABELS = {
  TECH_GRADUATE: 'BE / BTech / MCA / Any',
  POST_GRADUATE: 'Post Graduate',
  GRADUATE: 'Graduate',
  OTHER: 'Other',
  ANY: 'Any',
};

const parseTechnicalTerms = (techTerms) => {
  if (!techTerms) return [];
  try {
    const parsed = typeof techTerms === 'string' ? JSON.parse(techTerms) : techTerms;
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
};

// Visual style + explanation per JD-skill match status (display-only).
const JD_SKILL_STATUS = {
  evidenced: {
    color: 'var(--success-text)',
    bg: 'rgba(82, 196, 26, 0.10)',
    border: 'rgba(82, 196, 26, 0.35)',
    explain: (s) => `Mentioned in resume (×${s.count}) and listed in skills section`,
  },
  signals_only: {
    color: 'var(--info-strong)',
    bg: 'rgba(24, 144, 255, 0.10)',
    border: 'rgba(24, 144, 255, 0.35)',
    explain: (s) => `Found in resume (×${s.count}) but NOT in the candidate's declared skills section`,
  },
  listed_only: {
    color: 'var(--warn-text)',
    bg: 'rgba(250, 173, 20, 0.12)',
    border: 'rgba(250, 173, 20, 0.40)',
    explain: () => `Listed in skills section but not surfaced in resume signals`,
  },
  missing: {
    color: 'var(--text-3)',
    bg: 'var(--ink-4)',
    border: 'var(--border-light)',
    explain: () => `Not found in resume signals or declared skills`,
  },
};

const isPresent = (s) => s.status === 'evidenced' || s.status === 'signals_only';

// Renders the JD Skill Match for a candidate.
//  - variant="card"  → compact: a match meter + chips for PRESENT skills only (calm, premium).
//  - variant="full"  → drawer: the complete present + missing breakdown.
// Returns null when no JD signals are present (e.g. keyword-search results).
const JdSkillMatch = ({ signals, variant = 'full', label = 'Mandatory JD Skills' }) => {
  if (!signals) return null;
  const mandatory = Array.isArray(signals.mandatory) ? signals.mandatory : [];
  const goodToHave = Array.isArray(signals.goodToHave) ? signals.goodToHave : [];
  if (mandatory.length === 0 && goodToHave.length === 0) return null;

  // Skills mentioned in the resume but absent from the declared skills section — the recruiter's key signal.
  const signalsOnly = [...mandatory, ...goodToHave].filter((s) => s.status === 'signals_only');

  /* ---- Compact card variant: meter + present chips only ---- */
  if (variant === 'card') {
    const head = label.replace(/ JD Skills$/, '').replace(/ Skills$/, '');
    const mandPresent = mandatory.filter(isPresent);
    const gthPresent = goodToHave.filter(isPresent);
    const pct = mandatory.length ? Math.round((mandPresent.length / mandatory.length) * 100) : 0;
    const CAP = 5;
    const shown = mandPresent.slice(0, CAP);
    const extra = mandPresent.length - shown.length;

    const renderChip = (s, idx) => {
      const cls = s.status === 'signals_only' ? 'skill-chip skill-chip--signal' : 'skill-chip skill-chip--present';
      const style = JD_SKILL_STATUS[s.status] || JD_SKILL_STATUS.missing;
      return (
        <Tooltip key={`${s.skill}-${idx}`} title={style.explain(s)}>
          <span className={cls}>
            {s.skill}<span className="skill-chip__x">×{s.count}</span>
          </span>
        </Tooltip>
      );
    };

    return (
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 7 }}>
        {mandatory.length > 0 && (
          <div className="match-meter">
            <span className="match-meter__head">{head}</span>
            <span className="match-meter__bar"><span className="match-meter__fill" style={{ width: `${pct}%` }} /></span>
            <span className="match-meter__count">{mandPresent.length}/{mandatory.length}</span>
          </div>
        )}
        {(shown.length > 0 || goodToHave.length > 0) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {shown.map(renderChip)}
            {extra > 0 && <span className="skill-chip skill-chip--more">+{extra}</span>}
            {goodToHave.length > 0 && (
              <Tooltip title="Good-to-have skills present in resume">
                <span className="skill-chip">Good-to-have <span className="skill-chip__x">{gthPresent.length}/{goodToHave.length}</span></span>
              </Tooltip>
            )}
          </div>
        )}
        {signalsOnly.length > 0 && (
          <div className="cand-signal-hint">
            ⓘ In resume, not in declared skills: <strong>{signalsOnly.map((s) => s.skill).join(', ')}</strong>
          </div>
        )}
      </div>
    );
  }

  /* ---- Full variant (drawer): complete present + missing breakdown ---- */
  const renderTag = (s, idx, secondary) => {
    const style = JD_SKILL_STATUS[s.status] || JD_SKILL_STATUS.missing;
    return (
      <Tooltip key={`${s.skill}-${idx}`} title={style.explain(s)}>
        <Tag
          style={{
            margin: 0,
            fontSize: '11px',
            padding: '1px 6px',
            borderRadius: '4px',
            background: style.bg,
            border: `1px solid ${style.border}`,
            color: style.color,
            fontWeight: 500,
            opacity: secondary ? 0.85 : 1,
          }}
        >
          {s.skill}
          {isPresent(s) ? (
            <span style={{ opacity: 0.7, marginLeft: '3px', fontSize: '9.5px', fontWeight: 700 }}>×{s.count}</span>
          ) : s.status === 'listed_only' ? (
            <span style={{ opacity: 0.7, marginLeft: '3px', fontSize: '9px', fontWeight: 600 }}>listed</span>
          ) : (
            <span style={{ opacity: 0.6, marginLeft: '3px', fontSize: '9px', fontWeight: 600 }}>missing</span>
          )}
        </Tag>
      </Tooltip>
    );
  };

  return (
    <div style={{ marginTop: 6 }}>
      {mandatory.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-3)', fontWeight: 600 }}>{label}:</span>
          <Space size={[4, 6]} wrap>
            {mandatory.map((s, idx) => renderTag(s, idx, false))}
          </Space>
        </div>
      )}
      {goodToHave.length > 0 && (
        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-3)', fontWeight: 600 }}>Good-to-have:</span>
          <Space size={[4, 6]} wrap>
            {goodToHave.map((s, idx) => renderTag(s, idx, true))}
          </Space>
        </div>
      )}
      {signalsOnly.length > 0 && (
        <div style={{ marginTop: 5, fontSize: '11px', color: 'var(--info-strong)', lineHeight: 1.4 }}>
          ⓘ Found in resume but not in declared skills:{' '}
          <strong>{signalsOnly.map((s) => `${s.skill} (×${s.count})`).join(', ')}</strong>
        </div>
      )}
    </div>
  );
};

/**
 * Placeholder rows shaped like the real candidate cards, shown while a match
 * runs. Replaces a blank 200px spacer: an empty void made the wait feel longer
 * and let the page jump when results landed. Reuses the app-wide `.shimmer`
 * class so it animates like every other loading surface.
 */
function CandidateListSkeleton({ rows = 4 }) {
  const Bar = ({ w, h = 12, mb = 0 }) => (
    <div className="shimmer" style={{ width: w, height: h, borderRadius: 6, marginBottom: mb }} />
  );
  return (
    <div aria-busy="true" aria-label="Loading candidates">
      {Array.from({ length: rows }).map((_, i) => (
        <Card
          key={i}
          className="no-lift"
          style={{ marginBottom: 10, animation: `fadeIn .3s ease ${i * 0.06}s both` }}
          styles={{ body: { padding: 20 } }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div className="shimmer" style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Bar w="38%" h={14} mb={9} />
              <Bar w="62%" h={11} mb={9} />
              <div style={{ display: 'flex', gap: 6 }}>
                <Bar w={64} h={18} />
                <Bar w={80} h={18} />
                <Bar w={52} h={18} />
              </div>
            </div>
            <Bar w={92} h={30} />
          </div>
        </Card>
      ))}
    </div>
  );
}

export default function CandidateScreening() {
  const { user } = useAuth();
  const convBodyRef = useRef(null);
  const navigate = useNavigate();

  const queryClient = useQueryClient();

  // ── Mode/Tab State (persisted so returning to the page restores the view) ──
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('screening_active_tab') || 'jd'); // 'jd' or 'keyword'

  // ── Roles Dropdown State ──
  // Roles come from React Query (prefetched at app load), cached for the session.
  // One entry per MRF (N19); "Include closed MRFs" adds the closed ones (N20).
  const [includeClosedMrfs, setIncludeClosedMrfs] = useState(false);
  const rolesQuery = useApprovedRoles({ includeClosed: includeClosedMrfs });
  const roles = rolesQuery.data || [];
  const loadingRoles = rolesQuery.isLoading;
  const [selectedRoleId, setSelectedRoleId] = useState(() => {
    const v = localStorage.getItem('screening_selected_role');
    return v ? Number(v) : null;
  });
  const selectedRole = roles.find((r) => r.id === selectedRoleId) || null;
  // A closed MRF can still be searched, read-only: Shortlist / Reject are off (N20).
  // The server refuses a shortlist onto a closed MRF too (409).
  const selectedRoleClosed = Boolean(selectedRole?.closed);
  const [roleDetails, setRoleDetails] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // N38: "Added within" on the JD tab — only candidates added in the last N days.
  const [jdAddedWithin, setJdAddedWithin] = useState(null);
  // N15: "Tagged to this JD only" — candidates uploaded for, or shortlisted to, this JD.
  const [jdTaggedOnly, setJdTaggedOnly] = useState(false);
  // L01: "Active candidates first" — on by default; off = match score only.
  const [jdActiveFirst, setJdActiveFirst] = useState(true);
  // Per-role candidates (JD tab) — cached per role (and filters) so revisiting the page keeps results.
  const roleCandidatesQuery = useRoleCandidates(selectedRoleId, activeTab === 'jd', jdAddedWithin, jdTaggedOnly, jdActiveFirst);

  // ── Candidates List State ──
  const [candidates, setCandidates] = useState([]);
  // The keyword filters behind the results on screen, replayed by Export.
  const [lastKeywordPayload, setLastKeywordPayload] = useState(null);
  // L11: "See the N not shown" drawer.
  const [notShownOpen, setNotShownOpen] = useState(false);
  const [summary, setSummary] = useState(null);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [selectedCandidateKeys, setSelectedCandidateKeys] = useState([]);
  // Blocks the whole page while the bulk shortlist/reject request (incl. email sends) is in flight.
  const [isShortlisting, setIsShortlisting] = useState(false);
  // Which decision the floating dock opened the modal for: null | 'shortlist' | 'reject'.
  const [decisionModalOpen, setDecisionModalOpen] = useState(null);
  // Dedupes the ranking-service-degraded warning so in-place cache patches don't re-toast it.
  const degradedNotifiedRef = useRef(null);

  // ── Pagination State (client-side; result sets are bounded server-side) ──
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  /** The slice actually on screen — what "select this page" acts on. */
  const pageCandidates = useMemo(
    () => candidates.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [candidates, currentPage, pageSize]
  );
  const pageCandidateIds = useMemo(() => pageCandidates.map((c) => c.id), [pageCandidates]);

  // ── Keyword Filter Fields ──
  const [form] = Form.useForm();
  const [selectedEduCategories, setSelectedEduCategories] = useState([]);
  const [activeEduKeys, setActiveEduKeys] = useState([]);

  // ── Sliding Drawer State ──
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [drawerTab, setDrawerTab] = useState('insights'); // 'insights', 'details', 'zeko'

  // ── Zeko Jobs & Scheduling State ──
  const [zekoJobs, setZekoJobs] = useState([]);
  const [loadingZekoJobs, setLoadingZekoJobs] = useState(false);
  const [zekoPipelineRows, setZekoPipelineRows] = useState([]);
  const [loadingZekoPipeline, setLoadingZekoPipeline] = useState(false);
  
  const [assigningJob, setAssigningJob] = useState(false);
  const [schedulingInterview, setSchedulingInterview] = useState(false);
  const [cancellingInterview, setCancellingInterview] = useState(false);

  // ── Conversations Modal State ──
  const [convModalVisible, setConvModalVisible] = useState(false);
  const [convLoading, setConvLoading] = useState(false);
  const [convCandidate, setConvCandidate] = useState(null);
  const [convMessages, setConvMessages] = useState([]);

  useEffect(() => {
    if (convModalVisible && convBodyRef.current) {
      setTimeout(() => {
        if (convBodyRef.current) {
          convBodyRef.current.scrollTop = convBodyRef.current.scrollHeight;
        }
      }, 100);
    }
  }, [convMessages, convModalVisible, convLoading]);

  // The drawer's score block serves both tabs: JD rows carry starRating, keyword
  // rows relevanceScore — keyword scores used to have no explanation at all (N06).
  const drawerRating = selectedCandidate?.starRating || selectedCandidate?.relevanceScore || null;
  const drawerScore = drawerRating ? (drawerRating.finalScore ?? drawerRating.avgScore ?? 0) : 0;

  const getCriteria = (key) => {
    if (activeTab !== 'jd' || !roleDetails || !selectedCandidate) return null;
    switch (key) {
      case 'totalExperience':
        if (roleDetails.experienceBand) return `Required: ${formatExperienceBand(roleDetails.experienceBand)}`;
        return roleDetails.total_experience
          ? `Required: ${roleDetails.total_experience} yrs total${roleDetails.relevant_experience ? ' · ' + roleDetails.relevant_experience + ' yrs relevant' : ''}` 
          : null;
      case 'relevantExperience':
        return roleDetails.relevant_experience 
          ? `Required: ${roleDetails.relevant_experience} yrs relevant` 
          : null;
      case 'education':
        return roleDetails.required_qualification 
          ? `Required: ${roleDetails.required_qualification}` 
          : null;
      case 'ctcAlignment':
        return (roleDetails.budget_min || roleDetails.budget_max)
          ? `Budget: ₹${roleDetails.budget_min || '0'}-₹${roleDetails.budget_max || '0'} LPA · Candidate: ₹${selectedCandidate.ExpectedCTC_LPA || '0'} LPA`
          : null;
      case 'availability':
        return formatNotice(selectedCandidate)
          ? `Candidate: ${formatNotice(selectedCandidate)}`
          : null;
      default:
        return null;
    }
  };
  
  const [selectedZekoJobId, setSelectedZekoJobId] = useState(null);
  const [interviewDates, setInterviewDates] = useState(null); // [start, end]
  const [cancelReason, setCancelReason] = useState('');

  /* ═══════ INITIAL LOAD ═══════ */
  // Roles load via React Query (prefetched at app load); only Zeko data fetched here.
  useEffect(() => {
    fetchZekoData();
  }, []);

  /* ═══════ PERSIST VIEW (survives navigation) ═══════ */
  useEffect(() => {
    localStorage.setItem('screening_active_tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (selectedRoleId) localStorage.setItem('screening_selected_role', String(selectedRoleId));
    else localStorage.removeItem('screening_selected_role');
  }, [selectedRoleId]);

  /* ═══════ SYNC JD CANDIDATES QUERY → RENDER STATE ═══════ */
  // Keep the existing render path (local candidates/summary/roleDetails + pagination) but
  // source it from the cached per-role query so navigation away/back shows results instantly.
  useEffect(() => {
    if (activeTab !== 'jd') return;
    const data = roleCandidatesQuery.data;
    if (data) {
      setRoleDetails(data.role || null);
      setCandidates(data.candidates || []);
      setSummary(data.summary || null);
      // Ranking-service outage fallback (see rerankCandidates on the backend) — warn
      // once per distinct failure rather than re-notifying on every in-place cache patch.
      if (data.summary?.degraded && degradedNotifiedRef.current !== data.summary.degradedReason) {
        degradedNotifiedRef.current = data.summary.degradedReason;
        notification.warning({
          message: 'Showing a limited candidate list',
          description: data.summary.degradedReason,
          duration: 8,
        });
      }
    }
  }, [roleCandidatesQuery.data, activeTab]);

  // Mirror the query's fetching state into the existing loading flag (keyword path sets it directly).
  useEffect(() => {
    if (activeTab === 'jd') {
      setLoadingCandidates(Boolean(selectedRoleId) && roleCandidatesQuery.isFetching);
    }
  }, [roleCandidatesQuery.isFetching, activeTab, selectedRoleId]);

  // Surface JD candidate-search errors (e.g. AI model overloaded).
  useEffect(() => {
    if (activeTab !== 'jd' || !roleCandidatesQuery.error) return;
    const err = roleCandidatesQuery.error;
    const isAIError = err?.status === 503 || err?.status === 429;
    if (isAIError) {
      notification.error({
        message: 'AI Model Overloaded',
        description: err.message || 'The AI Model is currently experiencing high demand. Please try again in a few moments.',
        duration: 0,
      });
    } else {
      message.error(err?.message || 'Error occurred while loading matching candidates.');
    }
  }, [roleCandidatesQuery.error, activeTab]);

  /* ═══════ API FETCHERS ═══════ */
  const fetchZekoData = async () => {
    setLoadingZekoJobs(true);
    try {
      const jobsRes = await screeningService.getZekoJobs();
      setZekoJobs(jobsRes.data?.data || jobsRes.data || []);
    } catch (err) {
      console.warn('Failed to load Zeko jobs list');
    } finally {
      setLoadingZekoJobs(false);
    }
  };

  const loadZekoPipeline = async () => {
    setLoadingZekoPipeline(true);
    try {
      const pipelineRes = await screeningService.getZekoPipeline();
      const pipelineData = pipelineRes.data?.data || pipelineRes.data || {};
      setZekoPipelineRows(pipelineData.pipeline || []);
    } catch (err) {
      console.warn('Failed to fetch Zeko candidate pipeline details');
    } finally {
      setLoadingZekoPipeline(false);
    }
  };

  /* ═══════ SEARCH / MATCH ACTION ═══════ */
  // Selecting a role just sets the id; useRoleCandidates fires (or serves cache) and the
  // sync effect populates the list. Clearing resets the local render state.
  const handleRoleSelect = (roleId) => {
    setSelectedRoleId(roleId);
    setSelectedCandidateKeys([]);
    setCurrentPage(1);
    if (!roleId) {
      setRoleDetails(null);
      setCandidates([]);
      setSummary(null);
    }
  };

  // The remembered role may have closed since last visit. Show it as closed
  // (tick the box) rather than as a bare number; drop it only if it is gone.
  useEffect(() => {
    if (!rolesQuery.isSuccess || !selectedRoleId) return;
    if (roles.some((r) => r.id === selectedRoleId)) return;
    if (!includeClosedMrfs) setIncludeClosedMrfs(true);
    else handleRoleSelect(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolesQuery.isSuccess, roles, selectedRoleId, includeClosedMrfs]);

  // Open MRFs first; closed ones (only when asked for) in their own group.
  const roleOptions = useMemo(() => {
    const toOption = (r) => ({ value: r.id, label: mrfOptionLabel(r), role: r });
    const open = roles.filter((r) => !r.closed).map(toOption);
    const closed = roles.filter((r) => r.closed).map(toOption);
    return closed.length ? [...open, { label: 'Closed', title: 'Closed', options: closed }] : open;
  }, [roles]);

  // Force-reload the selected role's candidates, bypassing the backend Redis cache,
  // and write the fresh result into the query cache so the UI updates.
  const forceReloadRoleCandidates = async () => {
    if (!selectedRoleId) return;
    const res = await screeningService.searchRoleCandidates(selectedRoleId, {
      force: true, addedWithinDays: jdAddedWithin, taggedOnly: jdTaggedOnly, activeFirst: jdActiveFirst,
    });
    queryClient.setQueryData(screeningKeys.roleCandidates(selectedRoleId, jdAddedWithin, jdTaggedOnly, jdActiveFirst), res);
  };

  /* ═══════ REFRESH (roles + current candidates) ═══════ */
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      if (activeTab === 'jd') {
        await rolesQuery.refetch();
        await forceReloadRoleCandidates();
      } else {
        form.submit(); // keyword results are computed fresh server-side
      }
    } catch (err) {
      message.error(err?.message || 'Failed to refresh.');
    } finally {
      setRefreshing(false);
    }
  };

  const handleKeywordSearch = async () => {
    setSelectedCandidateKeys([]);
    setCandidates([]);
    setSummary(null);
    setCurrentPage(1);
    setLoadingCandidates(true);

    const v = form.getFieldsValue(true);
    const payload = {
      // Any of these three makes the backend look one person up by exact
      // match and skip the filters below (always, whatever SCREENING_V2 says).
      name: v.name,
      email: v.email,
      phone: v.phone,
      keyword: v.keyword,
      matchMode: v.anySkill ? 'any' : 'all',
      // Tags arrive as an array; sent as a comma list so the pre-V2 backend
      // (which lower-cases a string) keeps working while SCREENING_V2 is off.
      location: Array.isArray(v.location) ? v.location.join(',') : v.location,
      gender: v.gender,
      expMin: v.expMin,
      expMax: v.expMax,
      ctcMin: v.ctcMin,
      ctcMax: v.ctcMax,
      noticePeriod: v.noticePeriod,
      position: v.position,
      addedWithinDays: v.addedWithinDays,
      education: selectedEduCategories.join(','),
      // L01: the form's checkbox starts ticked; unticked = match score only.
      activeFirst: v.activeFirst !== false,
    };
    // Kept so Export can re-run the identical search server-side (the export
    // never sends a candidate list — see screening.export.js).
    setLastKeywordPayload(payload);

    try {
      const res = await screeningService.searchKeywordCandidates(payload);
      const data = res.data?.data || res.data || {};
      setCandidates(data.candidates || []);
      setSummary(data.summary || null);
      message.success(data.summary?.mode === 'lookup'
        ? `Lookup completed: ${data.candidates?.length || 0} candidate(s) found`
        : `Search completed: ${data.candidates?.length || 0} matches`);
      if (data.summary?.aiUnavailable) {
        message.warning('AI insights are unavailable right now — results are shown without them.');
      }
      if (data.summary?.degraded) {
        notification.warning({
          message: 'Showing a limited candidate list',
          description: data.summary.degradedReason,
          duration: 8,
        });
      }
    } catch (err) {
      const isAIError = err.status === 503 || err.status === 429;
      if (isAIError) {
        notification.error({
          message: 'AI Model Overloaded',
          description: err.message || 'The AI Model is currently experiencing high demand. Please try again in a few moments.',
          duration: 0,
        });
      } else {
        message.error(err.message || 'Error executing candidate keyword search.');
      }
    } finally {
      setLoadingCandidates(false);
    }
  };

  const handleClearFilters = () => {
    form.resetFields();
    setSelectedEduCategories([]);
    setCandidates([]);
    setSummary(null);
    setCurrentPage(1);
    setSelectedCandidateKeys([]);
  };

  /* ═══════ BULK SHORTLIST / REJECT ACTIONS ═══════ */
  // Both dock buttons open DecisionEmailModal (reason/Tag-to-JD/editable email
  // preview) instead of firing immediately; the actual API call happens in
  // handleDecisionConfirm once the recruiter confirms.
  const openDecisionModal = (decision) => {
    if (selectedCandidateKeys.length === 0) return;
    setDecisionModalOpen(decision);
  };

  const patchCandidateLists = (updater) => {
    if (activeTab === 'jd') {
      // The JD list is sourced from the react-query cache (sync effect
      // above), so patch the cached axios envelope; the effect then
      // refreshes the local render state.
      queryClient.setQueryData(screeningKeys.roleCandidates(selectedRoleId, jdAddedWithin, jdTaggedOnly, jdActiveFirst), (prev) => {
        const payload = prev?.data?.data ?? prev?.data;
        if (!payload?.candidates) return prev;
        const updated = { ...payload, candidates: updater(payload.candidates) };
        return prev.data?.data !== undefined
          ? { ...prev, data: { ...prev.data, data: updated } }
          : { ...prev, data: updated };
      });
    } else {
      setCandidates((prev) => updater(prev));
    }
  };

  // N21: who a shortlist left out, and why — shown after the request returns.
  const [shortlistResult, setShortlistResult] = useState(null);
  // G3: the journey chip whose JD is being changed ({ shortlistId, candidateName }).
  const [changeJdTarget, setChangeJdTarget] = useState(null);

  /** After Change JD: the chip shows the new JD without a new search. */
  const handleJdChanged = (result) => {
    if (!result) return;
    patchCandidateLists((list) => list.map((cand) => (
      cand.pipelineHistory?.some((j) => j.shortlist_id === result.shortlist_id)
        ? {
          ...cand,
          pipelineHistory: cand.pipelineHistory.map((j) => (j.shortlist_id === result.shortlist_id
            ? { ...j, mrf_id: result.to_mrf_id, position: result.role }
            : j)),
        }
        : cand
    )));
  };

  const handleDecisionConfirm = async ({ mrfId, roleName, reason, sendEmail, emailOverride }) => {
    const decision = decisionModalOpen;
    if (!decision) return;
    const selectedList = candidates.filter((c) => selectedCandidateKeys.includes(c.id));
    if (selectedList.length === 0) return;

    const payload = {
      candidates: selectedList.map((c) => ({ id: c.id, Name: c.Name, EmailID: c.EmailID })),
      mrf_id: mrfId,
      role_name: roleName,
      send_email: sendEmail,
      email_override: emailOverride,
    };
    if (decision === 'reject') payload.reason = reason;
    // N17: only a Keyword-tab shortlist attaches the JD and adds About AAPNA.
    else payload.source = activeTab;

    setIsShortlisting(true);
    try {
      const res = decision === 'reject'
        ? await screeningService.rejectCandidates(payload)
        : await screeningService.shortlistCandidates(payload);
      const result = res.data?.data || res.data || {};
      const emailsSent = result.emails_sent ?? 0;
      const processedCount = decision === 'reject'
        ? (result.rejected ?? selectedList.length)
        : (result.shortlisted ?? selectedList.length);
      const skippedCount = result.skipped ?? 0;
      const skippedList = decision === 'shortlist' ? (result.skipped_candidates || []) : [];
      // N21 hardening: candidates the server could not add (an error, or no
      // longer on record); listed in the result dialog with the reason.
      const failedList = decision === 'shortlist' ? (result.failed_candidates || []) : [];
      const skippedNote = skippedCount > 0 && skippedList.length === 0
        ? ` ${skippedCount} already had a record for this role and ${skippedCount === 1 ? 'was' : 'were'} left unchanged.`
        : '';
      const failures = result.email_failures || [];
      const verb = decision === 'reject' ? 'Rejected' : 'Shortlisted';

      if (skippedList.length > 0 || failedList.length > 0) {
        // N21: name each one left out and why, instead of a bare count.
        const skippedIds = new Set([...skippedList, ...failedList].map((x) => String(x.cv_id)));
        const selectedRole = roles.find((r) => r.id === mrfId);
        setShortlistResult({
          roleLabel: selectedRole ? mrfOptionLabel(selectedRole) : roleName,
          added: selectedList.filter((c) => !skippedIds.has(String(c.id))).map((c) => c.Name || 'Candidate'),
          emailed: sendEmail && failures.length === 0,
          skipped: skippedList,
          failed: failedList,
        });
      }

      if (failures.length > 0) {
        // Group identical reasons so the message stays readable for bulk actions.
        const reasons = [...new Set(failures.map((f) => f.reason))];
        notification.warning({
          message: `${verb} ${processedCount}, but ${failures.length} email(s) not sent`,
          description: (
            <div>
              {reasons.map((r, i) => (
                <div key={i} style={{ marginBottom: 4 }}>• {r}</div>
              ))}
              <div style={{ marginTop: 6, color: 'var(--text-3)' }}>
                Affected: {failures.map((f) => f.name).join(', ')}
              </div>
            </div>
          ),
          duration: 0,
        });
      } else if (skippedList.length > 0 || failedList.length > 0) {
        // The result dialog says it all.
      } else {
        const emailNote = sendEmail
          ? ` Sent ${emailsSent} notification email(s).`
          : ' No email was sent.';
        const pipelineEntries = result.pipeline_entries || [];

        if (decision === 'shortlist' && selectedList.length === 1 && pipelineEntries[0]?.pipeline_id) {
          const pipelineId = pipelineEntries[0].pipeline_id;
          notification.success({
            message: `Shortlisted — ${selectedList[0].Name}`,
            description: `Now at HR Screening (Zeko) on the Pipeline board.${emailNote}`,
            btn: (
              <Button type="primary" size="small" onClick={() => navigate(`/pipeline?candidate=${pipelineId}`)}>
                View in Pipeline
              </Button>
            ),
            placement: 'topRight',
          });
        } else if (decision === 'shortlist') {
          notification.success({
            message: `Shortlisted ${processedCount} candidate(s) for ${roleName}`,
            description: `Now on the Pipeline board.${emailNote}${skippedNote}`,
            btn: (
              <Button type="primary" size="small" onClick={() => navigate(`/pipeline?position=${encodeURIComponent(roleName)}`)}>
                View in Pipeline
              </Button>
            ),
            placement: 'topRight',
          });
        } else {
          notification.success({
            message: `Rejected ${processedCount} candidate(s)`,
            description: `${emailNote}${skippedNote}`,
            placement: 'topRight',
          });
        }
      }

      setSelectedCandidateKeys([]);
      setDecisionModalOpen(null);

      const leftOut = new Set([...skippedList, ...failedList].map((x) => String(x.cv_id)));
      const decidedIds = new Set(selectedList.map((c) => c.id).filter((id) => !leftOut.has(String(id))));
      if (decision === 'reject') {
        // A rejected candidate should no longer sit in this role's current result
        // list (the backend also excludes them from future searches of this role).
        patchCandidateLists((list) => (list || []).filter((c) => !decidedIds.has(c.id)));
      } else {
        // Update shortlist badges in place — re-running the search (JD force
        // reload or keyword re-search) is expensive and kept the blocking
        // overlay up long after the success toast.
        patchCandidateLists((list) =>
          (list || []).map((c) =>
            decidedIds.has(c.id)
              ? {
                  ...c,
                  FinalStatus: 'Stage 0 - Resume Shortlisted',
                  shortlisted_status: 'Stage 0 - Resume Shortlisted',
                  shortlisted_by: user?.username || 'recruiter',
                  shortlisted_at: new Date().toISOString(),
                }
              : c
          )
        );
      }
    } catch (err) {
      message.error(err.message || `Failed to ${decision} candidate list.`);
    } finally {
      setIsShortlisting(false);
    }
  };

  /* ═══════ DRAWER ZEKO ACTIONS ═══════ */
  const handleAssignCandidate = async () => {
    if (!selectedCandidate || !selectedZekoJobId) {
      message.warning('Please select a Zeko Job first.');
      return;
    }

    setAssigningJob(true);
    try {
      // `assignZekoJob` needs a rpa_shortlisted_candidates.id, not a raw candidate
      // id — the Zeko pipeline joins on the shortlist row (see getZekoPipeline's
      // `sc.id AS candidate_id`). So the candidate must be shortlisted first.
      const shortlistId = selectedCandidate.shortlisted_status ? selectedCandidate.id : null;

      if (!shortlistId) {
        // Not shortlisted yet — route through the same modal the dock buttons use
        // so Keyword-tab candidates get the same mandatory role tag + editable
        // email that DecisionEmailModal already enforces, instead of a role-less
        // "Manual Screening" shortlist. JD tab still gets its role pre-filled
        // automatically (defaultMrfId/defaultRoleName are already wired into the
        // modal at the top-level render).
        setSelectedCandidateKeys([selectedCandidate.id]);
        setDecisionModalOpen('shortlist');
        message.info('Confirm the shortlist details to continue, then click "Assign to Zeko job" again.');
        return;
      }

      await screeningService.assignZekoJob({
        candidate_id: shortlistId,
        zeko_job_id: selectedZekoJobId,
      });
      message.success('Candidate assigned to Zeko job successfully.');
      loadZekoPipeline();
    } catch (err) {
      message.error(err.message || 'Failed to assign candidate to Zeko Job');
    } finally {
      setAssigningJob(false);
    }
  };

  const handleScheduleInterview = async () => {
    if (!selectedCandidate || !selectedZekoJobId || !interviewDates) {
      message.warning('Please select Zeko job and pick schedule times.');
      return;
    }

    setSchedulingInterview(true);
    try {
      const shortlistId = selectedCandidate.id; // Representing shortlist ID since we checked that above
      const payload = {
        shortlist_id: shortlistId,
        zeko_job_id: selectedZekoJobId,
        interview_start_at: interviewDates[0].toISOString(),
        interview_end_at: interviewDates[1].toISOString(),
      };

      await screeningService.scheduleZekoInterview(payload);
      message.success('Zeko interview scheduled successfully and invitation email sent.');
      setInterviewDates(null);
      loadZekoPipeline();
    } catch (err) {
      message.error(err.message || 'Failed to schedule interview.');
    } finally {
      setSchedulingInterview(false);
    }
  };

  const handleCancelInterview = async (pipelineId) => {
    if (!cancelReason) {
      message.warning('Please provide a reason for cancellation.');
      return;
    }

    setCancellingInterview(true);
    try {
      await screeningService.cancelZekoInterview({
        pipeline_id: pipelineId,
        cancel_reason: cancelReason,
      });
      message.success('Zeko interview cancelled successfully and candidate notified.');
      setCancelReason('');
      loadZekoPipeline();
    } catch (err) {
      message.error(err.message || 'Failed to cancel interview.');
    } finally {
      setCancellingInterview(false);
    }
  };

  const openConversationsModal = async (candidate) => {
    if (!candidate.EmailID) {
      message.error('No email address for this candidate.');
      return;
    }
    setConvCandidate(candidate);
    setConvMessages([]);
    setConvModalVisible(true);
    setConvLoading(true);

    try {
      const token = new URLSearchParams(window.location.search).get('token') || '';
      const response = await screeningService.getOutlookConversations(candidate.EmailID, token);
      const data = response.data?.data || response.data || {};
      if (!data.success) {
        throw new Error(data.error || 'Failed to load conversations');
      }

      const threads = data.threads || [];
      const emailLower = candidate.EmailID.toLowerCase().trim();
      const candThreads = threads.filter(
        (t) => (t.candidate_email || '').toLowerCase().trim() === emailLower
      );

      const allMsgs = [];
      candThreads.forEach((t) => {
        (t.messages || []).forEach((m) => {
          allMsgs.push(m);
        });
      });

      // Sort chronological (oldest first, i.e. chat format)
      allMsgs.sort((a, b) => new Date(a.sent_at || 0) - new Date(b.sent_at || 0));
      setConvMessages(allMsgs);
    } catch (err) {
      console.error('Failed to load conversations:', err);
      message.error(err.message || 'Failed to load email conversations.');
    } finally {
      setConvLoading(false);
    }
  };

  const downloadResume = (candidate) => {
    const url = candidate ? candidate.cvFileUrl : null;
    if (!url || String(url).trim() === '' || url === 'null' || url === 'undefined') {
      Modal.warning({
        title: 'Resume Not Available',
        content: 'Resume is not available for this candidate right now.',
        okButtonProps: { style: { borderRadius: '6px' } }
      });
      return;
    }
    const link = document.createElement('a');
    link.href = url;
    link.download = '';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  /* ═══════ HELPERS ═══════ */
  const parsePostgresArray = (str) => {
    if (!str) return [];
    if (Array.isArray(str)) return str;
    if (typeof str !== 'string') return [];
    
    const trimmed = str.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const result = [];
      let current = '';
      let inQuotes = false;
      for (let i = 1; i < trimmed.length - 1; i++) {
        const char = trimmed[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      if (current) {
        result.push(current.trim());
      }
      return result.map(s => s.replace(/^"|"$/g, '').trim()).filter(Boolean);
    }
    
    return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  };

  const openCandidateDrawer = (candidate) => {
    setSelectedCandidate(candidate);
    setSelectedZekoJobId(null);
    setInterviewDates(null);
    setCancelReason('');
    setDrawerTab('insights');
    setDrawerOpen(true);
    loadZekoPipeline();
  };

  const getFitVerdictColor = (verdict) => {
    const v = String(verdict || '').toLowerCase();
    if (v.includes('yes') || v.includes('excellent') || v.includes('strong')) return 'success';
    if (v.includes('no') || v.includes('poor') || v.includes('weak') || v.includes('red')) return 'error';
    return 'warning';
  };

  const renderStars = (starCount, size = 14) => {
    return Array.from({ length: 5 }).map((_, i) => (
      <StarFilled
        key={i}
        style={{
          color: i < starCount ? 'var(--star)' : 'var(--border-secondary)',
          fontSize: size,
          marginRight: 2,
        }}
      />
    ));
  };

  // Left fit-accent rail colour, keyed to the candidate's star tier.
  const scoreTierColor = (stars) => {
    if (stars >= 5) return 'var(--green)';
    if (stars >= 4) return 'var(--gold)';
    if (stars >= 3) return 'var(--warning)';
    return 'var(--border)';
  };

  const handleEduCheckboxChange = (checkedValues) => {
    setSelectedEduCategories(checkedValues);
  };

  return (
    <div className="stagger-children" style={{ maxWidth: 1200, margin: '0 auto', padding: '0 8px 40px' }}>
      
      {/* Title */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <Title level={2} style={{ margin: 0, fontWeight: 700, letterSpacing: '-0.02em' }}>
            Candidate Screening
          </Title>
          <Text type="secondary" style={{ fontSize: 14 }}>
            Rank and screen resumes using semantic search, custom parameters, and AI profiles
          </Text>
        </div>
      </div>

      {/* Main card */}
      <Card
        bordered={false}
        className="glass-card"
        style={{ minHeight: 'calc(100vh - 200px)' }}
        styles={{ body: { padding: '4px 20px 20px' } }}
      >
        <Tabs
          className="screening-tabs"
          activeKey={activeTab}
          onChange={(k) => {
            setActiveTab(k);
            setCandidates([]);
            setSummary(null);
            setCurrentPage(1);
            setSelectedCandidateKeys([]);
            setRoleDetails(null);
            setSelectedRoleId(null);
          }}
          items={[
            {
              key: 'jd',
              label: (
                <Space>
                  <SolutionOutlined />
                  JD Filtering
                </Space>
              ),
              children: (
                <div style={{ padding: '8px 0' }}>
                  <Row gutter={[16, 16]}>
                    <Col xs={24}>
                      <Space direction="vertical" style={{ width: '100%' }} size={4}>
                        <Text strong style={{ fontSize: 11, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Select an open role to instantly match and rank qualified candidates
                        </Text>
                        <Space.Compact style={{ width: '100%' }}>
                          <Select
                            showSearch
                            placeholder={loadingRoles ? "Loading open roles..." : "— Select an Open Role —"}
                            disabled={loadingRoles}
                            style={{ width: '100%', height: 44 }}
                            loading={loadingRoles}
                            value={selectedRoleId}
                            onChange={handleRoleSelect}
                            optionFilterProp="label"
                            options={roleOptions}
                            optionRender={(opt) => (
                              <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                                <span style={opt.data.role?.closed ? { color: 'var(--text-3)' } : undefined}>{opt.data.label}</span>
                                {opt.data.role?.isLatest && <Tag color="green" style={{ margin: 0 }}>Latest</Tag>}
                                {opt.data.role?.closed && <Tag style={{ margin: 0 }}>Closed</Tag>}
                              </Space>
                            )}
                          />
                          <Tooltip title="Refresh roles & candidates">
                            <Button
                              icon={<ReloadOutlined />}
                              style={{ height: 44 }}
                              loading={refreshing || rolesQuery.isFetching}
                              onClick={handleRefresh}
                            />
                          </Tooltip>
                        </Space.Compact>
                        <Space wrap size={16} style={{ marginTop: 4 }}>
                          <Checkbox
                            checked={includeClosedMrfs}
                            onChange={(e) => setIncludeClosedMrfs(e.target.checked)}
                          >
                            Include closed MRFs
                          </Checkbox>
                          <Tooltip title="Only candidates uploaded for this JD, or already shortlisted to it.">
                            <Checkbox
                              checked={jdTaggedOnly}
                              onChange={(e) => { setJdTaggedOnly(e.target.checked); setCurrentPage(1); setSelectedCandidateKeys([]); }}
                              data-testid="jd-tagged-only"
                            >
                              Tagged to this JD only
                            </Checkbox>
                          </Tooltip>
                          <Tooltip title="Active candidates (submitted their details recently) first, then pending responses and new applicants, then inactive ones. Untick to order by match score only.">
                            <Checkbox
                              checked={jdActiveFirst}
                              onChange={(e) => { setJdActiveFirst(e.target.checked); setCurrentPage(1); setSelectedCandidateKeys([]); }}
                              data-testid="jd-active-first"
                            >
                              Active candidates first
                            </Checkbox>
                          </Tooltip>
                          <Tooltip title="Only candidates added to the database in this period. Candidates with no added date are left out while this is set.">
                            <Space size={6}>
                              <Text type="secondary" style={{ fontSize: 13 }}>Added within</Text>
                              <Select
                                value={jdAddedWithin}
                                onChange={(v) => { setJdAddedWithin(v ?? null); setCurrentPage(1); setSelectedCandidateKeys([]); }}
                                options={ADDED_WITHIN_OPTIONS}
                                placeholder="Any time"
                                allowClear
                                style={{ width: 150 }}
                                data-testid="jd-added-within"
                              />
                            </Space>
                          </Tooltip>
                        </Space>
                        {selectedRoleClosed && (
                          <Alert
                            type="warning"
                            showIcon
                            style={{ marginTop: 4 }}
                            message={
                              `This MRF was closed${selectedRole.closed_at ? ` on ${fmtDate(selectedRole.closed_at)}` : ''}`
                              + `${selectedRole.closure_reason ? ` (${closureReasonLabel(selectedRole.closure_reason)})` : ''}.`
                              + ' Results are read-only: Shortlist and Reject are turned off.'
                            }
                          />
                        )}
                      </Space>
                    </Col>

                    {/* Role JD context details */}
                    {roleDetails && (
                      <Col xs={24}>
                        {/* Surface styling lives in CSS (.screening-role-card), not
                            inline — under Design V2 this panel is restyled onto the
                            glass tier, and no stylesheet can override an inline style. */}
                        <Card size="small" className="screening-role-card">
                          <Row gutter={[16, 8]}>
                            <Col xs={24} sm={12} md={6}>
                              <Text type="secondary" style={{ fontSize: 12 }}>Open Role</Text>
                              <div style={{ fontWeight: 700, fontSize: 15 }}>{roleDetails.role_title}</div>
                            </Col>
                            <Col xs={12} sm={6} md={3}>
                              <Text type="secondary" style={{ fontSize: 12 }}>Openings</Text>
                              <div style={{ fontWeight: 600 }}>{roleDetails.role_openings} openings</div>
                            </Col>
                            {roleDetails.experienceBand ? (
                              <>
                                {/* Strict JD search (Phase 3 N08): what the gates
                                    actually enforce, and where each value came from. */}
                                <Col xs={12} sm={6} md={5}>
                                  <Text type="secondary" style={{ fontSize: 12 }}>Experience</Text>
                                  <div style={{ fontWeight: 600 }}>{formatExperienceBand(roleDetails.experienceBand)}</div>
                                  <Text type="secondary" style={{ fontSize: 12 }}>{BAND_SOURCE_LABELS[roleDetails.experienceBand.source]}</Text>
                                </Col>
                                <Col xs={24} sm={12} md={5}>
                                  <Text type="secondary" style={{ fontSize: 12 }}>Budget</Text>
                                  {roleDetails.budget_max ? (
                                    <>
                                      <div style={{ fontWeight: 600 }}>Up to ₹{roleDetails.budget_max} LPA</div>
                                      <Text type="secondary" style={{ fontSize: 12 }}>From the MRF request</Text>
                                    </>
                                  ) : (
                                    <>
                                      <div style={{ fontWeight: 600, color: 'var(--text-3)' }}>Not set</div>
                                      <Text type="warning" style={{ fontSize: 12 }}>Expected CTC is not checked</Text>
                                    </>
                                  )}
                                </Col>
                              </>
                            ) : (
                              <>
                                <Col xs={12} sm={6} md={5}>
                                  <Text type="secondary" style={{ fontSize: 12 }}>Experience Required</Text>
                                  <div style={{ fontWeight: 600 }}>{roleDetails.total_experience} yrs (rel {roleDetails.relevant_experience} yrs)</div>
                                </Col>
                                <Col xs={24} sm={12} md={5}>
                                  <Text type="secondary" style={{ fontSize: 12 }}>Target Budget</Text>
                                  <div style={{ fontWeight: 600 }}>
                                    {roleDetails.budget_min && roleDetails.budget_max
                                      ? `₹${roleDetails.budget_min} - ₹${roleDetails.budget_max} LPA`
                                      : 'N/A'}
                                  </div>
                                </Col>
                              </>
                            )}
                            <Col xs={24} sm={12} md={5} style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                              <Button
                                type="text"
                                danger
                                onClick={() => handleRoleSelect(null)}
                                style={{ fontWeight: 600 }}
                              >
                                Clear
                              </Button>
                            </Col>
                            <Col xs={24}>
                              {(() => {
                                const team = roleDetails.requirement_for_team || roleDetails.role_team;
                                const qualKey = roleDetails.required_qualification || roleDetails.role_required_qualification;
                                // Strict JD search names the requirement it enforces; null = none checked.
                                const strictJd = Boolean(roleDetails.experienceBand);
                                const qualLabel = strictJd ? roleDetails.educationRequirement : (ROLE_QUAL_LABELS[qualKey] || qualKey);
                                const stream = roleDetails.required_stream || roleDetails.role_required_qualification_stream;
                                const responsibilities = roleDetails.role_responsibilities || roleDetails.roles_and_responsibilities;
                                return (
                                  <>
                                    <Divider style={{ margin: '8px 0' }} />
                                    {/* Meta row: team + qualification */}
                                    {(team || (qualLabel && qualLabel !== 'ANY')) && (
                                      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', marginBottom: 10 }}>
                                        {team && (
                                          <div>
                                            <Text type="secondary" style={{ fontSize: 12 }}>Requirement For Team</Text>
                                            <div style={{ fontWeight: 600, fontSize: 13 }}>{team}</div>
                                          </div>
                                        )}
                                        {qualLabel && (
                                          <div>
                                            <Text type="secondary" style={{ fontSize: 12 }}>Qualification</Text>
                                            <div style={{ fontWeight: 600, fontSize: 13 }}>{qualLabel}{stream ? ` — ${stream}` : ''}</div>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    {/* Skills */}
                                    <Space size={6} direction="vertical" style={{ width: '100%' }}>
                                      {strictJd ? (
                                        <div>
                                          <Tag color="blue" style={{ borderRadius: 4, fontWeight: 600 }}>MANDATORY SKILLS</Tag>
                                          <Text style={{ fontSize: 13 }} type={roleDetails.mandatorySkillsParsed?.length ? undefined : 'secondary'}>
                                            {roleDetails.mandatorySkillsParsed?.length ? 'Candidates must have all of these' : 'None found'}
                                          </Text>
                                          {roleDetails.mandatorySkillsParsed?.length > 0 && (
                                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                                              {roleDetails.mandatorySkillsParsed.map((skill) => (
                                                <Tag key={skill} color="blue" style={{ margin: 0, fontWeight: 600, fontSize: 13, padding: '2px 10px' }}>{skill}</Tag>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      ) : (
                                        <div>
                                          <Tag color="blue" style={{ borderRadius: 4, fontWeight: 600 }}>MANDATORY SKILLS</Tag>
                                          <Text style={{ fontSize: 13 }}>{roleDetails.role_mandatory_skills || 'N/A'}</Text>
                                        </div>
                                      )}
                                      {roleDetails.role_good_to_have_skills && (
                                        <div>
                                          <Tag color="cyan" style={{ borderRadius: 4, fontWeight: 600 }}>GOOD TO HAVE</Tag>
                                          <Text style={{ fontSize: 13 }}>{roleDetails.role_good_to_have_skills}</Text>
                                        </div>
                                      )}
                                      {responsibilities && (
                                        <div>
                                          <Tag color="green" style={{ borderRadius: 4, fontWeight: 600 }}>RESPONSIBILITIES</Tag>
                                          <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, marginTop: 6, maxHeight: 110, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
                                            {responsibilities}
                                          </div>
                                        </div>
                                      )}
                                    </Space>
                                  </>
                                );
                              })()}
                            </Col>
                          </Row>
                        </Card>
                      </Col>
                    )}
                  </Row>
                </div>
              ),
            },
            {
              key: 'keyword',
              label: (
                <Space>
                  <SearchOutlined />
                  Keyword Filtering
                </Space>
              ),
              children: (
                <Form
                  form={form}
                  layout="vertical"
                  onFinish={handleKeywordSearch}
                  className="screening-filter"
                  style={{ marginTop: 8 }}
                >
                  {/* Classic form (design approved 13 Oct). Every filled filter must
                      match, and a candidate missing that detail is left out.
                      Candidate name / Email / Phone find one person by exact match
                      and skip the other filters (N02). */}
                  <Row gutter={[20, 4]}>
                    <Col xs={24} lg={12}>
                      <div className="screening-skills-head">
                        <label htmlFor="keyword-skills" className="screening-field-label">Skills</label>
                        <Form.Item name="anySkill" valuePropName="checked" noStyle>
                          <Checkbox data-testid="any-skill" className="screening-any-skill">Match any one skill</Checkbox>
                        </Form.Item>
                      </div>
                      <Form.Item name="keyword">
                        <Input
                          id="keyword-skills"
                          size="large"
                          allowClear
                          placeholder="e.g. Java, Spring Boot, AWS"
                          prefix={<SearchOutlined style={{ color: 'var(--text-3)' }} />}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12} lg={6}>
                      <Form.Item label="Location" name="location">
                        <Select
                          mode="tags"
                          size="large"
                          allowClear
                          open={false}
                          tokenSeparators={[',']}
                          suffixIcon={<EnvironmentOutlined style={{ color: 'var(--text-3)' }} />}
                          placeholder="Add city"
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12} lg={6}>
                      <Form.Item label="Position applied for" name="position">
                        <Input size="large" allowClear placeholder="e.g. Java Developer" />
                      </Form.Item>
                    </Col>

                    <Col xs={24} md={12} lg={6}>
                      <Form.Item label="Candidate name" name="name" extra={<span className="field-hint">Exact match. Other filters are skipped.</span>}>
                        <Input size="large" allowClear placeholder="Full name" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12} lg={6}>
                      <Form.Item label="Email" name="email" extra={<span className="field-hint">Exact match. Other filters are skipped.</span>}>
                        <Input size="large" allowClear placeholder="name@example.com" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12} lg={6}>
                      <Form.Item label="Phone" name="phone" extra={<span className="field-hint">Exact match. Other filters are skipped.</span>}>
                        <Input size="large" allowClear placeholder="10-digit mobile number" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12} lg={6}>
                      <Form.Item label="Gender" name="gender">
                        <Select
                          size="large"
                          placeholder="Any"
                          allowClear
                          options={[
                            { value: 'male', label: 'Male' },
                            { value: 'female', label: 'Female' },
                          ]}
                        />
                      </Form.Item>
                    </Col>

                    <Col xs={24} md={12} lg={6}>
                      <Form.Item label="Experience (years)">
                        <Space.Compact style={{ width: '100%' }}>
                          <Form.Item name="expMin" noStyle>
                            <InputNumber size="large" placeholder="Min" style={{ width: '50%' }} min={0} />
                          </Form.Item>
                          <Form.Item name="expMax" noStyle>
                            <InputNumber size="large" placeholder="Max" style={{ width: '50%' }} min={0} />
                          </Form.Item>
                        </Space.Compact>
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12} lg={6}>
                      <Form.Item label="Expected CTC (LPA)">
                        <Space.Compact style={{ width: '100%' }}>
                          <Form.Item name="ctcMin" noStyle>
                            <InputNumber size="large" placeholder="Min" style={{ width: '50%' }} min={0} />
                          </Form.Item>
                          <Form.Item name="ctcMax" noStyle>
                            <InputNumber size="large" placeholder="Max" style={{ width: '50%' }} min={0} />
                          </Form.Item>
                        </Space.Compact>
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12} lg={6}>
                      <Form.Item label="Notice period" name="noticePeriod">
                        <Select
                          size="large"
                          placeholder="Any"
                          allowClear
                          options={[
                            { value: '0', label: 'Immediate' },
                            { value: '15', label: 'Up to 15 days' },
                            { value: '30', label: 'Up to 30 days' },
                            { value: '45', label: 'Up to 45 days' },
                            { value: '60', label: 'Up to 60 days' },
                            { value: '90', label: 'Up to 90 days' },
                          ]}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12} lg={6}>
                      <Form.Item label="Added within" name="addedWithinDays">
                        <Select
                          size="large"
                          placeholder="Any time"
                          allowClear
                          options={ADDED_WITHIN_OPTIONS}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12} lg={6}>
                      {/* L01: ticked by default; unticked = match score only. */}
                      <Form.Item label="Order" name="activeFirst" valuePropName="checked" initialValue>
                        <Checkbox data-testid="kw-active-first">
                          <Tooltip title="Active candidates (submitted their details recently) first, then pending responses and new applicants, then inactive ones.">
                            Active candidates first
                          </Tooltip>
                        </Checkbox>
                      </Form.Item>
                    </Col>

                    {/* Education: the same three expandable groups as before. */}
                    <Col xs={24}>
                      <Text strong style={{ fontSize: 11, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Education / Qualification (click categories below to expand)
                      </Text>
                      <Collapse
                        bordered={false}
                        expandIconPosition="end"
                        style={{ background: 'transparent', marginTop: 6 }}
                        activeKey={activeEduKeys}
                        onChange={setActiveEduKeys}
                        items={EDUCATION_FILTER_GROUPS.map((group) => {
                          const picked = selectedEduCategories.filter((x) => x.startsWith(group.prefix)).length;
                          return {
                            key: group.key,
                            className: 'screening-edu-panel',
                            label: (
                              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', paddingRight: 12 }}>
                                <Text strong style={{ fontSize: 13 }}>
                                  {group.title}{' '}
                                  <span style={{ fontSize: '11px', fontWeight: 'normal', color: 'var(--text-3)', marginLeft: 8 }}>
                                    {activeEduKeys.includes(group.key) ? '(click to collapse)' : '(click to expand)'}
                                  </span>
                                </Text>
                                {picked > 0 && <Badge count={picked} style={{ backgroundColor: 'var(--color-primary)' }} />}
                              </div>
                            ),
                            children: (
                              <Checkbox.Group value={selectedEduCategories} onChange={handleEduCheckboxChange} style={{ width: '100%' }}>
                                <Row gutter={[16, 8]}>
                                  {group.options.map((o) => (
                                    <Col xs={24} sm={12} key={o.value}>
                                      <Checkbox value={o.value}>{o.label}</Checkbox>
                                    </Col>
                                  ))}
                                </Row>
                              </Checkbox.Group>
                            ),
                          };
                        })}
                      />
                    </Col>

                    <Col xs={24} style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 16 }}>
                      <Tooltip title="Re-run the current search">
                        <Button
                          icon={<ReloadOutlined />}
                          onClick={handleRefresh}
                          loading={refreshing}
                          disabled={candidates.length === 0}
                          size="large"
                          style={{ height: 44, borderRadius: 10, fontWeight: 600, paddingInline: 18 }}
                        >
                          Refresh
                        </Button>
                      </Tooltip>
                      <Button onClick={handleClearFilters} className="cta-secondary" size="large" style={{ height: 44, borderRadius: 10, fontWeight: 600, paddingInline: 22 }}>
                        Clear
                      </Button>
                      <Button type="primary" htmlType="submit" icon={<SearchOutlined />} className="cta-primary" size="large" style={{ height: 44, borderRadius: 10, fontWeight: 600, paddingInline: 26 }}>
                        Search Candidates
                      </Button>
                    </Col>
                  </Row>
                </Form>
              ),
            },
          ]}
        />

        <Divider style={{ margin: '12px 0' }} />

        {/* Search summary metrics bar. Layout stays inline; the surface
            (fill/border/radius) moved to .screening-summary-bar so Design V2 can
            put it on the glass tier — a stylesheet cannot override an inline style. */}
        {summary && !summary.noMandatorySkills && (
          <div
            className="screening-summary-bar"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 10,
              padding: '12px 16px',
              marginBottom: 16,
            }}
          >
            {(() => {
              // Show a clean primary count; drop the trailing "· ★..." (the chips cover it),
              // and mute the parenthetical breakdown detail.
              // Strict JD search sends its detail line separately: it uses "·" itself.
              const strictJd = summary.mode === 'jd-strict';
              const primary = (summary.summaryText || `${candidates.length} candidates match`).split('·')[0].trim();
              const [head, ...rest] = strictJd ? [`${summary.shown} matched`] : primary.split('(');
              const detail = strictJd ? summary.summaryDetail || '' : (rest.length ? `(${rest.join('(')}` : '');
              return (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <Text strong style={{ color: 'var(--text)', fontSize: 15, letterSpacing: '-0.01em' }}>{head.trim()}</Text>
                  {detail && <Text style={{ color: 'var(--text-3)', fontSize: 12 }}>{detail.trim()}</Text>}
                  {/* L11: who the rules left out, and why. Strict search only. */}
                  {(() => {
                    const removed = summary.removedBy || {};
                    const inScope = Number(summary.total || 0) - (strictJd ? Number(removed.tagged || 0) : 0);
                    const notShown = Math.max(0, inScope - Number(summary.shown ?? candidates.length));
                    // removedBy exists only on the strict searches' funnel; a
                    // name / email lookup has none, and leaves no one out.
                    if (!summary.removedBy || notShown === 0 || (activeTab === 'jd' ? !selectedRoleId : !lastKeywordPayload)) return null;
                    return (
                      <a
                        role="button"
                        onClick={() => setNotShownOpen(true)}
                        style={{ fontSize: 12, fontWeight: 600 }}
                      >
                        See the {notShown.toLocaleString('en-IN')} not shown
                      </a>
                    );
                  })()}
                  {/* Carries the match score and the per-dimension breakdown the
                      cards have no room for. The server re-runs the search. */}
                  <ExportButton
                    request={(cfg) => (activeTab === 'jd'
                      ? screeningService.exportRoleCandidates(selectedRoleId, cfg, jdAddedWithin, jdTaggedOnly, jdActiveFirst)
                      : screeningService.exportKeywordCandidates(lastKeywordPayload || {}, cfg))}
                    fallbackName={activeTab === 'jd'
                      ? 'AAPNA-ATS_Screening-Results.csv'
                      : 'AAPNA-ATS_Screening-Keyword-Search.csv'}
                    rowCount={candidates.length}
                    disabled={activeTab === 'jd' ? !selectedRoleId : !lastKeywordPayload}
                    label="Export"
                    size="small"
                    style={{ marginLeft: 4 }}
                  />
                </div>
              );
            })()}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {summary.aiUnavailable && (
                <Tooltip title="The AI service did not respond. Filtering and ranking are unaffected; AI summaries are missing for this search.">
                  <Tag color="warning" style={{ margin: 0 }}>AI insights unavailable</Tag>
                </Tooltip>
              )}
              {summary.mode !== 'lookup' && (activeTab === 'jd'
                ? [
                    { label: '5★', value: summary.fiveStar || 0, color: 'var(--kpi-c)', hint: 'Excellent match: ranking score 9 or more out of 10.' },
                    { label: '4★', value: summary.fourStar || 0, color: 'var(--kpi-a)', hint: 'Strong match: ranking score 7 to 8.9.' },
                    { label: '3★', value: summary.threeStar || 0, color: 'var(--warning)', hint: 'Moderate match: ranking score 5 to 6.9.' },
                  ]
                : [
                    { label: 'Strong', value: summary.high || 0, color: 'var(--kpi-c)', hint: 'Strong match: 4 or 5 stars (score 7 or more out of 10).' },
                    { label: 'Moderate', value: summary.medium || 0, color: 'var(--kpi-a)', hint: 'Moderate match: 3 stars (score 5 to 6.9).' },
                    { label: 'Weak', value: summary.low || 0, color: 'var(--warning)', hint: 'Weak match: 1 or 2 stars (score below 5).' },
                  ]
              ).map((s) => (
                <Tooltip key={s.label} title={s.hint}>
                  <span className="screening-stat-chip">
                    <span className="dot" style={{ background: s.color }} />
                    {s.label}
                    <span style={{ color: 'var(--text)', fontWeight: 800 }}>{s.value}</span>
                  </span>
                </Tooltip>
              ))}
              {/* L01: how many results are Active / Pending response / New applicant / Inactive. */}
              {summary.mode !== 'lookup' && summary.activityCounts && ['active', 'pending', 'new', 'inactive']
                .filter((k) => summary.activityCounts[k] > 0)
                .map((k) => (
                  <Tooltip key={k} title={activityHint(k, summary.activeWindowDays)}>
                    <span className="screening-stat-chip" data-testid={`activity-count-${k}`}>
                      <span className="dot" style={{ background: ACTIVITY_STYLES[k].dot }} />
                      {ACTIVITY_STYLES[k].label}
                      <span style={{ color: 'var(--text)', fontWeight: 800 }}>{summary.activityCounts[k]}</span>
                    </span>
                  </Tooltip>
                ))}
            </div>
          </div>
        )}

        {/* Loading spinner viewport overlay. The markup moved to the shared
            LoadingOverlay so the Analytics page shows an identical wait. */}
        <LoadingOverlay open={loadingCandidates} message="Matching and scoring candidates..." />

        {loadingCandidates ? (
          <CandidateListSkeleton rows={pageSize > 10 ? 6 : 4} />
        ) : candidates.length > 0 ? (
          <div>
            {/* Select-all row. The checkbox acts on the VISIBLE PAGE only —
                selecting hundreds of unseen candidates from a control that sits
                above ten rows is how a bulk reject goes wrong. Selecting every
                match is still available, but as a deliberate second click. */}
            <div className="screening-selectall-bar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '6px 12px', marginBottom: 10 }}>
              <Checkbox
                checked={pageCandidateIds.length > 0 && pageCandidateIds.every((id) => selectedCandidateKeys.includes(id))}
                indeterminate={
                  pageCandidateIds.some((id) => selectedCandidateKeys.includes(id))
                  && !pageCandidateIds.every((id) => selectedCandidateKeys.includes(id))
                }
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedCandidateKeys((prev) => [...new Set([...prev, ...pageCandidateIds])]);
                  } else {
                    setSelectedCandidateKeys((prev) => prev.filter((id) => !pageCandidateIds.includes(id)));
                  }
                }}
              >
                <Text strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Select this page ({pageCandidateIds.length})
                </Text>
              </Checkbox>

              {candidates.length > pageCandidateIds.length && (
                selectedCandidateKeys.length === candidates.length ? (
                  <Button size="small" type="link" onClick={() => setSelectedCandidateKeys([])}>
                    Clear selection
                  </Button>
                ) : (
                  <Button
                    size="small"
                    type="link"
                    onClick={() => setSelectedCandidateKeys(candidates.map((c) => c.id))}
                  >
                    Select all {candidates.length} matches
                  </Button>
                )
              )}

              {selectedCandidateKeys.length > 0 && (
                <Text type="secondary" style={{ fontSize: 12, marginInlineStart: 'auto' }}>
                  {selectedCandidateKeys.length} selected
                </Text>
              )}
            </div>

            {/* Candidates card list */}
            <Space direction="vertical" style={{ width: '100%' }} size={10}>
              {pageCandidates
                .map((c) => {
                const isSelected = selectedCandidateKeys.includes(c.id);
                const rating = activeTab === 'jd' ? c.starRating : c.relevanceScore;
                
                return (
                  <Card
                    key={c.id}
                    className={`cand-card no-lift${isSelected ? ' is-selected' : ''}`}
                    onClick={() => openCandidateDrawer(c)}
                    style={{ cursor: 'pointer', '--cand-accent': scoreTierColor(rating?.stars ?? 0) }}
                    styles={{ body: { padding: 20 } }}
                  >
                    <Row gutter={[18, 14]} align="middle">
                      <Col>
                        <Checkbox
                          checked={isSelected}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedCandidateKeys((prev) => [...prev, c.id]);
                            } else {
                              setSelectedCandidateKeys((prev) => prev.filter((k) => k !== c.id));
                            }
                          }}
                        />
                      </Col>
                      <Col>
                        {(() => {
                          const initials = (c.Name || '').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
                          return (
                            <span className="cand-avatar-ring">
                              <Avatar
                                shape="circle"
                                size={46}
                                style={{
                                  background: isSelected
                                    ? 'linear-gradient(135deg, var(--gold) 0%, var(--green) 100%)'
                                    : 'var(--ink-2)',
                                  color: isSelected ? '#fff' : 'var(--text-2)',
                                  fontWeight: 700,
                                  fontSize: '15px',
                                }}
                              >
                                {initials}
                              </Avatar>
                            </span>
                          );
                        })()}
                      </Col>
                      <Col xs={24} sm={12} md={14}>
                        <Space direction="vertical" size={5} style={{ width: '100%' }}>
                          <Space align="center" size={8} wrap>
                            <span className="cand-name">{c.Name}</span>
                            {/* This is the surface the requirement actually needs:
                                the recruiter sees the referral WHILE deciding
                                whether to shortlist, not after. No referrer name
                                in a results list — the detail panel names them. */}
                            {c.is_referral ? <ReferralChip compact /> : null}
                            {/* N15: uploaded for / shortlisted to this JD. */}
                            {activeTab === 'jd' ? <JdTagChip tag={c.jd_tag} /> : null}
                            {/* L01: Active / Pending response / New applicant / Inactive. */}
                            <ActivityChip activity={c.activity} />
                            <StatusBadge status={
                              c.FinalStatus === 'Rejected' ? 'rejected'
                                : c.FinalStatus ? 'shortlisted'
                                : 'applied'
                            } />
                            {rating && rating.stars >= 4 && (
                              <Tag
                                style={{
                                  borderRadius: '20px',
                                  fontWeight: 800,
                                  fontSize: '9px',
                                  padding: '1px 6px',
                                  border: '1px solid rgba(122, 146, 46, 0.25)',
                                  background: 'rgba(122, 146, 46, 0.06)',
                                  color: 'var(--gold)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.05em',
                                  margin: 0
                                }}
                              >
                                <ThunderboltOutlined style={{ fontSize: '9px' }} />
                                Top Match
                              </Tag>
                            )}
                          </Space>

                          {/* When the candidate entered the database (N27) — "–" for legacy rows with no date. */}
                          <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                            Added on <strong style={{ color: 'var(--text-2)' }}>{fmtDate(c.createdAt)}</strong>
                          </div>

                          {/* Shortlisted/Rejected by/on — plainly visible, no hover required */}
                          {c.shortlisted_by && (
                            <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                              Shortlisted by <strong style={{ color: 'var(--text-2)' }}>{c.shortlisted_by}</strong> on {fmtDate(c.shortlisted_at)}
                            </div>
                          )}
                          {c.rejected_by && (
                            <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                              Rejected by <strong style={{ color: 'var(--text-2)' }}>{c.rejected_by}</strong> on {fmtDate(c.rejected_at)}
                            </div>
                          )}

                          {/* Pipeline history (M6) — how far this candidate got,
                              and on which role. The lines above say a decision
                              happened; these say at which round, which is what
                              decides whether they are worth approaching again.
                              One chip per journey, so a candidate already live
                              on two other MRFs shows as such. */}
                          {c.pipelineHistory?.length > 0 && (
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                              {c.pipelineHistory.map((j) => (
                                <Tooltip
                                  key={j.pipeline_id}
                                  title={
                                    <div style={{ fontSize: 11.5 }}>
                                      <div style={{ fontWeight: 700, marginBottom: 4 }}>{j.position || 'Role not recorded'}</div>
                                      {j.events.length > 0 ? j.events.map((e, i) => (
                                        <div key={i}>
                                          {fmtDate(e.at)} · {e.status_label || `${e.stage_label} ${e.event_type}`}
                                        </div>
                                      )) : <div>No recorded events yet.</div>}
                                    </div>
                                  }
                                >
                                  <Tag
                                    color={j.is_closed ? 'purple' : (j.current_stage_status === 'rejected' ? 'red' : j.current_stage_status === 'hold' ? 'orange' : 'blue')}
                                    style={{ fontSize: 10, margin: 0, cursor: 'help' }}
                                  >
                                    {j.is_closed ? `Closed — ${j.final_outcome.replace(/_/g, ' ')}` : j.current_stage_label}
                                    {j.position ? ` · ${j.position}` : ''}
                                    {/* G3: shortlisted to the wrong JD from a keyword search?
                                        Fix it here. The dialog says if it is no longer allowed. */}
                                    {activeTab === 'keyword' && j.shortlist_id && !j.is_closed && (
                                      <Button
                                        type="link"
                                        size="small"
                                        style={{ fontSize: 10, height: 'auto', padding: '0 0 0 6px' }}
                                        onClick={(e) => { e.stopPropagation(); setChangeJdTarget({ shortlistId: j.shortlist_id, candidateName: c.Name }); }}
                                        data-testid="change-jd-link"
                                      >
                                        {j.mrf_id ? 'Change JD' : 'Set JD'}
                                      </Button>
                                    )}
                                  </Tag>
                                </Tooltip>
                              ))}
                            </div>
                          )}

                          {/* Current Company */}
                          {(() => {
                            const companyName = formatCurrentCompany(c.CurrentCompany);
                            return companyName ? (
                              <div className="cand-company" style={{ marginTop: '-1px' }}>{companyName}</div>
                            ) : null;
                          })()}

                          {/* Contact (N06): enough to act on a candidate without
                              opening the drawer. Click does not open the drawer, so
                              the text can be selected and copied. */}
                          <div
                            className="cand-contact"
                            data-testid="cand-contact"
                            onClick={(e) => e.stopPropagation()}
                            style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-2)', cursor: 'text' }}
                          >
                            <MailOutlined style={{ color: 'var(--text-3)' }} />
                            <span style={{ wordBreak: 'break-all' }}>{c.EmailID || '—'}</span>
                            <span style={{ color: 'var(--text-3)' }}>·</span>
                            <PhoneOutlined style={{ color: 'var(--text-3)' }} />
                            <span>{c.ContactNumber || '—'}</span>
                          </div>

                          {/* Detail Indicators (Pills) */}
                          <div style={{ display: 'flex', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
                            <span className="screening-pill">
                              <EnvironmentOutlined style={{ color: 'var(--gold)' }} />
                              <span>{c.CurrentLocation || 'N/A'}</span>
                            </span>
                            <span className="screening-pill">
                              <ClockCircleOutlined style={{ color: 'var(--green)' }} />
                              <span>{c.TotalExperienceYears || '0'} yrs exp ({c.LastCompanyExperienceYears ? `${c.LastCompanyExperienceYears} yrs last co.` : '0 yrs last co.'})</span>
                            </span>
                            <span className="screening-pill">
                              <span style={{ fontWeight: 700, color: 'var(--gold)' }}>₹</span>
                              <span>{c.ExpectedCTC_LPA || c.CTC_LPA || '0'} LPA</span>
                            </span>
                            {c.HighestQualification && (
                              <span className="screening-pill">
                                <SolutionOutlined style={{ color: 'var(--gold)' }} />
                                <span>{c.HighestQualification}{c.graduationdegree ? ` (${c.graduationdegree})` : ''}</span>
                              </span>
                            )}
                          </div>

                          <div className="cand-divider" />

                          {/* Skills */}
                          {(() => {
                            const skills = parsePostgresArray(c.Top5KeySkills);
                            if (!skills || skills.length === 0) return null;
                            return (
                              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span className="cand-section-label">Skills</span>
                                <SkillTags skills={skills} max={6} />
                              </div>
                            );
                          })()}

                          {/* JD / Searched skill match — compact meter + present chips */}
                          <JdSkillMatch signals={c.jdSkillSignals} variant="card" label={activeTab === 'keyword' ? 'Searched Skills' : 'Mandatory JD Skills'} />

                          {/* Resume Signals (generic fallback when no JD context, e.g. filter-only search) */}
                          {!c.jdSkillSignals && (() => {
                            const technicalTerms = parseTechnicalTerms(c.resume_technical_terms);
                            if (technicalTerms.length === 0) return null;
                            return (
                              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span className="cand-section-label">Resume Signals</span>
                                {technicalTerms.slice(0, 6).map((t, idx) => (
                                  <span key={idx} className="skill-chip">
                                    {t.term || t}<span className="skill-chip__x">×{t.count || 1}</span>
                                  </span>
                                ))}
                              </div>
                            );
                          })()}
                        </Space>
                      </Col>

                      {/* Right-aligned Rating and Action Buttons */}
                      <Col xs={24} sm={8} md={6} style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 16, marginLeft: 'auto' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                          {rating && (
                            <div className="cand-score">
                              <div className="cand-score__value">
                                {rating.avgScore ?? rating.finalScore ?? (rating.scorePct ? (rating.scorePct / 10) : '')}<small>/10</small>
                              </div>
                              <div className="cand-score__stars">{renderStars(rating.stars, 11)}</div>
                              <Tag
                                color={getFitVerdictColor(rating.label)}
                                className="cand-score__verdict"
                                style={{ margin: 0, border: '1px solid transparent' }}
                              >
                                {rating.label}
                              </Tag>
                            </div>
                          )}
                          {formatNotice(c) && (
                            <span className="screening-pill" style={{ fontSize: 10.5 }}>
                              <ClockCircleOutlined style={{ color: 'var(--green)' }} />
                              <span>{formatNotice(c)}</span>
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Tooltip title="Conversations">
                            <Button
                              icon={<MessageOutlined style={{ fontSize: '15px' }} />}
                              onClick={(e) => {
                                e.stopPropagation();
                                openConversationsModal(c);
                              }}
                              className="screening-action-btn"
                            />
                          </Tooltip>
                          <Tooltip title="Download Resume">
                            <Button
                              icon={<FileTextOutlined style={{ fontSize: '15px' }} />}
                              onClick={(e) => {
                                e.stopPropagation();
                                downloadResume(c);
                              }}
                              className="screening-action-btn"
                            />
                          </Tooltip>
                          <Tooltip title="View details">
                            <Button
                              icon={<RightOutlined style={{ fontSize: '13px' }} />}
                              onClick={(e) => { e.stopPropagation(); openCandidateDrawer(c); }}
                              className="screening-action-btn primary"
                            />
                          </Tooltip>
                        </div>
                      </Col>
                    </Row>
                  </Card>
                );
              })}
            </Space>

            {/* Pagination (client-side; result set is bounded server-side) */}
            {candidates.length > pageSize && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <Pagination
                  current={currentPage}
                  pageSize={pageSize}
                  total={candidates.length}
                  showSizeChanger
                  pageSizeOptions={['10', '20', '50', '100']}
                  showTotal={(total, range) => `${range[0]}-${range[1]} of ${total}`}
                  onChange={(p, s) => { setCurrentPage(p); setPageSize(s); }}
                  onShowSizeChange={(_, s) => { setPageSize(s); setCurrentPage(1); }}
                />
              </div>
            )}
          </div>
        ) : activeTab === 'jd' && summary?.noMandatorySkills ? (
          // Strict JD search found no checkable mandatory skill on the MRF, so
          // it shows nobody rather than everyone in the experience band.
          <Alert
            type="warning"
            showIcon
            style={{ margin: 8 }}
            message="This MRF has no mandatory skills, so no candidates are shown."
            description="Edit the MRF and list the technical skills a candidate must have, separated by commas (for example: SQL, Power BI, JIRA)."
          />
        ) : (
          <div style={{ padding: '64px 24px', textAlign: 'center' }}>
            <div
              style={{
                width: 64, height: 64, borderRadius: '50%',
                background: 'var(--gold-subtle)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: 18,
              }}
            >
              <SearchOutlined style={{ fontSize: 26, color: 'var(--gold)' }} />
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
              {selectedRoleId || form.getFieldValue('keyword')
                ? 'No matching candidates'
                : 'Start screening candidates'}
            </div>
            <Text type="secondary" style={{ fontSize: 13.5 }}>
              {selectedRoleId || form.getFieldValue('keyword')
                ? 'No candidates matched the screening requirements. Try widening your filters.'
                : (activeTab === 'jd'
                    ? 'Select an open role above to instantly match and rank qualified candidates.'
                    : 'Enter skills and filters above, then hit Search to find qualified resumes.')}
            </Text>
          </div>
        )}
      </Card>

      {/* Floating shortlist dock — hidden while the decision modal is open so its own
          Cancel/Confirm footer isn't fought by this fixed-position, higher-z-index bar. */}
      {selectedCandidateKeys.length > 0 && !decisionModalOpen && createPortal(
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--color-primary-bg)',
            border: '2.5px solid var(--color-primary)',
            boxShadow: 'var(--box-shadow-secondary)',
            borderRadius: 16,
            padding: '12px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            zIndex: 10000,
            backdropFilter: 'blur(8px)',
          }}
        >
          <Text strong style={{ fontSize: 14 }}>
            {selectedCandidateKeys.length} candidate{selectedCandidateKeys.length === 1 ? '' : 's'} selected
          </Text>
          <Button
            type="primary"
            icon={<CheckCircleOutlined />}
            onClick={() => openDecisionModal('shortlist')}
            disabled={activeTab === 'jd' && selectedRoleClosed}
            title={activeTab === 'jd' && selectedRoleClosed ? 'This MRF is closed' : undefined}
            style={{ borderRadius: 8, fontWeight: 700 }}
          >
            Shortlist Selected
          </Button>
          <Button
            danger
            icon={<CloseCircleOutlined />}
            onClick={() => openDecisionModal('reject')}
            disabled={activeTab === 'jd' && selectedRoleClosed}
            title={activeTab === 'jd' && selectedRoleClosed ? 'This MRF is closed' : undefined}
            style={{ borderRadius: 8, fontWeight: 700 }}
          >
            Reject Selected
          </Button>
          <Tooltip title="Clear selection">
            <Button
              type="text"
              icon={<CloseCircleOutlined />}
              onClick={() => setSelectedCandidateKeys([])}
              style={{ fontWeight: 600 }}
            />
          </Tooltip>
        </div>,
        document.body
      )}

      <DecisionEmailModal
        open={Boolean(decisionModalOpen)}
        decision={decisionModalOpen || 'shortlist'}
        activeTab={activeTab}
        candidates={candidates.filter((c) => selectedCandidateKeys.includes(c.id))}
        roles={roles}
        defaultMrfId={selectedRoleId}
        defaultRoleName={roleDetails?.role_title}
        confirmLoading={isShortlisting}
        onCancel={() => setDecisionModalOpen(null)}
        onConfirm={handleDecisionConfirm}
      />

      {/* L11: who the search left out, and why. */}
      <NotShownDrawer
        open={notShownOpen}
        onClose={() => setNotShownOpen(false)}
        kind={activeTab === 'jd' ? 'jd' : 'keyword'}
        params={activeTab === 'jd'
          ? (selectedRoleId ? { mrfId: selectedRoleId, addedWithinDays: jdAddedWithin, taggedOnly: jdTaggedOnly } : null)
          : (lastKeywordPayload ? { filters: lastKeywordPayload } : null)}
        contextLabel={activeTab === 'jd'
          ? (selectedRole ? mrfOptionLabel(selectedRole) : 'this JD')
          : 'this keyword search'}
      />

      <ChangeJdModal
        open={Boolean(changeJdTarget)}
        shortlistId={changeJdTarget?.shortlistId ?? null}
        candidateName={changeJdTarget?.candidateName}
        onClose={() => setChangeJdTarget(null)}
        onChanged={handleJdChanged}
      />
      <ShortlistResultModal
        open={Boolean(shortlistResult)}
        roleLabel={shortlistResult?.roleLabel || ''}
        added={shortlistResult?.added}
        emailed={shortlistResult?.emailed}
        skipped={shortlistResult?.skipped}
        failed={shortlistResult?.failed}
        onClose={() => setShortlistResult(null)}
      />

      {/* Full-page blocker while the shortlist/reject request (incl. email sends) runs.
          Rendered via portal to <body> — antd's `fullscreen` Spin uses position:fixed
          in place, which ancestor transforms clip to a sub-container. */}
      <LoadingOverlay
        open={isShortlisting}
        message="Processing candidates..."
        hint="This may take a few seconds. Please wait."
      />

      {/* Sliding Candidate Insights Drawer */}
      <Drawer
        title={
          selectedCandidate ? (
            <div>
              <Title level={4} style={{ margin: 0 }}>{selectedCandidate.Name}</Title>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {selectedCandidate.HighestQualification || 'Candidate Details'}
              </Text>
            </div>
          ) : (
            'Insights'
          )
        }
        placement="right"
        width={560}
        onClose={() => setDrawerOpen(false)}
        open={drawerOpen}
        styles={{ body: { padding: '12px 20px 24px' } }}
        footer={
          selectedCandidate ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '10px 16px', background: 'var(--ink-2)', borderTop: '1px solid var(--border-secondary)' }}>
              <Button 
                onClick={() => setDrawerOpen(false)} 
                style={{ borderRadius: '6px' }}
              >
                Close
              </Button>
              {(() => {
                const isSel = selectedCandidateKeys.includes(selectedCandidate.id);
                return (
                  <Button
                    type="primary"
                    icon={isSel ? <CheckCircleOutlined /> : <UnorderedListOutlined />}
                    onClick={() => {
                      if (isSel) {
                        setSelectedCandidateKeys(prev => prev.filter(id => id !== selectedCandidate.id));
                        message.info('Candidate unselected.');
                      } else {
                        setSelectedCandidateKeys(prev => [...prev, selectedCandidate.id]);
                        message.success('Candidate selected.');
                      }
                    }}
                    style={{
                      borderRadius: '6px',
                      backgroundColor: '#6d7e3d',
                      borderColor: '#6d7e3d',
                      opacity: isSel ? 0.75 : 1
                    }}
                  >
                    {isSel ? 'Selected' : 'Select Candidate'}
                  </Button>
                );
              })()}
            </div>
          ) : null
        }
      >
        {selectedCandidate ? (
          <div>
            <Tabs
              activeKey={drawerTab}
              onChange={setDrawerTab}
              items={[
                {
                  key: 'insights',
                  label: (
                    <Space>
                      <ThunderboltOutlined />
                      AI Insights
                    </Space>
                  ),
                  children: (() => {
                    const rec = selectedCandidate.profile?.shortlistRecommendation || '';
                    const label = rec.split('—')[0].trim();
                    
                    let borderColor = 'rgba(230,126,34,0.35)';
                    let bgColor = 'rgba(230,126,34,0.08)';
                    let textColor = '#e67e22';
                    if (label.startsWith('Yes')) {
                      borderColor = 'rgba(74,124,89,0.35)';
                      bgColor = 'rgba(74,124,89,0.08)';
                      textColor = '#4a7c59';
                    } else if (label.startsWith('No')) {
                      borderColor = 'rgba(192,57,43,0.3)';
                      bgColor = 'rgba(192,57,43,0.06)';
                      textColor = '#c0392b';
                    }
                    
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 10 }}>
                        
                        {/* Recruiter Summary */}
                        {selectedCandidate.profile?.summary && (
                          <div>
                            <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '8px' }}>AI Profile</div>
                            <div style={{
                              fontSize: '12.5px',
                              color: 'var(--text-1)',
                              lineHeight: '1.7',
                              marginBottom: '14px',
                              padding: '14px 16px',
                              background: 'linear-gradient(135deg, rgba(109,126,61,0.08), transparent)',
                              borderLeft: '3px solid #6d7e3d',
                              borderRadius: '0 8px 8px 0'
                            }}>
                              {selectedCandidate.profile.summary}
                            </div>
                          </div>
                        )}

                        {/* Side-by-Side Fit Verdict & Shortlist Recommendation */}
                        {selectedCandidate.profile && (selectedCandidate.profile.fitVerdict || selectedCandidate.profile.shortlistRecommendation) && (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
                            {selectedCandidate.profile.fitVerdict && (
                              <div style={{ padding: '10px 12px', background: bgColor, borderRadius: '8px', border: `1px solid ${borderColor}` }}>
                                <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '5px' }}>Fit Verdict</div>
                                <div style={{ fontSize: '11.5px', color: 'var(--text-1)', lineHeight: '1.5', fontWeight: 500 }}>{selectedCandidate.profile.fitVerdict}</div>
                              </div>
                            )}
                            {selectedCandidate.profile.shortlistRecommendation && (
                              (() => {
                                const reason = rec.includes('—') ? rec.split('—').slice(1).join('—').trim() : '';
                                return (
                                  <div style={{ padding: '10px 12px', borderRadius: '8px', border: `1px solid ${borderColor}`, backgroundColor: bgColor }}>
                                    <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '5px' }}>Shortlist</div>
                                    <div style={{ fontSize: '13px', fontWeight: 700, color: textColor, marginBottom: '3px' }}>{label}</div>
                                    {reason && <div style={{ fontSize: '10px', color: 'var(--text-3)', lineHeight: '1.4' }}>{reason}</div>}
                                  </div>
                                );
                              })()
                            )}
                          </div>
                        )}

                      {/* Red Flags Alert Card */}
                      {selectedCandidate.profile?.redFlags && selectedCandidate.profile.redFlags.length > 0 && (
                        <div style={{ marginBottom: '14px', padding: '12px 14px', background: 'rgba(192,57,43,0.05)', border: '1px solid rgba(192,57,43,0.2)', borderRadius: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                            <WarningOutlined style={{ color: '#c0392b', fontSize: '12px' }} />
                            <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#c0392b' }}>Red Flags</span>
                          </div>
                          {selectedCandidate.profile.redFlags.map((flag, idx) => (
                            <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '7px', marginBottom: '5px' }}>
                              <span style={{ color: '#c0392b', fontSize: '11px', flexShrink: 0, marginTop: '1px' }}>•</span>
                              <span style={{ fontSize: '11.5px', color: '#b03020', lineHeight: 1.5 }}>{flag}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Skill Coverage Section */}
                      {selectedCandidate.profile?.skillGap && (
                        <div style={{ marginBottom: '14px' }}>
                          <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '8px' }}>Skill Coverage</div>
                          
                          {selectedCandidate.profile.skillGap.mandatory?.present?.length > 0 && (
                            <div style={{ marginBottom: '8px' }}>
                              <div style={{ fontSize: '9px', color: '#4a7c59', fontWeight: 600, marginBottom: '4px' }}>✓ Mandatory — Present</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                {selectedCandidate.profile.skillGap.mandatory.present.map((s) => (
                                  <span key={s} style={{ fontSize: '10.5px', background: 'rgba(74,124,89,0.12)', color: '#4a7c59', padding: '3px 9px', borderRadius: '20px', border: '1px solid rgba(74,124,89,0.25)', fontWeight: 500 }}>{s}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {selectedCandidate.profile.skillGap.mandatory?.missing?.length > 0 && (
                            <div style={{ marginBottom: '8px' }}>
                              <div style={{ fontSize: '9px', color: '#c0392b', fontWeight: 600, marginBottom: '4px' }}>✗ Mandatory — Missing</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                {selectedCandidate.profile.skillGap.mandatory.missing.map((s) => (
                                  <span key={s} style={{ fontSize: '10.5px', background: 'rgba(192,57,43,0.08)', color: '#c0392b', padding: '3px 9px', borderRadius: '20px', border: '1px solid rgba(192,57,43,0.2)', fontWeight: 500 }}>{s}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {selectedCandidate.profile.skillGap.goodToHave?.present?.length > 0 && (
                            <div style={{ marginBottom: '8px' }}>
                              <div style={{ fontSize: '9px', color: '#6d7e3d', fontWeight: 600, marginBottom: '4px' }}>✓ Good to Have — Present</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                {selectedCandidate.profile.skillGap.goodToHave.present.map((s) => (
                                  <span key={s} style={{ fontSize: '10.5px', background: 'rgba(109,126,61,0.12)', color: '#6d7e3d', padding: '3px 9px', borderRadius: '20px', border: '1px solid rgba(109,126,61,0.25)', fontWeight: 500 }}>{s}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {selectedCandidate.profile.skillGap.goodToHave?.missing?.length > 0 && (
                            <div style={{ marginBottom: '8px' }}>
                              <div style={{ fontSize: '9px', color: 'var(--text-3)', fontWeight: 600, marginBottom: '4px' }}>✗ Good to Have — Missing</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                {selectedCandidate.profile.skillGap.goodToHave.missing.map((s) => (
                                  <span key={s} style={{ fontSize: '10.5px', background: 'var(--ink-4)', color: 'var(--text-3)', padding: '3px 9px', borderRadius: '20px', border: '1px solid var(--border-secondary)', fontWeight: 500 }}>{s}</span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* JD Skill Match Section (cross-references JD skills vs resume signals + declared skills) */}
                      {selectedCandidate.jdSkillSignals && (
                        <div style={{ marginBottom: '14px' }}>
                          <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '8px' }}>{activeTab === 'keyword' ? 'Searched Skill Match' : 'JD Skill Match'}</div>
                          <JdSkillMatch signals={selectedCandidate.jdSkillSignals} label={activeTab === 'keyword' ? 'Searched Skills' : 'Mandatory JD Skills'} />
                        </div>
                      )}

                      {/* Resume Signals Section */}
                      {(() => {
                        const technicalTerms = parseTechnicalTerms(selectedCandidate.resume_technical_terms);
                        if (technicalTerms.length === 0) return null;
                        return (
                          <div style={{ marginBottom: '14px' }}>
                            <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '8px' }}>Resume Signals</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                              {technicalTerms.slice(0, 15).map((t, idx) => (
                                <span 
                                  key={idx} 
                                  style={{ 
                                    fontSize: '11px', 
                                    background: 'var(--ink-4)', 
                                    color: 'var(--text-2)', 
                                    padding: '3px 9px', 
                                    borderRadius: '6px', 
                                    border: '1px solid var(--border-light)', 
                                    fontWeight: 500 
                                  }}
                                >
                                  {t.term || t} <span style={{ opacity: 0.6, marginLeft: '2px', fontSize: '9.5px', fontWeight: 600 }}>x{t.count || 1}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Career Trajectory Card */}
                      {selectedCandidate.profile?.careerProgression && (
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px', background: bgColor, borderRadius: '8px', border: `1px solid ${borderColor}`, marginBottom: '14px' }}>
                          <RiseOutlined style={{ color: textColor, fontSize: '14px', flexShrink: 0, marginTop: '2px' }} />
                          <div>
                            <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '3px' }}>Career Trajectory</div>
                            <div style={{ fontSize: '11.5px', color: 'var(--text-1)', lineHeight: '1.5' }}>{selectedCandidate.profile.careerProgression}</div>
                          </div>
                        </div>
                      )}

                      {/* Candidate Score Header & Parameter Breakdown Cards */}
                      {drawerRating?.breakdown && Object.keys(drawerRating.breakdown).length > 0 && (
                        <div>
                          {/* Section Header */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)' }}>Candidate Score</div>
                            <span style={{ fontSize: '10px', color: 'var(--text-3)', fontFamily: 'monospace' }}>
                              {drawerRating.mode === 'keyword' ? 'Keyword Mode' : (drawerRating.mode || (selectedRoleId ? 'JD Mode' : 'Keyword Mode'))}
                            </span>
                          </div>
                          
                          {/* Score visual breakdown row */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px', marginBottom: '14px' }}>
                            <div>{renderStars(drawerRating.stars)}</div>
                            <span style={{ fontSize: '22px', fontWeight: 700, color: '#6d7e3d', fontFamily: 'monospace', lineHeight: 1 }}>
                              {Math.round(drawerScore)}
                            </span>
                            {(() => {
                              const label = drawerRating.label;
                              const val = drawerScore;
                              let borderColor = 'rgba(230,126,34,0.35)';
                              let bgColor = 'rgba(230,126,34,0.08)';
                              let textColor = '#e67e22';
                              if (val >= 8) {
                                borderColor = 'rgba(74,124,89,0.35)';
                                bgColor = 'rgba(74,124,89,0.08)';
                                textColor = '#4a7c59';
                              } else if (val >= 6) {
                                borderColor = 'rgba(109,126,61,0.35)';
                                bgColor = 'rgba(109,126,61,0.08)';
                                textColor = '#6d7e3d';
                              } else if (val >= 4) {
                                borderColor = 'rgba(61,107,138,0.35)';
                                bgColor = 'rgba(61,107,138,0.08)';
                                textColor = '#3d6b8a';
                              } else {
                                borderColor = 'rgba(192,57,43,0.3)';
                                bgColor = 'rgba(192,57,43,0.06)';
                                textColor = '#c0392b';
                              }
                              return (
                                <span style={{
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  padding: '3px 8px',
                                  borderRadius: '4px',
                                  border: `1px solid ${borderColor}`,
                                  backgroundColor: bgColor,
                                  color: textColor
                                }}>
                                  {label}
                                </span>
                              );
                            })()}
                          </div>

                          {/* Individual Parameter Cards */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {Object.entries(drawerRating.breakdown).map(([key, item]) => {
                              const scoreVal = item.score ?? item.pts ?? 0;
                              // Keyword reasons are computed from the actual match
                              // (which skill was found where), so they win over the
                              // AI's generic per-parameter text.
                              const reason = (drawerRating.mode === 'keyword' || drawerRating.mode === 'JD Strict' ? item.reason : null)
                                || selectedCandidate.profile?.scoreReasons?.[key] || item.reason || 'Criteria metrics verified';
                              
                              // Map color based on score value
                              let color = '#c0392b'; // Red
                              let bgColor = 'rgba(192,57,43,0.05)';
                              let borderColor = 'rgba(192,57,43,0.15)';
                              if (scoreVal >= 8) {
                                color = '#4a7c59'; // Green
                                bgColor = 'rgba(74,124,89,0.07)';
                                borderColor = 'rgba(74,124,89,0.15)';
                              } else if (scoreVal >= 6) {
                                color = '#6d7e3d'; // Olive
                                bgColor = 'rgba(109,126,61,0.07)';
                                borderColor = 'rgba(109,126,61,0.15)';
                              } else if (scoreVal >= 4) {
                                color = '#3d6b8a'; // Blue
                                bgColor = 'rgba(61,107,138,0.07)';
                                borderColor = 'rgba(61,107,138,0.15)';
                              }
                              
                              const criteria = getCriteria(key);

                              return (
                                <div
                                  key={key}
                                  style={{
                                    background: bgColor,
                                    border: `1px solid ${borderColor}`,
                                    padding: '10px 12px',
                                    borderRadius: '8px',
                                    display: 'flex',
                                    flexDirection: 'column'
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: (reason || criteria) ? '7px' : '0' }}>
                                    <div style={{ fontSize: '11.5px', color: 'var(--text-2)', fontWeight: 500, flex: 1 }}>
                                      {item.label}
                                      {item.weight != null && item.weight < 1 && (
                                        <span style={{ color: 'var(--text-3)', fontWeight: 400 }}> · {Math.round(item.weight * 100)}% of score</span>
                                      )}
                                    </div>
                                    
                                    {/* Custom Progress Bar */}
                                    <div style={{ width: '80px', height: '4px', background: 'var(--ink-4)', borderRadius: '4px', overflow: 'hidden', flexShrink: 0 }}>
                                      <div style={{ height: '100%', width: `${scoreVal * 10}%`, background: color, borderRadius: '4px' }} />
                                    </div>
                                    
                                    <div style={{ fontSize: '13px', fontWeight: 700, color: color, fontFamily: 'monospace', width: '18px', textAlign: 'right', flexShrink: 0 }}>
                                      {scoreVal}
                                    </div>
                                  </div>
                                  
                                  {reason && (
                                    <div style={{ fontSize: '11px', color: 'var(--text-3)', lineHeight: '1.5', borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: '6px' }}>
                                      {reason}
                                    </div>
                                  )}
                                  
                                  {criteria && (
                                    <div style={{
                                      fontSize: '10px',
                                      color: 'var(--text-3)',
                                      fontFamily: 'monospace',
                                      marginTop: reason ? '4px' : '0',
                                      paddingTop: reason ? '4px' : '0',
                                      borderTop: reason ? '1px solid rgba(0,0,0,0.04)' : 'none',
                                      display: 'flex',
                                      gap: '6px',
                                      alignItems: 'center'
                                    }}>
                                      <span style={{ color: 'var(--text-3)', opacity: 0.6 }}>▸</span>
                                      {criteria}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      </div>
                    );
                  })(),
                },
                {
                  key: 'details',
                  label: (
                    <Space>
                      <SolutionOutlined />
                      Candidate Details
                    </Space>
                  ),
                  children: (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 10 }}>
                      
                      {/* Section: CONTACT */}
                      <div>
                        <Text strong style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>CONTACT</Text>
                        <Card size="small" style={{ borderRadius: 8, background: 'var(--ink-3)', marginTop: 4 }}>
                          <Row gutter={[16, 8]}>
                            <Col span={12}>
                              <Text type="secondary" style={{ fontSize: 11, display: 'block', textTransform: 'uppercase' }}>Email</Text>
                              <Text strong style={{ fontSize: 13, wordBreak: 'break-all' }}>{selectedCandidate.EmailID || '—'}</Text>
                            </Col>
                            <Col span={12}>
                              <Text type="secondary" style={{ fontSize: 11, display: 'block', textTransform: 'uppercase' }}>Phone</Text>
                              <Text strong style={{ fontSize: 13 }}>{selectedCandidate.ContactNumber || '—'}</Text>
                            </Col>
                            <Col span={24}>
                              <Text type="secondary" style={{ fontSize: 11, display: 'block', textTransform: 'uppercase' }}>LinkedIn</Text>
                              <Text strong style={{ fontSize: 13 }}>
                                {selectedCandidate.LinkedInProfile && selectedCandidate.LinkedInProfile !== 'na' ? (
                                  <a href={selectedCandidate.LinkedInProfile} target="_blank" rel="noopener noreferrer">{selectedCandidate.LinkedInProfile}</a>
                                ) : '—'}
                              </Text>
                            </Col>
                          </Row>
                        </Card>
                      </div>

                      {/* Section: EXPERIENCE & COMPENSATION */}
                      <div>
                        <Text strong style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>EXPERIENCE & COMPENSATION</Text>
                        <Card size="small" style={{ borderRadius: 8, background: 'var(--ink-3)', marginTop: 4 }}>
                          <Row gutter={[16, 12]}>
                            <Col span={12}>
                              <Text type="secondary" style={{ fontSize: 11, display: 'block', textTransform: 'uppercase' }}>Total Exp</Text>
                              <Text strong style={{ fontSize: 13 }}>{selectedCandidate.TotalExperienceYears ? `${selectedCandidate.TotalExperienceYears} yrs` : '0 yrs'}</Text>
                            </Col>
                            <Col span={12}>
                              <Text type="secondary" style={{ fontSize: 11, display: 'block', textTransform: 'uppercase' }}>Last Co. Exp</Text>
                              <Text strong style={{ fontSize: 13 }}>{selectedCandidate.LastCompanyExperienceYears ? `${selectedCandidate.LastCompanyExperienceYears} yrs` : '0 yrs'}</Text>
                            </Col>
                            <Col span={12}>
                              <Text type="secondary" style={{ fontSize: 11, display: 'block', textTransform: 'uppercase' }}>Current CTC</Text>
                              <Text strong style={{ fontSize: 13 }}>₹{selectedCandidate.CTC_LPA || '0'} LPA</Text>
                            </Col>
                            <Col span={12}>
                              <Text type="secondary" style={{ fontSize: 11, display: 'block', textTransform: 'uppercase' }}>Expected CTC</Text>
                              <Text strong style={{ fontSize: 13 }}>₹{selectedCandidate.ExpectedCTC_LPA || '0'} LPA</Text>
                            </Col>
                            <Col span={12}>
                              <Text type="secondary" style={{ fontSize: 11, display: 'block', textTransform: 'uppercase' }}>Notice Period</Text>
                              <Text strong style={{ fontSize: 13 }}>{selectedCandidate.NoticePeriod ? `${selectedCandidate.NoticePeriod} days` : '0 days'}</Text>
                            </Col>
                            <Col span={12}>
                              <Text type="secondary" style={{ fontSize: 11, display: 'block', textTransform: 'uppercase' }}>Gender</Text>
                              <Text strong style={{ fontSize: 13 }}>{selectedCandidate.Gender || '—'}</Text>
                            </Col>
                            <Col span={24}>
                              <Text type="secondary" style={{ fontSize: 11, display: 'block', textTransform: 'uppercase' }}>Current Company</Text>
                              <Text strong style={{ fontSize: 13 }}>
                                {formatCurrentCompany(selectedCandidate.CurrentCompany) || '—'}
                              </Text>
                            </Col>
                          </Row>
                        </Card>
                      </div>

                      {/* Section: SKILLS */}
                      <div>
                        <Text strong style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>SKILLS</Text>
                        <div style={{ marginTop: 6 }}>
                          <Space size={[4, 6]} wrap>
                            {parsePostgresArray(selectedCandidate.Top5KeySkills).map((s) => (
                              <Tag key={s} style={{ margin: 0, fontSize: 12, padding: '4px 10px', borderRadius: 6, background: '#f1f3f5', border: '1px solid #ced4da', color: '#495057', fontWeight: 500 }}>
                                {s}
                              </Tag>
                            ))}
                          </Space>
                        </div>
                      </div>

                      {/* Section: EDUCATION */}
                      <div>
                        <Text strong style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>EDUCATION</Text>
                        <Card size="small" style={{ borderRadius: 8, background: 'var(--ink-3)', marginTop: 4 }}>
                          <Row gutter={[16, 12]}>
                            <Col span={24}>
                              <Text type="secondary" style={{ fontSize: 11, display: 'block', textTransform: 'uppercase' }}>Highest Qualification</Text>
                              <Text strong style={{ fontSize: 13 }}>{selectedCandidate.HighestQualification || '—'}</Text>
                            </Col>
                            <Col span={24}>
                              <Text type="secondary" style={{ fontSize: 11, display: 'block', textTransform: 'uppercase' }}>Graduation Stream</Text>
                              <Text strong style={{ fontSize: 13 }}>
                                {selectedCandidate.graduationdegree 
                                  ? `${selectedCandidate.graduationdegree}${selectedCandidate.graduationspecialization ? ` - ${selectedCandidate.graduationspecialization}` : ''}`
                                  : '—'}
                              </Text>
                            </Col>
                            <Col span={24}>
                              <Text type="secondary" style={{ fontSize: 11, display: 'block', textTransform: 'uppercase' }}>PG Stream</Text>
                              <Text strong style={{ fontSize: 13 }}>
                                {selectedCandidate.postgraduationdegree
                                  ? `${selectedCandidate.postgraduationdegree}${selectedCandidate.postgraduationspecialization ? ` - ${selectedCandidate.postgraduationspecialization}` : ''}`
                                  : '—'}
                              </Text>
                            </Col>
                            <Col span={24}>
                              <Text type="secondary" style={{ fontSize: 11, display: 'block', textTransform: 'uppercase' }}>Scores</Text>
                              <Text strong style={{ fontSize: 13 }}>
                                {[
                                  selectedCandidate.a10th ? `10th: ${selectedCandidate.a10th}%` : null,
                                  selectedCandidate.a12th ? `12th: ${selectedCandidate.a12th}%` : null,
                                  selectedCandidate.graduation ? `Grad: ${selectedCandidate.graduation}%` : null,
                                  selectedCandidate.postGraduation ? `PostGrad: ${selectedCandidate.postGraduation}%` : null,
                                ].filter(Boolean).join(' · ') || '—'}
                              </Text>
                            </Col>
                          </Row>
                        </Card>
                      </div>

                      {/* Section: PREFERENCES & READINESS */}
                      <div>
                        <Text strong style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>PREFERENCES & READINESS</Text>
                        <Card size="small" style={{ borderRadius: 8, background: 'var(--ink-3)', marginTop: 4 }}>
                          <Row gutter={[16, 12]}>
                            <Col span={12}>
                              <Text type="secondary" style={{ fontSize: 11, display: 'block', textTransform: 'uppercase' }}>Preferred Shift</Text>
                              <Text strong style={{ fontSize: 13 }}>{selectedCandidate.PreferredShift || '—'}</Text>
                            </Col>
                            <Col span={12}>
                              <Text type="secondary" style={{ fontSize: 11, display: 'block', textTransform: 'uppercase' }}>Job Source</Text>
                              <Text strong style={{ fontSize: 13 }}>{selectedCandidate.JobSource || '—'}</Text>
                            </Col>
                            {/* Referral sits beside Job Source, the free-text field
                                this replaces. Screening is behind requireStaff +
                                the candidate_screening module, so no vendor or
                                interviewer reaches it. */}
                            <Col span={12}>
                              <Text type="secondary" style={{ fontSize: 11, display: 'block', textTransform: 'uppercase' }}>Referral</Text>
                              {selectedCandidate.is_referral ? (
                                <Text strong style={{ fontSize: 13 }}>
                                  Yes — referred by {selectedCandidate.referred_by || '—'}
                                </Text>
                              ) : (
                                <Text strong style={{ fontSize: 13 }}>—</Text>
                              )}
                            </Col>
                            <Col span={12}>
                              <Text type="secondary" style={{ fontSize: 11, display: 'block', textTransform: 'uppercase' }}>Reason for Change</Text>
                              <Text strong style={{ fontSize: 13 }}>{selectedCandidate.ReasonForJobChange || '—'}</Text>
                            </Col>
                            <Col span={12}>
                              <Text type="secondary" style={{ fontSize: 11, display: 'block', textTransform: 'uppercase' }}>English Rating</Text>
                              <div>
                                {selectedCandidate.EnglishCommunicationRating 
                                  ? renderStars(parseInt(selectedCandidate.EnglishCommunicationRating, 10)) 
                                  : '—'}
                              </div>
                            </Col>
                            <Col span={12}>
                              <Text type="secondary" style={{ fontSize: 11, display: 'block', textTransform: 'uppercase' }}>Willing for Test</Text>
                              <Tag color={selectedCandidate.WillingToTakeOnlineTest === 'Yes' ? 'success' : 'default'} style={{ borderRadius: 4, marginTop: 2 }}>
                                {selectedCandidate.WillingToTakeOnlineTest || '—'}
                              </Tag>
                            </Col>
                            <Col span={12}>
                              <Text type="secondary" style={{ fontSize: 11, display: 'block', textTransform: 'uppercase' }}>Has Laptop</Text>
                              <Tag color={selectedCandidate.HasLaptopForInitialDays === 'Yes' ? 'success' : 'default'} style={{ borderRadius: 4, marginTop: 2 }}>
                                {selectedCandidate.HasLaptopForInitialDays || '—'}
                              </Tag>
                            </Col>
                          </Row>
                        </Card>
                      </div>

                      {/* Section: VENDOR INFO */}
                      <div>
                        <Text strong style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>VENDOR INFO</Text>
                        <Card size="small" style={{ borderRadius: 8, background: 'var(--ink-3)', marginTop: 4 }}>
                          <Row gutter={[16, 8]}>
                            <Col span={12}>
                              <Text type="secondary" style={{ fontSize: 11, display: 'block', textTransform: 'uppercase' }}>Vendor Name</Text>
                              <Text strong style={{ fontSize: 13 }}>{selectedCandidate.vendorName || '—'}</Text>
                            </Col>
                            <Col span={12}>
                              <Text type="secondary" style={{ fontSize: 11, display: 'block', textTransform: 'uppercase' }}>Vendor Email</Text>
                              <Text strong style={{ fontSize: 13, wordBreak: 'break-all' }}>{selectedCandidate.VendorEmail || '—'}</Text>
                            </Col>
                          </Row>
                        </Card>
                      </div>

                      {/* Section: SYSTEM STATUS */}
                      <div>
                        <Text strong style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>SYSTEM STATUS</Text>
                        <Card size="small" style={{ borderRadius: 8, background: 'var(--ink-3)', marginTop: 4 }}>
                          <Row gutter={[16, 8]}>
                            <Col span={24}>
                              <Text type="secondary" style={{ fontSize: 11, display: 'block', textTransform: 'uppercase' }}>RPA Final Status</Text>
                              <Text strong style={{ fontSize: 13 }}>{selectedCandidate.FinalStatus || 'No Status'}</Text>
                            </Col>
                            {selectedCandidate.shortlisted_by && (
                              <>
                                <Col span={12}>
                                  <Text type="secondary" style={{ fontSize: 11, display: 'block', textTransform: 'uppercase' }}>Shortlisted By</Text>
                                  <Text strong style={{ fontSize: 13 }}>{selectedCandidate.shortlisted_by}</Text>
                                </Col>
                                <Col span={12}>
                                  <Text type="secondary" style={{ fontSize: 11, display: 'block', textTransform: 'uppercase' }}>Shortlisted On</Text>
                                  <Text strong style={{ fontSize: 13 }}>{fmtDateTime(selectedCandidate.shortlisted_at)}</Text>
                                </Col>
                              </>
                            )}
                            {selectedCandidate.rejected_by && (
                              <>
                                <Col span={12}>
                                  <Text type="secondary" style={{ fontSize: 11, display: 'block', textTransform: 'uppercase' }}>Rejected By</Text>
                                  <Text strong style={{ fontSize: 13 }}>{selectedCandidate.rejected_by}</Text>
                                </Col>
                                <Col span={12}>
                                  <Text type="secondary" style={{ fontSize: 11, display: 'block', textTransform: 'uppercase' }}>Rejected On</Text>
                                  <Text strong style={{ fontSize: 13 }}>{fmtDateTime(selectedCandidate.rejected_at)}</Text>
                                </Col>
                              </>
                            )}
                          </Row>
                        </Card>
                      </div>

                      {/* Section: EMPLOYMENT TIMELINE */}
                      <div>
                        <Text strong style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>EMPLOYMENT TIMELINE</Text>
                        <div style={{ marginTop: 8 }}>
                          {selectedCandidate.employment_history?.companies && selectedCandidate.employment_history.companies.length > 0 ? (
                            <Timeline
                              mode="left"
                              style={{ marginTop: 12 }}
                              items={selectedCandidate.employment_history.companies.map((company, idx) => ({
                                color: 'var(--color-primary)',
                                children: (
                                  <div style={{ fontSize: 13 }}>
                                    <Text strong>{company.CompanyName || '[Company Name]'}</Text>
                                    <div>
                                      <Text type="secondary" style={{ fontSize: 11 }}>
                                        {company.StartDate || '[Start Date]'} — {company.EndDate || '[End Date]'}
                                        {company.YearsWorked ? ` · (${company.YearsWorked} yrs)` : ''}
                                      </Text>
                                    </div>
                                  </div>
                                ),
                              }))}
                            />
                          ) : (
                            <Empty description="No employment history parsed." image={Empty.PRESENTED_IMAGE_SIMPLE} styles={{ image: { height: 40 } }} />
                          )}
                        </div>
                      </div>

                    </div>
                  ),
                },
              ]}
            />
          </div>
        ) : (
          <Spin />
        )}
      </Drawer>

      {/* Conversations Modal */}
      <Modal
        open={convModalVisible}
        onCancel={() => setConvModalVisible(false)}
        footer={null}
        width={680}
        styles={{ body: { padding: 0 } }}
        closeIcon={null}
        destroyOnClose
        centered
      >
        <div className="conv-modal-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="conv-modal-title">
              {convCandidate ? convCandidate.Name : '—'}
            </div>
            <div className="conv-modal-sub">
              {convCandidate ? [convCandidate.PositionApplied || convCandidate.Designation || convCandidate.designation || '', convCandidate.EmailID].filter(Boolean).join(' · ') : '—'}
            </div>
          </div>
          {convMessages.length > 0 && (
            <span className="conv-msg-count">
              {convMessages.length} message{convMessages.length !== 1 ? 's' : ''}
            </span>
          )}
          <button className="conv-close" onClick={() => setConvModalVisible(false)} style={{ marginLeft: 12 }}>
            &#x2715;
          </button>
        </div>

        <div className="conv-body" ref={convBodyRef}>
          {convLoading ? (
            <div className="conv-loading">
              <Spin size="small" /> <span style={{ marginLeft: 8 }}>Loading conversations...</span>
            </div>
          ) : convMessages.length > 0 ? (
            convMessages.map((msg, index) => {
              const isOut = msg.direction === 'outbound';
              const timeStr = msg.sent_at
                ? fmtDateTime(msg.sent_at)
                : '';
              const showBadge = isOut && msg.tracking;
              const cleanBodyText = cleanMsgBody(msg.body_preview || msg.body_html);

              return (
                <div key={index} style={{ display: 'flex', flexDirection: 'column' }}>
                  <div className={`conv-msg ${isOut ? 'out' : 'in'}`}>
                    {msg.subject && (
                      <div
                        className="conv-msg-subject"
                        style={{ color: isOut ? 'rgba(255,255,255,0.95)' : 'var(--olive)' }}
                      >
                        {msg.subject}
                      </div>
                    )}
                    <div className="conv-msg-body">{cleanBodyText}</div>
                    <div className="conv-msg-meta">
                      <span>{timeStr}</span>
                      {showBadge && (
                        msg.tracking.opened ? (
                          <span className="conv-badge conv-b-opened">Opened</span>
                        ) : (
                          <span className="conv-badge conv-b-delivered">Delivered</span>
                        )
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="conv-empty">
              No email conversations found for this candidate.
            </div>
          )}
        </div>
      </Modal>

    </div>
  );
}
