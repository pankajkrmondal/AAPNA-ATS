/**
 * Sparkline — a tiny gradient area chart for KPI cards. Pure presentational; takes an
 * array of numbers. Renders nothing when there's no meaningful series.
 */
import { Area, AreaChart, ResponsiveContainer } from 'recharts';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function Sparkline({ data = [], color = '#7a922e', height = 34 }) {
  const series = (data || []).map((v, i) => ({ i, v: Number(v) || 0 }));
  const hasSignal = series.some((p) => p.v > 0);
  if (series.length < 2 || !hasSignal) return null;

  const gid = `spark-${color.replace('#', '')}`;
  return (
    <div style={{ width: '100%', height }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gid})`}
            isAnimationActive={!prefersReducedMotion()}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}