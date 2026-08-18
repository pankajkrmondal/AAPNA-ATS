import MetricInfo from '../common/MetricInfo';
/**
 * UpcomingInterviews — next-7-days agenda derived from the Zeko pipeline
 * (rows with a future interview_start_at). "Today" rows are highlighted.
 */
import { useMemo } from 'react';
import { Card, Typography, Empty, Tooltip, Avatar } from 'antd';
import { CalendarOutlined, ClockCircleOutlined, ArrowRightOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { upcomingInterviews } from '../../utils/dashboardAggregations';

const { Title, Text } = Typography;

function initials(name = '') {
  return name.split(' ').map((n) => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
}

export default function UpcomingInterviews({ pipeline = [], onNavigate }) {
  const items = useMemo(() => upcomingInterviews(pipeline, 7), [pipeline]);
  const todayKey = dayjs().format('YYYY-MM-DD');

  return (
    <Card bordered={false} className="glass-card dash-chart-card" styles={{ body: { padding: 22 } }}>
      <div className="dash-card-head">
        <div>
          <Title level={5} style={{ margin: 0 }}>Upcoming Interviews <MetricInfo metric="upcomingInterviews" size={12} /></Title>
          <Text type="secondary" style={{ fontSize: 12.5 }}>Next 7 days</Text>
        </div>
        <Tooltip title="Open Recruitment Analytics to see the full interview schedule and pipeline.">
          <span className="dash-card-link" onClick={() => onNavigate?.('/analytics')}>
            View all <ArrowRightOutlined />
          </span>
        </Tooltip>
      </div>

      <div className="dash-agenda">
        {items.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No interviews scheduled" style={{ paddingTop: 40 }} />
        ) : (
          items.slice(0, 6).map((it) => {
            const when = dayjs(it._when);
            const isToday = when.format('YYYY-MM-DD') === todayKey;
            // Days out, without needing dayjs's relativeTime plugin (not registered
            // in this app) — the row already shows the date, this names the distance.
            const daysOut = when.startOf('day').diff(dayjs().startOf('day'), 'day');
            const whenWord = isToday ? 'Today' : daysOut === 1 ? 'Tomorrow' : `In ${daysOut} days`;
            /* The row ellipsises both the name and the role and abbreviates the date to
               "12 Aug" — every one of those truncations is recoverable here. */
            const rowTip = (
              <span>
                <strong>{it.candidate_name || 'Candidate'}</strong>
                <br />
                {it.job_title || it.role || it.pipeline_status || 'Role not recorded'}
                <br />
                {whenWord} · {when.format('dddd D MMMM, h:mm A')}
                <br />
                <em>Click to open Recruitment Analytics</em>
              </span>
            );
            return (
              <Tooltip
                key={it.id || `${it.candidate_email}-${it._when}`}
                title={rowTip}
                placement="left"
              >
                <div
                  className={`dash-agenda__row ${isToday ? 'is-today' : ''}`}
                  onClick={() => onNavigate?.('/analytics')}
                >
                  <div className="dash-agenda__date">
                    <span className="dash-agenda__day">{when.format('DD')}</span>
                    <span className="dash-agenda__mon">{when.format('MMM')}</span>
                  </div>
                  <Avatar size={34} style={{ background: 'linear-gradient(135deg, var(--gold) 0%, var(--green) 100%)', color: '#fff', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                    {initials(it.candidate_name)}
                  </Avatar>
                  <div className="dash-agenda__body">
                    <Text className="dash-agenda__name" ellipsis>{it.candidate_name || 'Candidate'}</Text>
                    <Text type="secondary" className="dash-agenda__role" ellipsis>{it.job_title || it.role || it.pipeline_status || '—'}</Text>
                  </div>
                  <div className="dash-agenda__time">
                    {isToday && <span className="dash-agenda__today">TODAY</span>}
                    <span className="mono"><ClockCircleOutlined /> {when.format('hh:mm A')}</span>
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