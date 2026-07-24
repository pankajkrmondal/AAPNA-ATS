/**
 * RecruiterBreakdownCard — grouped horizontal bar chart: candidates ADDED
 * (uploaded) vs SHORTLISTED to a role, two bars per recruiter. Backend
 * resolves both rpa_cv.last_action_by (email) and
 * rpa_shortlisted_candidates.shortlisted_by (username) against rpa_users so
 * the two counts land on the same row for the same person, with a real
 * display name — see dashboard.service.js's getRecruiterBreakdown().
 * Full-database counts via GET /api/dashboard/recruiter-breakdown.
 */
import { Card, Typography, Tooltip, Empty } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';

const { Title, Text } = Typography;

const ADDED_COLOR = '#7a922e';
const SHORTLISTED_COLOR = '#2563eb';

// Special-case labels that aren't real recruiter names — explained on hover
// rather than hidden, so the chart stays honest about what the data covers.
const LABEL_EXPLANATIONS = {
  'Unattributed': 'No uploader on record — mostly legacy candidates imported before this system tracked who added them.',
  'Self Applied': 'Candidate applied directly (e.g. via email intake), not uploaded by a recruiter.',
};

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function BarTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const added = payload.find((p) => p.dataKey === 'added')?.value ?? 0;
  const shortlisted = payload.find((p) => p.dataKey === 'shortlisted')?.value ?? 0;
  const note = LABEL_EXPLANATIONS[label];
  return (
    <div className="dash-chart-tip">
      <div className="dash-chart-tip__label">{label}</div>
      <div className="dash-chart-tip__value" style={{ color: ADDED_COLOR }}>Added: {added}</div>
      <div className="dash-chart-tip__value" style={{ color: SHORTLISTED_COLOR }}>Shortlisted: {shortlisted}</div>
      {note && <div className="dash-chart-tip__note">{note}</div>}
    </div>
  );
}

export default function RecruiterBreakdownCard({ data = [] }) {
  // Grows with the number of recruiters so every row stays visible without scrolling.
  const chartHeight = Math.max(220, data.length * 46);

  return (
    <Card bordered={false} className="glass-card dash-chart-card" styles={{ body: { padding: 22 } }}>
      <div className="dash-card-head">
        <div>
          <Title level={5} style={{ margin: 0 }}>
            Recruiter Activity{' '}
            <Tooltip title="Added: candidates this person uploaded. Shortlisted: candidates this person shortlisted to a role. Matched to the same row wherever both can be resolved to the same account; full-database counts, not sampled.">
              <InfoCircleOutlined style={{ fontSize: 12, color: 'var(--text-3)' }} />
            </Tooltip>
          </Title>
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            Candidates added vs. shortlisted per recruiter
          </Text>
        </div>
      </div>

      <div style={{ height: chartHeight, marginTop: 12 }}>
        {data.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No recruiter activity yet" style={{ paddingTop: 64 }} />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 4 }} barCategoryGap="28%">
              <XAxis type="number" hide allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="recruiter"
                width={140}
                tick={{ fontSize: 11, fill: 'var(--text)' }}
                tickLine={false}
                axisLine={false}
              />
              <RTooltip content={<BarTip />} cursor={{ fill: 'var(--gold-subtle)' }} />
              <Legend
                verticalAlign="top"
                align="right"
                height={24}
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 11.5 }}
              />
              <Bar dataKey="added" name="Added" fill={ADDED_COLOR} radius={[0, 6, 6, 0]} barSize={12} isAnimationActive={!prefersReducedMotion()} animationDuration={800} />
              <Bar dataKey="shortlisted" name="Shortlisted" fill={SHORTLISTED_COLOR} radius={[0, 6, 6, 0]} barSize={12} isAnimationActive={!prefersReducedMotion()} animationDuration={800} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
