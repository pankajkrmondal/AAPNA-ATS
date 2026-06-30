/**
 * Candidates Page — Searchable, filterable candidate listing matching legacy UI.
 * Recreates the exact n8n layout, modals, actions, fields, and validations.
 */
import { useState, useEffect } from 'react';
import { Form, Input, Button, Card, Table, Space, Tag, Modal, Row, Col, Typography, message, Select, Spin } from 'antd';
import { SearchOutlined, EyeOutlined, EditOutlined, MessageOutlined, FileTextOutlined, HistoryOutlined, CloseOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import candidateService from '../services/candidateService';

const { Title, Text, Paragraph } = Typography;

export default function Candidates() {
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(5); // Matches legacy PAGE_SIZE = 5

  // Search parameters and searched state
  const [searchParams, setSearchParams] = useState({ email: '', name: '', phone: '' });
  const [hasSearched, setHasSearched] = useState(false);

  // Modals state
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  
  // Emails modal state
  const [emailsOpen, setEmailsOpen] = useState(false);
  const [emails, setEmails] = useState([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  
  const [updating, setUpdating] = useState(false);

  // Load candidates
  const loadCandidates = async (params = searchParams) => {
    if (!hasSearched && !params.email && !params.name && !params.phone) {
      return;
    }
    setLoading(true);
    try {
      // Fetch up to 200 candidates to allow client-side sorting and pagination of the full dataset
      const res = await candidateService.search({
        email: params.email || undefined,
        name: params.name || undefined,
        phone: params.phone || undefined,
      }, 1, 200);

      if (res.data) {
        const list = Array.isArray(res.data.data)
          ? res.data.data
          : (res.data.data?.data || res.data.data?.candidates || []);
        
        setCandidates(list);
        setTotal(list.length);
      }
    } catch (err) {
      message.error('Failed to load candidates.');
    } finally {
      setLoading(false);
    }
  };

  // Handle search submit
  const handleSearch = (values) => {
    const email = (values.email || '').trim();
    const name = (values.name || '').trim();
    const phone = (values.phone || '').trim();
    
    if (!email && !name && !phone) {
      message.error('Please enter at least one search field (Email, Name, or Phone).');
      return;
    }
    
    const params = { email, name, phone };
    setSearchParams(params);
    setHasSearched(true);
    setPage(1);
    loadCandidates(params);
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

  const SectionHeader = ({ title }) => (
    <div style={{ display: 'flex', alignItems: 'center', marginTop: 24, marginBottom: 16 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.6px' }}>{title}</span>
      <div style={{ flex: 1, height: 1, background: '#e5e7eb', marginLeft: 12 }} />
    </div>
  );

  const columns = [
    {
      title: '#',
      key: 'index',
      width: 50,
      render: (_, __, index) => <span style={{ color: '#6b7561', fontWeight: 600 }}>{(page - 1) * pageSize + index + 1}</span>,
    },
    {
      title: 'NAME ⇅',
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => (a.name || '').localeCompare(b.name || ''),
      render: (text) => <Text strong style={{ fontSize: 13, color: '#111827' }}>{text || '—'}</Text>,
    },
    {
      title: 'EMAIL ⇅',
      dataIndex: 'email',
      key: 'email',
      sorter: (a, b) => (a.email || '').localeCompare(b.email || ''),
      render: (text) => <span style={{ fontFamily: 'monospace', fontSize: 12.5, color: '#374151' }}>{text || '—'}</span>,
    },
    {
      title: 'CONTACT',
      dataIndex: 'phone',
      key: 'phone',
      render: (text) => <span style={{ fontFamily: 'monospace', fontSize: 12.5, color: '#374151' }}>{text || '—'}</span>,
    },
    {
      title: 'POSITION APPLIED ⇅',
      dataIndex: 'position',
      key: 'position',
      sorter: (a, b) => (a.position || '').localeCompare(b.position || ''),
      render: (text) => <Text style={{ fontSize: 13, fontWeight: 500, color: '#1f2937' }}>{text || '—'}</Text>,
    },
    {
      title: 'GENDER',
      dataIndex: 'gender',
      key: 'gender',
      render: (text) => <Text style={{ fontSize: 12.5, color: '#4b5563' }}>{text || '—'}</Text>,
    },
    {
      title: 'LOCATION ⇅',
      dataIndex: 'location',
      key: 'location',
      sorter: (a, b) => (a.location || '').localeCompare(b.location || ''),
      render: (text) => <Text style={{ fontSize: 12.5, color: '#4b5563' }}>{text || '—'}</Text>,
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
                background: hasCv ? '#7a922e' : '#f3f4f6',
                borderColor: hasCv ? '#7a922e' : '#d1d5db',
                color: hasCv ? '#fff' : '#9ca3af',
              }}
            />
            <Button
              size="small"
              onClick={() => handleOpenView(record)}
              style={{ borderRadius: 6, background: '#fff', borderColor: '#d1d5db', color: '#374151', fontWeight: 500 }}
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
                background: '#f3f4f6',
                borderColor: '#d1d5db',
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
        <div style={{ marginBottom: 20 }}>
          <Title level={3} style={{ fontFamily: "'Sora', sans-serif", fontWeight: 700, margin: '0 0 4px 0' }}>
            Search Candidate
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Search existing candidates by Email ID, Name, or Phone Number — results show below.
          </Text>
        </div>

        <Form
          form={form}
          layout="vertical"
          onFinish={handleSearch}
        >
          <Row gutter={16}>
            <Col xs={24} sm={8}>
              <Form.Item
                label={<span style={{ fontWeight: 600, fontSize: 11, textTransform: 'uppercase', color: '#4b5563' }}>Email ID</span>}
                name="email"
              >
                <Input placeholder="candidate@example.com" style={{ height: 42, borderRadius: 8 }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item
                label={<span style={{ fontWeight: 600, fontSize: 11, textTransform: 'uppercase', color: '#4b5563' }}>Candidate Name</span>}
                name="name"
              >
                <Input placeholder="e.g. Rahul Sharma" style={{ height: 42, borderRadius: 8 }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item
                label={<span style={{ fontWeight: 600, fontSize: 11, textTransform: 'uppercase', color: '#4b5563' }}>Phone / Contact Number</span>}
                name="phone"
              >
                <Input placeholder="+91 98765 43210" style={{ height: 42, borderRadius: 8 }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              icon={<SearchOutlined />}
              loading={loading}
              style={{
                background: '#7a922e',
                borderColor: '#7a922e',
                height: 42,
                borderRadius: 8,
                fontWeight: 600,
                padding: '0 24px',
              }}
            >
              Search Candidate
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {/* Loading state indicator */}
      {loading && candidates.length === 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
          <Spin size="large" />
        </div>
      )}

      {/* No Data alert matching legacy style */}
      {hasSearched && !loading && candidates.length === 0 && (
        <div style={{
          padding: 16,
          background: 'rgba(192, 57, 43, 0.1)',
          border: '1px solid #c0392b',
          color: '#c0392b',
          borderRadius: 8,
          fontWeight: 500,
          fontSize: 13,
          marginBottom: 28,
        }}>
          No candidates found matching your search criteria. Please try a different name, email, or phone number.
        </div>
      )}

      {/* Candidates Results Table */}
      {hasSearched && candidates.length > 0 && (
        <Card
          bordered={false}
          style={{
            borderRadius: 12,
            boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
          }}
          styles={{ body: { padding: 12 } }}
        >
          <div style={{ padding: '8px 12px 14px' }}>
            <Text strong style={{ fontSize: 11, color: '#6b7561', textTransform: 'uppercase' }}>
              Showing {total} results
            </Text>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <Table
              dataSource={candidates}
              columns={columns}
              rowKey="id"
              loading={loading}
              pagination={{
                current: page,
                pageSize: pageSize,
                total: total,
                onChange: setPage,
                showSizeChanger: false,
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
        {selectedCandidate && (
          <div>
            {/* Section 1: Personal Information */}
            <SectionHeader title="Personal Information" />
            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Candidate Name</Text>
                <Text strong style={{ fontSize: 13.5 }}>{selectedCandidate.name || '—'}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Candidate Email</Text>
                <Text style={{ fontSize: 13.5, fontFamily: 'monospace' }}>{selectedCandidate.email || '—'}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Candidate Contact Number</Text>
                <Text style={{ fontSize: 13.5, fontFamily: 'monospace' }}>{selectedCandidate.phone || '—'}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Highest Qualification</Text>
                <Text style={{ fontSize: 13.5 }}>{selectedCandidate.education || '—'}</Text>
              </Col>
              
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Total Experience (Years)</Text>
                <Text style={{ fontSize: 13.5 }}>{selectedCandidate.experience || '—'}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Last Company Experience (Years)</Text>
                <Text style={{ fontSize: 13.5 }}>{selectedCandidate.lastCompanyExperience || '—'}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Current Location</Text>
                <Text style={{ fontSize: 13.5 }}>{selectedCandidate.location || '—'}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>CTC (LPA)</Text>
                <Text style={{ fontSize: 13.5 }}>{selectedCandidate.currentCTC || '—'}</Text>
              </Col>
              
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Expected CTC (LPA)</Text>
                <Text style={{ fontSize: 13.5 }}>{selectedCandidate.expectedCTC || '—'}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Notice Period (Days)</Text>
                <Text style={{ fontSize: 13.5 }}>{selectedCandidate.noticePeriod || '—'}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Position Applied</Text>
                <Text style={{ fontSize: 13.5 }}>{selectedCandidate.position || '—'}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Job Source</Text>
                <Text style={{ fontSize: 13.5 }}>{selectedCandidate.jobSource || '—'}</Text>
              </Col>

              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Recruiter Info (AAPNA)</Text>
                <Text style={{ fontSize: 13.5 }}>{selectedCandidate.recruiterInfo || '—'}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>English Communication Rating</Text>
                <Text style={{ fontSize: 13.5 }}>{selectedCandidate.englishCommunicationRating || '—'}</Text>
              </Col>
              
              <Col span={24}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Top 5 Key Skills</Text>
                <Text style={{ fontSize: 13.5, fontWeight: 500 }}>{selectedCandidate.top5KeySkills || '—'}</Text>
              </Col>

              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Gender</Text>
                <Text style={{ fontSize: 13.5 }}>{selectedCandidate.gender || '—'}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Preferred Shift</Text>
                <Text style={{ fontSize: 13.5 }}>{selectedCandidate.preferredShift || '—'}</Text>
              </Col>

              <Col span={24}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Reason For Job Change</Text>
                <Text style={{ fontSize: 13.5 }}>{selectedCandidate.reasonForJobChange || '—'}</Text>
              </Col>

              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Willing To Take Online Test?</Text>
                <Text style={{ fontSize: 13.5 }}>{selectedCandidate.willingToTakeOnlineTest || '—'}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Has Laptop For Initial Days?</Text>
                <Text style={{ fontSize: 13.5 }}>{selectedCandidate.hasLaptopForInitialDays || '—'}</Text>
              </Col>

              <Col span={24}>
                <div style={{ background: '#f3f4f6', padding: '12px 14px', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                  <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase', marginBottom: 4 }}>Current Company</Text>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Text type="secondary" style={{ fontSize: 9, display: 'block' }}>Company Name</Text>
                      <Text strong>{selectedCandidate.currentCompany?.Name || '—'}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary" style={{ fontSize: 9, display: 'block' }}>Website</Text>
                      <Text>{selectedCandidate.currentCompany?.Website || '—'}</Text>
                    </Col>
                  </Row>
                </div>
              </Col>
            </Row>

            {/* Section 2: Education */}
            <SectionHeader title="Education" />
            <Row gutter={[16, 16]}>
              <Col span={6}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>10th %</Text>
                <Text style={{ fontSize: 13 }}>{selectedCandidate.a10th || '—'}</Text>
              </Col>
              <Col span={6}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>12th %</Text>
                <Text style={{ fontSize: 13 }}>{selectedCandidate.a12th || '—'}</Text>
              </Col>
              <Col span={6}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Graduation %</Text>
                <Text style={{ fontSize: 13 }}>{selectedCandidate.graduation || '—'}</Text>
              </Col>
              <Col span={6}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Post-Graduation %</Text>
                <Text style={{ fontSize: 13 }}>{selectedCandidate.postGraduation || '—'}</Text>
              </Col>
              
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Graduation Degree</Text>
                <Text style={{ fontSize: 13 }}>{selectedCandidate.graduationdegree || '—'}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Graduation Specialization</Text>
                <Text style={{ fontSize: 13 }}>{selectedCandidate.graduationspecialization || '—'}</Text>
              </Col>
              
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Post-Graduation Degree</Text>
                <Text style={{ fontSize: 13 }}>{selectedCandidate.postgraduationdegree || '—'}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Post-Graduation Specialization</Text>
                <Text style={{ fontSize: 13 }}>{selectedCandidate.postgraduationspecialization || '—'}</Text>
              </Col>
              
              <Col span={24}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>LinkedIn Profile Link</Text>
                {selectedCandidate.LinkedInProfile ? (
                  <a href={selectedCandidate.LinkedInProfile} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                    {selectedCandidate.LinkedInProfile}
                  </a>
                ) : '—'}
              </Col>
            </Row>

            {/* Section 3: Employment History */}
            <SectionHeader title="Employment History" />
            {selectedCandidate.employment_history?.companies?.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {selectedCandidate.employment_history.companies.map((co, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, padding: '10px 14px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                    <div>
                      <Text type="secondary" style={{ fontSize: 9, fontWeight: 600, display: 'block', textTransform: 'uppercase' }}>Company Name</Text>
                      <Text strong>{co.CompanyName || '—'}</Text>
                    </div>
                    <div>
                      <Text type="secondary" style={{ fontSize: 9, fontWeight: 600, display: 'block', textTransform: 'uppercase' }}>Start Date</Text>
                      <Text>{co.StartDate || '—'}</Text>
                    </div>
                    <div>
                      <Text type="secondary" style={{ fontSize: 9, fontWeight: 600, display: 'block', textTransform: 'uppercase' }}>End Date</Text>
                      <Text>{co.EndDate || '—'}</Text>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Text type="secondary" style={{ fontSize: 13 }}>No employment history recorded.</Text>
            )}

            {/* Section 4: Assessment & Interview */}
            <SectionHeader title="Assessment & Interview" />
            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Heat</Text>
                <Text style={{ fontSize: 13 }}>{selectedCandidate.Heat || '—'}</Text>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Final Status</Text>
                <Text style={{ fontSize: 13 }}>{selectedCandidate.FinalStatus || '—'}</Text>
              </Col>
              <Col span={24}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>HR Quick Comments</Text>
                <Text style={{ fontSize: 13 }}>{selectedCandidate.HRQuickcomments || '—'}</Text>
              </Col>
              
              <Col span={8}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>IQ Score</Text>
                <Text style={{ fontSize: 13 }}>{selectedCandidate.IQScore || '—'}</Text>
              </Col>
              <Col span={8}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Tech Score</Text>
                <Text style={{ fontSize: 13 }}>{selectedCandidate.TechScore || '—'}</Text>
              </Col>
              <Col span={8}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Zeko Interview Score</Text>
                <Text style={{ fontSize: 13 }}>{selectedCandidate.ZekoInterviewScore || '—'}</Text>
              </Col>
              
              <Col span={8}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Zeko Coding Score</Text>
                <Text style={{ fontSize: 13 }}>{selectedCandidate.ZekoCodingScore || '—'}</Text>
              </Col>
              <Col span={16}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Zeko Communication Score</Text>
                <Text style={{ fontSize: 13 }}>{selectedCandidate.ZekoCommunicationScore || '—'}</Text>
              </Col>
              
              <Col span={24}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Tech Round One Feedback</Text>
                <Paragraph style={{ fontSize: 13, margin: 0, whiteSpace: 'pre-line' }}>{selectedCandidate.TechRoundOne || '—'}</Paragraph>
              </Col>
              <Col span={24}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Tech Round Two Feedback</Text>
                <Paragraph style={{ fontSize: 13, margin: 0, whiteSpace: 'pre-line' }}>{selectedCandidate.TechRoundTwo || '—'}</Paragraph>
              </Col>
              <Col span={24}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Tech Round Three Feedback</Text>
                <Paragraph style={{ fontSize: 13, margin: 0, whiteSpace: 'pre-line' }}>{selectedCandidate.TechRoundThree || '—'}</Paragraph>
              </Col>
              
              <Col span={24}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>Managerial / CEO Feedback</Text>
                <Paragraph style={{ fontSize: 13, margin: 0, whiteSpace: 'pre-line' }}>{selectedCandidate.ManagerialOrCEOFeedback || '—'}</Paragraph>
              </Col>
              <Col span={24}>
                <Text type="secondary" style={{ fontSize: 10, fontWeight: 700, display: 'block', textTransform: 'uppercase' }}>HR Interview</Text>
                <Paragraph style={{ fontSize: 13, margin: 0, whiteSpace: 'pre-line' }}>{selectedCandidate.HRInterview || '—'}</Paragraph>
              </Col>
            </Row>
          </div>
        )}
      </Modal>

      {/* 2) EDIT CANDIDATE DETAILS MODAL (High Fidelity) */}
      <Modal
        title={<span style={{ fontSize: 16, fontFamily: "'Sora', sans-serif", fontWeight: 700 }}>Edit Candidate</span>}
        open={editOpen}
        onOk={handleSaveEdit}
        onCancel={() => setEditOpen(false)}
        okText="Update Candidate"
        okButtonProps={{ style: { background: '#7a922e', borderColor: '#7a922e' }, loading: updating }}
        width={750}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto', paddingRight: 12 } }}
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          {/* Section 1: Personal Information */}
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Personal Information</span>
            <div style={{ height: 1, background: '#e5e7eb', marginTop: 6 }} />
          </div>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>CANDIDATE NAME</span>} name="name">
                <Input readonly style={{ background: '#f3f4f6', cursor: 'not-allowed', borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>CANDIDATE EMAIL</span>} name="email">
                <Input readonly style={{ background: '#f3f4f6', cursor: 'not-allowed', borderRadius: 6 }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>CANDIDATE CONTACT NUMBER</span>} 
                name="phone"
                rules={[{ validator: contactNumberValidator }]}
                extra={<span style={{ fontSize: 10, color: '#6b7280' }}>Use commas to add multiple numbers (Supports international formats)</span>}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>HIGHEST QUALIFICATION</span>} 
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
                label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>TOTAL EXPERIENCE (YEARS)</span>} 
                name="experience"
                rules={[{ validator: experienceValidator }]}
              >
                <Input placeholder="e.g. 5 or 5.50" style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>LAST COMPANY EXPERIENCE (YEARS)</span>} 
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
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>CURRENT LOCATION</span>} name="location">
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>CTC (LPA)</span>} 
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
                label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>EXPECTED CTC (LPA)</span>} 
                name="expectedCTC"
                rules={[{ validator: decimalFieldValidator }]}
              >
                <Input placeholder="e.g. 10 or 10.5" style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>NOTICE PERIOD (DAYS)</span>} 
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
                label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>POSITION APPLIED</span>} 
                name="position"
                rules={[{ validator: nonNumericValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>JOB SOURCE</span>} name="jobSource">
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>RECRUITER INFO (AAPNA)</span>} 
                name="recruiterInfo"
                rules={[{ validator: nonNumericValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>ENGLISH COMMUNICATION RATING</span>} name="englishCommunicationRating">
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

          <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>TOP 5 KEY SKILLS</span>} name="top5KeySkills">
            <Input.TextArea placeholder="React, Node.js, Python, AWS, Docker" style={{ borderRadius: 6 }} />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>GENDER</span>} name="gender">
                <Select placeholder="Select" style={{ height: 38 }}>
                  <Select.Option value="Male">Male</Select.Option>
                  <Select.Option value="Female">Female</Select.Option>
                  <Select.Option value="Other">Other</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>PREFERRED SHIFT</span>} name="preferredShift">
                <Select placeholder="Select" style={{ height: 38 }}>
                  <Select.Option value="2pm - 11pm/3pm - 12am">2pm - 11pm/3pm - 12am</Select.Option>
                  <Select.Option value="4pm - 1am">4pm - 1am</Select.Option>
                  <Select.Option value="Others">Others</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>REASON FOR JOB CHANGE</span>} name="reasonForJobChange">
            <Input.TextArea style={{ borderRadius: 6 }} />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>WILLING TO TAKE ONLINE TEST?</span>} name="willingToTakeOnlineTest">
                <Select placeholder="Select" style={{ height: 38 }}>
                  <Select.Option value="Yes">Yes</Select.Option>
                  <Select.Option value="No">No</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>HAS LAPTOP FOR INITIAL DAYS?</span>} name="hasLaptopForInitialDays">
                <Select placeholder="Select" style={{ height: 38 }}>
                  <Select.Option value="Yes">Yes</Select.Option>
                  <Select.Option value="No">No</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <div style={{ background: '#f9fafb', padding: '14px 18px', borderRadius: 8, border: '1px solid #e5e7eb', marginBottom: 24 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#4b5563', textTransform: 'uppercase', display: 'block', marginBottom: 10 }}>Current Company</span>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item label={<span style={{ fontSize: 10, fontWeight: 600, color: '#4b5563' }}>COMPANY NAME</span>} name={['currentCompany', 'Name']} style={{ marginBottom: 0 }}>
                  <Input placeholder="e.g. Google" style={{ borderRadius: 6 }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label={<span style={{ fontSize: 10, fontWeight: 600, color: '#4b5563' }}>WEBSITE</span>} name={['currentCompany', 'Website']} style={{ marginBottom: 0 }}>
                  <Input placeholder="https://example.com" style={{ borderRadius: 6 }} />
                </Form.Item>
              </Col>
            </Row>
          </div>

          {/* Section 2: Education */}
          <div style={{ marginBottom: 8, marginTop: 24 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Education</span>
            <div style={{ height: 1, background: '#e5e7eb', marginTop: 6 }} />
          </div>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>10TH PERCENTAGE</span>} name="a10th">
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>12TH PERCENTAGE</span>} name="a12th">
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>GRADUATION PERCENTAGE</span>} name="graduation">
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>POST GRADUATION PERCENTAGE</span>} name="postGraduation">
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>GRADUATION DEGREE</span>} 
                name="graduationdegree"
                rules={[{ validator: nonNumericValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>GRADUATION SPECIALIZATION</span>} 
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
                label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>POST GRADUATION DEGREE</span>} 
                name="postgraduationdegree"
                rules={[{ validator: nonNumericValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>POST GRADUATION SPECIALIZATION</span>} 
                name="postgraduationspecialization"
                rules={[{ validator: nonNumericValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>LINKEDIN PROFILE LINK</span>} name="LinkedInProfile">
            <Input placeholder="https://linkedin.com/in/..." style={{ borderRadius: 6 }} />
          </Form.Item>

          {/* Section 3: Employment History */}
          <div style={{ marginBottom: 8, marginTop: 24 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Employment History</span>
            <div style={{ height: 1, background: '#e5e7eb', marginTop: 6 }} />
          </div>

          <Form.List name="employment_history_companies">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...restField }) => (
                  <div key={key} style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 1.2fr 0.4fr', gap: 12, marginBottom: 12, padding: '12px 14px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
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
            <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Assessment & Interview</span>
            <div style={{ height: 1, background: '#e5e7eb', marginTop: 6 }} />
          </div>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>HEAT</span>} name="Heat">
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>FINAL STATUS</span>} name="FinalStatus">
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>HR QUICK COMMENTS</span>} name="HRQuickcomments">
            <Input.TextArea style={{ borderRadius: 6 }} />
          </Form.Item>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>IQ SCORE</span>} 
                name="IQScore"
                rules={[{ validator: wholeNumberValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>TECH SCORE</span>} 
                name="TechScore"
                rules={[{ validator: wholeNumberValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>ZEKO INTERVIEW SCORE</span>} 
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
                label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>ZEKO CODING SCORE</span>} 
                name="ZekoCodingScore"
                rules={[{ validator: wholeNumberValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>ZEKO COMMUNICATION SCORE</span>} 
                name="ZekoCommunicationScore"
                rules={[{ validator: wholeNumberValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>TECH ROUND ONE FEEDBACK</span>} name="TechRoundOne">
            <Input.TextArea style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>TECH ROUND TWO FEEDBACK</span>} name="TechRoundTwo">
            <Input.TextArea style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>TECH ROUND THREE FEEDBACK</span>} name="TechRoundThree">
            <Input.TextArea style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>MANAGERIAL / CEO FEEDBACK</span>} name="ManagerialOrCEOFeedback">
            <Input.TextArea style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>HR INTERVIEW</span>} name="HRInterview">
            <Input.TextArea style={{ borderRadius: 6 }} />
          </Form.Item>

          <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>APPLICATION STATUS</span>} name="status">
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
            <div style={{ marginTop: 12, color: '#6b7561' }}>Loading email thread…</div>
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
                    background: isOutbound ? '#f9fafb' : '#fff',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text strong style={{ fontSize: 13 }}>{email.subject || '(No Subject)'}</Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {email.sent_at ? email.sent_at.split('T')[0] : ''}
                    </Text>
                  </div>
                  <div style={{ fontSize: 11.5, color: '#6b7561', marginBottom: 6 }}>
                    <strong>From:</strong> {email.from_name ? `${email.from_name} <${email.from_email}>` : email.from_email}
                  </div>
                  <Paragraph style={{ fontSize: 12.5, margin: 0, whiteSpace: 'pre-line', color: '#374151' }}>
                    {email.body_preview || '(Empty preview)'}
                  </Paragraph>
                </div>
              );
            })}
          </div>
        ) : (
          <div
            style={{
              background: '#f8f9f5',
              border: '1px dashed #dde2d0',
              borderRadius: 8,
              padding: '44px 20px',
              textAlign: 'center',
              color: '#6b7561',
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
