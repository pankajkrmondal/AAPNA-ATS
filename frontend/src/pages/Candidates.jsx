/**
 * Candidates Page — the records surface for the whole candidate database.
 *
 * Browsable by default and paginated/filtered SERVER-side: one page of rows per
 * request, never the full ~4k-row table.
 *
 * Deliberately narrow, because the previous version was not. It carried a free-text
 * quick-search box AND a collapsible "Advanced filters" panel (email, name, phone,
 * position, location) AND per-column sorting — three overlapping ways to reorder or
 * narrow the same table. What is left is the part recruiters actually use: search by
 * name, email or phone.
 *
 * Order is fixed at id descending (newest first, first-ever-added last) and is not
 * user-adjustable, so there are no sort arrows anywhere in the table. The one
 * exception is the "Details completed in" quick filter (N44), which lists the
 * most recent completions first.
 *
 * Retained as-is: the view/conversations modals and CSV export. Export takes the
 * same filter object as the table, so it exports exactly what is on screen.
 *
 * Phase 3 "Do Now", section C:
 *   - N21: staff with Candidate Screening access can tick candidates and "Add to
 *     JD": the same shortlist as the Screening page (same skip rules, same
 *     email), then a result listing who was added and who was not, and why.
 *   - N18: the Edit form is one field per row and uses the candidate form's
 *     lists and rules (constants/candidateFields.js).
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Form, Input, Button, Card, Table, Space, Tag, Modal, Row, Col, Typography, message, Select, Spin, AutoComplete } from 'antd';
import { SearchOutlined, EyeOutlined, EditOutlined, MessageOutlined, FileTextOutlined, HistoryOutlined, CloseOutlined, PlusOutlined, DeleteOutlined, InboxOutlined } from '@ant-design/icons';
import candidateService from '../services/candidateService';
import CandidateDetailCard from '../components/CandidateDetailCard';
import ReferralPanel from '../components/candidates/ReferralPanel';
import ReferralChip from '../components/candidates/ReferralChip';
import ExportButton from '../components/common/ExportButton';
import EmptyState from '../components/common/EmptyState';
import LoadingSkeleton from '../components/common/LoadingSkeleton';
import usePointerSpotlight from '../hooks/usePointerSpotlight';
import { fmtDate, fmtDateTime } from '../utils/dateFormat';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateCandidateCopies } from '../utils/candidateCache';
import DecisionEmailModal from '../components/screening/DecisionEmailModal';
import ShortlistResultModal from '../components/screening/ShortlistResultModal';
import screeningService from '../services/screeningService';
import useAuth from '../hooks/useAuth';
import { useApprovedRoles } from '../hooks/useScreeningData';
import { mrfOptionLabel } from '../utils/mrfLabel';
import {
  QUALIFICATION_OPTIONS, QUALIFICATION_OTHER, NOTICE_PERIOD_OPTIONS, SHIFT_OPTIONS, ENGLISH_RATING_OPTIONS,
  RECRUITER_NONE, phoneRule, experienceRule, notMoreThanTotalRule, ctcRule, percentRule, optionsKeeping,
} from '../constants/candidateFields';

const { Title, Text, Paragraph } = Typography;

/**
 * Table header cells: one line, small caps-size type (the approved full-width
 * design). antd's default ~14px header made the three date labels alone
 * ~490px wide and pushed the Action column off-screen with the nav open.
 */
const HEADER_CELL_STYLE = { whiteSpace: 'nowrap', fontSize: 11.5, letterSpacing: '0.03em', color: 'var(--text-2)', padding: '10px 8px' };
/** Body cells: the design's 8px side padding (the theme's ~20px made 11 columns ~440px wider). */
const BODY_CELL_STYLE = { padding: '10px 8px' };

/** "Details completed in" choices (N44). Values match the API's completedWithin. */
const COMPLETED_IN_OPTIONS = [
  { value: '', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
];
const COMPLETED_IN_PHRASE = { today: 'today', 7: 'in the last 7 days', 30: 'in the last 30 days' };

/** Edit-form label and hint, in the form's existing small-caps style. */
const fieldLabel = (text) => <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>{text}</span>;
const fieldHint = (text) => <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{text}</span>;

/** AutoComplete filter: the typed text anywhere in the option, any case. */
const filterByText = (input, option) => String(option?.value ?? '').toLowerCase().includes(String(input || '').toLowerCase());

/** A date cell: DD Mon YYYY in IST, or a dash when there is no date on file. */
const dateCell = (value) => (
  <Text style={{ fontSize: 12.5, color: value ? 'var(--text)' : 'var(--text-3)', whiteSpace: 'nowrap' }}>{fmtDate(value)}</Text>
);

export default function Candidates() {
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  // The values the Edit form opened with, so a save sends only what the user
  // changed (N29): sending every field let a form opened before a pipeline
  // update write the old Final Status or Zeko score back over the new one.
  const editInitialValues = useRef({});
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  /** Cursor-tracked spotlight for the search card, the page's one `.spotlight`
   *  surface. One delegated listener on the page root, as on the dashboard.
   *  Safe here because this component has a single return — the loading state is
   *  rendered inside the same root, so the node the listener is bound to is never
   *  swapped out (the trap documented on CandidateDetail, which does branch). */
  const rootRef = useRef(null);
  usePointerSpotlight(rootRef);

  // The only filters this page offers: the three identifiers a recruiter actually
  // searches by. There used to be a free-text "quick search" box AND a collapsible
  // "Advanced filters" panel carrying position/location on top of these — two
  // competing search affordances for one table, which just made the page confusing.
  // Plus one quick filter (N44): candidates who completed the missing-details
  // form recently — the "warm" ones recruiters chase first.
  const [searchParams, setSearchParams] = useState({
    name: '', email: '', phone: '', completedWithin: '',
  });

  // Modals state
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  
  // Emails modal state
  const [emailsOpen, setEmailsOpen] = useState(false);
  const [emails, setEmails] = useState([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  
  const [updating, setUpdating] = useState(false);

  // N21: tick candidates and add them to an open MRF. Staff with Candidate
  // Screening access only (the shortlist API is behind that module); never vendors.
  const { user } = useAuth();
  const userRole = (user?.role || '').toLowerCase();
  const canAddToJd = userRole !== 'vendor'
    && (userRole === 'admin' || userRole === 'superadmin' || (user?.permissions || []).includes('candidate_screening'));
  // Editing a candidate is staff-only; the API refuses vendors (N29).
  const canEdit = userRole !== 'vendor';
  // These three are the candidate-level copy the hourly Zeko sync rewrites,
  // so an edit here lasts only until the next synced result (N29).
  const ZEKO_SYNC_HINT = 'Updated automatically by Zeko sync';
  const rolesQuery = useApprovedRoles({ enabled: canAddToJd });
  const openRoles = useMemo(() => (rolesQuery.data || []).filter((r) => !r.closed), [rolesQuery.data]);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [selectedRows, setSelectedRows] = useState([]);
  const [addToJdOpen, setAddToJdOpen] = useState(false);
  const [addingToJd, setAddingToJd] = useState(false);
  const [addResult, setAddResult] = useState(null);

  // N18: the Edit form's suggestion lists, loaded the first time it opens.
  const [cityNames, setCityNames] = useState([]);
  const [recruiterNames, setRecruiterNames] = useState([]);
  const formOptionsLoaded = useRef(false);
  const cityOptions = useMemo(() => cityNames.map((c) => ({ value: c })), [cityNames]);
  const roleNameOptions = useMemo(
    () => [...new Set(openRoles.map((r) => r.role).filter(Boolean))].sort().map((r) => ({ value: r })),
    [openRoles],
  );

  /** Filters actually sent to the API — blanks are omitted entirely. */
  const activeFilters = useMemo(() => {
    const f = {};
    Object.entries(searchParams).forEach(([k, v]) => {
      if (v && String(v).trim()) f[k] = String(v).trim();
    });
    return f;
  }, [searchParams]);

  const hasFilters = Object.keys(activeFilters).length > 0;

  /**
   * Loads ONE page from the server — never the whole table. Only `pageSize` rows
   * cross the wire per request, so the ~4k-row database costs the same to browse
   * as a 25-row one.
   *
   * Order is FIXED at id descending: newest candidate first, the first ever added
   * last. It is not user-adjustable, so there is one predictable order rather than
   * a sort control per column. `id` is also the primary key, which means Postgres
   * walks the index instead of sorting every matching row on each page request —
   * `createdAt` (the old default) has no index and is nullable, so NULL-dated
   * legacy rows sorted to the top of page 1 under DESC.
   */
  const loadCandidates = useCallback(async () => {
    setLoading(true);
    try {
      // The one exception to the fixed order: while "Details completed in" is on,
      // newest completion first — that is the whole point of the filter (N44).
      const res = await candidateService.search(
        { ...activeFilters, sort: activeFilters.completedWithin ? 'detailsCompletedAt' : 'id', order: 'desc' },
        page,
        pageSize,
      );
      const body = res.data || {};
      const list = Array.isArray(body.data)
        ? body.data
        : (body.data?.data || body.data?.candidates || []);
      const pagination = body.pagination || body.data?.pagination || {};
      setCandidates(Array.isArray(list) ? list : []);
      // Fall back to the row count only when the server sends no total, so the
      // pager degrades rather than lying about the dataset size.
      setTotal(pagination.total ?? body.total ?? list.length);
    } catch {
      message.error('Failed to load candidates.');
      setCandidates([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [activeFilters, page, pageSize]);

  // Browse by default: no search term required to see data.
  useEffect(() => { loadCandidates(); }, [loadCandidates]);

  const handleSearch = (values) => {
    setSearchParams({
      name: (values.name || '').trim(),
      email: (values.email || '').trim(),
      phone: (values.phone || '').trim(),
      completedWithin: values.completedWithin || '',
    });
    setPage(1);
  };

  const handleClearFilters = () => {
    form.resetFields();
    setSearchParams({ name: '', email: '', phone: '', completedWithin: '' });
    setPage(1);
  };

  /** Pagination only — no sorter to map, the order is fixed. */
  const handleTableChange = (pagination) => {
    if (pagination.current !== page) setPage(pagination.current);
    if (pagination.pageSize !== pageSize) {
      setPageSize(pagination.pageSize);
      setPage(1);
    }
  };

  // Open View Details
  const handleOpenView = (record) => {
    setSelectedCandidate(record);
    setViewOpen(true);
  };

  // Open Edit Modal
  const handleOpenEdit = (record) => {
    setSelectedCandidate(record);
    editForm.resetFields();
    if (!formOptionsLoaded.current) {
      formOptionsLoaded.current = true;
      candidateService.getPublicLocations().then((res) => setCityNames(res.data?.data || [])).catch(() => {});
      candidateService.getPublicRecruiters().then((res) => setRecruiterNames(res.data?.data || [])).catch(() => {});
    }
    
    // Parse employment history companies
    const companies = record.employment_history?.companies || [];
    
    editForm.setFieldsValue({
      name: record.name,
      email: record.email,
      phone: record.phone,
      education: record.education,
      experience: record.experience,
      lastCompanyExperience: record.lastCompanyExperience,
      location: record.location,
      currentCTC: record.currentCTC,
      expectedCTC: record.expectedCTC,
      noticePeriod: record.noticePeriod,
      position: record.position,
      jobSource: record.jobSource,
      recruiterInfo: record.recruiterInfo,
      englishCommunicationRating: record.englishCommunicationRating || undefined,
      top5KeySkills: record.top5KeySkills,
      gender: record.gender || undefined,
      preferredShift: record.preferredShift || undefined,
      reasonForJobChange: record.reasonForJobChange,
      willingToTakeOnlineTest: record.willingToTakeOnlineTest || undefined,
      hasLaptopForInitialDays: record.hasLaptopForInitialDays || undefined,
      currentCompany: record.currentCompany || { Name: '', Website: '' },
      status: record.status,
      
      // Education fields
      a10th: record.a10th,
      a12th: record.a12th,
      graduation: record.graduation,
      postGraduation: record.postGraduation,
      graduationdegree: record.graduationdegree,
      graduationspecialization: record.graduationspecialization,
      postgraduationdegree: record.postgraduationdegree,
      postgraduationspecialization: record.postgraduationspecialization,
      LinkedInProfile: record.LinkedInProfile,
      
      // Employment History list
      employment_history_companies: companies.length > 0 ? companies : [{ CompanyName: '', StartDate: '', EndDate: '' }],
      
      // Assessment & Interview fields
      Heat: record.Heat,
      HRQuickcomments: record.HRQuickcomments,
      IQScore: record.IQScore,
      TechScore: record.TechScore,
      ZekoInterviewScore: record.ZekoInterviewScore,
      ZekoCodingScore: record.ZekoCodingScore,
      ZekoCommunicationScore: record.ZekoCommunicationScore,
      FinalStatus: record.FinalStatus,
      TechRoundOne: record.TechRoundOne,
      TechRoundTwo: record.TechRoundTwo,
      TechRoundThree: record.TechRoundThree,
      ManagerialOrCEOFeedback: record.ManagerialOrCEOFeedback,
      HRInterview: record.HRInterview,
    });
    editInitialValues.current = editForm.getFieldsValue(true);
    setEditOpen(true);
  };

  // Save Edit Details
  const handleSaveEdit = async () => {
    if (!selectedCandidate) return;
    setUpdating(true);
    try {
      const values = await editForm.validateFields();
      
      const payload = {
        name: values.name,
        email: values.email,
        phone: values.phone,
        // "Other (please specify)" saves what was typed, not the label.
        education: values.education === QUALIFICATION_OTHER ? values.educationOther?.trim() : values.education,
        experience: values.experience,
        lastCompanyExperience: values.lastCompanyExperience,
        location: values.location,
        currentCTC: values.currentCTC,
        expectedCTC: values.expectedCTC,
        noticePeriod: values.noticePeriod,
        position: values.position,
        jobSource: values.jobSource,
        recruiterInfo: values.recruiterInfo,
        englishCommunicationRating: values.englishCommunicationRating,
        top5KeySkills: values.top5KeySkills,
        gender: values.gender,
        preferredShift: values.preferredShift,
        reasonForJobChange: values.reasonForJobChange,
        willingToTakeOnlineTest: values.willingToTakeOnlineTest,
        hasLaptopForInitialDays: values.hasLaptopForInitialDays,
        currentCompany: values.currentCompany,
        status: values.status,

        // Education fields
        a10th: values.a10th,
        a12th: values.a12th,
        graduation: values.graduation,
        postGraduation: values.postGraduation,
        graduationdegree: values.graduationdegree,
        graduationspecialization: values.graduationspecialization,
        postgraduationdegree: values.postgraduationdegree,
        postgraduationspecialization: values.postgraduationspecialization,
        LinkedInProfile: values.LinkedInProfile,

        // Employment history object
        employment_history: {
          companies: values.employment_history_companies || [],
        },

        // Assessment & Interview fields
        Heat: values.Heat,
        HRQuickcomments: values.HRQuickcomments,
        IQScore: values.IQScore,
        TechScore: values.TechScore,
        ZekoInterviewScore: values.ZekoInterviewScore,
        ZekoCodingScore: values.ZekoCodingScore,
        ZekoCommunicationScore: values.ZekoCommunicationScore,
        FinalStatus: values.FinalStatus,
        TechRoundOne: values.TechRoundOne,
        TechRoundTwo: values.TechRoundTwo,
        TechRoundThree: values.TechRoundThree,
        ManagerialOrCEOFeedback: values.ManagerialOrCEOFeedback,
        HRInterview: values.HRInterview,
      };

      // Send only the fields the user changed. Two payload keys are built from
      // differently named form fields; every other key is its form field.
      const FORM_FIELDS_FOR = {
        education: ['education', 'educationOther'],
        employment_history: ['employment_history_companies'],
      };
      const before = editInitialValues.current || {};
      const fieldChanged = (f) => JSON.stringify(values[f] ?? null) !== JSON.stringify(before[f] ?? null);
      const changes = Object.fromEntries(
        Object.entries(payload).filter(([key]) => (FORM_FIELDS_FOR[key] || [key]).some(fieldChanged)),
      );
      if (Object.keys(changes).length === 0) {
        message.info('No changes to save.');
        setEditOpen(false);
        return;
      }

      await candidateService.update(selectedCandidate.id, changes);
      message.success('Candidate details updated successfully.');
      setEditOpen(false);
      loadCandidates(searchParams);
      // The pipeline and screening pages read their own cached copies; the
      // backend has synced them, so drop the cache to refetch (N29).
      invalidateCandidateCopies(queryClient);
    } catch (err) {
      message.error(err?.message || 'Failed to update candidate details.');
    } finally {
      setUpdating(false);
    }
  };

  // Open Emails Modal
  const handleOpenEmails = async (record) => {
    setSelectedCandidate(record);
    setEmailsOpen(true);
    setEmailsLoading(true);
    setEmails([]);
    try {
      const res = await candidateService.getEmails(record.id);
      if (res.data && res.data.data) {
        setEmails(res.data.data || []);
      }
    } catch (err) {
      message.error('Failed to load candidate email conversations.');
    } finally {
      setEmailsLoading(false);
    }
  };

  // Download Resume
  const handleDownloadResume = (cvFileUrl) => {
    if (!cvFileUrl || cvFileUrl === 'null' || cvFileUrl === 'undefined' || String(cvFileUrl).trim() === '') {
      Modal.warning({
        title: '⚠️ Alert',
        content: 'Resume is not available for this candidate right now.',
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

  // Validation for the fields the shared rules (constants/candidateFields.js) do not cover.
  const wholeNumberValidator = (_, value) => {
    if (value === undefined || value === null || String(value).trim() === '') return Promise.resolve();
    const val = String(value).trim();
    if (!/^[0-9]+$/.test(val)) return Promise.reject(new Error('Only whole positive numbers allowed'));
    return Promise.resolve();
  };

  const nonNumericValidator = (_, value) => {
    if (!value) return Promise.resolve();
    if (/[0-9]/.test(value)) return Promise.reject(new Error('No numbers allowed'));
    return Promise.resolve();
  };

  /** N21: shortlist the ticked candidates onto the chosen MRF. */
  const handleAddToJd = async ({ mrfId, roleName, sendEmail, emailOverride }) => {
    if (selectedRows.length === 0) return;
    setAddingToJd(true);
    try {
      const res = await screeningService.shortlistCandidates({
        candidates: selectedRows.map((r) => ({ id: r.id, Name: r.name, EmailID: r.email })),
        mrf_id: mrfId,
        role_name: roleName,
        send_email: sendEmail,
        email_override: emailOverride,
        source: 'search_candidate',
      });
      const result = res.data?.data || res.data || {};
      const skipped = result.skipped_candidates || [];
      // Compared as strings: row ids and the server's cv_id differ in type.
      const skippedIds = new Set(skipped.map((x) => String(x.cv_id)));
      const failures = result.email_failures || [];
      const role = openRoles.find((r) => r.id === mrfId);
      setAddResult({
        roleLabel: role ? mrfOptionLabel(role) : roleName,
        added: selectedRows.filter((r) => !skippedIds.has(String(r.id))).map((r) => r.name || 'Candidate'),
        emailed: sendEmail && failures.length === 0,
        skipped,
        failures,
      });
      setAddToJdOpen(false);
      setSelectedRowKeys([]);
      setSelectedRows([]);
    } catch (err) {
      message.error(err?.message || 'Failed to add the candidates to the JD.');
    } finally {
      setAddingToJd(false);
    }
  };

  const columns = [
    {
      title: '#',
      key: 'index',
      width: 40,
      render: (_, __, index) => <span style={{ color: 'var(--text-3)', fontWeight: 600 }}>{(page - 1) * pageSize + index + 1}</span>,
    },
    // No column is sortable. The table is always id-descending (see
    // loadCandidates) — one fixed, predictable order, with search as the only way
    // to narrow it. Adding `sorter` back to any column would also need the API to
    // support that field: resolveSortField() in candidate.service.js silently
    // falls back to createdAt for keys it doesn't know, so an arrow on e.g.
    // Location would quietly reorder by date instead.
    {
      title: 'NAME',
      dataIndex: 'name',
      key: 'name',
      // The chip rides with the name rather than taking its own column: the
      // table is already wide, and a referral is a fact about the person. No
      // referrer name here — this is a broad, screenshot-able list.
      //
      // Plain inline flow, NOT an antd <Space>. Space is inline-flex, and inside
      // this narrow auto-width column its children shrink to their minimum
      // content width — which broke a long name into one character per line.
      render: (text, record) => (
        <>
          <Text strong style={{ fontSize: 13, color: 'var(--text)', whiteSpace: 'nowrap' }}>{text || '—'}</Text>
          {record.isReferral ? (
            <>
              {' '}
              <ReferralChip compact />
            </>
          ) : null}
        </>
      ),
    },
    {
      title: 'EMAIL',
      dataIndex: 'email',
      key: 'email',
      render: (text) => <span style={{ fontFamily: 'monospace', fontSize: 12.5, color: 'var(--text)' }}>{text || '—'}</span>,
    },
    {
      title: 'CONTACT',
      dataIndex: 'phone',
      key: 'phone',
      render: (text) => <span style={{ fontFamily: 'monospace', fontSize: 12.5, color: 'var(--text)' }}>{text || '—'}</span>,
    },
    {
      title: 'POSITION APPLIED',
      dataIndex: 'position',
      key: 'position',
      render: (text) => <Text style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{text || '—'}</Text>,
    },
    {
      title: 'GENDER',
      dataIndex: 'gender',
      key: 'gender',
      render: (text) => <Text style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{text || '—'}</Text>,
    },
    {
      title: 'LOCATION',
      dataIndex: 'location',
      key: 'location',
      render: (text) => <Text style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{text || '—'}</Text>,
    },
    // Dates (N27, N44). Not sortable, like every other column — see above.
    {
      title: 'DATE ADDED',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: dateCell,
    },
    {
      title: 'DETAILS REQUESTED',
      dataIndex: 'detailsRequestedAt',
      key: 'detailsRequestedAt',
      render: dateCell,
    },
    {
      title: 'DETAILS COMPLETED',
      dataIndex: 'detailsCompletedAt',
      key: 'detailsCompletedAt',
      render: (value) => (value
        ? <Text strong style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{fmtDate(value)}</Text>
        : dateCell(value)),
    },
    {
      title: 'ACTION',
      key: 'action',
      align: 'right',
      width: 120,
      render: (_, record) => {
        const fileUrl = record.cvFileUrl;
        const hasCv = fileUrl && fileUrl !== 'null' && fileUrl !== 'undefined' && String(fileUrl).trim() !== '';
        return (
          <Space size={4}>
            <Button
              size="small"
              title="CV/Resume"
              aria-label="CV/Resume"
              icon={<FileTextOutlined />}
              onClick={() => handleDownloadResume(fileUrl)}
              style={{
                borderRadius: 6,
                // --brand-primary, not a literal #7a922e: per-org theming works by
                // swapping the brand layer, and a hardcoded hex is invisible to it.
                background: hasCv ? 'var(--brand-primary)' : 'var(--ink-4)',
                borderColor: hasCv ? 'var(--brand-primary)' : 'var(--border)',
                // #fff stays literal: it is the foreground ON the brand fill, not a
                // brand colour itself, and the app writes it that way throughout.
                color: hasCv ? '#fff' : 'var(--text-3)',
              }}
            />
            <Button
              size="small"
              title="View"
              aria-label="View"
              icon={<EyeOutlined />}
              onClick={() => handleOpenView(record)}
              style={{ borderRadius: 6, background: 'var(--colorBgContainer)', borderColor: 'var(--border)', color: 'var(--text-2)' }}
            />
            {canEdit && (
              <Button
                size="small"
                title="Edit"
                aria-label="Edit"
                icon={<EditOutlined />}
                onClick={() => handleOpenEdit(record)}
                style={{ borderRadius: 6, background: 'var(--brand-primary)', borderColor: 'var(--brand-primary)', color: '#fff' }}
              />
            )}
            <Button
              size="small"
              title="Conversations"
              aria-label="Conversations"
              icon={<MessageOutlined />}
              onClick={() => handleOpenEmails(record)}
              style={{
                borderRadius: 6,
                background: 'var(--ink-4)',
                borderColor: 'var(--border)',
                color: 'var(--violet)',
              }}
            />
          </Space>
        );
      },
    },
  ];

  return (
    // Full width of the content area (no 1200px cap, no extra padding — MainLayout
    // already pads every page): with the date columns the table needs the room.
    <div ref={rootRef} className="stagger-children">
      {/* 3-Field Candidate Search Card — tier 2, and this page's one feature
          surface, so it takes the spotlight (the same way /candidates/:id spends
          it on its header card and the dashboard on exactly one widget).

          The inline radius and shadow are gone because `.glass-card` owns both;
          leaving them would have pinned a 12px radius and a flat black shadow
          under the glass treatment. The `borderTop: 4px solid #7a922e` rail is
          gone for a design reason rather than a token one — a flat green bar
          under a gradient rim is the pre-glass vocabulary showing through. */}
      <Card
        bordered={false}
        className="glass-card spotlight"
        style={{ marginBottom: 16 }}
        styles={{ body: { padding: '18px 20px' } }}
      >
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <Title level={4} style={{ fontFamily: "'Sora', sans-serif", fontWeight: 700, margin: 0 }}>
            Search Candidate
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {total > 0
              ? `Browsing all ${total.toLocaleString()} candidates. Search by name, email or phone number.`
              : 'Search by name, email or phone number.'}
          </Text>
        </div>

        <Form form={form} layout="vertical" onFinish={handleSearch}>
          <Row gutter={14} align="bottom">
            {[
              { name: 'name', label: 'Candidate Name', ph: 'e.g. Rahul Sharma' },
              { name: 'email', label: 'Email ID', ph: 'candidate@example.com' },
              { name: 'phone', label: 'Phone / Contact Number', ph: '+91 98765 43210' },
            ].map((f) => (
              <Col flex="1 1 200px" key={f.name}>
                <Form.Item
                  label={<span style={{ fontWeight: 600, fontSize: 11, textTransform: 'uppercase', color: 'var(--text-2)' }}>{f.label}</span>}
                  name={f.name}
                  style={{ marginBottom: 0 }}
                >
                  <Input placeholder={f.ph} allowClear style={{ height: 36, borderRadius: 8 }} />
                </Form.Item>
              </Col>
            ))}
            <Col flex="1 1 200px">
              <Form.Item
                label={<span style={{ fontWeight: 600, fontSize: 11, textTransform: 'uppercase', color: 'var(--text-2)' }}>Details completed in</span>}
                name="completedWithin"
                initialValue=""
                style={{ marginBottom: 0 }}
              >
                <Select options={COMPLETED_IN_OPTIONS} style={{ height: 36 }} />
              </Form.Item>
            </Col>
            <Col flex="none">
              <Form.Item style={{ marginBottom: 0 }}>
                <Space>
                  <Button
                    type="primary"
                    htmlType="submit"
                    icon={<SearchOutlined />}
                    loading={loading}
                    style={{ height: 36, borderRadius: 8, fontWeight: 600, padding: '0 20px' }}
                  >
                    Search
                  </Button>
                  <Button
                    onClick={handleClearFilters}
                    disabled={!hasFilters}
                    style={{ height: 36, borderRadius: 8 }}
                  >
                    Reset
                  </Button>
                </Space>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      {/* Initial load only — subsequent page/filter changes use the table's own
          loading overlay so rows don't disappear and jump the scroll position.

          A skeleton in the table's own shape rather than the centred <Spin> that
          was here: the spinner occupied ~100px, then the table replaced it and
          shoved the page down several hundred. The skeleton holds the space. */}
      {loading && candidates.length === 0 && (
        <Card bordered={false} className="glass-3 no-lift" styles={{ body: { padding: 12 } }}>
          <LoadingSkeleton type="table" rows={8} />
        </Card>
      )}

      {/* The table renders unconditionally once anything has loaded — it owns its own
          empty state. The page previously hid the whole card until a search had run,
          which is why it looked broken on arrival.

          Tier 3 — a paginated table of up to 100 rows is exactly the dense-data
          case tier 3 exists for, and this is the first real consumer of
          `.glass-3` in the app (it was written for a dashboard card that was
          replaced before it shipped). `no-lift` cancels the base
          `.ant-card:not(.no-lift):hover` rise: a whole records table bobbing as
          the pointer crosses it is wrong. Radius and shadow come from the class. */}
      {(!loading || candidates.length > 0) && (
        <Card
          bordered={false}
          className="glass-3 no-lift"
          styles={{ body: { padding: 12 } }}
        >
          <div style={{
            padding: '8px 12px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}>
            <Text strong style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>
              {/* Real match count from the server, not the number of rows fetched. */}
              {total.toLocaleString()} {total === 1 ? 'candidate' : 'candidates'}
              {hasFilters ? ' matching' : ' in total'}
            </Text>
            {activeFilters.completedWithin && (
              <Text style={{ fontSize: 12.5, color: 'var(--text-2)', flex: 1 }}>
                {total.toLocaleString()} {total === 1 ? 'candidate' : 'candidates'} completed their details {COMPLETED_IN_PHRASE[activeFilters.completedWithin]}. Newest first.
              </Text>
            )}
            {canAddToJd && selectedRowKeys.length > 0 && (
              <Space size={8} data-testid="selection-bar">
                <Text strong style={{ fontSize: 12.5 }}>{selectedRowKeys.length} selected</Text>
                <Button type="primary" size="small" onClick={() => setAddToJdOpen(true)}>Add to JD</Button>
                <Button size="small" onClick={() => { setSelectedRowKeys([]); setSelectedRows([]); }}>Clear selection</Button>
              </Space>
            )}
            <ExportButton
              request={(cfg) => candidateService.exportCsv(activeFilters, cfg)}
              fallbackName="AAPNA-ATS_Candidates.csv"
              rowCount={total}
              size="small"
            />
          </div>

          <div style={{ overflowX: 'auto' }}>
            <Table
              dataSource={candidates}
              // Every header on one line (review 15 Oct): the table scrolls
              // sideways when it must, it never stacks a header into two rows.
              columns={columns.map((col) => ({ ...col, onHeaderCell: () => ({ style: HEADER_CELL_STYLE }), onCell: () => ({ style: BODY_CELL_STYLE }) }))}
              rowKey={(r) => r.id ?? r.EmailID}
              // N21: ticks for staff with screening access; kept across pages.
              rowSelection={canAddToJd ? {
                selectedRowKeys,
                preserveSelectedRowKeys: true,
                columnWidth: 32,
                onChange: (keys, rows) => {
                  setSelectedRowKeys(keys);
                  // antd drops rows it has not seen on this page from `rows`;
                  // keep the ones remembered from earlier pages.
                  setSelectedRows((prev) => {
                    const byId = new Map(prev.map((r) => [r.id, r]));
                    rows.filter(Boolean).forEach((r) => byId.set(r.id, r));
                    return keys.map((k) => byId.get(k)).filter(Boolean);
                  });
                },
              } : undefined}
              loading={loading}
              onChange={handleTableChange}
              // Natural column widths, scrolling sideways when the dates make the
              // table wider than the card (N27/N44) — never squeezing a name mid-word.
              scroll={{ x: 'max-content' }}
              locale={{
                // The Phase 2 EmptyState, in its two real shapes: a search that
                // matched nothing (recoverable — offer the reset) versus a
                // genuinely empty database (nothing to recover, so no button
                // that would do nothing).
                emptyText: hasFilters ? (
                  <EmptyState
                    size="sm"
                    icon={<SearchOutlined />}
                    title="No candidates match this search"
                    body="Try searching on fewer details — a partial name or just the email domain usually finds it."
                    actionLabel="Reset search"
                    onAction={handleClearFilters}
                  />
                ) : (
                  <EmptyState
                    size="sm"
                    icon={<InboxOutlined />}
                    title="No candidates in the database yet"
                    body="Candidates appear here once resumes have been uploaded and parsed."
                  />
                ),
              }}
              pagination={{
                current: page,
                pageSize,
                total,
                showSizeChanger: true,
                pageSizeOptions: ['25', '50', '100'],
                showTotal: (t, range) => `${range[0]}–${range[1]} of ${t.toLocaleString()}`,
                style: { paddingRight: 10 },
              }}
              size="middle"
            />
          </div>
        </Card>
      )}

      {/* 1) VIEW CANDIDATE DETAILS MODAL (High Fidelity) */}
      <Modal
        title={<span style={{ fontSize: 16, fontFamily: "'Sora', sans-serif", fontWeight: 700 }}>View Candidate</span>}
        open={viewOpen}
        onCancel={() => setViewOpen(false)}
        footer={[
          <Button
            key="close"
            style={{ borderRadius: 6, fontWeight: 600 }}
            onClick={() => setViewOpen(false)}
          >
            Close
          </Button>
        ]}
        width={750}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto', paddingRight: 12 } }}
      >
        <CandidateDetailCard candidate={selectedCandidate} showPipelineScores={canEdit} />
      </Modal>

      {/* 2) EDIT CANDIDATE DETAILS MODAL. One field per row (N18 review), with
          the same lists and rules as the candidate's own details form
          (constants/candidateFields.js); the server checks them again. */}
      <Modal
        title={<span style={{ fontSize: 16, fontFamily: "'Sora', sans-serif", fontWeight: 700 }}>Edit Candidate</span>}
        open={editOpen}
        onOk={handleSaveEdit}
        onCancel={() => setEditOpen(false)}
        okText="Update Candidate"
        okButtonProps={{ loading: updating }}
        width={680}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto', paddingRight: 12 } }}
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          {/* Section 1: Personal Information */}
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Personal Information</span>
            <div style={{ height: 1, background: 'var(--border-light)', marginTop: 6 }} />
          </div>

          <Form.Item label={fieldLabel('CANDIDATE NAME')} name="name">
            <Input readOnly style={{ background: 'var(--ink-4)', cursor: 'not-allowed', borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={fieldLabel('CANDIDATE EMAIL')} name="email">
            <Input readOnly style={{ background: 'var(--ink-4)', cursor: 'not-allowed', borderRadius: 6 }} />
          </Form.Item>

          <Form.Item
            label={fieldLabel('CANDIDATE CONTACT NUMBER')}
            name="phone"
            rules={[phoneRule]}
            extra={fieldHint('10 digits; +91, spaces and dashes are fine.')}
          >
            <Input style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={fieldLabel('HIGHEST QUALIFICATION')} name="education">
            <Select
              placeholder="Select"
              showSearch
              allowClear
              options={optionsKeeping(QUALIFICATION_OPTIONS, selectedCandidate?.education)}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.education !== b.education}>
            {({ getFieldValue }) => (getFieldValue('education') === QUALIFICATION_OTHER ? (
              <Form.Item
                label={fieldLabel('SPECIFY QUALIFICATION')}
                name="educationOther"
                rules={[{ required: true, whitespace: true, message: 'Enter the qualification.' }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            ) : null)}
          </Form.Item>

          <Form.Item label={fieldLabel('TOTAL EXPERIENCE (YEARS)')} name="experience" rules={[experienceRule('Total experience')]}>
            <Input placeholder="e.g. 5 or 5.5" style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item
            label={fieldLabel('LAST COMPANY EXPERIENCE (YEARS)')}
            name="lastCompanyExperience"
            dependencies={['experience']}
            rules={[experienceRule('Last company experience'), notMoreThanTotalRule('experience')]}
          >
            <Input placeholder="e.g. 2 or 2.5" style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item
            label={fieldLabel('CURRENT LOCATION')}
            name="location"
            extra={fieldHint('Suggests cities already in the ATS; free text allowed.')}
          >
            <AutoComplete options={cityOptions} filterOption={filterByText} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item label={fieldLabel('CTC (LPA)')} name="currentCTC" rules={[ctcRule('CTC (LPA)')]}>
            <Input placeholder="e.g. 10 or 10.5" style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={fieldLabel('EXPECTED CTC (LPA)')} name="expectedCTC" rules={[ctcRule('Expected CTC (LPA)')]}>
            <Input placeholder="e.g. 10 or 10.5" style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={fieldLabel('NOTICE PERIOD')} name="noticePeriod">
            <Select placeholder="Select" allowClear options={optionsKeeping(NOTICE_PERIOD_OPTIONS, selectedCandidate?.noticePeriod)} />
          </Form.Item>

          <Form.Item
            label={fieldLabel('POSITION APPLIED')}
            name="position"
            extra={fieldHint('Search open roles, or type another.')}
          >
            <AutoComplete options={roleNameOptions} filterOption={filterByText} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item label={fieldLabel('JOB SOURCE')} name="jobSource">
            <Input style={{ borderRadius: 6 }} />
          </Form.Item>

          {/* Referral sits next to Job Source because that is the free-text field
              recruiters have been using for it ("Referral - Anuj"). This is the
              structured replacement; it saves through its own audited endpoints,
              NOT through "Update Candidate" — see ReferralPanel's header.
              Mounted only while the modal is open, and keyed by candidate, so
              reopening always shows current state rather than a stale cache. */}
          {editOpen && selectedCandidate?.id ? (
            <ReferralPanel
              key={selectedCandidate.id}
              candidateId={selectedCandidate.id}
              onChanged={loadCandidates}
            />
          ) : null}

          <Form.Item
            label={fieldLabel('RECRUITER INFO (AAPNA)')}
            name="recruiterInfo"
            extra={fieldHint('Active recruiter accounts, or "None".')}
          >
            <Select
              placeholder="Select"
              showSearch
              allowClear
              options={optionsKeeping([...recruiterNames, RECRUITER_NONE], selectedCandidate?.recruiterInfo)}
            />
          </Form.Item>

          <Form.Item label={fieldLabel('ENGLISH COMMUNICATION RATING')} name="englishCommunicationRating">
            <Select placeholder="Select" options={ENGLISH_RATING_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))} />
          </Form.Item>

          <Form.Item label={fieldLabel('TOP 5 KEY SKILLS')} name="top5KeySkills">
            <Input.TextArea placeholder="React, Node.js, Python, AWS, Docker" style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={fieldLabel('GENDER')} name="gender">
            <Select placeholder="Select">
              <Select.Option value="Male">Male</Select.Option>
              <Select.Option value="Female">Female</Select.Option>
              <Select.Option value="Other">Other</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item label={fieldLabel('PREFERRED SHIFT')} name="preferredShift">
            <Select placeholder="Select" allowClear options={optionsKeeping(SHIFT_OPTIONS, selectedCandidate?.preferredShift)} />
          </Form.Item>

          <Form.Item label={fieldLabel('REASON FOR JOB CHANGE')} name="reasonForJobChange">
            <Input.TextArea style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={fieldLabel('WILLING TO TAKE ONLINE TEST?')} name="willingToTakeOnlineTest">
            <Select placeholder="Select">
              <Select.Option value="Yes">Yes</Select.Option>
              <Select.Option value="No">No</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item label={fieldLabel('HAS LAPTOP FOR INITIAL DAYS?')} name="hasLaptopForInitialDays">
            <Select placeholder="Select">
              <Select.Option value="Yes">Yes</Select.Option>
              <Select.Option value="No">No</Select.Option>
            </Select>
          </Form.Item>

          <div style={{ background: 'var(--ink-4)', padding: '14px 18px', borderRadius: 8, border: '1px solid var(--border-light)', marginBottom: 24 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', display: 'block', marginBottom: 10 }}>Current Company</span>
            <Form.Item label={<span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-2)' }}>COMPANY NAME</span>} name={['currentCompany', 'Name']}>
              <Input placeholder="e.g. Google" style={{ borderRadius: 6 }} />
            </Form.Item>
            <Form.Item label={<span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-2)' }}>WEBSITE</span>} name={['currentCompany', 'Website']} style={{ marginBottom: 0 }}>
              <Input placeholder="https://example.com" style={{ borderRadius: 6 }} />
            </Form.Item>
          </div>

          {/* Section 2: Education */}
          <div style={{ marginBottom: 8, marginTop: 24 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Education</span>
            <div style={{ height: 1, background: 'var(--border-light)', marginTop: 6 }} />
          </div>

          <Form.Item label={fieldLabel('10TH PERCENTAGE')} name="a10th" rules={[percentRule('10th percentage')]}>
            <Input style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={fieldLabel('12TH PERCENTAGE')} name="a12th" rules={[percentRule('12th percentage')]}>
            <Input style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={fieldLabel('GRADUATION PERCENTAGE')} name="graduation" rules={[percentRule('Graduation percentage')]}>
            <Input style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={fieldLabel('POST GRADUATION PERCENTAGE')} name="postGraduation" rules={[percentRule('Post graduation percentage')]}>
            <Input style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={fieldLabel('GRADUATION DEGREE')} name="graduationdegree" rules={[{ validator: nonNumericValidator }]}>
            <Input style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={fieldLabel('GRADUATION SPECIALIZATION')} name="graduationspecialization" rules={[{ validator: nonNumericValidator }]}>
            <Input style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={fieldLabel('POST GRADUATION DEGREE')} name="postgraduationdegree" rules={[{ validator: nonNumericValidator }]}>
            <Input style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={fieldLabel('POST GRADUATION SPECIALIZATION')} name="postgraduationspecialization" rules={[{ validator: nonNumericValidator }]}>
            <Input style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={fieldLabel('LINKEDIN PROFILE LINK')} name="LinkedInProfile">
            <Input placeholder="https://linkedin.com/in/..." style={{ borderRadius: 6 }} />
          </Form.Item>

          {/* Section 3: Employment History */}
          <div style={{ marginBottom: 8, marginTop: 24 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Employment History</span>
            <div style={{ height: 1, background: 'var(--border-light)', marginTop: 6 }} />
          </div>

          <Form.List name="employment_history_companies">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...restField }) => (
                  <div key={key} style={{ marginBottom: 12, padding: '12px 14px', background: 'var(--ink-4)', borderRadius: 8, border: '1px solid var(--border-light)' }}>
                    <Form.Item
                      {...restField}
                      name={[name, 'CompanyName']}
                      label={<span style={{ fontSize: 10, fontWeight: 600 }}>COMPANY NAME</span>}
                      rules={[{ required: true, message: 'Required' }]}
                    >
                      <Input placeholder="e.g. Google" style={{ borderRadius: 6 }} />
                    </Form.Item>
                    <Form.Item
                      {...restField}
                      name={[name, 'StartDate']}
                      label={<span style={{ fontSize: 10, fontWeight: 600 }}>START DATE</span>}
                    >
                      <Input placeholder="e.g. Jan 2023" style={{ borderRadius: 6 }} />
                    </Form.Item>
                    <Form.Item
                      {...restField}
                      name={[name, 'EndDate']}
                      label={<span style={{ fontSize: 10, fontWeight: 600 }}>END DATE</span>}
                      style={{ marginBottom: 8 }}
                    >
                      <Input placeholder="e.g. Dec 2024" style={{ borderRadius: 6 }} />
                    </Form.Item>
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={() => remove(name)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                <Form.Item>
                  <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />} style={{ height: 38 }}>
                    Add Company Experience
                  </Button>
                </Form.Item>
              </>
            )}
          </Form.List>

          {/* Section 4: Assessment & Interview */}
          <div style={{ marginBottom: 8, marginTop: 24 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Assessment & Interview</span>
            <div style={{ height: 1, background: 'var(--border-light)', marginTop: 6 }} />
          </div>

          <Form.Item label={fieldLabel('HEAT')} name="Heat">
            <Input style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={fieldLabel('FINAL STATUS')} name="FinalStatus">
            <Input style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={fieldLabel('HR QUICK COMMENTS')} name="HRQuickcomments">
            <Input.TextArea style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={fieldLabel('IQ SCORE')} name="IQScore" rules={[{ validator: wholeNumberValidator }]}>
            <Input style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={fieldLabel('TECH SCORE')} name="TechScore" rules={[{ validator: wholeNumberValidator }]}>
            <Input style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={fieldLabel('ZEKO INTERVIEW SCORE')} name="ZekoInterviewScore" rules={[{ validator: wholeNumberValidator }]} extra={ZEKO_SYNC_HINT}>
            <Input style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={fieldLabel('ZEKO CODING SCORE')} name="ZekoCodingScore" rules={[{ validator: wholeNumberValidator }]} extra={ZEKO_SYNC_HINT}>
            <Input style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={fieldLabel('ZEKO COMMUNICATION SCORE')} name="ZekoCommunicationScore" rules={[{ validator: wholeNumberValidator }]} extra={ZEKO_SYNC_HINT}>
            <Input style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={fieldLabel('TECH ROUND ONE FEEDBACK')} name="TechRoundOne">
            <Input.TextArea style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={fieldLabel('TECH ROUND TWO FEEDBACK')} name="TechRoundTwo">
            <Input.TextArea style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={fieldLabel('TECH ROUND THREE FEEDBACK')} name="TechRoundThree">
            <Input.TextArea style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={fieldLabel('MANAGERIAL / CEO FEEDBACK')} name="ManagerialOrCEOFeedback">
            <Input.TextArea style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={fieldLabel('HR INTERVIEW')} name="HRInterview">
            <Input.TextArea style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={fieldLabel('APPLICATION STATUS')} name="status">
            <Select>
              <Select.Option value="new">New</Select.Option>
              <Select.Option value="screening">Screening</Select.Option>
              <Select.Option value="shortlisted">Shortlisted</Select.Option>
              <Select.Option value="interview">Interview</Select.Option>
              <Select.Option value="offered">Offered</Select.Option>
              <Select.Option value="hired">Hired</Select.Option>
              <Select.Option value="rejected">Rejected</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* 3) EMAIL CONVERSATIONS / COMMUNICATIONS MODAL (Screenshot 2) */}
      <Modal
        title={
          selectedCandidate && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '90%' }}>
              <div>
                <Title level={4} style={{ margin: 0, fontSize: 15 }}>{selectedCandidate.name}</Title>
                <Text type="secondary" style={{ fontSize: 11.5, fontWeight: 400 }}>{selectedCandidate.email}</Text>
              </div>
              <Tag color="processing" style={{ borderRadius: 12, fontWeight: 700, fontSize: 10, padding: '2px 10px' }}>
                {emails.length} messages
              </Tag>
            </div>
          )
        }
        open={emailsOpen}
        onCancel={() => setEmailsOpen(false)}
        footer={[
          <Button key="close" style={{ borderRadius: 6 }} onClick={() => setEmailsOpen(false)}>
            Close
          </Button>
        ]}
        width={650}
        styles={{ body: { padding: '12px 24px 24px' } }}
      >
        {emailsLoading ? (
          <div style={{ padding: '60px 0', textAlign: 'center' }}>
            <Spin size="large" />
            <div style={{ marginTop: 12, color: 'var(--text-3)' }}>Loading email thread…</div>
          </div>
        ) : emails.length > 0 ? (
          <div style={{ maxHeight: '55vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {emails.map((email) => {
              const isOutbound = email.direction?.toLowerCase() === 'outbound' || email.from_email === selectedCandidate.email;
              return (
                <div
                  key={email.id}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: 12,
                    background: isOutbound ? 'var(--ink-4)' : 'var(--colorBgContainer)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text strong style={{ fontSize: 13 }}>{email.subject || '(No Subject)'}</Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {email.sent_at ? fmtDateTime(email.sent_at) : ''}
                    </Text>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 6 }}>
                    <strong>From:</strong> {email.from_name ? `${email.from_name} <${email.from_email}>` : email.from_email}
                  </div>
                  <Paragraph style={{ fontSize: 12.5, margin: 0, whiteSpace: 'pre-line', color: 'var(--text)' }}>
                    {email.body_preview || '(Empty preview)'}
                  </Paragraph>
                </div>
              );
            })}
          </div>
        ) : (
          <div
            style={{
              background: 'var(--ink-4)',
              border: '1px dashed var(--border)',
              borderRadius: 8,
              padding: '44px 20px',
              textAlign: 'center',
              color: 'var(--text-3)',
            }}
          >
            <HistoryOutlined style={{ fontSize: 32, opacity: 0.3, marginBottom: 12 }} />
            <div style={{ fontSize: 13.5, fontWeight: 500 }}>No email conversations found for this candidate.</div>
          </div>
        )}
      </Modal>

      {/* N21: Add to JD — the Screening page's shortlist dialog and result. */}
      {canAddToJd && (
        <>
          <DecisionEmailModal
            open={addToJdOpen}
            decision="shortlist"
            activeTab="search"
            candidates={selectedRows.map((r) => ({ id: r.id, Name: r.name, EmailID: r.email, ContactNumber: r.phone }))}
            roles={openRoles}
            confirmLoading={addingToJd}
            onCancel={() => setAddToJdOpen(false)}
            onConfirm={handleAddToJd}
          />
          <ShortlistResultModal
            open={Boolean(addResult)}
            roleLabel={addResult?.roleLabel || ''}
            added={addResult?.added}
            emailed={addResult?.emailed}
            skipped={addResult?.skipped}
            emailFailures={addResult?.failures}
            onClose={() => setAddResult(null)}
          />
        </>
      )}
    </div>
  );
}
