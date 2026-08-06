/**
 * CandidateDetail Page — Tabbed detail view for a single candidate.
 * Placeholder tabs: Profile, Resume, AI Insights, Emails, Timeline.
 */
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Card, Tabs, Typography, Button, Avatar, Space, Tag, Row, Col, Descriptions, Empty, Timeline, Form, Input, Modal, message } from 'antd';
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
import { useState } from 'react';

import candidateService from '../services/candidateService';
import StatusBadge from '../components/common/StatusBadge';
import SkillTags from '../components/common/SkillTags';
import LoadingSkeleton from '../components/common/LoadingSkeleton';

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

  if (isLoading) {
    return <LoadingSkeleton type="detail" />;
  }

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
      message.error(err.response?.data?.message || 'Failed to update candidate details.');
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
            style={{ marginBottom: 24 }}
          >
            <Descriptions.Item label="Email">{data.email}</Descriptions.Item>
            <Descriptions.Item label="Phone">{data.phone}</Descriptions.Item>
            <Descriptions.Item label="Location">{data.location}</Descriptions.Item>
            <Descriptions.Item label="Experience">{data.experience ? `${data.experience} Years` : ''}</Descriptions.Item>
            <Descriptions.Item label="Current Company">
              {typeof data.currentCompany === 'object' && data.currentCompany !== null ? (
                <div>
                  <Text style={{ display: 'block' }}>{data.currentCompany.Name || data.currentCompany.name || '—'}</Text>
                  {data.currentCompany.Website && (
                    <Text type="secondary" style={{ fontSize: 11 }}>
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

          <Card title="Professional Summary" size="small" bordered={false} style={{ background: 'var(--gold-subtle)', borderRadius: 12 }}>
            <Paragraph style={{ margin: 0, fontSize: 14, lineHeight: 1.8 }}>
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
        <div className="animate-fade-in" style={{ textAlign: 'center', padding: '60px 0' }}>
          <Empty
            description="Resume viewer will be integrated here"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          >
            <Button type="primary" icon={<FileTextOutlined />} style={{ borderRadius: 8 }}>
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
        <div className="animate-fade-in" style={{ textAlign: 'center', padding: '60px 0' }}>
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
        <div className="animate-fade-in" style={{ textAlign: 'center', padding: '60px 0' }}>
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
        <div className="animate-fade-in" style={{ padding: '24px 0' }}>
          <Timeline
            items={[
              { color: '#7a922e', children: <><Text strong>Resume uploaded</Text><br /><Text type="secondary" style={{ fontSize: 12 }}>Jun 4, 2026 · 2:30 PM</Text></> },
              { color: '#92a63c', children: <><Text strong>AI screening completed</Text> — Score: {data.score || 92}%<br /><Text type="secondary" style={{ fontSize: 12 }}>Jun 4, 2026 · 2:31 PM</Text></> },
              { color: '#2980b9', children: <><Text strong>Shortlisted</Text> by HR Admin<br /><Text type="secondary" style={{ fontSize: 12 }}>Jun 4, 2026 · 3:15 PM</Text></> },
              { color: 'gray', children: <><Text type="secondary">Awaiting interview scheduling</Text></> },
            ]}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="stagger-children">
      {/* Back button */}
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={() => {
          if (fromPage === 'analytics') {
            navigate('/analytics');
          } else {
            navigate('/candidates');
          }
        }}
        style={{ marginBottom: 16, borderRadius: 8, fontWeight: 500 }}
      >
        {fromPage === 'analytics' ? 'Back to Analytics' : 'Back to Candidates'}
      </Button>

      {/* Header card */}
      <Card
        bordered={false}
        className="glass-card"
        style={{ marginBottom: 24 }}
        styles={{ body: { padding: 28 } }}
      >
        <Row gutter={[24, 16]} align="middle">
          <Col>
            <Avatar
              size={72}
              icon={<UserOutlined />}
              style={{
                background: 'var(--gradient-primary)',
                fontSize: 28,
              }}
            />
          </Col>
          <Col flex="auto">
            <Space direction="vertical" size={4}>
              <Space size={12} align="center">
                <Title level={3} style={{ margin: 0, fontWeight: 700 }}>{data.name}</Title>
                <StatusBadge status={data.status} />
                <Tag
                  style={{
                    borderRadius: 6,
                    fontWeight: 700,
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 14,
                    border: 'none',
                    background: data.score >= 90 ? '#4a7c5920' : '#d4a01720',
                    color: data.score >= 90 ? '#4a7c59' : '#d4a017',
                  }}
                >
                  {data.score}% Match
                </Tag>
              </Space>
              <Text type="secondary" style={{ fontSize: 15 }}>{data.position}</Text>
              <Space size={16} style={{ marginTop: 4 }}>
                <Space size={4}><MailOutlined style={{ opacity: 0.5 }} /><Text type="secondary" style={{ fontSize: 13 }}>{data.email}</Text></Space>
                <Space size={4}><PhoneOutlined style={{ opacity: 0.5 }} /><Text type="secondary" style={{ fontSize: 13 }}>{data.phone}</Text></Space>
                <Space size={4}><EnvironmentOutlined style={{ opacity: 0.5 }} /><Text type="secondary" style={{ fontSize: 13 }}>{data.location}</Text></Space>
              </Space>
              <div style={{ marginTop: 8 }}>
                <SkillTags skills={data.skills} max={6} />
              </div>
            </Space>
          </Col>
          <Col>
            <Button 
              type="primary" 
              icon={<EditOutlined />} 
              style={{ borderRadius: 8, background: '#7a922e', borderColor: '#7a922e' }}
              onClick={handleOpenEdit}
            >
              Edit
            </Button>
          </Col>
        </Row>
      </Card>

      {/* Tabbed content */}
      <Card bordered={false} className="glass-card" styles={{ body: { padding: '4px 24px 24px' } }}>
        <Tabs items={tabItems} defaultActiveKey="profile" />
      </Card>

      {/* Edit Candidate details modal */}
      <Modal
        title={<span style={{ fontSize: 16, fontFamily: "'Sora', sans-serif", fontWeight: 700 }}>Edit Candidate Details</span>}
        open={editOpen}
        onOk={handleSaveEdit}
        onCancel={() => setEditOpen(false)}
        okText="Update Candidate"
        okButtonProps={{ style: { background: '#7a922e', borderColor: '#7a922e' }, loading: updating }}
        width={700}
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
                <Input readOnly style={{ background: '#f3f4f6', cursor: 'not-allowed', borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>CANDIDATE EMAIL</span>} name="email">
                <Input readOnly style={{ background: '#f3f4f6', cursor: 'not-allowed', borderRadius: 6 }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>CANDIDATE CONTACT NUMBER</span>} 
                name="phone"
                rules={[{ validator: contactNumberValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>CURRENT LOCATION</span>} 
                name="location"
                rules={[{ validator: nonNumericValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
          </Row>

          {/* Section 2: Education & Experience */}
          <div style={{ marginBottom: 8, marginTop: 16 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Education & Experience</span>
            <div style={{ height: 1, background: '#e5e7eb', marginTop: 6 }} />
          </div>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>HIGHEST QUALIFICATION</span>} 
                name="education"
                rules={[{ validator: nonNumericValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>TOTAL EXPERIENCE (YEARS)</span>} 
                name="experience"
                rules={[{ validator: experienceValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
          </Row>

          {/* Section 3: Company & CTC */}
          <div style={{ marginBottom: 8, marginTop: 16 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Company & Salary Details</span>
            <div style={{ height: 1, background: '#e5e7eb', marginTop: 6 }} />
          </div>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 10, fontWeight: 600, color: '#4b5563' }}>CURRENT COMPANY NAME</span>} name={['currentCompany', 'Name']}>
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={<span style={{ fontSize: 10, fontWeight: 600, color: '#4b5563' }}>CURRENT COMPANY WEBSITE</span>} name={['currentCompany', 'Website']}>
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>EXPECTED CTC (LPA)</span>} 
                name="expectedCTC"
                rules={[{ validator: decimalFieldValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>CURRENT CTC (LPA)</span>} 
                name="currentCTC"
                rules={[{ validator: decimalFieldValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item 
                label={<span style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>NOTICE PERIOD (DAYS)</span>} 
                name="noticePeriod"
                rules={[{ validator: noticePeriodValidator }]}
              >
                <Input style={{ borderRadius: 6 }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}
