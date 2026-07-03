/**
 * TopRolesSkillsCard — two compact horizontal bar charts: top applied roles and most
 * in-demand skills, aggregated client-side from the candidate batch. Toggle between them.
 */
import { useMemo, useState } from 'react';
import { Card, Typography, Segmented, Empty } from 'antd';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { topByField, topSkills } from '../../utils/dashboardAggregations';

const { Title, Text } = Typography;

const ROLE_COLORS = ['#7a922e', '#2563eb', '#d97706', '#16a34a', '#e11d48', '#4f46e5', '#0891b2', '#b45309'];

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function BarTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="dash-chart-tip">
      <div className="dash-chart-tip__label">{p.name}</div>
      <div className="dash-chart-tip__value">{p.value} candidate{p.value === 1 ? '' : 's'}</div>
    </div>
  );
}

export default function TopRolesSkillsCard({ candidates = [] }) {
  const [mode, setMode] = useState('roles');
  const roles = useMemo(() => topByField(candidates, 'position', 7), [candidates]);
  const skills = useMemo(() => topSkills(candidates, 8), [candidates]);

  const data = mode === 'roles' ? roles : skills;

  return (
    <Card bordered={false} className="glass-card dash-chart-card" styles={{ body: { padding: 22 } }}>
      <div className="dash-card-head">
        <div>
          <Title level={5} style={{ margin: 0 }}>Talent Insights</Title>
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            {mode === 'roles' ? 'Top applied roles' : 'Most in-demand skills'}
          </Text>
        </div>
        <Segmented
          size="small"
          value={mode}
          onChange={setMode}
          options={[{ label: 'Roles', value: 'roles' }, { label: 'Skills', value: 'skills' }]}
        />
      </div>

      <div style={{ height: 250, marginTop: 12 }}>
        {data.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`No ${mode} data`} style={{ paddingTop: 64 }} />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 4 }}>
              <XAxis type="number" hide allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="name"
                width={120}
                tick={{ fontSize: 11.5, fill: 'var(--text)' }}
                tickLine={false}
                axisLine={false}
              />
              <RTooltip content={<BarTip />} cursor={{ fill: 'var(--gold-subtle)' }} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]} isAnimationActive={!prefersReducedMotion()} animationDuration={800} barSize={16}>
                {data.map((_, i) => (
                  <Cell key={i} fill={ROLE_COLORS[i % ROLE_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}