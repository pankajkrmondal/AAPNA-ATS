import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Tabs,
  Typography,
  Select,
  Input,
  /* Button now comes from src/ui — see the import below. */
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
import dayjs from 'dayjs';
import { useQueryClient } from '@tanstack/react-query';
import useAuth from '../hooks/useAuth';
import screeningService from '../services/screeningService';
import { useApprovedRoles, useRoleCandidates, screeningKeys } from '../hooks/useScreeningData';
import StatusBadge from '../components/common/StatusBadge';
import SkillTags from '../components/common/SkillTags';
import ExportButton from '../components/common/ExportButton';
import LoadingOverlay from '../components/common/LoadingOverlay';
import DecisionEmailModal from '../components/screening/DecisionEmailModal';
import { cleanMsgBody } from '../utils/emailText';
import { DesignScope, PageShell, PageHeader, Surface, Button, SegmentedTabs } from '../ui';
// After '../ui' so page rules win on equal specificity.
import '../styles/pages/candidate-screening.css';

const { Title, Text, Paragraph } = Typography;
const { Panel } = Collapse;

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
      <div className="cs-col">
        {mandatory.length > 0 && (
          <div className="match-meter">
            <span className="match-meter__head">{head}</span>
            <span className="match-meter__bar"><span className="match-meter__fill" style={{ width: `${pct}%` }} /></span>
            <span className="match-meter__count">{mandPresent.length}/{mandatory.length}</span>
          </div>
        )}
        {(shown.length > 0 || goodToHave.length > 0) && (
          <div className="cs-mid--wrap">
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
          className={'cs-vtag' + (secondary ? ' cs-vtag--secondary' : '')}
          style={{ '--cs-tag-bg': style.bg, '--cs-tag-border': style.border, '--cs-tag-ink': style.color }}
        >
          {s.skill}
          {isPresent(s) ? (
            <span className="cs-suffix">×{s.count}</span>
          ) : s.status === 'listed_only' ? (
            <span className="cs-suffix">listed</span>
          ) : (
            <span className="cs-suffix">missing</span>
          )}
        </Tag>
      </Tooltip>
    );
  };

  return (
    <div className="cs-mt-1-5">
      {mandatory.length > 0 && (
        <div className="cs-mid--gap">
          <span className="cs-caption--muted">{label}:</span>
          <Space size={[4, 6]} wrap>
            {mandatory.map((s, idx) => renderTag(s, idx, false))}
          </Space>
        </div>
      )}
      {goodToHave.length > 0 && (
        <div className="cs-row--tight">
          <span className="cs-caption--muted">Good-to-have:</span>
          <Space size={[4, 6]} wrap>
            {goodToHave.map((s, idx) => renderTag(s, idx, true))}
          </Space>
        </div>
      )}
      {signalsOnly.length > 0 && (
        <div className="cs-note--info">
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
    <div className="shimmer cs-bar" style={{ '--cs-bar-w': w, '--cs-bar-h': typeof h === 'number' ? h + 'px' : h, '--cs-bar-mb': typeof mb === 'number' ? mb + 'px' : mb }} />
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
          <div className="cs-mid--wide">
            <div className="shimmer cs-avatar" />
            <div className="cs-grow">
              <Bar w="38%" h={14} mb={9} />
              <Bar w="62%" h={11} mb={9} />
              <div className="cs-inline">
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
  const [activeEduKeys, setActiveEduKeys] = useState([]);

  // ── Roles Dropdown State ──
  // Roles come from React Query (prefetched at app load), cached for the session.
  const rolesQuery = useApprovedRoles();
  const roles = rolesQuery.data || [];
  const loadingRoles = rolesQuery.isLoading;
  const [selectedRoleId, setSelectedRoleId] = useState(() => {
    const v = localStorage.getItem('screening_selected_role');
    return v ? Number(v) : null;
  });
  const [roleDetails, setRoleDetails] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // Per-role candidates (JD tab) — cached per role so revisiting the page keeps results.
  const roleCandidatesQuery = useRoleCandidates(selectedRoleId, activeTab === 'jd');

  // ── Candidates List State ──
  const [candidates, setCandidates] = useState([]);
  // The keyword filters behind the results on screen, replayed by Export.
  const [lastKeywordPayload, setLastKeywordPayload] = useState(null);
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

  const getCriteria = (key) => {
    if (activeTab !== 'jd' || !roleDetails || !selectedCandidate) return null;
    switch (key) {
      case 'totalExperience':
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
        return selectedCandidate.NoticePeriod != null 
          ? `Candidate: ${selectedCandidate.NoticePeriod} days notice` 
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

  // Force-reload the selected role's candidates, bypassing the backend Redis cache,
  // and write the fresh result into the query cache so the UI updates.
  const forceReloadRoleCandidates = async () => {
    if (!selectedRoleId) return;
    const res = await screeningService.searchRoleCandidates(selectedRoleId, { force: true });
    queryClient.setQueryData(screeningKeys.roleCandidates(selectedRoleId), res);
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

  const handleKeywordSearch = async (values) => {
    setSelectedCandidateKeys([]);
    setCandidates([]);
    setSummary(null);
    setCurrentPage(1);
    setLoadingCandidates(true);

    const payload = {
      ...values,
      education: selectedEduCategories.join(','),
    };
    // Kept so Export can re-run the identical search server-side (the export
    // never sends a candidate list — see screening.export.js).
    setLastKeywordPayload(payload);

    try {
      const res = await screeningService.searchKeywordCandidates(payload);
      const data = res.data?.data || res.data || {};
      setCandidates(data.candidates || []);
      setSummary(data.summary || null);
      message.success(`Search completed: ${data.candidates?.length || 0} matches`);
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
      queryClient.setQueryData(screeningKeys.roleCandidates(selectedRoleId), (prev) => {
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
      const skippedNote = skippedCount > 0
        ? ` ${skippedCount} already had a record for this role and ${skippedCount === 1 ? 'was' : 'were'} left unchanged.`
        : '';
      const failures = result.email_failures || [];
      const verb = decision === 'reject' ? 'Rejected' : 'Shortlisted';

      if (failures.length > 0) {
        // Group identical reasons so the message stays readable for bulk actions.
        const reasons = [...new Set(failures.map((f) => f.reason))];
        notification.warning({
          message: `${verb} ${processedCount}, but ${failures.length} email(s) not sent`,
          description: (
            <div>
              {reasons.map((r, i) => (
                <div key={i} className="cs-mb-1">• {r}</div>
              ))}
              <div className="cs-mt-1-5 cs-muted">
                Affected: {failures.map((f) => f.name).join(', ')}
              </div>
            </div>
          ),
          duration: 0,
        });
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
              <Button emphasis="solid" size="sm" onClick={() => navigate(`/pipeline?candidate=${pipelineId}`)}>
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
              <Button emphasis="solid" size="sm" onClick={() => navigate(`/pipeline?position=${encodeURIComponent(roleName)}`)}>
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

      const decidedIds = new Set(selectedList.map((c) => c.id));
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
        className={'cs-star' + (i < starCount ? ' cs-star--on' : '')}
        style={{ '--cs-star-size': typeof size === 'number' ? size + 'px' : size }}
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
    <DesignScope>
      <PageShell width="standard" className="stagger-children">
      
      {/* Page header — 2026-08-31. Was a hand-rolled `.cs-page-head` div with a
          `Title level={2}`, which resolves to the pack's title2 role: 24px, the largest
          of the app's hand-rolled titles and still 8px under the lab's 32px. */}
      <PageHeader
        eyebrow="Screening"
        title="Candidate Screening"
        subtitle="Rank and screen resumes using semantic search, custom parameters, and AI profiles."
      />

      {/* Main card */}
      <Surface tier={2} padding="relaxed" className="cs-main">
        {/* 2026-09-01 — was an AntD `<Tabs className="screening-tabs">`, which hand-built
            a segmented capsule out of tab chrome: a 10px nav-list, 8px tabs, and the
            ink-bar suppressed with `!important`. `Segmented` is the design system's
            control for this and names `.screening-tabs` in its own header as one of the
            bars it exists to retire. Measured, and the reason this is not just tidying:
            the active tab's label was `--brand-primary` on an opaque pane at **3.51:1**
            in light mode — under the 4.5 AA floor for 15px text. `.ui-segmented__item--active`
            uses `--brand-ink` and measures 5.81:1. Same defect, same fix, as the soft
            button.

            The label `<Space>` wrappers became `.ui-segmented__label`: Space emits its
            own gap markup, and inside a fixed-height pill that is a nested flex row
            fighting the one the pill already provides. */}
        <SegmentedTabs
          aria-label="Screening mode"
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
                <span className="ui-segmented__label">
                  <SolutionOutlined />
                  JD Filtering
                </span>
              ),
              children: (
                <div className="cs-pad-y">
                  <Row gutter={[16, 16]}>
                    <Col xs={24}>
                      <Space direction="vertical" className="cs-full" size={4}>
                        <Text strong className="cs-legend cs-legend--ink">
                          Select an open role to instantly match and rank qualified candidates
                        </Text>
                        <Space.Compact className="cs-full">
                          <Select
                            showSearch
                            placeholder={loadingRoles ? "Loading open roles..." : "— Select an Open Role —"}
                            disabled={loadingRoles}
                            className="cs-full--tall"
                            loading={loadingRoles}
                            value={selectedRoleId}
                            onChange={handleRoleSelect}
                            optionFilterProp="children"
                            options={roles.map((r) => ({
                              value: r.id,
                              label: `${r.role} (${r.number_of_positions} openings)`,
                            }))}
                          />
                          <Tooltip title="Refresh roles & candidates">
                            {/* `size="lg"` gives --control-h-relaxed, the same 46px
                                `.cs-ctl` hardcoded — it has to match the Select it
                                shares a Space.Compact with. */}
                            <Button
                              emphasis="soft"
                              size="lg"
                              iconOnly
                              icon={<ReloadOutlined />}
                              loading={refreshing || rolesQuery.isFetching}
                              onClick={handleRefresh}
                            />
                          </Tooltip>
                        </Space.Compact>
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
                              <Text type="secondary" className="cs-caption">Open Role</Text>
                              <div className="cs-strong--lg">{roleDetails.role_title}</div>
                            </Col>
                            <Col xs={12} sm={6} md={3}>
                              <Text type="secondary" className="cs-caption">Openings</Text>
                              <div className="cs-strong">{roleDetails.role_openings} openings</div>
                            </Col>
                            <Col xs={12} sm={6} md={5}>
                              <Text type="secondary" className="cs-caption">Experience Required</Text>
                              <div className="cs-strong">{roleDetails.total_experience} yrs (rel {roleDetails.relevant_experience} yrs)</div>
                            </Col>
                            <Col xs={24} sm={12} md={5}>
                              <Text type="secondary" className="cs-caption">Target Budget</Text>
                              <div className="cs-strong">
                                {roleDetails.budget_min && roleDetails.budget_max 
                                  ? `₹${roleDetails.budget_min} - ₹${roleDetails.budget_max} LPA`
                                  : 'N/A'}
                              </div>
                            </Col>
                            <Col xs={24} sm={12} md={5} className="cs-end--center">
                              <Button
                                emphasis="text"
                                tone="danger"
                                onClick={() => handleRoleSelect(null)}
                              >
                                Clear
                              </Button>
                            </Col>
                            <Col xs={24}>
                              {(() => {
                                const team = roleDetails.requirement_for_team || roleDetails.role_team;
                                const qualKey = roleDetails.required_qualification || roleDetails.role_required_qualification;
                                const qualLabel = ROLE_QUAL_LABELS[qualKey] || qualKey;
                                const stream = roleDetails.required_stream || roleDetails.role_required_qualification_stream;
                                const responsibilities = roleDetails.role_responsibilities || roleDetails.roles_and_responsibilities;
                                return (
                                  <>
                                    <Divider className="cs-my-2" />
                                    {/* Meta row: team + qualification */}
                                    {(team || (qualLabel && qualLabel !== 'ANY')) && (
                                      <div className="cs-wrap--wide">
                                        {team && (
                                          <div>
                                            <Text type="secondary" className="cs-caption">Requirement For Team</Text>
                                            <div className="cs-body--strong">{team}</div>
                                          </div>
                                        )}
                                        {qualLabel && (
                                          <div>
                                            <Text type="secondary" className="cs-caption">Qualification</Text>
                                            <div className="cs-body--strong">{qualLabel}{stream ? ` — ${stream}` : ''}</div>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    {/* Skills */}
                                    <Space size={6} direction="vertical" className="cs-full">
                                      <div>
                                        <Tag color="blue" className="cs-tag">MANDATORY SKILLS</Tag>
                                        <Text className="cs-body">{roleDetails.role_mandatory_skills || 'N/A'}</Text>
                                      </div>
                                      {roleDetails.role_good_to_have_skills && (
                                        <div>
                                          <Tag color="cyan" className="cs-tag">GOOD TO HAVE</Tag>
                                          <Text className="cs-body">{roleDetails.role_good_to_have_skills}</Text>
                                        </div>
                                      )}
                                      {responsibilities && (
                                        <div>
                                          <Tag color="green" className="cs-tag">RESPONSIBILITIES</Tag>
                                          <div className="cs-summary">
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
                <span className="ui-segmented__label">
                  <SearchOutlined />
                  Keyword Filtering
                </span>
              ),
              /* Merged 2026-08-31. This Form declared the class attribute twice, so
                 `screening-filter` had been dead for as long as it was written that way
                 — React keeps only the last one. Both classes are wanted: one is the
                 filter form's own styling, the other its top margin.

                 The note lives HERE, outside the parentheses, and not as a {} comment
                 inside them: `children:` holds a single parenthesised expression, so a
                 JSX comment placed before the element becomes a second adjacent
                 expression and the file stops parsing. */
              children: (
                <Form
                  form={form}
                  layout="vertical"
                  onFinish={handleKeywordSearch}
                  className="screening-filter cs-mt-2"
                >
                  <Row gutter={[16, 8]}>
                    <Col xs={24} sm={8}>
                      <Form.Item
                        label="Skills"
                        name="keyword"
                        extra={
                          <span className="field-hint">
                            Separate skills with commas — matched against skills, resume keywords &amp; full resume text.
                          </span>
                        }
                      >
                        <Input size="large" allowClear placeholder="e.g. Python, Django, AWS" prefix={<SearchOutlined className="cs-muted" />} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={8}>
                      <Form.Item label="Designation" name="designation" extra={<span className="field-hint">Target role or title</span>}>
                        <Input size="large" allowClear placeholder="e.g. Senior Developer" prefix={<SolutionOutlined className="cs-muted" />} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={8}>
                      <Form.Item label="Location" name="location" extra={<span className="field-hint">City or region</span>}>
                        <Input size="large" allowClear placeholder="e.g. Noida, Pune" prefix={<EnvironmentOutlined className="cs-muted" />} />
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={4}>
                      <Form.Item label="Gender" name="gender" extra={<span className="field-hint">Optional</span>}>
                        <Select
                          size="large"
                          placeholder="Any"
                          options={[
                            { value: '', label: 'Any' },
                            { value: 'male', label: 'Male' },
                            { value: 'female', label: 'Female' },
                          ]}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={5}>
                      <Form.Item label="Experience (Years)" extra={<span className="field-hint">Range in years</span>}>
                        <Input.Group compact className="cs-flex">
                          <Form.Item name="expMin" noStyle>
                            <InputNumber size="large" placeholder="Min" className="cs-half" min={0} />
                          </Form.Item>
                          <Form.Item name="expMax" noStyle>
                            <InputNumber size="large" placeholder="Max" className="cs-half" min={0} />
                          </Form.Item>
                        </Input.Group>
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={5}>
                      <Form.Item label="Annual CTC (LPA)" extra={<span className="field-hint">Range in LPA</span>}>
                        <Input.Group compact className="cs-flex">
                          <Form.Item name="ctcMin" noStyle>
                            <InputNumber size="large" placeholder="Min" className="cs-half" min={0} />
                          </Form.Item>
                          <Form.Item name="ctcMax" noStyle>
                            <InputNumber size="large" placeholder="Max" className="cs-half" min={0} />
                          </Form.Item>
                        </Input.Group>
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={5}>
                      <Form.Item label="Notice Period (Max Days)" name="noticePeriod" extra={<span className="field-hint">Max joining time</span>}>
                        <Select
                          size="large"
                          placeholder="Any"
                          options={[
                            { value: '', label: 'Any' },
                            { value: '15', label: '15 days' },
                            { value: '30', label: '30 days' },
                            { value: '45', label: '45 days' },
                            { value: '60', label: '60 days' },
                            { value: '90', label: '90 days' },
                          ]}
                        />
                      </Form.Item>
                    </Col>

                    {/* Collapsible Education Groups */}
                    <Col xs={24}>
                      <Text strong className="cs-legend cs-legend--ink">
                        Education / Qualification (Click categories below to expand)
                      </Text>
                      <Collapse
                        bordered={false}
                        expandIconPosition="end"
                        className="cs-collapse"
                        activeKey={activeEduKeys}
                        onChange={setActiveEduKeys}
                      >
                        <Panel
                          header={
                            <div className="cs-spread">
                              <Text strong className="cs-body">
                                Technical Roles{' '}
                                <span className="cs-caption--muted cs-ml-2">
                                  {activeEduKeys.includes('tech') ? '(click to collapse)' : '(click to expand)'}
                                </span>
                              </Text>
                              {selectedEduCategories.filter(x => x.startsWith('tech_')).length > 0 && (
                                <Badge count={selectedEduCategories.filter(x => x.startsWith('tech_')).length} className="cs-progress" />
                              )}
                            </div>
                          }
                          key="tech"
                          className="screening-edu-panel"
                        >
                          <Checkbox.Group value={selectedEduCategories} onChange={handleEduCheckboxChange}>
                            <Row gutter={[16, 8]}>
                              <Col xs={24} sm={12}>
                                <Checkbox value="tech_cs_it_mca_mtech">BE/B.Tech (CS/IT)/MCA/M.Tech</Checkbox>
                              </Col>
                              <Col xs={24} sm={12}>
                                <Checkbox value="tech_other_it_msc_ms">BE/B.Tech (Other)/M.Sc IT/MS IT</Checkbox>
                              </Col>
                              <Col xs={24} sm={12}>
                                <Checkbox value="tech_bca_bsc_it_grad">BCA/B.Sc IT/CS/IT Graduate</Checkbox>
                              </Col>
                              <Col xs={24} sm={12}>
                                <Checkbox value="tech_non_it_grad">Non-IT Graduate</Checkbox>
                              </Col>
                            </Row>
                          </Checkbox.Group>
                        </Panel>
                        
                        <Panel
                          header={
                            <div className="cs-spread">
                              <Text strong className="cs-body">
                                Accounts & Finance{' '}
                                <span className="cs-caption--muted cs-ml-2">
                                  {activeEduKeys.includes('fin') ? '(click to collapse)' : '(click to expand)'}
                                </span>
                              </Text>
                              {selectedEduCategories.filter(x => x.startsWith('fin_')).length > 0 && (
                                <Badge count={selectedEduCategories.filter(x => x.startsWith('fin_')).length} className="cs-progress" />
                              )}
                            </div>
                          }
                          key="fin"
                          className="screening-edu-panel"
                        >
                          <Checkbox.Group value={selectedEduCategories} onChange={handleEduCheckboxChange}>
                            <Row gutter={[16, 8]}>
                              <Col xs={24} sm={12}>
                                <Checkbox value="fin_ca_mba_cma_icwa">CA/MBA Finance/CMA/ICWA</Checkbox>
                              </Col>
                              <Col xs={24} sm={12}>
                                <Checkbox value="fin_mcom">M.Com</Checkbox>
                              </Col>
                              <Col xs={24} sm={12}>
                                <Checkbox value="fin_bcom">B.Com</Checkbox>
                              </Col>
                              <Col xs={24} sm={12}>
                                <Checkbox value="fin_any_other_grad">Any Other Graduate</Checkbox>
                              </Col>
                            </Row>
                          </Checkbox.Group>
                        </Panel>

                        <Panel
                          header={
                            <div className="cs-spread">
                              <Text strong className="cs-body">
                                Sales & HR Roles{' '}
                                <span className="cs-caption--muted cs-ml-2">
                                  {activeEduKeys.includes('sales') ? '(click to collapse)' : '(click to expand)'}
                                </span>
                              </Text>
                              {selectedEduCategories.filter(x => x.startsWith('sales_')).length > 0 && (
                                <Badge count={selectedEduCategories.filter(x => x.startsWith('sales_')).length} className="cs-progress" />
                              )}
                            </div>
                          }
                          key="sales"
                          className="screening-edu-panel"
                        >
                          <Checkbox.Group value={selectedEduCategories} onChange={handleEduCheckboxChange}>
                            <Row gutter={[16, 8]}>
                              <Col xs={24} sm={12}>
                                <Checkbox value="sales_mba_be_btech_mca_it">MBA/BE/B.Tech/MCA/IT Graduate</Checkbox>
                              </Col>
                              <Col xs={24} sm={12}>
                                <Checkbox value="sales_any_postgrad_non_it">Any Postgraduate (Non-IT)</Checkbox>
                              </Col>
                              <Col xs={24} sm={12}>
                                <Checkbox value="sales_any_grad">Any Graduate</Checkbox>
                              </Col>
                            </Row>
                          </Checkbox.Group>
                        </Panel>
                      </Collapse>
                    </Col>

                    <Col xs={24} className="cs-end--gap-2">
                      <Tooltip title="Re-run the current search">
                        <Button
                          emphasis="soft"
                          size="lg"
                          icon={<ReloadOutlined />}
                          onClick={handleRefresh}
                          loading={refreshing}
                          disabled={candidates.length === 0}
                        >
                          Refresh
                        </Button>
                      </Tooltip>
                      {/* BOTH of these previously declared the class attribute TWICE on
                          the same element — once naming the legacy cta-secondary /
                          cta-primary treatments, then again naming cs-btn plus a width
                          modifier. In JSX the later one wins silently, so the two cta-*
                          classes were dead on the page's two most prominent buttons and
                          had been for as long as they were written that way.
                          `dup-classname.mjs` guards exactly this and is a source scan,
                          which is why this note describes the shape rather than quoting
                          it — spelling it out literally trips the check. */}
                      <Button emphasis="soft" tone="neutral" size="lg" onClick={handleClearFilters}>
                        Clear Filters
                      </Button>
                      <Button emphasis="solid" size="lg" htmlType="submit" icon={<SearchOutlined />}>
                        Search Candidates
                      </Button>
                    </Col>
                  </Row>
                </Form>
              ),
            },
          ]}
        />

        <Divider className="cs-my-3" />

        {/* Search summary metrics bar. Layout stays inline; the surface
            (fill/border/radius) moved to .screening-summary-bar so Design V2 can
            put it on the glass tier — a stylesheet cannot override an inline style. */}
        {summary && (
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
              const primary = (summary.summaryText || `${candidates.length} candidates match`).split('·')[0].trim();
              const [head, ...rest] = primary.split('(');
              const detail = rest.length ? `(${rest.join('(')}` : '';
              return (
                <div className="cs-base">
                  <Text strong className="cs-title-ink--lg">{head.trim()}</Text>
                  {detail && <Text className="cs-muted--sm">{detail.trim()}</Text>}
                  {/* Carries the match score and the per-dimension breakdown the
                      cards have no room for. The server re-runs the search. */}
                  <ExportButton
                    request={(cfg) => (activeTab === 'jd'
                      ? screeningService.exportRoleCandidates(selectedRoleId, cfg)
                      : screeningService.exportKeywordCandidates(lastKeywordPayload || {}, cfg))}
                    fallbackName={activeTab === 'jd'
                      ? 'AAPNA-ATS_Screening-Results.csv'
                      : 'AAPNA-ATS_Screening-Keyword-Search.csv'}
                    rowCount={candidates.length}
                    disabled={activeTab === 'jd' ? !selectedRoleId : !lastKeywordPayload}
                    label="Export"
                    size="small"
                    className="cs-ml-1"
                  />
                </div>
              );
            })()}
            <div className="cs-wrap">
              {(activeTab === 'jd'
                ? [
                    { label: '5★', value: summary.fiveStar || 0, color: 'var(--kpi-c)' },
                    { label: '4★', value: summary.fourStar || 0, color: 'var(--kpi-a)' },
                    { label: '3★', value: summary.threeStar || 0, color: 'var(--warning)' },
                  ]
                : [
                    { label: 'Strong', value: summary.high || 0, color: 'var(--kpi-c)' },
                    { label: 'Moderate', value: summary.medium || 0, color: 'var(--kpi-a)' },
                    { label: 'Weak', value: summary.low || 0, color: 'var(--warning)' },
                  ]
              ).map((s) => (
                <span key={s.label} className="screening-stat-chip">
                  <span className="dot cs-dot-stage" style={{ '--cs-dot': s.color }} />
                  {s.label}
                  <span className="cs-title-ink">{s.value}</span>
                </span>
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
            <div className="screening-selectall-bar cs-mid--bar">
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
                <Text strong className="cs-caption--caps">
                  Select this page ({pageCandidateIds.length})
                </Text>
              </Checkbox>

              {candidates.length > pageCandidateIds.length && (
                selectedCandidateKeys.length === candidates.length ? (
                  <Button size="sm" emphasis="text" onClick={() => setSelectedCandidateKeys([])}>
                    Clear selection
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    emphasis="text"
                    onClick={() => setSelectedCandidateKeys(candidates.map((c) => c.id))}
                  >
                    Select all {candidates.length} matches
                  </Button>
                )
              )}

              {selectedCandidateKeys.length > 0 && (
                <Text type="secondary" className="cs-caption--auto">
                  {selectedCandidateKeys.length} selected
                </Text>
              )}
            </div>

            {/* Candidates card list */}
            <Space direction="vertical" className="cs-full" size={10}>
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
                                className={'cs-avatar-chip' + (isSelected ? ' cs-avatar-chip--on' : '')}
                              >
                                {initials}
                              </Avatar>
                            </span>
                          );
                        })()}
                      </Col>
                      <Col xs={24} sm={12} md={14}>
                        <Space direction="vertical" size={5} className="cs-full">
                          <Space align="center" size={8} wrap>
                            <span className="cand-name">{c.Name}</span>
                            <StatusBadge status={
                              c.FinalStatus === 'Rejected' ? 'rejected'
                                : c.FinalStatus ? 'shortlisted'
                                : 'applied'
                            } />
                            {rating && rating.stars >= 4 && (
                              <Tag
                                className="cs-top-tag"
                              >
                                <ThunderboltOutlined className="cs-legend" />
                                Top Match
                              </Tag>
                            )}
                          </Space>

                          {/* Shortlisted/Rejected by/on — plainly visible, no hover required */}
                          {c.shortlisted_by && (
                            <div className="cs-caption--muted">
                              Shortlisted by <strong className="cs-ink">{c.shortlisted_by}</strong> on {dayjs(c.shortlisted_at).format('DD MMM YYYY')}
                            </div>
                          )}
                          {c.rejected_by && (
                            <div className="cs-caption--muted">
                              Rejected by <strong className="cs-ink">{c.rejected_by}</strong> on {dayjs(c.rejected_at).format('DD MMM YYYY')}
                            </div>
                          )}

                          {/* Pipeline history (M6) — how far this candidate got,
                              and on which role. The lines above say a decision
                              happened; these say at which round, which is what
                              decides whether they are worth approaching again.
                              One chip per journey, so a candidate already live
                              on two other MRFs shows as such. */}
                          {c.pipelineHistory?.length > 0 && (
                            <div className="cs-wrap--sm">
                              {c.pipelineHistory.map((j) => (
                                <Tooltip
                                  key={j.pipeline_id}
                                  title={
                                    <div className="cs-caption">
                                      <div className="cs-strong--gap">{j.position || 'Role not recorded'}</div>
                                      {j.events.length > 0 ? j.events.map((e, i) => (
                                        <div key={i}>
                                          {dayjs(e.at).format('DD MMM YY')} · {e.status_label || `${e.stage_label} ${e.event_type}`}
                                        </div>
                                      )) : <div>No recorded events yet.</div>}
                                    </div>
                                  }
                                >
                                  <Tag
                                    color={j.is_closed ? 'purple' : (j.current_stage_status === 'rejected' ? 'red' : j.current_stage_status === 'hold' ? 'orange' : 'blue')}
                                    className="cs-help"
                                  >
                                    {j.is_closed ? `Closed — ${j.final_outcome.replace(/_/g, ' ')}` : j.current_stage_label}
                                    {j.position ? ` · ${j.position}` : ''}
                                  </Tag>
                                </Tooltip>
                              ))}
                            </div>
                          )}

                          {/* Current Company */}
                          {(() => {
                            const companyName = formatCurrentCompany(c.CurrentCompany);
                            return companyName ? (
                              <div className="cand-company cs-mt-neg">{companyName}</div>
                            ) : null;
                          })()}

                          {/* Detail Indicators (Pills) */}
                          <div className="cs-wrap--gap">
                            <span className="screening-pill">
                              <EnvironmentOutlined className="cs-brand" />
                              <span>{c.CurrentLocation || 'N/A'}</span>
                            </span>
                            <span className="screening-pill">
                              <ClockCircleOutlined className="cs-ok" />
                              <span>{c.TotalExperienceYears || '0'} yrs exp ({c.LastCompanyExperienceYears ? `${c.LastCompanyExperienceYears} yrs last co.` : '0 yrs last co.'})</span>
                            </span>
                            <span className="screening-pill">
                              <span className="cs-brand--strong">₹</span>
                              <span>{c.ExpectedCTC_LPA || c.CTC_LPA || '0'} LPA</span>
                            </span>
                            {c.HighestQualification && (
                              <span className="screening-pill">
                                <SolutionOutlined className="cs-brand" />
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
                              <div className="cs-row">
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
                              <div className="cs-row">
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
                      <Col xs={24} sm={8} md={6} className="cs-end--meta">
                        <div className="cs-stack--end">
                          {rating && (
                            <div className="cand-score">
                              <div className="cand-score__value">
                                {rating.avgScore ?? rating.finalScore ?? (rating.scorePct ? (rating.scorePct / 10) : '')}<small>/10</small>
                              </div>
                              <div className="cand-score__stars">{renderStars(rating.stars, 11)}</div>
                              <Tag
                                color={getFitVerdictColor(rating.label)}
                                className="cand-score__verdict cs-flush--edge"
                              >
                                {rating.label}
                              </Tag>
                            </div>
                          )}
                          {c.NoticePeriod && (
                            <span className="screening-pill cs-caption">
                              <ClockCircleOutlined className="cs-ok" />
                              <span>{c.NoticePeriod} days notice</span>
                            </span>
                          )}
                        </div>
                        <div className="cs-mid">
                          <Tooltip title="Conversations">
                            {/* `.screening-action-btn` retired here — it set width,
                                height, radius, display, border and background with
                                `!important` on every declaration, which would have
                                overridden `.ui-btn` rather than losing to it. Its
                                `.primary` variant painted `--gold`, a colour the token
                                layer no longer owns. Emphasis carries the same
                                distinction: `soft` for the two secondary actions,
                                `solid` for the one that opens the record. */}
                            <Button
                              emphasis="soft"
                              iconOnly
                              icon={<MessageOutlined />}
                              onClick={(e) => {
                                e.stopPropagation();
                                openConversationsModal(c);
                              }}
                            />
                          </Tooltip>
                          <Tooltip title="Download Resume">
                            <Button
                              emphasis="soft"
                              iconOnly
                              icon={<FileTextOutlined />}
                              onClick={(e) => {
                                e.stopPropagation();
                                downloadResume(c);
                              }}
                            />
                          </Tooltip>
                          <Tooltip title="View details">
                            <Button
                              emphasis="solid"
                              iconOnly
                              icon={<RightOutlined />}
                              onClick={(e) => { e.stopPropagation(); openCandidateDrawer(c); }}
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
              <div className="cs-end--gap">
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
        ) : (
          <div className="cs-empty">
            <div className="cs-empty-icon">
              <SearchOutlined className="cs-brand--lg" />
            </div>
            <div className="cs-section-title">
              {selectedRoleId || form.getFieldValue('keyword')
                ? 'No matching candidates'
                : 'Start screening candidates'}
            </div>
            <Text type="secondary" className="cs-lede--sm">
              {selectedRoleId || form.getFieldValue('keyword')
                ? 'No candidates matched the screening requirements. Try widening your filters.'
                : (activeTab === 'jd'
                    ? 'Select an open role above to instantly match and rank qualified candidates.'
                    : 'Enter skills and filters above, then hit Search to find qualified resumes.')}
            </Text>
          </div>
        )}
      </Surface>

      {/* Floating shortlist dock — hidden while the decision modal is open so its own
          Cancel/Confirm footer isn't fought by this fixed-position, higher-z-index bar. */}
      {selectedCandidateKeys.length > 0 && !decisionModalOpen && createPortal(
        <div
          className="cs-floatbar cs-floatbar--fixed"
          style={{ backdropFilter: 'blur(8px)' }}
        >
          <Text strong className="cs-lede">
            {selectedCandidateKeys.length} candidate{selectedCandidateKeys.length === 1 ? '' : 's'} selected
          </Text>
          {/* `.cs-pill` was dead on both of these: it is defined as `.cs-pill.ant-tag`,
              so it only ever styled Tags and never matched a button. */}
          <Button
            emphasis="solid"
            icon={<CheckCircleOutlined />}
            onClick={() => openDecisionModal('shortlist')}
          >
            Shortlist Selected
          </Button>
          <Button
            emphasis="soft"
            tone="danger"
            icon={<CloseCircleOutlined />}
            onClick={() => openDecisionModal('reject')}
          >
            Reject Selected
          </Button>
          <Tooltip title="Clear selection">
            <Button
              emphasis="text"
              iconOnly
              icon={<CloseCircleOutlined />}
              onClick={() => setSelectedCandidateKeys([])}
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
              <Title level={4} className="cs-flush">{selectedCandidate.Name}</Title>
              <Text type="secondary" className="cs-caption">
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
            <div className="cs-drawer-foot">
              <Button
                emphasis="soft"
                tone="neutral"
                onClick={() => setDrawerOpen(false)}
              >
                Close
              </Button>
              {(() => {
                const isSel = selectedCandidateKeys.includes(selectedCandidate.id);
                return (
                  <Button
                    emphasis="solid"
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
                    className={'cs-primary-btn' + (isSel ? ' cs-primary-btn--dim' : '')}
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
                    
                    // The tone is picked here; the COLOURS live in
                    // styles/pages/candidate-screening.css as `.cs-tone--*`. Spelled as
                    // rgba() literals they could follow neither a tenant brand nor dark
                    // mode, and each tone was written out three times.
                    let tone = 'cs-tone--warn';
                    if (label.startsWith('Yes')) tone = 'cs-tone--good';
                    else if (label.startsWith('No')) tone = 'cs-tone--bad';
                    
                    return (
                      <div className="cs-stack--lg">
                        
                        {/* Recruiter Summary */}
                        {selectedCandidate.profile?.summary && (
                          <div>
                            <div className="cs-legend--strong cs-legend--gap">AI Profile</div>
                            <div className="cs-ai-summary">
                              {selectedCandidate.profile.summary}
                            </div>
                          </div>
                        )}

                        {/* Side-by-Side Fit Verdict & Shortlist Recommendation */}
                        {selectedCandidate.profile && (selectedCandidate.profile.fitVerdict || selectedCandidate.profile.shortlistRecommendation) && (
                          <div className="cs-grid-2">
                            {selectedCandidate.profile.fitVerdict && (
                              <div className={`cs-panel cs-tone ${tone}`}>
                                <div className="cs-legend--strong cs-legend--gap-sm">Fit Verdict</div>
                                <div className="cs-panel__body cs-panel__body--strong">{selectedCandidate.profile.fitVerdict}</div>
                              </div>
                            )}
                            {selectedCandidate.profile.shortlistRecommendation && (
                              (() => {
                                const reason = rec.includes('—') ? rec.split('—').slice(1).join('—').trim() : '';
                                return (
                                  <div className={`cs-panel cs-tone ${tone}`}>
                                    <div className="cs-legend--strong cs-legend--gap-sm">Shortlist</div>
                                    <div className="cs-panel__verdict">{label}</div>
                                    {reason && <div className="cs-panel__reason">{reason}</div>}
                                  </div>
                                );
                              })()
                            )}
                          </div>
                        )}

                      {/* Red Flags Alert Card */}
                      {selectedCandidate.profile?.redFlags && selectedCandidate.profile.redFlags.length > 0 && (
                        <div className="cs-alert">
                          <div className="cs-mid--label">
                            <WarningOutlined className="cs-danger-text" />
                            <span className="cs-danger-label">Red Flags</span>
                          </div>
                          {selectedCandidate.profile.redFlags.map((flag, idx) => (
                            <div key={idx} className="cs-top">
                              <span className="cs-danger-icon">•</span>
                              <span className="cs-danger-body">{flag}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Skill Coverage Section */}
                      {selectedCandidate.profile?.skillGap && (
                        <div className="cs-mb-3">
                          <div className="cs-legend--strong cs-legend--gap">Skill Coverage</div>
                          
                          {selectedCandidate.profile.skillGap.mandatory?.present?.length > 0 && (
                            <div className="cs-mb-2">
                              <div className="cs-skill-label cs-skill--present">✓ Mandatory — Present</div>
                              <div className="cs-chips">
                                {selectedCandidate.profile.skillGap.mandatory.present.map((s) => (
                                  <span key={s} className="cs-skill cs-skill--present">{s}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {selectedCandidate.profile.skillGap.mandatory?.missing?.length > 0 && (
                            <div className="cs-mb-2">
                              <div className="cs-skill-label cs-skill--missing">✗ Mandatory — Missing</div>
                              <div className="cs-chips">
                                {selectedCandidate.profile.skillGap.mandatory.missing.map((s) => (
                                  <span key={s} className="cs-skill cs-skill--missing">{s}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {selectedCandidate.profile.skillGap.goodToHave?.present?.length > 0 && (
                            <div className="cs-mb-2">
                              <div className="cs-skill-label cs-skill--partial">✓ Good to Have — Present</div>
                              <div className="cs-chips">
                                {selectedCandidate.profile.skillGap.goodToHave.present.map((s) => (
                                  <span key={s} className="cs-skill cs-skill--partial">{s}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {selectedCandidate.profile.skillGap.goodToHave?.missing?.length > 0 && (
                            <div className="cs-mb-2">
                              <div className="cs-skill-label">✗ Good to Have — Missing</div>
                              <div className="cs-chips">
                                {selectedCandidate.profile.skillGap.goodToHave.missing.map((s) => (
                                  <span key={s} className="cs-skill cs-skill--none">{s}</span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* JD Skill Match Section (cross-references JD skills vs resume signals + declared skills) */}
                      {selectedCandidate.jdSkillSignals && (
                        <div className="cs-mb-3">
                          <div className="cs-legend--strong cs-legend--gap">{activeTab === 'keyword' ? 'Searched Skill Match' : 'JD Skill Match'}</div>
                          <JdSkillMatch signals={selectedCandidate.jdSkillSignals} label={activeTab === 'keyword' ? 'Searched Skills' : 'Mandatory JD Skills'} />
                        </div>
                      )}

                      {/* Resume Signals Section */}
                      {(() => {
                        const technicalTerms = parseTechnicalTerms(selectedCandidate.resume_technical_terms);
                        if (technicalTerms.length === 0) return null;
                        return (
                          <div className="cs-mb-3">
                            <div className="cs-legend--strong cs-legend--gap">Resume Signals</div>
                            <div className="cs-wrap--chips">
                              {technicalTerms.slice(0, 15).map((t, idx) => (
                                <span 
                                  key={idx} 
                                  className="cs-term"
                                >
                                  {t.term || t} <span className="cs-suffix">x{t.count || 1}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Career Trajectory Card */}
                      {selectedCandidate.profile?.careerProgression && (
                        <div className={`cs-panel cs-panel--row cs-tone ${tone}`}>
                          <RiseOutlined className="cs-panel__icon" />
                          <div>
                            <div className="cs-legend--strong cs-legend--gap-sm">Career Trajectory</div>
                            <div className="cs-panel__body">{selectedCandidate.profile.careerProgression}</div>
                          </div>
                        </div>
                      )}

                      {/* Candidate Score Header & Parameter Breakdown Cards */}
                      {selectedCandidate.starRating?.breakdown && (
                        <div>
                          {/* Section Header */}
                          <div className="cs-split-center">
                            <div className="cs-legend--strong">Candidate Score</div>
                            <span className="cs-mode">
                              {selectedCandidate.starRating.mode || (selectedRoleId ? 'JD Mode' : 'Keyword Mode')}
                            </span>
                          </div>
                          
                          {/* Score visual breakdown row */}
                          <div className="cs-mid--head">
                            <div>{renderStars(selectedCandidate.starRating.stars)}</div>
                            <span className="cs-score">
                              {Math.round(selectedCandidate.starRating.finalScore)}
                            </span>
                            {(() => {
                              const label = selectedCandidate.starRating.label;
                              const val = selectedCandidate.starRating.finalScore;
                              // Same five tones as the verdict badge above, keyed off
                              // the score band instead of the label.
                              let tone = 'cs-tone--warn';
                              if (val >= 8) tone = 'cs-tone--good';
                              else if (val >= 6) tone = 'cs-tone--fair';
                              else if (val >= 4) tone = 'cs-tone--mid';
                              else tone = 'cs-tone--bad';
                              return (
                                <span className={`cs-score-badge cs-tone ${tone}`}>
                                  {label}
                                </span>
                              );
                            })()}
                          </div>

                          {/* Individual Parameter Cards */}
                          <div className="cs-stack--sm">
                            {Object.entries(selectedCandidate.starRating.breakdown).map(([key, item]) => {
                              const scoreVal = item.score ?? item.pts ?? 0;
                              const reason = selectedCandidate.profile?.scoreReasons?.[key] || item.reason || 'Criteria metrics verified';
                              
                              // Same five-tone ladder as the verdict and score badges
                              // — this was its fourth hand-written copy. The tint lives
                              // in `.cs-tone--*`; `color` stays a value because the
                              // meter fill and the score cell take it as data.
                              let tone = 'cs-tone--bad';
                              let color = 'var(--red)';
                              if (scoreVal >= 8) { tone = 'cs-tone--good'; color = 'var(--kpi-c)'; }
                              else if (scoreVal >= 6) { tone = 'cs-tone--fair'; color = 'var(--brand-ink)'; }
                              else if (scoreVal >= 4) { tone = 'cs-tone--mid'; color = 'var(--kpi-b)'; }
                              
                              const criteria = getCriteria(key);

                              return (
                                <div
                                  key={key}
                                  className={`cs-param-row cs-tone cs-tone--soft ${tone}`}
                                >
                                  <div className={(reason || criteria) ? 'cs-mid--row' : 'cs-mid--row-flush'}>
                                    <div className="cs-param">
                                      {item.label}
                                    </div>
                                    
                                    {/* Custom Progress Bar */}
                                    <div className="cs-meter">
                                      <div className="cs-meter__bar" style={{ '--cs-meter': `${scoreVal * 10}%`, '--cs-meter-ink': color }} />
                                    </div>
                                    
                                    <div className="cs-score-cell" style={{ '--cs-cell-ink': color }}>
                                      {scoreVal}
                                    </div>
                                  </div>
                                  
                                  {reason && (
                                    <div className="cs-foot-note">
                                      {reason}
                                    </div>
                                  )}
                                  
                                  {criteria && (
                                    <div className={'cs-criteria' + (reason ? ' cs-criteria--after' : '')} style={{
                                      gap: '6px',
                                      alignItems: 'center'
                                    }}>
                                      <span className="cs-faded">▸</span>
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
                    <div className="cs-stack--md">
                      
                      {/* Section: CONTACT */}
                      <div>
                        <Text strong className="cs-legend">CONTACT</Text>
                        <Card size="small" className="cs-well">
                          <Row gutter={[16, 8]}>
                            <Col span={12}>
                              <Text type="secondary" className="cs-label">Email</Text>
                              <Text strong className="cs-body--break">{selectedCandidate.EmailID || '—'}</Text>
                            </Col>
                            <Col span={12}>
                              <Text type="secondary" className="cs-label">Phone</Text>
                              <Text strong className="cs-body">{selectedCandidate.ContactNumber || '—'}</Text>
                            </Col>
                            <Col span={24}>
                              <Text type="secondary" className="cs-label">LinkedIn</Text>
                              <Text strong className="cs-body">
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
                        <Text strong className="cs-legend">EXPERIENCE & COMPENSATION</Text>
                        <Card size="small" className="cs-well">
                          <Row gutter={[16, 12]}>
                            <Col span={12}>
                              <Text type="secondary" className="cs-label">Total Exp</Text>
                              <Text strong className="cs-body">{selectedCandidate.TotalExperienceYears ? `${selectedCandidate.TotalExperienceYears} yrs` : '0 yrs'}</Text>
                            </Col>
                            <Col span={12}>
                              <Text type="secondary" className="cs-label">Last Co. Exp</Text>
                              <Text strong className="cs-body">{selectedCandidate.LastCompanyExperienceYears ? `${selectedCandidate.LastCompanyExperienceYears} yrs` : '0 yrs'}</Text>
                            </Col>
                            <Col span={12}>
                              <Text type="secondary" className="cs-label">Current CTC</Text>
                              <Text strong className="cs-body">₹{selectedCandidate.CTC_LPA || '0'} LPA</Text>
                            </Col>
                            <Col span={12}>
                              <Text type="secondary" className="cs-label">Expected CTC</Text>
                              <Text strong className="cs-body">₹{selectedCandidate.ExpectedCTC_LPA || '0'} LPA</Text>
                            </Col>
                            <Col span={12}>
                              <Text type="secondary" className="cs-label">Notice Period</Text>
                              <Text strong className="cs-body">{selectedCandidate.NoticePeriod ? `${selectedCandidate.NoticePeriod} days` : '0 days'}</Text>
                            </Col>
                            <Col span={12}>
                              <Text type="secondary" className="cs-label">Gender</Text>
                              <Text strong className="cs-body">{selectedCandidate.Gender || '—'}</Text>
                            </Col>
                            <Col span={24}>
                              <Text type="secondary" className="cs-label">Current Company</Text>
                              <Text strong className="cs-body">
                                {formatCurrentCompany(selectedCandidate.CurrentCompany) || '—'}
                              </Text>
                            </Col>
                          </Row>
                        </Card>
                      </div>

                      {/* Section: SKILLS */}
                      <div>
                        <Text strong className="cs-legend">SKILLS</Text>
                        <div className="cs-mt-1-5">
                          <Space size={[4, 6]} wrap>
                            {parsePostgresArray(selectedCandidate.Top5KeySkills).map((s) => (
                              <Tag key={s} className="cs-chip">
                                {s}
                              </Tag>
                            ))}
                          </Space>
                        </div>
                      </div>

                      {/* Section: EDUCATION */}
                      <div>
                        <Text strong className="cs-legend">EDUCATION</Text>
                        <Card size="small" className="cs-well">
                          <Row gutter={[16, 12]}>
                            <Col span={24}>
                              <Text type="secondary" className="cs-label">Highest Qualification</Text>
                              <Text strong className="cs-body">{selectedCandidate.HighestQualification || '—'}</Text>
                            </Col>
                            <Col span={24}>
                              <Text type="secondary" className="cs-label">Graduation Stream</Text>
                              <Text strong className="cs-body">
                                {selectedCandidate.graduationdegree 
                                  ? `${selectedCandidate.graduationdegree}${selectedCandidate.graduationspecialization ? ` - ${selectedCandidate.graduationspecialization}` : ''}`
                                  : '—'}
                              </Text>
                            </Col>
                            <Col span={24}>
                              <Text type="secondary" className="cs-label">PG Stream</Text>
                              <Text strong className="cs-body">
                                {selectedCandidate.postgraduationdegree
                                  ? `${selectedCandidate.postgraduationdegree}${selectedCandidate.postgraduationspecialization ? ` - ${selectedCandidate.postgraduationspecialization}` : ''}`
                                  : '—'}
                              </Text>
                            </Col>
                            <Col span={24}>
                              <Text type="secondary" className="cs-label">Scores</Text>
                              <Text strong className="cs-body">
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
                        <Text strong className="cs-legend">PREFERENCES & READINESS</Text>
                        <Card size="small" className="cs-well">
                          <Row gutter={[16, 12]}>
                            <Col span={12}>
                              <Text type="secondary" className="cs-label">Preferred Shift</Text>
                              <Text strong className="cs-body">{selectedCandidate.PreferredShift || '—'}</Text>
                            </Col>
                            <Col span={12}>
                              <Text type="secondary" className="cs-label">Job Source</Text>
                              <Text strong className="cs-body">{selectedCandidate.JobSource || '—'}</Text>
                            </Col>
                            <Col span={12}>
                              <Text type="secondary" className="cs-label">Reason for Change</Text>
                              <Text strong className="cs-body">{selectedCandidate.ReasonForJobChange || '—'}</Text>
                            </Col>
                            <Col span={12}>
                              <Text type="secondary" className="cs-label">English Rating</Text>
                              <div>
                                {selectedCandidate.EnglishCommunicationRating 
                                  ? renderStars(parseInt(selectedCandidate.EnglishCommunicationRating, 10)) 
                                  : '—'}
                              </div>
                            </Col>
                            <Col span={12}>
                              <Text type="secondary" className="cs-label">Willing for Test</Text>
                              <Tag color={selectedCandidate.WillingToTakeOnlineTest === 'Yes' ? 'success' : 'default'} className="cs-tag--stack">
                                {selectedCandidate.WillingToTakeOnlineTest || '—'}
                              </Tag>
                            </Col>
                            <Col span={12}>
                              <Text type="secondary" className="cs-label">Has Laptop</Text>
                              <Tag color={selectedCandidate.HasLaptopForInitialDays === 'Yes' ? 'success' : 'default'} className="cs-tag--stack">
                                {selectedCandidate.HasLaptopForInitialDays || '—'}
                              </Tag>
                            </Col>
                          </Row>
                        </Card>
                      </div>

                      {/* Section: VENDOR INFO */}
                      <div>
                        <Text strong className="cs-legend">VENDOR INFO</Text>
                        <Card size="small" className="cs-well">
                          <Row gutter={[16, 8]}>
                            <Col span={12}>
                              <Text type="secondary" className="cs-label">Vendor Name</Text>
                              <Text strong className="cs-body">{selectedCandidate.vendorName || '—'}</Text>
                            </Col>
                            <Col span={12}>
                              <Text type="secondary" className="cs-label">Vendor Email</Text>
                              <Text strong className="cs-body--break">{selectedCandidate.VendorEmail || '—'}</Text>
                            </Col>
                          </Row>
                        </Card>
                      </div>

                      {/* Section: SYSTEM STATUS */}
                      <div>
                        <Text strong className="cs-legend">SYSTEM STATUS</Text>
                        <Card size="small" className="cs-well">
                          <Row gutter={[16, 8]}>
                            <Col span={24}>
                              <Text type="secondary" className="cs-label">RPA Final Status</Text>
                              <Text strong className="cs-body">{selectedCandidate.FinalStatus || 'No Status'}</Text>
                            </Col>
                            {selectedCandidate.shortlisted_by && (
                              <>
                                <Col span={12}>
                                  <Text type="secondary" className="cs-label">Shortlisted By</Text>
                                  <Text strong className="cs-body">{selectedCandidate.shortlisted_by}</Text>
                                </Col>
                                <Col span={12}>
                                  <Text type="secondary" className="cs-label">Shortlisted On</Text>
                                  <Text strong className="cs-body">{dayjs(selectedCandidate.shortlisted_at).format('DD MMM YYYY, hh:mm a')}</Text>
                                </Col>
                              </>
                            )}
                            {selectedCandidate.rejected_by && (
                              <>
                                <Col span={12}>
                                  <Text type="secondary" className="cs-label">Rejected By</Text>
                                  <Text strong className="cs-body">{selectedCandidate.rejected_by}</Text>
                                </Col>
                                <Col span={12}>
                                  <Text type="secondary" className="cs-label">Rejected On</Text>
                                  <Text strong className="cs-body">{dayjs(selectedCandidate.rejected_at).format('DD MMM YYYY, hh:mm a')}</Text>
                                </Col>
                              </>
                            )}
                          </Row>
                        </Card>
                      </div>

                      {/* Section: EMPLOYMENT TIMELINE */}
                      <div>
                        <Text strong className="cs-legend">EMPLOYMENT TIMELINE</Text>
                        <div className="cs-mt-2">
                          {selectedCandidate.employment_history?.companies && selectedCandidate.employment_history.companies.length > 0 ? (
                            <Timeline
                              mode="left"
                              className="cs-mt-3"
                              items={selectedCandidate.employment_history.companies.map((company, idx) => ({
                                color: 'var(--color-primary)',
                                children: (
                                  <div className="cs-body">
                                    <Text strong>{company.CompanyName || '[Company Name]'}</Text>
                                    <div>
                                      <Text type="secondary" className="cs-caption">
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
          <div className="cs-grow">
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
          <button className="conv-close cs-ml-3" onClick={() => setConvModalVisible(false)}>
            &#x2715;
          </button>
        </div>

        <div className="conv-body" ref={convBodyRef}>
          {convLoading ? (
            <div className="conv-loading">
              <Spin size="small" /> <span className="cs-ml-2">Loading conversations...</span>
            </div>
          ) : convMessages.length > 0 ? (
            convMessages.map((msg, index) => {
              const isOut = msg.direction === 'outbound';
              const timeStr = msg.sent_at
                ? dayjs(msg.sent_at).format('DD MMM, hh:mm a')
                : '';
              const showBadge = isOut && msg.tracking;
              const cleanBodyText = cleanMsgBody(msg.body_preview || msg.body_html);

              return (
                <div key={index} className="cs-stack">
                  <div className={`conv-msg ${isOut ? 'out' : 'in'}`}>
                    {msg.subject && (
                      <div
                        className={'conv-msg-subject cs-msg-subject' + (isOut ? ' cs-msg-subject--out' : '')}
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

      </PageShell>
    </DesignScope>
  );
}
