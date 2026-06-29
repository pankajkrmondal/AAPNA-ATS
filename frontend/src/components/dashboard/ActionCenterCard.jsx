/**
 * ActionCenterCard — "Needs your attention": the recruiter's actionable queue, each row
 * deep-links into the relevant screen. Counts are sourced from data already loaded:
 *  - pending MRF approvals (mrf list)
 *  - duplicates to review (live socket count, passed in)
 *  - candidates awaiting screening (funnel.sourced − funnel.aiScreened)
 *  - interviews scheduled today (Zeko pipeline)
 */
import { Card, Typography, Tooltip } from 'antd';
import {
  FileTextOutlined,
  BranchesOutlined,
  FilterOutlined,
  CalendarOutlined,
  ArrowRightOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';

const { Title, Text } = Typography;

export default function ActionCenterCard({
  pendingMrfCount = 0,
  reviewCount = 0,
  awaitingScreening = 0,
  interviewsToday = 0,
  onNavigate,
}) {
  const items = [
    { key: 'mrf', label: 'MRFs pending approval', count: pendingMrfCount, icon: <FileTextOutlined />, color: '#2563eb', url: '/mrf' },
    { key: 'dup', label: 'Duplicates to review', count: reviewCount, icon: <BranchesOutlined />, color: '#e11d48', url: '/candidates', live: true },
    { key: 'screen', label: 'Awaiting screening', count: awaitingScreening, icon: <FilterOutlined />, color: '#d97706', url: '/filtering' },
    { key: 'interview', label: 'Interviews today', count: interviewsToday, icon: <CalendarOutlined />, color: '#16a34a', url: '/analytics' },
  ];

  const allClear = items.every((i) => !i.count);

  return (
    <Card bordered={false} className="glass-card dash-chart-card" styles={{ body: { padding: 22 } }}>
      <div className="dash-card-head">
        <div>
          <Title level={5} style={{ margin: 0 }}>Needs Your Attention</Title>
          <Text type="secondary" style={{ fontSize: 12.5 }}>Your actionable queue</Text>
        </div>
      </div>

      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {allClear ? (
          <div className="dash-allclear">
            <CheckCircleOutlined />
            <span>All clear — nothing needs your attention right now.</span>
          </div>
        ) : (
          items.map((it) => (
            <Tooltip key={it.key} title={`Open ${it.label.toLowerCase()}`} placement="left">
              <div
                className={`dash-action-row ${it.count ? 'has-count' : 'is-empty'}`}
                onClick={() => onNavigate?.(it.url)}
                style={{ '--row-color': it.color }}
              >
                <span className="dash-action-row__icon" style={{ background: `${it.color}1a`, color: it.color }}>
                  {it.icon}
                </span>
                <span className="dash-action-row__label">
                  {it.label}
                  {it.live && <span className="live-badge" style={{ marginLeft: 8 }}><span className="live-badge__dot" />LIVE</span>}
                </span>
                <span className="dash-action-row__count" style={{ color: it.count ? it.color : 'var(--text-3)' }}>
                  {it.count}
                </span>
                <ArrowRightOutlined className="dash-action-row__arrow" />
              </div>
            </Tooltip>
          ))
        )}
      </div>
    </Card>
  );
}