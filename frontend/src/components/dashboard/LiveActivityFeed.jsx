import MetricInfo from '../common/MetricInfo';
/**
 * LiveActivityFeed — presentational real-time feed. Receives events from useLiveActivity
 * (socket). Shows a live pulse and a graceful "listening" state before anything arrives.
 */
import { Card, Typography, Tooltip } from 'antd';
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
          <Title level={5} style={{ margin: 0 }}>Live Activity <MetricInfo metric="liveActivity" size={12} /></Title>
          <Text type="secondary" style={{ fontSize: 12.5 }}>Real-time pipeline events</Text>
        </div>
        <Tooltip title="Connected. New events appear here the moment they happen, with no need to refresh.">
          <span className="live-badge"><span className="live-badge__dot" />LIVE</span>
        </Tooltip>
      </div>

      <div className="dash-feed">
        {events.length === 0 ? (
          <Tooltip title="Nothing has happened since you opened this page. This is a live ticker rather than a history — as soon as someone uploads a CV or makes a screening decision, it will show up here.">
            <div className="dash-feed__idle">
              <span className="dash-feed__radar" />
              <Text type="secondary" style={{ fontSize: 12.5 }}>Listening for new uploads & reviews…</Text>
            </div>
          </Tooltip>
        ) : (
          /* Rows ellipsis their title and show a relative time, so both the full text
             and the actual clock time are only reachable on hover. */
          events.map((e) => (
            <Tooltip
              key={e.id}
              placement="left"
              title={(
                <span>
                  <strong>{e.title}</strong>
                  {e.detail ? <><br />{e.detail}</> : null}
                  <br />
                  {new Date(e.at).toLocaleString(undefined, {
                    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              )}
            >
              <div className={`dash-feed__row tone-${e.tone || 'info'}`}>
                <span className="dash-feed__icon">
                  {e.tone === 'success' ? <CheckCircleOutlined /> : e.tone === 'warning' ? <WarningOutlined /> : (ICON[e.type] || <CloudUploadOutlined />)}
                </span>
                <div className="dash-feed__body">
                  <Text className="dash-feed__title" ellipsis>{e.title}</Text>
                  <Text type="secondary" className="dash-feed__detail">{e.detail}</Text>
                </div>
                <Text type="secondary" className="dash-feed__time">{timeAgo(e.at)}</Text>
              </div>
            </Tooltip>
          ))
        )}
      </div>
    </Card>
  );
}