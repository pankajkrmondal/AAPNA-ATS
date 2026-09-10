import MetricInfo from '../common/MetricInfo';
/**
 * HiringTrendsCard — animated gradient area chart of new candidates added per day over the
 * selected date-range (client-bucketed from the candidate batch). Honest label: it reflects
 * candidates entering the system, the one time-series we can derive frontend-only.
 */
import { useMemo } from 'react';
import { Typography, Tooltip, Empty } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { bucketByDay } from '../../utils/dashboardAggregations';
import { Surface } from '../../ui';
import { CHART_TICK_SIZE } from '../../constants/chartType';

const { Title, Text } = Typography;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const n = payload[0].value;
  return (
    <div className="dash-chart-tip">
      <div className="dash-chart-tip__label">{label}</div>
      <div className="dash-chart-tip__value">
        {n === 0 ? 'No candidates added' : `${n} candidate${n === 1 ? '' : 's'} added`}
      </div>
    </div>
  );
}

export default function HiringTrendsCard({ candidates = [], rangeDays = 30, role = '', loading = false }) {
  const data = useMemo(() => bucketByDay(candidates, rangeDays), [candidates, rangeDays]);
  const total = useMemo(() => data.reduce((s, d) => s + d.count, 0), [data]);
  const peak = useMemo(() => data.reduce((m, d) => Math.max(m, d.count), 0), [data]);

  return (
    <Surface tier={2} className="dash-chart-card">
      <div className="dash-card-head">
        <div>
          <Title level={5} className="cmp-flush">Hiring Trends <MetricInfo metric="hiringTrends" size={12} /></Title>
          {/* Naming the active role here, not just in the picker, is what tells the
              reader why the shape of the chart just changed under them. */}
          <Text type="secondary" className="cmp-sub">
            New candidates added · last {rangeDays} days{role ? ` · ${role}` : ''}
          </Text>
        </div>
        <Tooltip title={`${total.toLocaleString()} candidates were added in the last ${rangeDays} days — the sum of every day on this chart. Hover a point to see a single day; busiest day so far is ${peak}.`}>
          <div className="dash-card-metric">
            <span className="dash-card-metric__num">{total.toLocaleString()}</span>
            <span className="dash-card-metric__cap">total <InfoCircleOutlined /></span>
          </div>
        </Tooltip>
      </div>
      {/* The "based on the 200 most recently added profiles" caveat used to sit here as
          body copy. It is still true and still stated — it moved into this card's
          MetricInfo definition (constants/metricDefinitions.js `hiringTrends.caveat`),
          which is where every other metric's provenance lives. A permanent apology
          printed under the title read as clutter and drew the eye away from the data. */}
      <div className="cmp-chart--sm">
        {!loading && total === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No candidates in this range" className="cmp-empty-pad--md" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--brand-primary)" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="var(--brand-primary)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: CHART_TICK_SIZE, fill: 'var(--text-2)' }}
                interval={Math.max(0, Math.floor(data.length / 7) - 1)}
                tickLine={false}
                axisLine={{ stroke: 'var(--border-light)' }}
              />
              <YAxis
                tick={{ fontSize: CHART_TICK_SIZE, fill: 'var(--text-2)' }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                domain={[0, Math.max(4, peak + 1)]}
                width={42}
              />
              <RTooltip content={<ChartTip />} cursor={{ stroke: 'var(--gold)', strokeWidth: 1, strokeDasharray: '4 4' }} />
              <Area
                type="monotone"
                dataKey="count"
                stroke="var(--brand-primary)"
                strokeWidth={2.5}
                fill="url(#trendFill)"
                isAnimationActive={!prefersReducedMotion()}
                animationDuration={900}
                dot={false}
                activeDot={{ r: 4, fill: 'var(--brand-primary)', stroke: 'var(--brand-on-solid)', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Surface>
  );
}