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
 * user-adjustable, so there are no sort arrows anywhere in the table.
 *
 * Retained as-is: the view/edit/conversations modals and CSV export. Export takes the
 * same filter object as the table, so it exports exactly what is on screen.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
/* Button comes from src/ui, not antd — see the import below. A raw AntD button on a
   converted route renders flat: themeConfig.js zeroes `primaryShadow` whenever preset
   geometry is on, on the stated assumption that `.ui-btn` repaints the glow, and
   <DesignScope> turns preset geometry on for this whole subtree. */
import { Form, Input, Card, Table, Space, Tag, Modal, Row, Col, Typography, message, Select, Spin } from 'antd';
import { SearchOutlined, EyeOutlined, EditOutlined, MessageOutlined, FileTextOutlined, HistoryOutlined, CloseOutlined, PlusOutlined, DeleteOutlined, InboxOutlined } from '@ant-design/icons';
import candidateService from '../services/candidateService';
import CandidateDetailCard from '../components/CandidateDetailCard';
import ReferralPanel from '../components/candidates/ReferralPanel';
import ReferralChip from '../components/candidates/ReferralChip';
import ExportButton from '../components/common/ExportButton';
import EmptyState from '../components/common/EmptyState';
import { DesignScope, PageShell, PageHeader, Surface, Button } from '../ui';
import LoadingSkeleton from '../components/common/LoadingSkeleton';
import usePointerSpotlight from '../hooks/usePointerSpotlight';

const { Title, Text, Paragraph } = Typography;

export default function Candidates() {
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
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
  const [searchParams, setSearchParams] = useState({
    name: '', email: '', phone: '',
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
      const res = await candidateService.search(
        { ...activeFilters, sort: 'id', order: 'desc' },
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
    });
    setPage(1);
  };

  const handleClearFilters = () => {
    form.resetFields();
    setSearchParams({ name: '', email: '', phone: '' });
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
        education: values.education,
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

      await candidateService.update(selectedCandidate.id, payload);
      message.success('Candidate details updated successfully.');
      setEditOpen(false);
      loadCandidates(searchParams);
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

  // Custom validation helpers
  const contactNumberValidator = (_, value) => {
    if (!value) return Promise.resolve();
    const val = String(value).trim();
    if (val === '') return Promise.resolve();
    if (/[a-zA-Z]/.test(val)) return Promise.reject(new Error('No alphabets allowed'));
    if (!/^[0-9\s\-+\(\)\.,]+$/.test(val)) return Promise.reject(new Error('Invalid characters in phone number'));
    const parts = val.split(',').map(p => p.trim());
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p === '') return Promise.reject(new Error('Empty number between commas'));
      const digits = p.replace(/[^0-9]/g, '');
      if (digits.length < 7 || digits.length > 15) {
        return Promise.reject(new Error('Invalid length (7-15 digits)'));
      }
    }
    return Promise.resolve();
  };

  const experienceValidator = (_, value) => {
    if (value === undefined || value === null || String(value).trim() === '') return Promise.resolve();
    const val = String(value).trim();
    if (!/^[\d.]+$/.test(val)) return Promise.reject(new Error('Only numeric values are allowed'));
    if ((val.match(/\./g) || []).length > 1) return Promise.reject(new Error('Invalid number format'));
    const parts = val.split('.');
    if (parts[1] !== undefined && parts[1].length > 2) return Promise.reject(new Error('Max 2 decimal places'));
    const num = parseFloat(val);
    if (isNaN(num) || num < 0) return Promise.reject(new Error('Only numeric values are allowed'));
    if (num > 60) return Promise.reject(new Error('Value out of range (max 60)'));
    const experienceRegex = /^(60(\.0{1,2})?|[0-5]?\d(\.\d{1,2})?)$/;
    if (!experienceRegex.test(val)) return Promise.reject(new Error('Invalid format'));
    return Promise.resolve();
  };

  const lastCompanyExpValidator = (_, value) => {
    if (value === undefined || value === null || String(value).trim() === '') return Promise.resolve();
    const val = String(value).trim();
    if (!/^[\d.]+$/.test(val)) return Promise.reject(new Error('Only numeric values are allowed'));
    if ((val.match(/\./g) || []).length > 1) return Promise.reject(new Error('Invalid number format'));
    const parts = val.split('.');
    if (parts[1] !== undefined && parts[1].length > 2) return Promise.reject(new Error('Max 2 decimal places'));
    const num = parseFloat(val);
    if (isNaN(num) || num < 0) return Promise.reject(new Error('Only numeric values are allowed'));
    if (num > 60) return Promise.reject(new Error('Value out of range (max 60)'));
    const experienceRegex = /^(60(\.0{1,2})?|[0-5]?\d(\.\d{1,2})?)$/;
    if (!experienceRegex.test(val)) return Promise.reject(new Error('Invalid format'));
    
    // Check total experience
    const totalExp = editForm.getFieldValue('experience');
    if (totalExp) {
      const totalNum = parseFloat(totalExp);
      if (!isNaN(totalNum) && num > totalNum) {
        return Promise.reject(new Error('Cannot exceed Total Experience'));
      }
    }
    return Promise.resolve();
  };

  const decimalFieldValidator = (_, value) => {
    if (value === undefined || value === null || String(value).trim() === '') return Promise.resolve();
    const val = String(value).trim();
    if (!/^[\d.]+$/.test(val)) return Promise.reject(new Error('Only numeric values are allowed'));
    if ((val.match(/\./g) || []).length > 1) return Promise.reject(new Error('Invalid number format'));
    const parts = val.split('.');
    if (parts[1] !== undefined && parts[1].length > 2) return Promise.reject(new Error('Max 2 decimal places'));
    const num = parseFloat(val);
    if (isNaN(num) || num < 0) return Promise.reject(new Error('Only numeric values are allowed'));
    return Promise.resolve();
  };

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

  const noticePeriodValidator = (_, value) => {
    if (value === undefined || value === null || String(value).trim() === '') return Promise.resolve();
    const val = String(value).trim();
    if (val.includes('+') || val.includes('-')) return Promise.reject(new Error('Signs (+/-) not allowed'));
    return Promise.resolve();
  };

  const columns = [
    {
      title: '#',
      key: 'index',
      width: 50,
      render: (_, __, index) => <span className="cand-muted-strong">{(page - 1) * pageSize + index + 1}</span>,
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
          <Text strong className="cand-body">{text || '—'}</Text>
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
      render: (text) => <span className="cand-mono">{text || '—'}</span>,
    },
    {
      title: 'CONTACT',
      dataIndex: 'phone',
      key: 'phone',
      render: (text) => <span className="cand-mono">{text || '—'}</span>,
    },
    {
      title: 'POSITION APPLIED',
      dataIndex: 'position',
      key: 'position',
      render: (text) => <Text className="cand-body">{text || '—'}</Text>,
    },
    {
      title: 'GENDER',
      dataIndex: 'gender',
      key: 'gender',
      render: (text) => <Text className="cand-meta">{text || '—'}</Text>,
    },
    {
      title: 'LOCATION',
      dataIndex: 'location',
      key: 'location',
      render: (text) => <Text className="cand-meta">{text || '—'}</Text>,
    },
    {
      title: 'ACTION',
      key: 'action',
      align: 'right',
      width: 180,
      render: (_, record) => {
        const fileUrl = record.cvFileUrl;
        const hasCv = fileUrl && fileUrl !== 'null' && fileUrl !== 'undefined' && String(fileUrl).trim() !== '';
        return (
          <Space size={4}>
            {/* Row actions, converted 2026-08-31. These were four private treatments
                — `.cand-action`, `.cand-action--active`, `.cand-chip--off`,
                `.cand-chip--on` — each painting its own fill and border. They are now
                emphasis levels, which is the same information in the system's
                vocabulary: `soft` where the action is live, `text` where it is not.

                Deliberately NOT `solid`: a solid glowing button repeated down 25 rows
                is the case ui.css calls out as wrong. The old `.cand-chip--on` did
                exactly that on every Edit. */}
            <Button
              size="sm"
              emphasis={hasCv ? 'soft' : 'text'}
              iconOnly
              title="CV/Resume"
              icon={<FileTextOutlined />}
              onClick={() => handleDownloadResume(fileUrl)}
            />
            <Button
              size="sm"
              emphasis="text"
              onClick={() => handleOpenView(record)}
            >
              View
            </Button>
            <Button
              size="sm"
              emphasis="soft"
              onClick={() => handleOpenEdit(record)}
            >
              Edit
            </Button>
            {/* The violet `.cand-action--conv` ink goes with the class. The icon already
                distinguishes this action, and a per-page button colour is the thing the
                Button primitive exists to end. */}
            <Button
              size="sm"
              emphasis="text"
              iconOnly
              title="Conversations"
              icon={<MessageOutlined />}
              onClick={() => handleOpenEmails(record)}
            />
          </Space>
        );
      },
    },
  ];

  return (
    /* DesignScope is the Stage 5 conversion switch — this subtree takes the preset's
       AntD geometry while unconverted routes keep theirs. PageShell owns the page
       inset: this file previously set `padding: 24px` on top of the layout Content's
       own `24px 28px 40px`, so it sat ~48px in while /dashboard sat at 24. */
    <DesignScope>
      <PageShell ref={rootRef} width="standard">
      {/* 3-Field Candidate Search Card — tier 2, and this page's one feature
          surface, so it takes the spotlight (the same way /candidates/:id spends
          it on its header card and the dashboard on exactly one widget).

          The inline radius and shadow are gone because `.glass-card` owns both;
          leaving them would have pinned a 12px radius and a flat black shadow
          under the glass treatment. The `borderTop: 4px solid #7a922e` rail is
          gone for a design reason rather than a token one — a flat green bar
          under a gradient rim is the pre-glass vocabulary showing through. */}
      {/* The page header, lifted OUT of the search card — 2026-08-31.
          It sat inside the tier-2 Surface as a `Title level={3}`, which resolves to
          the pack's title3 role: 20px, against the lab List archetype's 32px
          `--fs-title-1`. A page title nested inside its own container also reads as
          that container's label rather than as the page's, so the screen opened on a
          form field with no anchor. The lab's List archetype puts the header above the
          search surface, which is what this now does. Previous markup at the foot of
          this file per the no-delete rule. */}
      <PageHeader
        eyebrow="Candidates"
        title="Search Candidate"
        /* One line, like the lab's. The "search by name, email or phone" half of the
           old copy is redundant now that the header sits directly above three labelled
           fields saying exactly that — it only pushed the subtitle onto a second line. */
        subtitle={total > 0
          ? `Every candidate across every open requisition — ${total.toLocaleString()} in the database.`
          : 'Every candidate across every open requisition.'}
      />

      <Surface
        tier={2}
        padding="relaxed"
        bloom
        className="cand-search-card"
      >
        <Form form={form} layout="vertical" onFinish={handleSearch} className="cand-form">
          <Row gutter={16}>
            {[
              { name: 'name', label: 'Candidate Name', ph: 'e.g. Rahul Sharma' },
              { name: 'email', label: 'Email ID', ph: 'candidate@example.com' },
              { name: 'phone', label: 'Phone / Contact Number', ph: '+91 98765 43210' },
            ].map((f) => (
              <Col xs={24} sm={12} lg={8} key={f.name}>
                <Form.Item
                  label={<span className="cand-caption">{f.label}</span>}
                  name={f.name}
                >
                  <Input placeholder={f.ph} allowClear />
                </Form.Item>
              </Col>
            ))}
          </Row>

          <Form.Item style={{ marginBottom: 0 }}>
            <Space>
              {/* Was a raw AntD button with the ui-btn classes pasted on as a string —
                  the workaround `Button` exists to remove. Same rendering, one source. */}
              <Button
                emphasis="solid"
                htmlType="submit"
                icon={<SearchOutlined />}
                loading={loading}
              >
                Search
              </Button>
              {/* `soft`, not AntD's default outline. ui.css states the reason: "an
                  outlined button next to a glowing solid one reads as disabled" — which
                  is exactly what this pair did, grey-outlined Reset beside solid Search.
                  `neutral` because clearing a form is not a brand action. */}
              <Button
                emphasis="soft"
                tone="neutral"
                onClick={handleClearFilters}
                disabled={!hasFilters}
              >
                Reset
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Surface>

      {/* Initial load only — subsequent page/filter changes use the table's own
          loading overlay so rows don't disappear and jump the scroll position.

          A skeleton in the table's own shape rather than the centred <Spin> that
          was here: the spinner occupied ~100px, then the table replaced it and
          shoved the page down several hundred. The skeleton holds the space. */}
      {loading && candidates.length === 0 && (
        <Surface tier={3} padding="compact">
          <LoadingSkeleton type="table" rows={8} />
        </Surface>
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
        <Surface
          tier={3}
          padding="compact"
        >
          <div style={{
            padding: '8px 12px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}>
            <Text strong className="cand-hint-caps">
              {/* Real match count from the server, not the number of rows fetched. */}
              {total.toLocaleString()} {total === 1 ? 'candidate' : 'candidates'}
              {hasFilters ? ' matching' : ' in total'}
            </Text>
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
              columns={columns}
              rowKey={(r) => r.id ?? r.EmailID}
              loading={loading}
              onChange={handleTableChange}
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
        </Surface>
      )}

      {/* 1) VIEW CANDIDATE DETAILS MODAL (High Fidelity) */}
      <Modal
        title={<span className="cand-modal-title">View Candidate</span>}
        open={viewOpen}
        onCancel={() => setViewOpen(false)}
        footer={[
          <Button
            key="close"
            emphasis="soft"
            tone="neutral"
            onClick={() => setViewOpen(false)}
          >
            Close
          </Button>
        ]}
        width={750}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto', paddingRight: 12 } }}
      >
        <CandidateDetailCard candidate={selectedCandidate} />
      </Modal>

      {/* 2) EDIT CANDIDATE DETAILS MODAL (High Fidelity) */}
      <Modal
        title={<span className="cand-modal-title">Edit Candidate</span>}
        open={editOpen}
        onOk={handleSaveEdit}
        onCancel={() => setEditOpen(false)}
        okText="Update Candidate"
        okButtonProps={{ loading: updating }}
        width={750}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto', paddingRight: 12 } }}
      >
        <Form form={editForm} layout="vertical" className="cand-form" style={{ marginTop: 16 }}>
          {/* Section 1: Personal Information */}
          <div style={{ marginBottom: 8 }}>
            <span className="cand-caption">Personal Information</span>
            <div className="cand-rule" />
          </div>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={<span className="cand-label">CANDIDATE NAME</span>} name="name">
                <Input readonly className="cand-disabled" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<span className="cand-label">CANDIDATE EMAIL</span>} name="email">
                <Input readonly className="cand-disabled" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                label={<span className="cand-label">CANDIDATE CONTACT NUMBER</span>} 
                name="phone"
                rules={[{ validator: contactNumberValidator }]}
                extra={<span className="cand-tiny-muted">Use commas to add multiple numbers (Supports international formats)</span>}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                label={<span className="cand-label">HIGHEST QUALIFICATION</span>} 
                name="education"
                rules={[{ validator: nonNumericValidator }]}
              >
                <Input />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                label={<span className="cand-label">TOTAL EXPERIENCE (YEARS)</span>} 
                name="experience"
                rules={[{ validator: experienceValidator }]}
              >
                <Input placeholder="e.g. 5 or 5.50" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                label={<span className="cand-label">LAST COMPANY EXPERIENCE (YEARS)</span>} 
                name="lastCompanyExperience"
                dependencies={['experience']}
                rules={[{ validator: lastCompanyExpValidator }]}
              >
                <Input placeholder="e.g. 5 or 5.50" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={<span className="cand-label">CURRENT LOCATION</span>} name="location">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                label={<span className="cand-label">CTC (LPA)</span>} 
                name="currentCTC"
                rules={[{ validator: decimalFieldValidator }]}
              >
                <Input placeholder="e.g. 10 or 10.5" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                label={<span className="cand-label">EXPECTED CTC (LPA)</span>} 
                name="expectedCTC"
                rules={[{ validator: decimalFieldValidator }]}
              >
                <Input placeholder="e.g. 10 or 10.5" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                label={<span className="cand-label">NOTICE PERIOD (DAYS)</span>} 
                name="noticePeriod"
                rules={[{ validator: noticePeriodValidator }]}
              >
                <Input />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                label={<span className="cand-label">POSITION APPLIED</span>} 
                name="position"
                rules={[{ validator: nonNumericValidator }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<span className="cand-label">JOB SOURCE</span>} name="jobSource">
                <Input />
              </Form.Item>
            </Col>
          </Row>

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

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                label={<span className="cand-label">RECRUITER INFO (AAPNA)</span>} 
                name="recruiterInfo"
                rules={[{ validator: nonNumericValidator }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<span className="cand-label">ENGLISH COMMUNICATION RATING</span>} name="englishCommunicationRating">
                <Select placeholder="Select">
                  <Select.Option value="1">1</Select.Option>
                  <Select.Option value="2">2</Select.Option>
                  <Select.Option value="3">3</Select.Option>
                  <Select.Option value="4">4</Select.Option>
                  <Select.Option value="5">5</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label={<span className="cand-label">TOP 5 KEY SKILLS</span>} name="top5KeySkills">
            <Input.TextArea placeholder="React, Node.js, Python, AWS, Docker" />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={<span className="cand-label">GENDER</span>} name="gender">
                <Select placeholder="Select">
                  <Select.Option value="Male">Male</Select.Option>
                  <Select.Option value="Female">Female</Select.Option>
                  <Select.Option value="Other">Other</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<span className="cand-label">PREFERRED SHIFT</span>} name="preferredShift">
                <Select placeholder="Select">
                  <Select.Option value="2pm - 11pm/3pm - 12am">2pm - 11pm/3pm - 12am</Select.Option>
                  <Select.Option value="4pm - 1am">4pm - 1am</Select.Option>
                  <Select.Option value="Others">Others</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label={<span className="cand-label">REASON FOR JOB CHANGE</span>} name="reasonForJobChange">
            <Input.TextArea />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={<span className="cand-label">WILLING TO TAKE ONLINE TEST?</span>} name="willingToTakeOnlineTest">
                <Select placeholder="Select">
                  <Select.Option value="Yes">Yes</Select.Option>
                  <Select.Option value="No">No</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<span className="cand-label">HAS LAPTOP FOR INITIAL DAYS?</span>} name="hasLaptopForInitialDays">
                <Select placeholder="Select">
                  <Select.Option value="Yes">Yes</Select.Option>
                  <Select.Option value="No">No</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <div className="cand-panel">
            <span className="cand-group-label">Current Company</span>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item label={<span className="cand-label">COMPANY NAME</span>} name={['currentCompany', 'Name']} style={{ marginBottom: 0 }}>
                  <Input placeholder="e.g. Google" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label={<span className="cand-label">WEBSITE</span>} name={['currentCompany', 'Website']} style={{ marginBottom: 0 }}>
                  <Input placeholder="https://example.com" />
                </Form.Item>
              </Col>
            </Row>
          </div>

          {/* Section 2: Education */}
          <div style={{ marginBottom: 8, marginTop: 24 }}>
            <span className="cand-caption">Education</span>
            <div className="cand-rule" />
          </div>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={<span className="cand-label">10TH PERCENTAGE</span>} name="a10th">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<span className="cand-label">12TH PERCENTAGE</span>} name="a12th">
                <Input />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={<span className="cand-label">GRADUATION PERCENTAGE</span>} name="graduation">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<span className="cand-label">POST GRADUATION PERCENTAGE</span>} name="postGraduation">
                <Input />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                label={<span className="cand-label">GRADUATION DEGREE</span>} 
                name="graduationdegree"
                rules={[{ validator: nonNumericValidator }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                label={<span className="cand-label">GRADUATION SPECIALIZATION</span>} 
                name="graduationspecialization"
                rules={[{ validator: nonNumericValidator }]}
              >
                <Input />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                label={<span className="cand-label">POST GRADUATION DEGREE</span>} 
                name="postgraduationdegree"
                rules={[{ validator: nonNumericValidator }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                label={<span className="cand-label">POST GRADUATION SPECIALIZATION</span>} 
                name="postgraduationspecialization"
                rules={[{ validator: nonNumericValidator }]}
              >
                <Input />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label={<span className="cand-label">LINKEDIN PROFILE LINK</span>} name="LinkedInProfile">
            <Input placeholder="https://linkedin.com/in/..." />
          </Form.Item>

          {/* Section 3: Employment History */}
          <div style={{ marginBottom: 8, marginTop: 24 }}>
            <span className="cand-caption">Employment History</span>
            <div className="cand-rule" />
          </div>

          <Form.List name="employment_history_companies">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...restField }) => (
                  <div key={key} className="cand-strip" style={{ gridTemplateColumns: '2fr 1.2fr 1.2fr 0.4fr' }}>
                    <Form.Item
                      {...restField}
                      name={[name, 'CompanyName']}
                      label={<span className="cand-micro">COMPANY NAME</span>}
                      rules={[{ required: true, message: 'Required' }]}
                      style={{ marginBottom: 0 }}
                    >
                      <Input placeholder="e.g. Google" />
                    </Form.Item>
                    <Form.Item
                      {...restField}
                      name={[name, 'StartDate']}
                      label={<span className="cand-micro">START DATE</span>}
                      style={{ marginBottom: 0 }}
                    >
                      <Input placeholder="e.g. Jan 2023" />
                    </Form.Item>
                    <Form.Item
                      {...restField}
                      name={[name, 'EndDate']}
                      label={<span className="cand-micro">END DATE</span>}
                      style={{ marginBottom: 0 }}
                    >
                      <Input placeholder="e.g. Dec 2024" />
                    </Form.Item>
                    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                      {/* `tone="danger"` rather than AntD's `danger` prop: the tone
                          feeds --ui-tone/--ui-glow, so the destructive meaning survives
                          a preset or tenant swap instead of being AntD's fixed red. */}
                      <Button
                        emphasis="text"
                        tone="danger"
                        iconOnly
                        title="Remove"
                        icon={<DeleteOutlined />}
                        onClick={() => remove(name)}
                      />
                    </div>
                  </div>
                ))}
                <Form.Item>
                  {/* `dashed` is not in the system's vocabulary — the three emphases
                      are solid/soft/text. A soft block button is the same "add another"
                      affordance without a fourth border style. */}
                  <Button emphasis="soft" onClick={() => add()} block icon={<PlusOutlined />}>
                    Add Company Experience
                  </Button>
                </Form.Item>
              </>
            )}
          </Form.List>

          {/* Section 4: Assessment & Interview */}
          <div style={{ marginBottom: 8, marginTop: 24 }}>
            <span className="cand-caption">Assessment & Interview</span>
            <div className="cand-rule" />
          </div>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={<span className="cand-label">HEAT</span>} name="Heat">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<span className="cand-label">FINAL STATUS</span>} name="FinalStatus">
                <Input />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label={<span className="cand-label">HR QUICK COMMENTS</span>} name="HRQuickcomments">
            <Input.TextArea />
          </Form.Item>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item 
                label={<span className="cand-label">IQ SCORE</span>} 
                name="IQScore"
                rules={[{ validator: wholeNumberValidator }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item 
                label={<span className="cand-label">TECH SCORE</span>} 
                name="TechScore"
                rules={[{ validator: wholeNumberValidator }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item 
                label={<span className="cand-label">ZEKO INTERVIEW SCORE</span>} 
                name="ZekoInterviewScore"
                rules={[{ validator: wholeNumberValidator }]}
              >
                <Input />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                label={<span className="cand-label">ZEKO CODING SCORE</span>} 
                name="ZekoCodingScore"
                rules={[{ validator: wholeNumberValidator }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                label={<span className="cand-label">ZEKO COMMUNICATION SCORE</span>} 
                name="ZekoCommunicationScore"
                rules={[{ validator: wholeNumberValidator }]}
              >
                <Input />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label={<span className="cand-label">TECH ROUND ONE FEEDBACK</span>} name="TechRoundOne">
            <Input.TextArea />
          </Form.Item>

          <Form.Item label={<span className="cand-label">TECH ROUND TWO FEEDBACK</span>} name="TechRoundTwo">
            <Input.TextArea />
          </Form.Item>

          <Form.Item label={<span className="cand-label">TECH ROUND THREE FEEDBACK</span>} name="TechRoundThree">
            <Input.TextArea />
          </Form.Item>

          <Form.Item label={<span className="cand-label">MANAGERIAL / CEO FEEDBACK</span>} name="ManagerialOrCEOFeedback">
            <Input.TextArea />
          </Form.Item>

          <Form.Item label={<span className="cand-label">HR INTERVIEW</span>} name="HRInterview">
            <Input.TextArea />
          </Form.Item>

          <Form.Item label={<span className="cand-label">APPLICATION STATUS</span>} name="status">
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
                <Title level={4} className="cand-detail-title">{selectedCandidate.name}</Title>
                <Text type="secondary" className="cand-micro">{selectedCandidate.email}</Text>
              </div>
              <Tag color="processing" className="cand-pill">
                {emails.length} messages
              </Tag>
            </div>
          )
        }
        open={emailsOpen}
        onCancel={() => setEmailsOpen(false)}
        footer={[
          <Button key="close" emphasis="soft" tone="neutral" onClick={() => setEmailsOpen(false)}>
            Close
          </Button>
        ]}
        width={650}
        styles={{ body: { padding: '12px 24px 24px' } }}
      >
        {emailsLoading ? (
          <div className="cmp-loading">
            <Spin size="large" />
            <div className="cand-note">Loading email thread…</div>
          </div>
        ) : emails.length > 0 ? (
          <div style={{ maxHeight: '55vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {emails.map((email) => {
              const isOutbound = email.direction?.toLowerCase() === 'outbound' || email.from_email === selectedCandidate.email;
              return (
                <div
                  key={email.id}
                  style={{
                                        padding: 12,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text strong className="cand-sub">{email.subject || '(No Subject)'}</Text>
                    <Text type="secondary" className="cand-tiny">
                      {email.sent_at ? email.sent_at.split('T')[0] : ''}
                    </Text>
                  </div>
                  <div className="cand-hint">
                    <strong>From:</strong> {email.from_name ? `${email.from_name} <${email.from_email}>` : email.from_email}
                  </div>
                  <Paragraph className="cand-pre">
                    {email.body_preview || '(Empty preview)'}
                  </Paragraph>
                </div>
              );
            })}
          </div>
        ) : (
          <div
            className="cand-msg-empty"
            style={{ padding: '44px 20px', textAlign: 'center' }}
          >
            <HistoryOutlined className="cand-empty-icon" />
            <div className="cand-sub">No email conversations found for this candidate.</div>
          </div>
        )}
      </Modal>
      </PageShell>
    </DesignScope>
  );
}

// ============================================================================
//    PREVIOUS PAGE HEADER — kept per the no-delete rule, 2026-08-31.
//
//    Replaced because the title sat INSIDE the search card. Two consequences, both
//    measured against the lab's List / table archetype:
//
//      - `Title level={3}` resolves to the font pack's title3 role — 20px — where
//        `.ui-page-header__title` is `--fs-title-1`, 32px. Every hand-rolled header in
//        the app had the same 12px shortfall.
//      - Nested inside a tier-2 Surface, a page title reads as that card's label. The
//        screen therefore opened on a form field with nothing anchoring it, which is
//        most of why /candidates read "dislocated" beside the lab.
//
//    The lab's ListScreen (src/pages/design-lab/AppPane.jsx) puts the header ABOVE the
//    search surface with no wrapper, which is what the replacement does. The surface
//    tiers did not change — measured, they already matched the lab exactly
//    (2 surfaces, tier 2 + tier 3).
//
//    `.cand-page-title` and `.cand-sub` remain defined in ui.css; nothing renders them
//    now, and they come out with the class sweep rather than with this edit.
//
//      <Surface tier={2} padding="relaxed" bloom className="cand-search-card">
//        <div style={{ marginBottom: 18 }}>
//          <Title level={3} className="cand-page-title">
//            Search Candidate
//          </Title>
//          <Text type="secondary" className="cand-sub">
//            {total > 0
//              ? `Browsing all ${total.toLocaleString()} candidates. Search by name, email or phone number.`
//              : 'Search by name, email or phone number.'}
//          </Text>
//        </div>
//
//        <Form form={form} layout="vertical" onFinish={handleSearch} className="cand-form">
//
//    PREVIOUS BUTTONS — same date, same rule. Ten raw AntD buttons carrying five
//    private treatments. Each is recorded here as `selector → replacement`:
//
//      .cand-action                    → Button size="sm" emphasis="text"  iconOnly
//      .cand-action--active            → Button size="sm" emphasis="soft"  iconOnly
//      .cand-chip--off  ("View")       → Button size="sm" emphasis="text"
//      .cand-chip--on   ("Edit")       → Button size="sm" emphasis="soft"
//      .cand-action--conv (violet ink) → Button size="sm" emphasis="text"  iconOnly
//      .cand-chip       ("Close")      → Button emphasis="soft" tone="neutral"
//      className="ui-btn ui-btn--md ui-btn--solid"  → Button emphasis="solid"
//      <Button> (bare default, Reset)  → Button emphasis="soft" tone="neutral"
//      <Button type="text" danger>     → Button emphasis="text" tone="danger"
//      <Button type="dashed" block>    → Button emphasis="soft" block
