import MetricInfo from '../common/MetricInfo';
/**
 * ActionCenterCard — "Needs your attention": the recruiter's actionable queue, each row
 * deep-links into the relevant screen. Counts are sourced from data already loaded:
 *  - pending MRF approvals (mrf list)
 *  - duplicates to review (live socket count, passed in)
 *  - candidates awaiting screening (funnel.sourced − funnel.aiScreened)
 *  - interviews scheduled today (Zeko pipeline)
 */
import { Typography, Tooltip } from 'antd';
import {
  FileTextOutlined,
  BranchesOutlined,
  FilterOutlined,
  CalendarOutlined,
  ArrowRightOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { Surface } from '../../ui';

const { Title, Text } = Typography;

export default function ActionCenterCard({
  pendingMrfCount = 0,
  reviewCount = 0,
  awaitingScreening = 0,
  interviewsToday = 0,
  onNavigate,
}) {
  const items = [
    // `pendingMrfCount` now comes from the server's approval_status = pending count.
    // It was previously the LENGTH of a list fetched with status=pending, which mapped
    // onto `mrfstatus` (submission state) rather than approval state and was capped at
    // 50 — see dashboard.service.js getStats().
    // Each `desc` names both what the number counts and the screen the row opens —
    // "Click to open" alone never said where you were about to be taken.
    { key: 'mrf', label: 'MRFs awaiting approval', desc: 'Requisitions submitted but not yet approved or declined. Opens MRF Requests.', count: pendingMrfCount, icon: <FileTextOutlined />, color: 'var(--skill-3)', url: '/mrf' },
    { key: 'dup', label: 'Duplicates to review', desc: 'CVs flagged as possible duplicates of someone already on file. Opens Search Candidates.', count: reviewCount, icon: <BranchesOutlined />, color: 'var(--skill-7)', url: '/candidates', live: true },
    { key: 'screen', label: 'Awaiting screening', desc: 'Candidates on file that the AI has not scored yet. Opens Candidate Screening.', count: awaitingScreening, icon: <FilterOutlined />, color: 'var(--skill-5)', url: '/filtering' },
    { key: 'interview', label: 'Interviews today', desc: 'Interviews with a start time falling today. Opens Recruitment Analytics.', count: interviewsToday, icon: <CalendarOutlined />, color: 'var(--skill-2)', url: '/analytics' },
  ];

  const allClear = items.every((i) => !i.count);

  return (
    <Surface tier={2} className="dash-chart-card">
      <div className="dash-card-head">
        <div>
          <Title level={5} className="cmp-flush">Needs Your Attention <MetricInfo metric="actionCentre" size={12} /></Title>
          <Text type="secondary" className="cmp-sub">Your actionable queue</Text>
        </div>
      </div>

      <div className="cmp-stack--gap">
        {allClear ? (
          <Tooltip title="No requisitions are waiting on approval, no duplicates need reviewing, every candidate on file has been screened, and there are no interviews scheduled for today.">
            <div className="dash-allclear">
              <CheckCircleOutlined />
              <span>All clear — nothing needs your attention right now.</span>
            </div>
          </Tooltip>
        ) : (
          items.map((it) => (
            <Tooltip
              key={it.key}
              placement="left"
              title={it.count
                ? `${it.count} ${it.count === 1 ? 'item needs' : 'items need'} action. ${it.desc}`
                : `Nothing waiting here. ${it.desc}`}
            >
              <div
                className={`dash-action-row ${it.count ? 'has-count' : 'is-empty'}`}
                onClick={() => onNavigate?.(it.url)}
                style={{ '--row-color': it.color }}
              >
                <span className="dash-action-row__icon">
                  {it.icon}
                </span>
                <span className="dash-action-row__label">
                  {it.label}
                  {it.live && <span className="live-badge cmp-ml-2"><span className="live-badge__dot" />LIVE</span>}
                </span>
                <span className={'dash-action-row__count' + (it.count ? ' dash-action-row__count--on' : '')}>
                  {it.count}
                </span>
                <ArrowRightOutlined className="dash-action-row__arrow" />
              </div>
            </Tooltip>
          ))
        )}
      </div>
    </Surface>
  );
}