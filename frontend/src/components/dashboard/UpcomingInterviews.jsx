import MetricInfo from '../common/MetricInfo';
/**
 * UpcomingInterviews — next-7-days agenda of Zeko interviews AND Teams
 * interviews (GET /dashboard/upcoming-interviews). "Today" rows are highlighted.
 *
 * N36: it used to read the Zeko list only (no Teams interviews) and every row
 * opened Analytics. Each row now opens that candidate's drawer on the pipeline
 * board (/pipeline?candidate=<pipeline id>).
 */
import { Card, Typography, Empty, Tooltip, Avatar, Tag } from 'antd';
import { ClockCircleOutlined, ArrowRightOutlined } from '@ant-design/icons';
import { fmtDateTime, fmtTime, istDateParts } from '../../utils/dateFormat';

const { Title, Text } = Typography;

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
/** Whole India-time days since the epoch — for "Today" / "Tomorrow" / "In N days". */
const istDayNumber = (value) => Math.floor((new Date(value).getTime() + IST_OFFSET_MS) / DAY_MS);

function initials(name = '') {
  return name.split(' ').map((n) => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
}

/** True when the interview starts on today's India-time date. */
export const isTodayIst = (value) => istDayNumber(value) === istDayNumber(Date.now());

export default function UpcomingInterviews({ items = [], onNavigate }) {
  const today = istDayNumber(Date.now());
  const open = (it) => onNavigate?.(it.pipelineId ? `/pipeline?candidate=${it.pipelineId}` : '/pipeline');

  return (
    <Card bordered={false} className="glass-card dash-chart-card" styles={{ body: { padding: 22 } }}>
      <div className="dash-card-head">
        <div>
          <Title level={5} style={{ margin: 0 }}>Upcoming Interviews <MetricInfo metric="upcomingInterviews" size={12} /></Title>
          <Text type="secondary" style={{ fontSize: 12.5 }}>Next 7 days · Zeko and Teams</Text>
        </div>
        <Tooltip title="Open the Candidate Pipeline board.">
          <span className="dash-card-link" onClick={() => onNavigate?.('/pipeline')}>
            View all <ArrowRightOutlined />
          </span>
        </Tooltip>
      </div>

      <div className="dash-agenda">
        {items.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No interviews scheduled" style={{ paddingTop: 40 }} />
        ) : (
          items.slice(0, 6).map((it) => {
            const badge = istDateParts(it.startAt);
            const daysOut = istDayNumber(it.startAt) - today;
            const isToday = daysOut === 0;
            const whenWord = isToday ? 'Today' : daysOut === 1 ? 'Tomorrow' : `In ${daysOut} days`;
            const typeLabel = it.type === 'teams' ? 'Teams' : 'Zeko';
            /* The row ellipsises both the name and the role and abbreviates the date to
               "12 Aug" — every one of those truncations is recoverable here. */
            const rowTip = (
              <span>
                <strong>{it.candidateName || 'Candidate'}</strong>
                <br />
                {it.role || 'Role not recorded'} · {it.round}
                <br />
                {whenWord} · {fmtDateTime(it.startAt)}
                <br />
                <em>{it.pipelineId ? 'Click to open this candidate on the pipeline board' : 'Click to open the pipeline board'}</em>
              </span>
            );
            return (
              <Tooltip key={it.key} title={rowTip} placement="left">
                <div
                  className={`dash-agenda__row ${isToday ? 'is-today' : ''}`}
                  onClick={() => open(it)}
                  data-testid={`upcoming-${it.key}`}
                >
                  <div className="dash-agenda__date">
                    <span className="dash-agenda__day">{badge?.day}</span>
                    <span className="dash-agenda__mon">{badge?.month}</span>
                  </div>
                  <Avatar size={34} style={{ background: 'linear-gradient(135deg, var(--gold) 0%, var(--green) 100%)', color: '#fff', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                    {initials(it.candidateName || '')}
                  </Avatar>
                  <div className="dash-agenda__body">
                    <Text className="dash-agenda__name" ellipsis>{it.candidateName || 'Candidate'}</Text>
                    <Text type="secondary" className="dash-agenda__role" ellipsis>{it.round}{it.role ? ` · ${it.role}` : ''}</Text>
                  </div>
                  <div className="dash-agenda__time">
                    {isToday && <span className="dash-agenda__today">TODAY</span>}
                    <Tag color={it.type === 'teams' ? 'blue' : 'purple'} style={{ marginInlineEnd: 0, fontSize: 10.5 }}>{typeLabel}</Tag>
                    <span className="mono"><ClockCircleOutlined /> {fmtTime(it.startAt)}</span>
                  </div>
                </div>
              </Tooltip>
            );
          })
        )}
      </div>
    </Card>
  );
}
