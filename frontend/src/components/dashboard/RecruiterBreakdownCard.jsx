/**
 * RecruiterBreakdownCard — grouped horizontal bar chart: candidates ADDED
 * (uploaded) vs SHORTLISTED to a role, two bars per recruiter. Backend
 * resolves both rpa_cv.last_action_by (email) and
 * rpa_shortlisted_candidates.shortlisted_by (username) against rpa_users so
 * the two counts land on the same row for the same person, with a real
 * display name — see dashboard.service.js's getRecruiterBreakdown().
 * Full-database counts via GET /api/dashboard/recruiter-breakdown.
 */
import { Typography, Empty } from 'antd';
import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import MetricInfo from '../common/MetricInfo';
import { Surface } from '../../ui';
import { CHART_TICK_SIZE, CHART_LEGEND_SIZE } from '../../constants/chartType';

const { Title, Text } = Typography;

// The two series. Tokens rather than literals so the chart follows the brand and
// dark mode; SVG paint attributes resolve CSS variables.
const ADDED_COLOR = 'var(--brand-primary)';
const SHORTLISTED_COLOR = 'var(--skill-3)';

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
  // Share of what they added that they also put forward — the question the two bars
  // side by side are really asking, spelled out rather than left to be eyeballed.
  const rate = added > 0 ? Math.round((shortlisted / added) * 100) : null;
  return (
    <div className="dash-chart-tip">
      <div className="dash-chart-tip__label">{label}</div>
      <div className="dash-chart-tip__value rb-added">
        {added} candidate{added === 1 ? '' : 's'} added
      </div>
      <div className="dash-chart-tip__value rb-shortlisted">
        {shortlisted} shortlisted to a role
      </div>
      {rate !== null && (
        <div className="dash-chart-tip__note">{rate}% of what they added went forward</div>
      )}
      {note && <div className="dash-chart-tip__note">{note}</div>}
    </div>
  );
}

export default function RecruiterBreakdownCard({ data = [] }) {
  // Grows with the number of recruiters so every row stays visible without scrolling.
  const chartHeight = Math.max(220, data.length * 46);

  return (
    <Surface tier={2} className="dash-chart-card">
      <div className="dash-card-head">
        <div>
          {/* This used to be its own <Tooltip> with its own wording, which is how the
              same widget ended up explaining itself twice, differently. It now reads
              from the shared registry like every other widget on the page. */}
          <Title level={5} className="cmp-flush">
            Recruiter Activity <MetricInfo metric="recruiterActivity" size={12} />
          </Title>
          <Text type="secondary" className="cmp-sub">
            Candidates added vs. shortlisted per recruiter
          </Text>
        </div>
      </div>

      <div className="rb-chart" style={{ '--rb-h': typeof chartHeight === 'number' ? chartHeight + 'px' : chartHeight }}>
        {data.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No recruiter activity yet" className="cmp-empty-pad--lg" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 4 }} barCategoryGap="28%">
              <XAxis type="number" hide allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="recruiter"
                width={140}
                tick={{ fontSize: CHART_TICK_SIZE, fill: 'var(--text)' }}
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
                wrapperStyle={{ fontSize: CHART_LEGEND_SIZE }}
              />
              <Bar dataKey="added" name="Added" fill={ADDED_COLOR} radius={[0, 6, 6, 0]} barSize={12} isAnimationActive={!prefersReducedMotion()} animationDuration={800} />
              <Bar dataKey="shortlisted" name="Shortlisted" fill={SHORTLISTED_COLOR} radius={[0, 6, 6, 0]} barSize={12} isAnimationActive={!prefersReducedMotion()} animationDuration={800} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Surface>
  );
}
