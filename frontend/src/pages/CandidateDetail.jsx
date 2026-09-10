/**
 * CandidateDetail Page — Tabbed detail view for a single candidate.
 * Placeholder tabs: Profile, Resume, AI Insights, Emails, Timeline.
 */
import { useParams, useNavigate, useLocation } from 'react-router-dom';
// Button now comes from src/ui — see the import below.
import { Card, Tabs, Typography, Avatar, Space, Tag, Row, Col, Descriptions, Empty, Timeline, Form, Input, Modal, message } from 'antd';
import {
  ArrowLeftOutlined,
  UserOutlined,
  FileTextOutlined,
  ThunderboltOutlined,
  MailOutlined,
  ClockCircleOutlined,
  EditOutlined,
  PhoneOutlined,
  EnvironmentOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import candidateService from '../services/candidateService';
import StatusBadge from '../components/common/StatusBadge';
import SkillTags from '../components/common/SkillTags';
import LoadingSkeleton from '../components/common/LoadingSkeleton';
import usePointerSpotlight from '../hooks/usePointerSpotlight';
import { DesignScope, PageShell, PageHeader, Surface, Button } from '../ui';
// After '../ui' so page rules win on equal specificity.
import '../styles/pages/candidate-detail.css';

const { Title, Text, Paragraph } = Typography;

/** Mock candidate for demo. */
const MOCK_CANDIDATE = {
  id: '1',
  name: 'Priya Sharma',
  email: 'priya.sharma@email.com',
  phone: '+91 98765 43210',
  location: 'Mumbai, India',
  position: 'Senior React Developer',
  experience: '6 years',
  status: 'shortlisted',
  score: 92,
  skills: ['React', 'TypeScript', 'Node.js', 'GraphQL', 'AWS', 'Docker', 'Jest'],
  summary: 'Experienced frontend engineer with 6+ years building scalable web applications using React and TypeScript. Strong background in performance optimization and design systems.',
  education: 'B.Tech in Computer Science — IIT Bombay, 2018',
  currentCompany: { Name: 'TechCorp Solutions', Website: '' },
  noticePeriod: '30 days',
  expectedCTC: '₹28 LPA',
};

export default function CandidateDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const fromPage = location.state?.from;

  const [editOpen, setEditOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [editForm] = Form.useForm();

  const { data: candidate, isLoading } = useQuery({
    queryKey: ['candidate', id],
    queryFn: () => candidateService.getById(id).then((r) => r.data.data),
    retry: false,
  });

  const data = candidate || MOCK_CANDIDATE;

  /** Cursor-tracked spotlight for this page's `.spotlight` surface (the header
   *  card), same delegated listener the dashboard uses.
   *
   *  LOAD-BEARING: the loading branch below must return the SAME root element —
   *  `<div className="stagger-children" ref={rootRef}>` — as the loaded branch.
   *  The hook attaches its `pointermove` listener to `rootRef.current` once and
   *  only re-runs when the ref identity changes, never when the DOM node behind
   *  it does. Two identical roots at the same position let React reuse the node
   *  across the loading→loaded flip, so the listener survives. Return a Fragment
   *  or a different element type from either branch and the node is swapped out,
   *  leaving the listener bound to a detached div and the spotlight dead. */
  const rootRef = useRef(null);
  usePointerSpotlight(rootRef);

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

  // Open Edit Modal
  const handleOpenEdit = () => {
    editForm.resetFields();
    editForm.setFieldsValue({
      name: data.name,
      email: data.email,
      phone: data.phone,
      location: data.location,
      experience: data.experience,
      education: data.education,
      expectedCTC: data.expectedCTC,
      currentCTC: data.currentCTC || '',
      noticePeriod: data.noticePeriod,
      currentCompany: {
        Name: data.currentCompany?.Name || data.currentCompany?.name || '',
        Website: data.currentCompany?.Website || data.currentCompany?.website || '',
      }
    });
    setEditOpen(true);
  };

  // Save Edit Details
  const handleSaveEdit = async () => {
    setUpdating(true);
    try {
      const values = await editForm.validateFields();
      
      const payload = {
        phone: values.phone,
        education: values.education,
        experience: values.experience,
        location: values.location,
        expectedCTC: values.expectedCTC,
        currentCTC: values.currentCTC,
        noticePeriod: values.noticePeriod,
        currentCompany: {
          Name: values.currentCompany?.Name || '',
          Website: values.currentCompany?.Website || '',
        }
      };

      await candidateService.update(id, payload);
      message.success('Candidate details updated successfully.');
      setEditOpen(false);
      queryClient.invalidateQueries({ queryKey: ['candidate', id] });
    } catch (err) {
      message.error(err.response?.data?.message || err?.message || 'Failed to update candidate details.');
    } finally {
      setUpdating(false);
    }
  };

  const tabItems = [
    {
      key: 'profile',
      label: (
        <Space><UserOutlined />Profile</Space>
      ),
      children: (
        <div className="animate-fade-in">
          <Descriptions
            bordered
            column={{ xs: 1, sm: 2 }}
            size="middle"
            className="cd-mb-5"
          >
            <Descriptions.Item label="Email">{data.email}</Descriptions.Item>
            <Descriptions.Item label="Phone">{data.phone}</Descriptions.Item>
            <Descriptions.Item label="Location">{data.location}</Descriptions.Item>
            <Descriptions.Item label="Experience">{data.experience ? `${data.experience} Years` : ''}</Descriptions.Item>
            <Descriptions.Item label="Current Company">
              {typeof data.currentCompany === 'object' && data.currentCompany !== null ? (
                <div>
                  <Text className="cd-block">{data.currentCompany.Name || data.currentCompany.name || '—'}</Text>
                  {data.currentCompany.Website && (
                    <Text type="secondary" className="cd-caption">
                      <a href={data.currentCompany.Website.startsWith('http') ? data.currentCompany.Website : `https://${data.currentCompany.Website}`} target="_blank" rel="noopener noreferrer">
                        {data.currentCompany.Website}
                      </a>
                    </Text>
                  )}
                </div>
              ) : (
                data.currentCompany || '—'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Notice Period">{data.noticePeriod ? `${data.noticePeriod} Days` : ''}</Descriptions.Item>
            <Descriptions.Item label="Expected CTC">{data.expectedCTC ? `₹ ${data.expectedCTC} LPA` : ''}</Descriptions.Item>
            <Descriptions.Item label="Education">{data.education}</Descriptions.Item>
          </Descriptions>

          {/* Tint and radius live in CSS (.cd-summary), not inline: under Design V2
              this callout is restyled onto the glass tier, and an inline style
              cannot be overridden by a stylesheet. */}
          <Card title="Professional Summary" size="small" bordered={false} className="cd-summary">
            <Paragraph className="cd-body">
              {data.summary || 'No professional summary available.'}
            </Paragraph>
          </Card>
        </div>
      ),
    },
    {
      key: 'resume',
      label: (
        <Space><FileTextOutlined />Resume</Space>
      ),
      children: (
        <div className="animate-fade-in cd-empty">
          <Empty
            description="Resume viewer will be integrated here"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          >
            <Button emphasis="solid" icon={<FileTextOutlined />}>
              Download Resume
            </Button>
          </Empty>
        </div>
      ),
    },
    {
      key: 'ai-insights',
      label: (
        <Space><ThunderboltOutlined />AI Insights</Space>
      ),
      children: (
        <div className="animate-fade-in cd-empty">
          <Empty
            description="AI-powered candidate analysis and scoring will appear here"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        </div>
      ),
    },
    {
      key: 'emails',
      label: (
        <Space><MailOutlined />Emails</Space>
      ),
      children: (
        <div className="animate-fade-in cd-empty">
          <Empty
            description="Email communication history will be shown here"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        </div>
      ),
    },
    {
      key: 'timeline',
      label: (
        <Space><ClockCircleOutlined />Timeline</Space>
      ),
      children: (
        <div className="animate-fade-in cd-tab-body">
          <Timeline
            items={[
              { color: 'var(--brand-primary)', children: <><Text strong>Resume uploaded</Text><br /><Text type="secondary" className="cd-caption">Jun 4, 2026 · 2:30 PM</Text></> },
              { color: 'var(--brand-primary-hover)', children: <><Text strong>AI screening completed</Text> — Score: {data.score || 92}%<br /><Text type="secondary" className="cd-caption">Jun 4, 2026 · 2:31 PM</Text></> },
              { color: 'var(--kpi-b)', children: <><Text strong>Shortlisted</Text> by HR Admin<br /><Text type="secondary" className="cd-caption">Jun 4, 2026 · 3:15 PM</Text></> },
              { color: 'gray', children: <><Text type="secondary">Awaiting interview scheduling</Text></> },
            ]}
          />
        </div>
      ),
    },
  ];

  if (isLoading) {
    // Rendered inside the same root as the loaded view — see the rootRef note above.
    return (
      <div className="stagger-children" ref={rootRef}>
        <LoadingSkeleton type="detail" />
      </div>
    );
  }

  return (
    <DesignScope>
      <PageShell ref={rootRef} width="standard" className="stagger-children">
      {/* Page header — 2026-08-31, and this route needed it most. Measured against the
          lab's Detail archetype, which opens `eyebrow = role / title = name /
          subtitle = where they are`, then plain panels:

            - the page's FIRST element was a bare text button ("← Back to Candidates")
              floating on the canvas with nothing around it;
            - the person's name — the subject of the whole screen — was a
              `Title level={3}` at 20px, buried inside a card, against the lab's 32px.

          The two panels below already matched the lab and are untouched. Identity and
          the page's actions move up here; the card keeps the DETAIL (avatar, contact
          lines, skills), so nothing is stated twice. */}
      <PageHeader
        eyebrow={data.position}
        title={data.name}
        subtitle={(
          <>
            <StatusBadge status={data.status} />
            {' '}
            <Tag className={`cd-score ${data.score >= 90 ? 'cd-score--high' : 'cd-score--mid'}`}>
              {data.score}% Match
            </Tag>
          </>
        )}
        actions={(
          <>
            <Button
              emphasis="text"
              icon={<ArrowLeftOutlined />}
              onClick={() => {
                if (fromPage === 'analytics') {
                  navigate('/analytics');
                } else {
                  navigate('/candidates');
                }
              }}
            >
              {fromPage === 'analytics' ? 'Back to Analytics' : 'Back to Candidates'}
            </Button>
            <Button emphasis="solid" icon={<EditOutlined />} onClick={handleOpenEdit}>
              Edit
            </Button>
          </>
        )}
      />

      {/* The record card — avatar, contact lines and skills. Keeps the cursor spotlight
          the dashboard puts on its one feature surface. */}
      <Surface tier={2} padding="relaxed" bloom className="spotlight cd-mb-5">
        <Row gutter={[24, 16]} align="middle">
          <Col>
            <Avatar size={72} icon={<UserOutlined />} className="cd-avatar" />
          </Col>
          <Col flex="auto">
            <Space direction="vertical" size={4}>
              <Space size={16}>
                <Space size={4}><MailOutlined className="cd-faded" /><Text type="secondary" className="cd-sub">{data.email}</Text></Space>
                <Space size={4}><PhoneOutlined className="cd-faded" /><Text type="secondary" className="cd-sub">{data.phone}</Text></Space>
                <Space size={4}><EnvironmentOutlined className="cd-faded" /><Text type="secondary" className="cd-sub">{data.location}</Text></Space>
              </Space>
              <div className="cd-mt-2">
                <SkillTags skills={data.skills} max={6} />
              </div>
            </Space>
          </Col>
        </Row>
      </Surface>

      {/* Tabbed content */}
      <Surface tier={2} padding="relaxed" className="cd-tabs-card">
        <Tabs items={tabItems} defaultActiveKey="profile" />
      </Surface>

      {/* Edit Candidate details modal */}
      <Modal
        title={<span className="cd-modal-title">Edit Candidate Details</span>}
        open={editOpen}
        onOk={handleSaveEdit}
        onCancel={() => setEditOpen(false)}
        okText="Update Candidate"
        okButtonProps={{ loading: updating }}
        width={700}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto', paddingRight: 12 } }}
      >
        <Form form={editForm} layout="vertical" className="cd-mt-4">
          {/* Section 1: Personal Information */}
          <div className="cd-mb-2">
            <span className="cd-section-label">Personal Information</span>
            <div className="cd-rule" />
          </div>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={<span className="cd-label">CANDIDATE NAME</span>} name="name">
                <Input readOnly className="cd-ctl--locked" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<span className="cd-label">CANDIDATE EMAIL</span>} name="email">
                <Input readOnly className="cd-ctl--locked" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                label={<span className="cd-label">CANDIDATE CONTACT NUMBER</span>} 
                name="phone"
                rules={[{ validator: contactNumberValidator }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                label={<span className="cd-label">CURRENT LOCATION</span>} 
                name="location"
                rules={[{ validator: nonNumericValidator }]}
              >
                <Input />
              </Form.Item>
            </Col>
          </Row>

          {/* Section 2: Education & Experience */}
          <div className="cd-section-gap">
            <span className="cd-section-label">Education & Experience</span>
            <div className="cd-rule" />
          </div>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                label={<span className="cd-label">HIGHEST QUALIFICATION</span>} 
                name="education"
                rules={[{ validator: nonNumericValidator }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                label={<span className="cd-label">TOTAL EXPERIENCE (YEARS)</span>} 
                name="experience"
                rules={[{ validator: experienceValidator }]}
              >
                <Input />
              </Form.Item>
            </Col>
          </Row>

          {/* Section 3: Company & CTC */}
          <div className="cd-section-gap">
            <span className="cd-section-label">Company & Salary Details</span>
            <div className="cd-rule" />
          </div>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={<span className="cd-label">CURRENT COMPANY NAME</span>} name={['currentCompany', 'Name']}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<span className="cd-label">CURRENT COMPANY WEBSITE</span>} name={['currentCompany', 'Website']}>
                <Input />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item 
                label={<span className="cd-label">EXPECTED CTC (LPA)</span>} 
                name="expectedCTC"
                rules={[{ validator: decimalFieldValidator }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item 
                label={<span className="cd-label">CURRENT CTC (LPA)</span>} 
                name="currentCTC"
                rules={[{ validator: decimalFieldValidator }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item 
                label={<span className="cd-label">NOTICE PERIOD (DAYS)</span>} 
                name="noticePeriod"
                rules={[{ validator: noticePeriodValidator }]}
              >
                <Input />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
      </PageShell>
    </DesignScope>
  );
}
