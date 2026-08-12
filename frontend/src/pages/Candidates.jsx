/**
 * Candidates Page — the records surface for the whole candidate database.
 *
 * Browsable by default and paginated/sorted/filtered SERVER-side. It previously
 * refused to render any rows until you typed a search term, then pulled up to 200
 * rows and sliced them in the browser — so there was no way to browse ~4k candidates,
 * and the result count reported rows fetched rather than rows matched.
 *
 * None of that needed new backend work: candidate.service.search() already supported
 * free-text `search` across name/email/skills, plus position/location/status filters,
 * `sort`/`order`, and real `page`/`limit`. This page just never called it that way.
 *
 * Retained as-is: the view/edit/conversations modals and CSV export. Export takes the
 * same filter object as the table, so it exports exactly what is on screen.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Form, Input, Button, Card, Table, Space, Tag, Modal, Row, Col, Typography, message, Select, Spin } from 'antd';
import { SearchOutlined, EyeOutlined, EditOutlined, MessageOutlined, FileTextOutlined, HistoryOutlined, CloseOutlined, PlusOutlined, DeleteOutlined, FilterOutlined, ReloadOutlined } from '@ant-design/icons';
import candidateService from '../services/candidateService';
import CandidateDetailCard from '../components/CandidateDetailCard';
import ExportButton from '../components/common/ExportButton';

const { Title, Text, Paragraph } = Typography;

export default function Candidates() {
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState({ field: 'createdAt', order: 'desc' });

  /** Free-text term, wired to the backend's `search` param (name/email/skills at
   *  once). Kept separate from the three precise fields below. */
  const [quick, setQuick] = useState('');
  const [quickInput, setQuickInput] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Precise filters. `email`/`name`/`phone` are the legacy identifier fields;
  // position/location are additional filters the API already supported but the UI
  // never exposed.
  const [searchParams, setSearchParams] = useState({
    email: '', name: '', phone: '', position: '', location: '',
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

  /** Filters actually sent to the API — undefined for blanks so they are omitted. */
  const activeFilters = useMemo(() => {
    const f = {};
    if (quick) f.search = quick;
    Object.entries(searchParams).forEach(([k, v]) => {
      if (v && String(v).trim()) f[k] = String(v).trim();
    });
    return f;
  }, [quick, searchParams]);

  const hasFilters = Object.keys(activeFilters).length > 0;

  /**
   * Loads ONE page from the server.
   *
   * This used to refuse to run until a search term was typed, then fetch up to 200
   * rows and paginate them in the browser — so there was no way to browse the
   * database, and "Showing N results" reported rows fetched (max 200) rather than the
   * true match count. The backend already supported free-text search, filters,
   * sorting and real pagination; the page simply never used them.
   */
  const loadCandidates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await candidateService.search(
        { ...activeFilters, sort: sort.field, order: sort.order },
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
  }, [activeFilters, page, pageSize, sort]);

  // Browse by default: no search term required to see data.
  useEffect(() => { loadCandidates(); }, [loadCandidates]);

  /** Debounce the quick-search box so typing doesn't fire a request per keystroke. */
  useEffect(() => {
    const id = setTimeout(() => {
      setQuick(quickInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(id);
  }, [quickInput]);

  /** Advanced (precise) filter submit. */
  const handleSearch = (values) => {
    setSearchParams({
      email: (values.email || '').trim(),
      name: (values.name || '').trim(),
      phone: (values.phone || '').trim(),
      position: (values.position || '').trim(),
      location: (values.location || '').trim(),
    });
    setPage(1);
  };

  const handleClearFilters = () => {
    form.resetFields();
    setSearchParams({ email: '', name: '', phone: '', position: '', location: '' });
    setQuickInput('');
    setQuick('');
    setPage(1);
  };

  /** AntD hands back its own sorter shape; map it to the API's sort/order params. */
  const handleTableChange = (pagination, _filters, sorter) => {
    if (pagination.current !== page) setPage(pagination.current);
    if (pagination.pageSize !== pageSize) {
      setPageSize(pagination.pageSize);
      setPage(1);
    }
    const field = sorter?.field || sorter?.columnKey;
    if (field) {
      setSort({ field, order: sorter.order === 'ascend' ? 'asc' : 'desc' });
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
      render: (_, __, index) => <span style={{ color: 'var(--text-3)', fontWeight: 600 }}>{(page - 1) * pageSize + index + 1}</span>,
    },
    // Sorting is SERVER-side now (`sorter: true`), because with real pagination a
    // client comparator would only reorder the 25 rows on screen and present that as
    // sorting the database.
    //
    // Only the fields the API can actually sort by are sortable. resolveSortField()
    // in candidate.service.js maps name / email / position / modifiedAt and silently
    // FALLS BACK to createdAt for anything else — so marking Location or Gender
    // sortable would show sort arrows that quietly reorder by date instead. No arrow
    // is better than a lying one.
    //
    // The "⇅" glyphs previously baked into these titles are gone; AntD renders its
    // own arrows, and the manual ones appeared on unsortable columns too.
    {
      title: 'NAME',
      dataIndex: 'name',
      key: 'name',
      sorter: true,
      render: (text) => <Text strong style={{ fontSize: 13, color: 'var(--text)' }}>{text || '—'}</Text>,
    },
    {
      title: 'EMAIL',
      dataIndex: 'email',
      key: 'email',
      sorter: true,
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
      sorter: true,
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
            <Button
              size="small"
              title="CV/Resume"
              icon={<FileTextOutlined />}
              onClick={() => handleDownloadResume(fileUrl)}
              style={{
                borderRadius: 6,
                background: hasCv ? '#7a922e' : 'var(--ink-4)',
                borderColor: hasCv ? '#7a922e' : 'var(--border)',
                color: hasCv ? '#fff' : 'var(--text-3)',
              }}
            />
            <Button
              size="small"
              onClick={() => handleOpenView(record)}
              style={{ borderRadius: 6, background: 'var(--colorBgContainer)', borderColor: 'var(--border)', color: 'var(--text-2)', fontWeight: 500 }}
            >
              View
            </Button>
            <Button
              size="small"
              onClick={() => handleOpenEdit(record)}
              style={{ borderRadius: 6, background: '#7a922e', borderColor: '#7a922e', color: '#fff', fontWeight: 500 }}
            >
              Edit
            </Button>
            <Button
              size="small"
              title="Conversations"
              icon={<MessageOutlined />}
              onClick={() => handleOpenEmails(record)}
              style={{
                borderRadius: 6,
                background: 'var(--ink-4)',
                borderColor: 'var(--border)',
                color: '#7c3aed',
              }}
            />
          </Space>
        );
      },
    },
  ];

  return (
    <div style={{ padding: '24px', maxWidth: 1200, margin: '0 auto' }} className="stagger-children">
      {/* 3-Field Candidate Search Card */}
      <Card
        bordered={false}
        style={{
          borderRadius: 12,
          boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
          borderTop: '4px solid #7a922e',
          marginBottom: 28,
        }}
      >
        <div style={{ marginBottom: 18 }}>
          <Title level={3} style={{ fontFamily: "'Sora', sans-serif", fontWeight: 700, margin: '0 0 4px 0' }}>
            Search Candidate
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {total > 0
              ? `Browsing all ${total.toLocaleString()} candidates. Search by name, email or skill, or open Advanced filters.`
              : 'Search by name, email or skill, or open Advanced filters.'}
          </Text>
        </div>

        {/* One box hitting the backend's free-text `search` (name + email + skills at
            once), debounced. This is the primary affordance now — the three precise
            identifier fields moved into Advanced below, because needing an exact email
            to see anything was what made the page feel empty. */}
        <Input
          size="large"
          allowClear
          prefix={<SearchOutlined style={{ color: 'var(--text-3)' }} />}
          placeholder="Search name, email, or skill…"
          value={quickInput}
          onChange={(e) => setQuickInput(e.target.value)}
          style={{ borderRadius: 10 }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <Button
            type={advancedOpen ? 'primary' : 'default'}
            ghost={advancedOpen}
            icon={<FilterOutlined />}
            onClick={() => setAdvancedOpen((o) => !o)}
            style={{ borderRadius: 8 }}
          >
            Advanced filters
          </Button>
          {hasFilters && (
            <>
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                {Object.keys(activeFilters).length} filter{Object.keys(activeFilters).length > 1 ? 's' : ''} active
              </Text>
              <Button type="text" size="small" icon={<ReloadOutlined />} onClick={handleClearFilters}>
                Clear all
              </Button>
            </>
          )}
        </div>

        {advancedOpen && (
          <Form form={form} layout="vertical" onFinish={handleSearch} style={{ marginTop: 18 }}>
            <Row gutter={16}>
              {[
                { name: 'email', label: 'Email ID', ph: 'candidate@example.com' },
                { name: 'name', label: 'Candidate Name', ph: 'e.g. Rahul Sharma' },
                { name: 'phone', label: 'Phone / Contact Number', ph: '+91 98765 43210' },
                { name: 'position', label: 'Position Applied', ph: 'e.g. React Engineer' },
                { name: 'location', label: 'Current Location', ph: 'e.g. Hyderabad' },
              ].map((f) => (
                <Col xs={24} sm={12} lg={8} key={f.name}>
                  <Form.Item
                    label={<span style={{ fontWeight: 600, fontSize: 11, textTransform: 'uppercase', color: 'var(--text-2)' }}>{f.label}</span>}
                    name={f.name}
                  >
                    <Input placeholder={f.ph} style={{ height: 42, borderRadius: 8 }} />
                  </Form.Item>
                </Col>
              ))}
            </Row>

            <Form.Item style={{ marginBottom: 0 }}>
              <Space>
                <Button
                  type="primary"
                  htmlType="submit"
                  icon={<SearchOutlined />}
                  loading={loading}
                  style={{ height: 42, borderRadius: 8, fontWeight: 600, padding: '0 24px' }}
                >
                  Apply filters
                </Button>
                <Button onClick={handleClearFilters} style={{ height: 42, borderRadius: 8 }}>
                  Reset
                </Button>
              </Space>
            </Form.Item>
          </Form>
        )}
      </Card>

      {/* Initial load only — subsequent page/filter changes use the table's own
          loading overlay so rows don't disappear and jump the scroll position. */}
      {loading && candidates.length === 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
          <Spin size="large" />
        </div>
      )}

      {/* The table renders unconditionally once anything has loaded — it owns its own
          empty state. The page previously hid the whole card until a search had run,
          which is why it looked broken on arrival. */}
      {(!loading || candidates.length > 0) && (
        <Card
          bordered={false}
          style={{
            borderRadius: 12,
            boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
          }}
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
                emptyText: hasFilters
                  ? 'No candidates match these filters. Try a broader search or clear them.'
                  : 'No candidates in the database yet.',
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
        <CandidateDetailCard candidate={selectedCandidate} />
      </Modal>

      {/* 2) EDIT CANDIDATE DETAILS MODAL (High Fidelity) */}
      <Modal
        title={<span style={{ fontSize: 16, fontFamily: "'Sora', sans-serif", fontWeight: 700 }}>Edit Candidate</span>}
        open={editOpen}
        onOk={handleSaveEdit}
        onCancel={() => setEditOpen(false)}
        okText="Update Candidate"
        okButtonProps={{ loading: updating }}
        width={750}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto', paddingRight: 12 } }}
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          {/* Section 1: Personal Information */}
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Personal Information</span>
            <div style={{ height: 1, background: 'var(--border-light)', marginTop: 6 }} />
          </div>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>CANDIDATE NAME</span>} name="name">
                <Input readonly style={{ background: 'var(--ink-4)', cursor: 'not-allowed', borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>CANDIDATE EMAIL</span>} name="email">
                <Input readonly style={{ background: 'var(--ink-4)', cursor: 'not-allowed', borderRadius: 6 }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>CANDIDATE CONTACT NUMBER</span>} 
                name="phone"
                rules={[{ validator: contactNumberValidator }]}
                extra={<span style={{ fontSize: 10, color: 'var(--text-3)' }}>Use commas to add multiple numbers (Supports international formats)</span>}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>HIGHEST QUALIFICATION</span>} 
                name="education"
                rules={[{ validator: nonNumericValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>TOTAL EXPERIENCE (YEARS)</span>} 
                name="experience"
                rules={[{ validator: experienceValidator }]}
              >
                <Input placeholder="e.g. 5 or 5.50" style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>LAST COMPANY EXPERIENCE (YEARS)</span>} 
                name="lastCompanyExperience"
                dependencies={['experience']}
                rules={[{ validator: lastCompanyExpValidator }]}
              >
                <Input placeholder="e.g. 5 or 5.50" style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>CURRENT LOCATION</span>} name="location">
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>CTC (LPA)</span>} 
                name="currentCTC"
                rules={[{ validator: decimalFieldValidator }]}
              >
                <Input placeholder="e.g. 10 or 10.5" style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>EXPECTED CTC (LPA)</span>} 
                name="expectedCTC"
                rules={[{ validator: decimalFieldValidator }]}
              >
                <Input placeholder="e.g. 10 or 10.5" style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>NOTICE PERIOD (DAYS)</span>} 
                name="noticePeriod"
                rules={[{ validator: noticePeriodValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>POSITION APPLIED</span>} 
                name="position"
                rules={[{ validator: nonNumericValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>JOB SOURCE</span>} name="jobSource">
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>RECRUITER INFO (AAPNA)</span>} 
                name="recruiterInfo"
                rules={[{ validator: nonNumericValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>ENGLISH COMMUNICATION RATING</span>} name="englishCommunicationRating">
                <Select placeholder="Select" style={{ height: 38 }}>
                  <Select.Option value="1">1</Select.Option>
                  <Select.Option value="2">2</Select.Option>
                  <Select.Option value="3">3</Select.Option>
                  <Select.Option value="4">4</Select.Option>
                  <Select.Option value="5">5</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>TOP 5 KEY SKILLS</span>} name="top5KeySkills">
            <Input.TextArea placeholder="React, Node.js, Python, AWS, Docker" style={{ borderRadius: 6 }} />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>GENDER</span>} name="gender">
                <Select placeholder="Select" style={{ height: 38 }}>
                  <Select.Option value="Male">Male</Select.Option>
                  <Select.Option value="Female">Female</Select.Option>
                  <Select.Option value="Other">Other</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>PREFERRED SHIFT</span>} name="preferredShift">
                <Select placeholder="Select" style={{ height: 38 }}>
                  <Select.Option value="2pm - 11pm/3pm - 12am">2pm - 11pm/3pm - 12am</Select.Option>
                  <Select.Option value="4pm - 1am">4pm - 1am</Select.Option>
                  <Select.Option value="Others">Others</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>REASON FOR JOB CHANGE</span>} name="reasonForJobChange">
            <Input.TextArea style={{ borderRadius: 6 }} />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>WILLING TO TAKE ONLINE TEST?</span>} name="willingToTakeOnlineTest">
                <Select placeholder="Select" style={{ height: 38 }}>
                  <Select.Option value="Yes">Yes</Select.Option>
                  <Select.Option value="No">No</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>HAS LAPTOP FOR INITIAL DAYS?</span>} name="hasLaptopForInitialDays">
                <Select placeholder="Select" style={{ height: 38 }}>
                  <Select.Option value="Yes">Yes</Select.Option>
                  <Select.Option value="No">No</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <div style={{ background: 'var(--ink-4)', padding: '14px 18px', borderRadius: 8, border: '1px solid #e5e7eb', marginBottom: 24 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', display: 'block', marginBottom: 10 }}>Current Company</span>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item label={<span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-2)' }}>COMPANY NAME</span>} name={['currentCompany', 'Name']} style={{ marginBottom: 0 }}>
                  <Input placeholder="e.g. Google" style={{ borderRadius: 6 }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label={<span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-2)' }}>WEBSITE</span>} name={['currentCompany', 'Website']} style={{ marginBottom: 0 }}>
                  <Input placeholder="https://example.com" style={{ borderRadius: 6 }} />
                </Form.Item>
              </Col>
            </Row>
          </div>

          {/* Section 2: Education */}
          <div style={{ marginBottom: 8, marginTop: 24 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Education</span>
            <div style={{ height: 1, background: 'var(--border-light)', marginTop: 6 }} />
          </div>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>10TH PERCENTAGE</span>} name="a10th">
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>12TH PERCENTAGE</span>} name="a12th">
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>GRADUATION PERCENTAGE</span>} name="graduation">
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>POST GRADUATION PERCENTAGE</span>} name="postGraduation">
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>GRADUATION DEGREE</span>} 
                name="graduationdegree"
                rules={[{ validator: nonNumericValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>GRADUATION SPECIALIZATION</span>} 
                name="graduationspecialization"
                rules={[{ validator: nonNumericValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>POST GRADUATION DEGREE</span>} 
                name="postgraduationdegree"
                rules={[{ validator: nonNumericValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>POST GRADUATION SPECIALIZATION</span>} 
                name="postgraduationspecialization"
                rules={[{ validator: nonNumericValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>LINKEDIN PROFILE LINK</span>} name="LinkedInProfile">
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
                  <div key={key} style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 1.2fr 0.4fr', gap: 12, marginBottom: 12, padding: '12px 14px', background: 'var(--ink-4)', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                    <Form.Item
                      {...restField}
                      name={[name, 'CompanyName']}
                      label={<span style={{ fontSize: 10, fontWeight: 600 }}>COMPANY NAME</span>}
                      rules={[{ required: true, message: 'Required' }]}
                      style={{ marginBottom: 0 }}
                    >
                      <Input placeholder="e.g. Google" style={{ borderRadius: 6 }} />
                    </Form.Item>
                    <Form.Item
                      {...restField}
                      name={[name, 'StartDate']}
                      label={<span style={{ fontSize: 10, fontWeight: 600 }}>START DATE</span>}
                      style={{ marginBottom: 0 }}
                    >
                      <Input placeholder="e.g. Jan 2023" style={{ borderRadius: 6 }} />
                    </Form.Item>
                    <Form.Item
                      {...restField}
                      name={[name, 'EndDate']}
                      label={<span style={{ fontSize: 10, fontWeight: 600 }}>END DATE</span>}
                      style={{ marginBottom: 0 }}
                    >
                      <Input placeholder="e.g. Dec 2024" style={{ borderRadius: 6 }} />
                    </Form.Item>
                    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                      <Button
                        type="text"
                        danger
                        title="Remove"
                        icon={<DeleteOutlined />}
                        onClick={() => remove(name)}
                        style={{ height: 38 }}
                      />
                    </div>
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

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>HEAT</span>} name="Heat">
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>FINAL STATUS</span>} name="FinalStatus">
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>HR QUICK COMMENTS</span>} name="HRQuickcomments">
            <Input.TextArea style={{ borderRadius: 6 }} />
          </Form.Item>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>IQ SCORE</span>} 
                name="IQScore"
                rules={[{ validator: wholeNumberValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>TECH SCORE</span>} 
                name="TechScore"
                rules={[{ validator: wholeNumberValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>ZEKO INTERVIEW SCORE</span>} 
                name="ZekoInterviewScore"
                rules={[{ validator: wholeNumberValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>ZEKO CODING SCORE</span>} 
                name="ZekoCodingScore"
                rules={[{ validator: wholeNumberValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>ZEKO COMMUNICATION SCORE</span>} 
                name="ZekoCommunicationScore"
                rules={[{ validator: wholeNumberValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>TECH ROUND ONE FEEDBACK</span>} name="TechRoundOne">
            <Input.TextArea style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>TECH ROUND TWO FEEDBACK</span>} name="TechRoundTwo">
            <Input.TextArea style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>TECH ROUND THREE FEEDBACK</span>} name="TechRoundThree">
            <Input.TextArea style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>MANAGERIAL / CEO FEEDBACK</span>} name="ManagerialOrCEOFeedback">
            <Input.TextArea style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>HR INTERVIEW</span>} name="HRInterview">
            <Input.TextArea style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>APPLICATION STATUS</span>} name="status">
            <Select style={{ height: 38 }}>
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
                    border: '1px solid #dde2d0',
                    borderRadius: 8,
                    padding: 12,
                    background: isOutbound ? 'var(--ink-4)' : 'var(--colorBgContainer)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text strong style={{ fontSize: 13 }}>{email.subject || '(No Subject)'}</Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {email.sent_at ? email.sent_at.split('T')[0] : ''}
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
              border: '1px dashed #dde2d0',
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
    </div>
  );
}
