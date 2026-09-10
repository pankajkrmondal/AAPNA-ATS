/**
 * NotFound — 404 page with fun illustration and navigation back to home.
 */
import { useNavigate } from 'react-router-dom';
import { Typography, Space } from 'antd';
import { Button } from '../ui';
import { HomeOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div
      className="animate-fade-in nf-page"
    >
      {/* Large 404 */}
      <div
        className="nf-code"
      >
        404
      </div>

      <Space direction="vertical" size={8} align="center">
        <Title level={3} className="cmp-flush--strong">
          Page Not Found
        </Title>
        <Text type="secondary" className="nf-body">
          Oops! The page you're looking for seems to have taken an unscheduled break.
          Maybe it's out interviewing candidates? 🤷
        </Text>
      </Space>

      <Button
        emphasis="solid"
        icon={<HomeOutlined />}
        size="lg"
        onClick={() => navigate('/dashboard')}
        className="nf-cta"
      >
        Back to Dashboard
      </Button>
    </div>
  );
}
