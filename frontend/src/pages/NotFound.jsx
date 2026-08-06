/**
 * NotFound — 404 page with fun illustration and navigation back to home.
 */
import { useNavigate } from 'react-router-dom';
import { Button, Typography, Space } from 'antd';
import { HomeOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div
      className="animate-fade-in"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 'calc(100vh - 160px)',
        textAlign: 'center',
        padding: 40,
      }}
    >
      {/* Large 404 */}
      <div
        style={{
          fontSize: 140,
          fontWeight: 800,
          lineHeight: 1,
          fontFamily: "'DM Mono', monospace",
          background: 'var(--gradient-primary)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          marginBottom: 8,
          opacity: 0.9,
          animation: 'float 4s ease-in-out infinite',
        }}
      >
        404
      </div>

      <Space direction="vertical" size={8} align="center">
        <Title level={3} style={{ margin: 0, fontWeight: 700 }}>
          Page Not Found
        </Title>
        <Text type="secondary" style={{ fontSize: 15, maxWidth: 400 }}>
          Oops! The page you're looking for seems to have taken an unscheduled break.
          Maybe it's out interviewing candidates? 🤷
        </Text>
      </Space>

      <Button
        type="primary"
        icon={<HomeOutlined />}
        size="large"
        onClick={() => navigate('/dashboard')}
        style={{
          marginTop: 32,
          borderRadius: 10,
          height: 48,
          paddingInline: 32,
          fontWeight: 600,
        }}
      >
        Back to Dashboard
      </Button>
    </div>
  );
}
