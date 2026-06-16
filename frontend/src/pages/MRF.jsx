/**
 * MRF Page — Replicates the legacy New MRF Request page.
 * Contains:
 *   1) New MRF Request Form (Hiring Manager details, CC emails, budget, JD link, and email body template)
 *   2) Submitted Records Listing (Search records, Status filter tabs, Export CSV, and paginated table)
 */
import { useState, useEffect } from 'react';
import { Form, Input, Button, Card, Table, Tag, Row, Col, Space, Typography, message, InputNumber, Radio, Modal, Select } from 'antd';
import { FileExcelOutlined, SendOutlined, ClearOutlined } from '@ant-design/icons';
import mrfService from '../services/mrfService';

const { Title, Text } = Typography;

// Same email pattern the n8n MRF form uses for main and CC email validation.
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

// CC Email is optional, but when provided it must be a comma-separated list of
// valid emails with no trailing comma/semicolon — mirrors the n8n form rules.
const validateCcEmail = (_, value) => {
  const ccEmail = (value || '').trim();
  if (!ccEmail) return Promise.resolve();

  if (/[;,]\s*$/.test(ccEmail)) {
    return Promise.reject(new Error('CC Email should not end with comma or semicolon'));
  }

  const ccEmails = ccEmail.split(',').map((e) => e.trim()).filter((e) => e !== '');
  if (ccEmails.length === 0) {
    return Promise.reject(new Error('Please enter a valid CC email address'));
  }

  const invalidEmails = ccEmails.filter((e) => !EMAIL_PATTERN.test(e));
  if (invalidEmails.length > 0) {
    return Promise.reject(new Error(`Invalid CC Email(s): ${invalidEmails.join(', ')}`));
  }

  return Promise.resolve();
};

const DEFAULT_EMAIL_BODY = `Default Message:
As discussed, we would like to initiate the hiring process for the RPA Developer position.

We request you to kindly fill out the Manpower Requisition Form (MRF) using the link below. This will help us clearly capture the role requirements and move forward with job creation and publishing.`;

// Editable fields of the submitted main MRF (rpa_mrf), grouped for the modal UI.
// Mirrors the backend whitelist in mrf.controller.js (MAIN_MRF_EDITABLE_FIELDS).
const MAIN_MRF_NUMERIC_FIELDS = ['number_of_positions', 'total_years_of_experience', 'relevant_years_of_experience'];
const MAIN_MRF_FIELD_GROUPS = [
  {
    title: 'Position',
    fields: [
      ['hiring_manager_name', 'Hiring Manager Name'],
      ['hiring_manager_designation', 'HM Designation'],
      ['position_hiring_for', 'Position Hiring For'],
      ['number_of_positions', 'Number of Positions'],
      ['required_in', 'Required In'],
      ['position_reports_to', 'Position Reports To'],
      ['employment_type', 'Employment Type'],
    ],
  },
  {
    title: 'Requirement & Experience',
    fields: [
      ['requirement_for_team', 'Requirement for Team'],
      ['requirement_for_team_other', 'Requirement for Team (Other)'],
      ['desired_qualification', 'Desired Qualification'],
      ['pg_information', 'PG Information'],
      ['graduate_other_information', 'Graduate / Other Info'],
      ['other_qualification_more_info', 'Other Qualification Info'],
      ['replacement_or_new_role', 'Replacement or New Role'],
      ['replacement_comments', 'Replacement Comments'],
      ['total_years_of_experience', 'Total Years of Experience'],
      ['relevant_years_of_experience', 'Relevant Years of Experience'],
      ['project_name', 'Project Name'],
      ['project_duration', 'Project Duration'],
      ['existing_resource_information', 'Existing Resource Info'],
    ],
  },
  {
    title: 'Skills & Responsibilities',
    fields: [
      ['roles_responsibilities', 'Roles & Responsibilities'],
      ['roles_responsibilities_other', 'Roles & Responsibilities (Other)'],
      ['mandatory_skills', 'Mandatory Skills'],
      ['mandatory_skills_other', 'Mandatory Skills (Other)'],
      ['good_to_have_skills', 'Good to Have Skills'],
      ['good_to_have_skills_other', 'Good to Have Skills (Other)'],
      ['competencies_required', 'Competencies Required'],
    ],
  },
  {
    title: 'Interview Process',
    fields: [
      ['first_technical_round', '1st Technical Round'],
      ['second_technical_round', '2nd Technical Round'],
      ['ceo_management_round', 'CEO / Management Round'],
      ['ceo_panel_details', 'CEO Panel Details'],
      ['hr_round', 'HR Round'],
      ['client_round', 'Client Round'],
      ['client_round_coordinator', 'Client Round Coordinator'],
      ['job_timing', 'Job Timing'],
      ['first_round_interview_slot', 'Interview Slot (Round 1)'],
      ['second_round_interview_slot', 'Interview Slot (Round 2)'],
      ['weekly_meeting_slot', 'Weekly Meeting Slot'],
    ],
  },
  {
    title: 'Additional',
    fields: [
      ['client_details', 'Client Details'],
      ['additional_information', 'Additional Information'],
      ['question_paper_new_owner', 'Question Paper New Owner'],
      ['jd_document_link', 'JD Document Link'],
    ],
  },
];

export default function MRF() {
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [mainForm] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  
  // Table filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusTab, setStatusTab] = useState('All'); // 'All', 'pending', 'manager submitted'

  // Details and edit modal state
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [updating, setUpdating] = useState(false);

  // Submitted main MRF (rpa_mrf) state — loaded when the record has a linked mrf_id
  const [mainMrf, setMainMrf] = useState(null);
  const [mainMrfLoading, setMainMrfLoading] = useState(false);
  const [isEditingMain, setIsEditingMain] = useState(false);
  const [updatingMain, setUpdatingMain] = useState(false);

  const formatSubmittedDate = (val) => {
    if (!val) return '';
    const date = new Date(val);
    const day = date.getDate();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12;
    hours = hours ? hours : 12;
    
    return `${day} ${month} ${year}, ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
  };

  const getWorkflowSummaryTags = (record) => {
    if (!record) return { raise: { label: 'PENDING', color: 'gold' }, approval: { label: 'PENDING', color: 'gold' } };
    
    const mrfStatusStr = (record.mrfstatus || '').trim().toLowerCase();
    let raiseLabel = 'PENDING';
    let raiseColor = 'gold';
    if (mrfStatusStr === 'managersubmitted' || mrfStatusStr === 'manager submitted') {
      raiseLabel = 'COMPLETED';
      raiseColor = 'success';
    } else if (mrfStatusStr === 'pending' || mrfStatusStr === 'pendingfromleader') {
      raiseLabel = 'PENDING';
      raiseColor = 'gold';
    } else {
      raiseLabel = mrfStatusStr.toUpperCase();
      raiseColor = raiseLabel.includes('COMPLETED') ? 'success' : 'gold';
    }

    const approvalStatusStr = (record.approval_status || '').trim().toLowerCase();
    let approvalLabel = 'PENDING';
    let approvalColor = 'gold';
    if (approvalStatusStr === 'approved' || approvalStatusStr === 'completed') {
      approvalLabel = 'APPROVED';
      approvalColor = 'success';
    } else if (approvalStatusStr === 'rejected') {
      approvalLabel = 'REJECTED';
      approvalColor = 'error';
    } else if (approvalStatusStr === 'waiting') {
      approvalLabel = 'WAITING';
      approvalColor = 'gold';
    } else {
      approvalLabel = approvalStatusStr ? approvalStatusStr.toUpperCase() : 'PENDING';
      approvalColor = approvalLabel.includes('COMPLETE') || approvalLabel.includes('APPROV') ? 'success' : 'gold';
    }

    return {
      raise: { label: raiseLabel, color: raiseColor },
      approval: { label: approvalLabel, color: approvalColor }
    };
  };

  const handleOpenDetailsModal = (record) => {
    setSelectedRecord(record);
    setIsEditing(false);
    setIsEditingMain(false);
    setMainMrf(null);
    mainForm.resetFields();
    editForm.resetFields();
    editForm.setFieldsValue({
      first_name: record.first_name,
      last_name: record.last_name,
      email: record.email,
      budget_min: record.budget_min,
      budget_max: record.budget_max,
      jd_doc_link: record.jd_doc_link,
      role: record.role,
      mrfstatus: record.mrfstatus || 'pending',
    });
    setDetailsOpen(true);

    // If the Hiring Manager has submitted, load the full main MRF for view/edit.
    if (record.mrf_id) {
      loadMainMrf(record.mrf_id);
    }
  };

  // Fetch the submitted main MRF (rpa_mrf) and populate the main edit form.
  const loadMainMrf = async (mrfId) => {
    setMainMrfLoading(true);
    try {
      const res = await mrfService.getMain(mrfId);
      const data = res.data?.data || res.data;
      setMainMrf(data);
      mainForm.resetFields();
      mainForm.setFieldsValue(data || {});
    } catch (err) {
      message.error(err?.message || 'Failed to load submitted MRF details.');
    } finally {
      setMainMrfLoading(false);
    }
  };

  // Save edits to the submitted main MRF (rpa_mrf) via the dedicated endpoint.
  const handleSaveMainChanges = async () => {
    if (!mainMrf) return;
    setUpdatingMain(true);
    try {
      const values = await mainForm.validateFields();
      await mrfService.updateMain(mainMrf.id, values);
      message.success('Submitted MRF details updated successfully.');
      setIsEditingMain(false);
      await loadMainMrf(mainMrf.id);
    } catch (err) {
      if (err?.errorFields) return; // validation errors already shown inline
      message.error(err?.message || 'Failed to update submitted MRF details.');
    } finally {
      setUpdatingMain(false);
    }
  };

  const handleSaveChanges = async () => {
    if (!selectedRecord) return;
    setUpdating(true);
    try {
      const values = await editForm.validateFields();
      await mrfService.update(selectedRecord.id, {
        first_name: values.first_name,
        last_name: values.last_name,
        email: values.email,
        budget_min: values.budget_min,
        budget_max: values.budget_max,
        jd_doc_link: values.jd_doc_link,
        role: values.role,
        mrfstatus: values.mrfstatus,
      });

      message.success('MRF Request details updated successfully.');
      setDetailsOpen(false);
      loadRecords(page, searchQuery, statusTab);
    } catch (err) {
      message.error(err?.message || 'Failed to update MRF Request.');
    } finally {
      setUpdating(false);
    }
  };

  // Load MRF records
  const loadRecords = async (pageNum = page, currentSearch = searchQuery, currentStatus = statusTab) => {
    setLoading(true);
    try {
      const res = await mrfService.list({
        search: currentSearch,
        status: currentStatus === 'All' ? '' : currentStatus,
        page: pageNum,
        limit: pageSize,
      });
      if (res.data) {
        const list = Array.isArray(res.data.data) ? res.data.data : [];
        const paginationObj = res.data.pagination || {};
        setRecords(list);
        setTotal(paginationObj.total || list.length);
      }
    } catch (err) {
      message.error('Failed to load MRF records.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecords(page, searchQuery, statusTab);
  }, [page]);

  // Handle submit new MRF
  const handleSubmit = async (values) => {
    // Budget validation — mirrors the n8n MRF form rules
    // (Budget Min >= 10,000 and Budget Max > Budget Min).
    const min = Number(values.budget_min);
    const max = Number(values.budget_max);
    if (Number.isNaN(min) || Number.isNaN(max)) {
      message.error('Budget values must be valid numbers.');
      return;
    }
    if (min < 10000) {
      message.error('Budget Min should be at least 10,000.');
      return;
    }
    if (max <= min) {
      message.error('Budget Max must be greater than Budget Min.');
      return;
    }

    setSubmitting(true);
    try {
      await mrfService.create({
        first_name: values.first_name,
        last_name: values.last_name,
        email: values.email,
        cc_email: values.cc_email,
        role: values.role,
        jd_doc_link: values.jd_doc_link,
        budget_min: values.budget_min,
        budget_max: values.budget_max,
        email_body_content: values.email_body_content,
      });

      message.success('MRF Request submitted successfully!');
      form.resetFields();
      form.setFieldsValue({ email_body_content: DEFAULT_EMAIL_BODY });
      setPage(1);
      loadRecords(1, searchQuery, statusTab);
    } catch (err) {
      message.error(err?.message || 'Failed to submit MRF request.');
    } finally {
      setSubmitting(false);
    }
  };

  // Handle clear form
  const handleClear = () => {
    form.resetFields();
    form.setFieldsValue({ email_body_content: DEFAULT_EMAIL_BODY });
  };

  // Handle search record input changes
  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchQuery(val);
    setPage(1);
    loadRecords(1, val, statusTab);
  };

  // Handle status tab filters changes
  const handleStatusFilterChange = (e) => {
    const val = e.target.value;
    setStatusTab(val);
    setPage(1);
    loadRecords(1, searchQuery, val);
  };

  // Export current records list to CSV
  const handleExportCSV = async () => {
    try {
      // Fetch all records (without pagination limit) for complete export
      const res = await mrfService.list({
        search: searchQuery,
        status: statusTab === 'All' ? '' : statusTab,
        page: 1,
        limit: 1000, // Large number to fetch all filtered
      });

      const exportList = Array.isArray(res.data?.data) ? res.data.data : records;

      if (exportList.length === 0) {
        message.warning('No records found to export.');
        return;
      }

      // Build CSV content
      const headers = ['First Name', 'Last Name', 'Email', 'Role', 'Min Budget', 'Max Budget', 'Status', 'Created Date'];
      const rows = exportList.map(r => [
        r.first_name || '',
        r.last_name || '',
        r.email || '',
        r.role || '',
        r.budget_min || '',
        r.budget_max || '',
        r.mrfstatus || '',
        r.created_at ? r.created_at.split('T')[0] : '',
      ]);

      const csvContent = [
        headers.join(','),
        ...rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `MRF_Records_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      message.success('CSV exported successfully!');
    } catch {
      message.error('Failed to export CSV.');
    }
  };

  const formatCurrency = (val) => {
    if (val === undefined || val === null) return '—';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(Number(val));
  };

  const columns = [
    {
      title: 'FIRST NAME',
      dataIndex: 'first_name',
      key: 'first_name',
      render: (text) => <Text style={{ fontSize: 13 }}>{text}</Text>,
    },
    {
      title: 'LAST NAME',
      dataIndex: 'last_name',
      key: 'last_name',
      render: (text) => <Text style={{ fontSize: 13 }}>{text}</Text>,
    },
    {
      title: 'EMAIL',
      dataIndex: 'email',
      key: 'email',
      render: (text) => <Text style={{ fontSize: 13, fontFamily: 'monospace' }}>{text}</Text>,
    },
    {
      title: 'ROLE',
      dataIndex: 'role',
      key: 'role',
      render: (text) => <Text strong style={{ fontSize: 13, color: '#374151' }}>{text}</Text>,
    },
    {
      title: 'MIN BUDGET',
      dataIndex: 'budget_min',
      key: 'budget_min',
      render: (val) => <Text style={{ fontSize: 13, fontFamily: 'monospace' }}>{formatCurrency(val)}</Text>,
    },
    {
      title: 'MAX BUDGET',
      dataIndex: 'budget_max',
      key: 'budget_max',
      render: (val) => <Text style={{ fontSize: 13, fontFamily: 'monospace' }}>{formatCurrency(val)}</Text>,
    },
    {
      title: 'MRF STATUS',
      dataIndex: 'mrfstatus',
      key: 'mrfstatus',
      render: (status) => {
        const statusStr = (status || '').trim().toLowerCase();
        let displayStatus = 'PENDING';
        let isManager = false;

        if (statusStr === 'managersubmitted' || statusStr === 'manager submitted') {
          displayStatus = 'MANAGER SUBMITTED';
          isManager = true;
        } else if (statusStr === 'pending' || statusStr === 'pendingfromleader') {
          displayStatus = 'PENDING';
          isManager = false;
        } else {
          displayStatus = (status || '').toUpperCase();
          isManager = displayStatus.includes('MANAGER');
        }

        return (
          <Tag color={isManager ? 'success' : 'gold'} style={{ borderRadius: 6, fontWeight: 700, fontSize: 11, padding: '2px 8px', textTransform: 'uppercase' }}>
            {displayStatus}
          </Tag>
        );
      },
    },
    {
      title: 'CREATED DATE',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (val) => {
        if (!val) return '—';
        const date = new Date(val);
        const options = { day: 'numeric', month: 'short', year: 'numeric' };
        return <Text style={{ fontSize: 13 }}>{date.toLocaleDateString('en-GB', options)}</Text>;
      },
    },
  ];

  return (
    <div style={{ padding: '24px', maxWidth: 1200, margin: '0 auto' }} className="animate-fade-in">
      {/* MRF Create Request Form Card */}
      <Card
        bordered={false}
        style={{
          borderRadius: 12,
          boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
          borderTop: '4px solid #005f56',
          marginBottom: 28,
        }}
      >
        <div style={{ marginBottom: 24 }}>
          <Title level={3} style={{ fontFamily: "'Lora', serif", fontWeight: 700, margin: '0 0 4px 0' }}>
            New MRF Request
          </Title>
          <Text type="secondary" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: '#005f56' }}>
            Hiring Manager Details
          </Text>
        </div>

        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          initialValues={{ email_body_content: DEFAULT_EMAIL_BODY }}
        >
          <Row gutter={16}>
            <Col xs={24} sm={8}>
              <Form.Item
                label={<span style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', color: '#4b5563' }}>First Name *</span>}
                name="first_name"
                rules={[{ required: true, message: 'Required' }]}
              >
                <Input placeholder="e.g. Abhijit" style={{ height: 42, borderRadius: 8 }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item
                label={<span style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', color: '#4b5563' }}>Last Name *</span>}
                name="last_name"
                rules={[{ required: true, message: 'Required' }]}
              >
                <Input placeholder="e.g. Roy" style={{ height: 42, borderRadius: 8 }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item
                label={<span style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', color: '#4b5563' }}>Email *</span>}
                name="email"
                rules={[{ required: true, message: 'Required' }, { pattern: EMAIL_PATTERN, message: 'Please enter a valid Email' }]}
              >
                <Input placeholder="e.g. aroy@aapnainfotech.com" style={{ height: 42, borderRadius: 8 }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} sm={8}>
              <Form.Item
                label={<span style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', color: '#4b5563' }}>CC Email (Keep Comma Separated)</span>}
                name="cc_email"
                rules={[{ validator: validateCcEmail }]}
              >
                <Input placeholder="e.g. example1@aapnainfotech.com, example2@aapnainfotech.com" style={{ height: 42, borderRadius: 8 }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item
                label={<span style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', color: '#4b5563' }}>Role *</span>}
                name="role"
                rules={[{ required: true, message: 'Required' }]}
              >
                <Input placeholder="e.g. Senior Software Engineer" style={{ height: 42, borderRadius: 8 }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item
                label={<span style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', color: '#4b5563' }}>JD Link *</span>}
                name="jd_doc_link"
                rules={[{ required: true, message: 'Required' }]}
              >
                <Input placeholder="e.g. https://link-to-jd.com" style={{ height: 42, borderRadius: 8 }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                label={<span style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', color: '#4b5563' }}>Budget Min (Annual CTC) *</span>}
                name="budget_min"
                rules={[{ required: true, message: 'Required' }]}
              >
                <InputNumber
                  placeholder="Min 1,00,000 (e.g. 5,00,000)"
                  formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={value => value.replace(/\$\s?|(,*)/g, '')}
                  style={{ width: '100%', height: 42, borderRadius: 8, display: 'flex', alignItems: 'center' }}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                label={<span style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', color: '#4b5563' }}>Budget Max (Annual CTC) *</span>}
                name="budget_max"
                rules={[{ required: true, message: 'Required' }]}
              >
                <InputNumber
                  placeholder="e.g. 10,00,000"
                  formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={value => value.replace(/\$\s?|(,*)/g, '')}
                  style={{ width: '100%', height: 42, borderRadius: 8, display: 'flex', alignItems: 'center' }}
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            label={<span style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', color: '#4b5563' }}>Email Body</span>}
            name="email_body_content"
          >
            <Input.TextArea rows={5} style={{ borderRadius: 8 }} />
          </Form.Item>

          <Space size={12}>
            <Button
              type="primary"
              htmlType="submit"
              icon={<SendOutlined />}
              loading={submitting}
              style={{
                background: '#005f56',
                borderColor: '#005f56',
                height: 42,
                borderRadius: 8,
                fontWeight: 600,
                padding: '0 24px',
              }}
            >
              Submit Request
            </Button>
            <Button
              onClick={handleClear}
              icon={<ClearOutlined />}
              style={{
                height: 42,
                borderRadius: 8,
                fontWeight: 600,
                padding: '0 20px',
              }}
            >
              Clear
            </Button>
          </Space>
        </Form>
      </Card>

      {/* Submitted MRF Records Listing Table Card */}
      <Card
        bordered={false}
        style={{
          borderRadius: 12,
          boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
        }}
        styles={{ body: { padding: 0 } }}
      >
        {/* Table Toolbar */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid #dde2d0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6b7561' }}>
              Records
            </span>
            <Input
              placeholder="Search records..."
              value={searchQuery}
              onChange={handleSearchChange}
              style={{ width: 220, borderRadius: 6 }}
            />
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              value={statusTab}
              onChange={handleStatusFilterChange}
            >
              <Radio.Button value="All">All</Radio.Button>
              <Radio.Button value="pending">Pending</Radio.Button>
              <Radio.Button value="manager submitted">Manager Submitted</Radio.Button>
            </Radio.Group>
          </div>
          <Button
            icon={<FileExcelOutlined />}
            onClick={handleExportCSV}
            style={{
              borderRadius: 6,
              color: '#005f56',
              borderColor: '#005f56',
              fontWeight: 600,
            }}
          >
            Export CSV
          </Button>
        </div>

        {/* Records Table */}
        <Table
          dataSource={records}
          columns={columns}
          rowKey="id"
          loading={loading}
          onRow={(record) => ({
            onClick: () => handleOpenDetailsModal(record),
            style: { cursor: 'pointer' },
          })}
          pagination={{
            current: page,
            pageSize: pageSize,
            total: total,
            onChange: setPage,
            showSizeChanger: false,
            style: { paddingRight: 20 },
          }}
        />
      </Card>

      {/* 2) VIEW/EDIT MRF DETAILS MODAL (High Fidelity) */}
      <Modal
        title={
          selectedRecord && (
            <div style={{ paddingBottom: 10, borderBottom: '1px solid #f3f4f6' }}>
              <div style={{ fontSize: 16, fontFamily: "'Lora', serif", fontWeight: 700, color: '#1f2937' }}>
                {selectedRecord.first_name} {selectedRecord.last_name} — {selectedRecord.role}
              </div>
              <div style={{ fontSize: 11, fontWeight: 500, color: '#6b7280', marginTop: 2 }}>
                Submitted {formatSubmittedDate(selectedRecord.created_at)} &bull; ID #{selectedRecord.id}
              </div>
            </div>
          )
        }
        open={detailsOpen}
        onCancel={() => { setDetailsOpen(false); setIsEditingMain(false); setMainMrf(null); }}
        width={800}
        footer={[
          isEditing ? (
            <Space key="footer-edit">
              <Button onClick={() => setIsEditing(false)} style={{ borderRadius: 6, fontWeight: 600 }}>
                Cancel
              </Button>
              <Button type="primary" onClick={handleSaveChanges} loading={updating} style={{ background: '#005f56', borderColor: '#005f56', borderRadius: 6, fontWeight: 600 }}>
                Save Changes
              </Button>
            </Space>
          ) : (
            <Space key="footer-view">
              <Button onClick={() => setIsEditing(true)} style={{ borderRadius: 6, color: '#005f56', borderColor: '#005f56', fontWeight: 600 }}>
                Edit Request
              </Button>
              <Button onClick={() => setDetailsOpen(false)} style={{ borderRadius: 6, fontWeight: 600 }}>
                Close
              </Button>
            </Space>
          )
        ]}
        styles={{ body: { padding: '20px 0 0 0' } }}
      >
        {selectedRecord && (
          <div>
            {/* Section 1: Workflow Summary */}
            <div style={{ background: '#f9fafb', padding: '16px 24px', borderRadius: 8, border: '1px solid #e5e7eb', marginBottom: 24 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 12 }}>
                Workflow Summary
              </div>
              <Row gutter={16}>
                <Col span={12}>
                  <Space>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#4b5563', textTransform: 'uppercase' }}>MRF Raise Status:</span>
                    <Tag color={getWorkflowSummaryTags(selectedRecord).raise.color} style={{ borderRadius: 6, fontWeight: 700, fontSize: 11, padding: '2px 8px' }}>
                      {getWorkflowSummaryTags(selectedRecord).raise.label}
                    </Tag>
                  </Space>
                </Col>
                <Col span={12} style={{ textAlign: 'right' }}>
                  <Space>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#4b5563', textTransform: 'uppercase' }}>MRF Approval Status:</span>
                    <Tag color={getWorkflowSummaryTags(selectedRecord).approval.color} style={{ borderRadius: 6, fontWeight: 700, fontSize: 11, padding: '2px 8px' }}>
                      {getWorkflowSummaryTags(selectedRecord).approval.label}
                    </Tag>
                  </Space>
                </Col>
              </Row>
            </div>

            {/* Section 2: New MRF Request Info */}
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: '#005f56', marginBottom: 16 }}>
              New MRF Request Info
            </div>

            <Form
              form={editForm}
              layout="vertical"
              disabled={!isEditing}
            >
              <Row gutter={16}>
                <Col span={6}>
                  <Form.Item
                    label={<span style={{ fontWeight: 600, fontSize: 10, textTransform: 'uppercase', color: '#4b5563' }}>First Name</span>}
                    name="first_name"
                    rules={[{ required: true, message: 'Required' }]}
                  >
                    <Input style={{ borderRadius: 6 }} />
                  </Form.Item>
                </Col>
                <Col span={6}>
                  <Form.Item
                    label={<span style={{ fontWeight: 600, fontSize: 10, textTransform: 'uppercase', color: '#4b5563' }}>Last Name</span>}
                    name="last_name"
                    rules={[{ required: true, message: 'Required' }]}
                  >
                    <Input style={{ borderRadius: 6 }} />
                  </Form.Item>
                </Col>
                <Col span={6}>
                  <Form.Item
                    label={<span style={{ fontWeight: 600, fontSize: 10, textTransform: 'uppercase', color: '#4b5563' }}>Manager Email</span>}
                    name="email"
                    rules={[{ required: true, message: 'Required' }, { type: 'email', message: 'Invalid email' }]}
                  >
                    <Input style={{ borderRadius: 6, fontFamily: 'monospace' }} />
                  </Form.Item>
                </Col>
                <Col span={6}>
                  <Form.Item
                    label={<span style={{ fontWeight: 600, fontSize: 10, textTransform: 'uppercase', color: '#4b5563' }}>Budget Min</span>}
                    name="budget_min"
                    rules={[{ required: true, message: 'Required' }]}
                  >
                    <InputNumber
                      formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                      parser={value => value.replace(/\$\s?|(,*)/g, '')}
                      style={{ width: '100%', borderRadius: 6 }}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={16}>
                <Col span={6}>
                  <Form.Item
                    label={<span style={{ fontWeight: 600, fontSize: 10, textTransform: 'uppercase', color: '#4b5563' }}>Budget Max</span>}
                    name="budget_max"
                    rules={[{ required: true, message: 'Required' }]}
                  >
                    <InputNumber
                      formatter={value => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                      parser={value => value.replace(/\$\s?|(,*)/g, '')}
                      style={{ width: '100%', borderRadius: 6 }}
                    />
                  </Form.Item>
                </Col>
                <Col span={6}>
                  <Form.Item
                    label={<span style={{ fontWeight: 600, fontSize: 10, textTransform: 'uppercase', color: '#4b5563' }}>JD Resource</span>}
                    name="jd_doc_link"
                    rules={[{ required: true, message: 'Required' }]}
                  >
                    {isEditing ? (
                      <Input placeholder="JD document link" style={{ borderRadius: 6 }} />
                    ) : (
                      <a
                        href={selectedRecord.jd_doc_link}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          height: 32,
                          background: '#f3f4f6',
                          border: '1px solid #d1d5db',
                          borderRadius: 6,
                          padding: '0 12px',
                          color: '#2563eb',
                          fontWeight: 600,
                          fontSize: 12,
                          width: '100%',
                          justifyContent: 'center',
                        }}
                      >
                        View Document &nbsp;&thinsp;↗
                      </a>
                    )}
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={16}>
                <Col span={24}>
                  <Form.Item
                    label={<span style={{ fontWeight: 600, fontSize: 10, textTransform: 'uppercase', color: '#4b5563' }}>Position Title</span>}
                    name="role"
                    rules={[{ required: true, message: 'Required' }]}
                  >
                    <Input style={{ borderRadius: 6 }} />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    label={<span style={{ fontWeight: 600, fontSize: 10, textTransform: 'uppercase', color: '#4b5563' }}>MRF Raise Status</span>}
                    name="mrfstatus"
                  >
                    <Select style={{ width: '100%', borderRadius: 6 }}>
                      <Select.Option value="pending">Pending</Select.Option>
                      <Select.Option value="pendingfromleader">Pending from Leader</Select.Option>
                      <Select.Option value="managersubmitted">Manager Submitted</Select.Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    label={<span style={{ fontWeight: 600, fontSize: 10, textTransform: 'uppercase', color: '#4b5563' }}>Form Submission Date</span>}
                  >
                    <Input
                      value={selectedRecord.created_at ? new Date(selectedRecord.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}
                      readOnly
                      disabled
                      style={{ borderRadius: 6 }}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </Form>

            {/* Section 3: Submitted MRF Details (rpa_mrf) — only when HM has submitted */}
            {selectedRecord.mrf_id && (
              <div style={{ marginTop: 28, borderTop: '1px solid #f3f4f6', paddingTop: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: '#005f56' }}>
                    Submitted MRF Details
                  </span>
                  {mainMrf && (
                    isEditingMain ? (
                      <Space>
                        <Button size="small" onClick={() => { setIsEditingMain(false); mainForm.setFieldsValue(mainMrf); }} style={{ borderRadius: 6, fontWeight: 600 }}>
                          Cancel
                        </Button>
                        <Button size="small" type="primary" onClick={handleSaveMainChanges} loading={updatingMain} style={{ background: '#005f56', borderColor: '#005f56', borderRadius: 6, fontWeight: 600 }}>
                          Save MRF
                        </Button>
                      </Space>
                    ) : (
                      <Button size="small" onClick={() => setIsEditingMain(true)} style={{ borderRadius: 6, color: '#005f56', borderColor: '#005f56', fontWeight: 600 }}>
                        Edit MRF
                      </Button>
                    )
                  )}
                </div>

                {mainMrfLoading ? (
                  <Text type="secondary" style={{ fontSize: 12 }}>Loading submitted MRF details…</Text>
                ) : mainMrf ? (
                  <Form form={mainForm} layout="vertical" disabled={!isEditingMain}>
                    {MAIN_MRF_FIELD_GROUPS.map((group) => (
                      <div key={group.title} style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase', color: '#9ca3af', margin: '4px 0 10px' }}>
                          {group.title}
                        </div>
                        <Row gutter={16}>
                          {group.fields.map(([name, label]) => (
                            <Col span={12} key={name}>
                              <Form.Item
                                label={<span style={{ fontWeight: 600, fontSize: 10, textTransform: 'uppercase', color: '#4b5563' }}>{label}</span>}
                                name={name}
                                rules={MAIN_MRF_NUMERIC_FIELDS.includes(name) ? [{ pattern: /^\d*$/, message: 'Must be a number' }] : []}
                              >
                                <Input style={{ borderRadius: 6 }} />
                              </Form.Item>
                            </Col>
                          ))}
                        </Row>
                      </div>
                    ))}
                  </Form>
                ) : (
                  <Text type="secondary" style={{ fontSize: 12 }}>No submitted MRF details available.</Text>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
