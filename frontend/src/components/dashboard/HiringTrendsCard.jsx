/**
 * HiringTrendsCard — animated gradient area chart of new candidates added per day over the
 * selected date-range (client-bucketed from the candidate batch). Honest label: it reflects
 * candidates entering the system, the one time-series we can derive frontend-only.
 */
import { useMemo } from 'react';
import { Card, Typography, Tooltip, Empty } from 'antd';
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

const { Title, Text } = Typography;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="dash-chart-tip">
      <div className="dash-chart-tip__label">{label}</div>
      <div className="dash-chart-tip__value">{payload[0].value} added</div>
    </div>
  );
}

export default function HiringTrendsCard({ candidates = [], rangeDays = 30, loading = false }) {
  const data = useMemo(() => bucketByDay(candidates, rangeDays), [candidates, rangeDays]);
  const total = useMemo(() => data.reduce((s, d) => s + d.count, 0), [data]);
  const peak = useMemo(() => data.reduce((m, d) => Math.max(m, d.count), 0), [data]);

  return (
    <Card bordered={false} className="glass-card dash-chart-card" styles={{ body: { padding: 22 } }}>
      <div className="dash-card-head">
        <div>
          <Title level={5} style={{ margin: 0 }}>Hiring Trends</Title>
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            New candidates added · last {rangeDays} days
          </Text>
        </div>
        <Tooltip title="Daily count of candidates entering the system over the selected range.">
          <div className="dash-card-metric">
            <span className="dash-card-metric__num">{total.toLocaleString()}</span>
            <span className="dash-card-metric__cap">total <InfoCircleOutlined /></span>
          </div>
        </Tooltip>
      </div>

      <div style={{ height: 240, marginTop: 8 }}>
        {!loading && total === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No candidates in this range" style={{ paddingTop: 60 }} />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7a922e" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#7a922e" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: 'var(--text-2)' }}
                interval={Math.max(0, Math.floor(data.length / 7) - 1)}
                tickLine={false}
                axisLine={{ stroke: 'var(--border-light)' }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--text-2)' }}
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
                stroke="#7a922e"
                strokeWidth={2.5}
                fill="url(#trendFill)"
                isAnimationActive={!prefersReducedMotion()}
                animationDuration={900}
                dot={false}
                activeDot={{ r: 4, fill: '#7a922e', stroke: '#fff', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}