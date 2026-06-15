/**
 * CandidateDetail Page — Tabbed detail view for a single candidate.
 * Placeholder tabs: Profile, Resume, AI Insights, Emails, Timeline.
 */
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Tabs, Typography, Button, Avatar, Space, Tag, Row, Col, Descriptions, Empty, Timeline } from 'antd';
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
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';

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
  currentCompany: 'TechCorp Solutions',
  noticePeriod: '30 days',
  expectedCTC: '₹28 LPA',
};

export default function CandidateDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: candidate, isLoading } = useQuery({
    queryKey: ['candidate', id],
    queryFn: () => candidateService.getById(id).then((r) => r.data),
    placeholderData: MOCK_CANDIDATE,
    retry: false,
  });

  const data = candidate || MOCK_CANDIDATE;

  if (isLoading) {
    return <LoadingSkeleton type="detail" />;
  }

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
            <Descriptions.Item label="Experience">{data.experience}</Descriptions.Item>
            <Descriptions.Item label="Current Company">{data.currentCompany}</Descriptions.Item>
            <Descriptions.Item label="Notice Period">{data.noticePeriod}</Descriptions.Item>
            <Descriptions.Item label="Expected CTC">{data.expectedCTC}</Descriptions.Item>
            <Descriptions.Item label="Education">{data.education}</Descriptions.Item>
          </Descriptions>

          <Card title="Professional Summary" size="small" bordered={false} style={{ background: 'var(--gold-subtle)', borderRadius: 12 }}>
            <Paragraph style={{ margin: 0, fontSize: 14, lineHeight: 1.8 }}>
              {data.summary}
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
              { color: '#005f56', children: <><Text strong>Resume uploaded</Text><br /><Text type="secondary" style={{ fontSize: 12 }}>Jun 4, 2026 · 2:30 PM</Text></> },
              { color: '#007a6f', children: <><Text strong>AI screening completed</Text> — Score: 92%<br /><Text type="secondary" style={{ fontSize: 12 }}>Jun 4, 2026 · 2:31 PM</Text></> },
              { color: '#2980b9', children: <><Text strong>Shortlisted</Text> by HR Admin<br /><Text type="secondary" style={{ fontSize: 12 }}>Jun 4, 2026 · 3:15 PM</Text></> },
              { color: 'gray', children: <><Text type="secondary">Awaiting interview scheduling</Text></> },
            ]}
          />
        </div>
      ),
    },
  ];

  return (
    <div>
      {/* Back button */}
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate('/candidates')}
        style={{ marginBottom: 16, borderRadius: 8, fontWeight: 500 }}
      >
        Back to Candidates
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
            <Button type="primary" icon={<EditOutlined />} style={{ borderRadius: 8 }}>
              Edit
            </Button>
          </Col>
        </Row>
      </Card>

      {/* Tabbed content */}
      <Card bordered={false} className="glass-card" styles={{ body: { padding: '4px 24px 24px' } }}>
        <Tabs items={tabItems} defaultActiveKey="profile" />
      </Card>
    </div>
  );
}
