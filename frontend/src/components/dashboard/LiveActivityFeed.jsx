/**
 * LiveActivityFeed — presentational real-time feed. Receives events from useLiveActivity
 * (socket). Shows a live pulse and a graceful "listening" state before anything arrives.
 */
import { Card, Typography, Empty } from 'antd';
import {
  CloudUploadOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';

const { Title, Text } = Typography;

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

const ICON = {
  upload: <CloudUploadOutlined />,
  review: <BranchesOutlined />,
};

export default function LiveActivityFeed({ events = [] }) {
  return (
    <Card bordered={false} className="glass-card dash-chart-card" styles={{ body: { padding: 22 } }}>
      <div className="dash-card-head">
        <div>
          <Title level={5} style={{ margin: 0 }}>Live Activity</Title>
          <Text type="secondary" style={{ fontSize: 12.5 }}>Real-time pipeline events</Text>
        </div>
        <span className="live-badge"><span className="live-badge__dot" />LIVE</span>
      </div>

      <div className="dash-feed">
        {events.length === 0 ? (
          <div className="dash-feed__idle">
            <span className="dash-feed__radar" />
            <Text type="secondary" style={{ fontSize: 12.5 }}>Listening for new uploads & reviews…</Text>
          </div>
        ) : (
          events.map((e) => (
            <div key={e.id} className={`dash-feed__row tone-${e.tone || 'info'}`}>
              <span className="dash-feed__icon">
                {e.tone === 'success' ? <CheckCircleOutlined /> : e.tone === 'warning' ? <WarningOutlined /> : (ICON[e.type] || <CloudUploadOutlined />)}
              </span>
              <div className="dash-feed__body">
                <Text className="dash-feed__title" ellipsis>{e.title}</Text>
                <Text type="secondary" className="dash-feed__detail">{e.detail}</Text>
              </div>
              <Text type="secondary" className="dash-feed__time">{timeAgo(e.at)}</Text>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}