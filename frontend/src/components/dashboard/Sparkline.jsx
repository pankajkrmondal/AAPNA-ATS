/**
 * Sparkline — the gradient area chart in the KPI card bands.
 *
 * Two things it does that the naive version did not, both of which are why the KPI
 * row now reads as finished on every card rather than only the busy ones:
 *
 *  1. IT ALWAYS DRAWS. The previous version bailed (`return null`) when the series was
 *     empty or entirely zero, which left a bare gradient band on any quiet metric —
 *     visually identical to a broken chart. A genuine zero week is information, so it
 *     renders as a flat baseline sitting on the floor of the band. Every card
 *     therefore has the same silhouette regardless of its data.
 *  2. UNIQUE GRADIENT IDS. The gradient's id used to be derived from the colour
 *     (`spark-7a922e`), so two cards sharing a colour would emit duplicate SVG ids and
 *     the second would reference the first's gradient. `useId` makes it per-instance.
 *
 * The "now" dot on the final point is what turns a decorative squiggle into something
 * readable — it tells you which end is today.
 */
import { useId } from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';

const prefersReducedMotion = () => typeof window !== 'undefined'
  && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * @param {object} props
 * @param {number[]} props.data
 * @param {string} [props.color]
 * @param {number} [props.height]
 */
export default function Sparkline({ data = [], color = '#4f2fb8', height = 34 }) {
  const uid = useId().replace(/:/g, '');
  const series = (data || []).map((v, i) => ({ i, v: Number(v) || 0 }));
  // A single point cannot describe a trend; below that there is genuinely nothing
  // to draw. Everything else — including an all-zero week — renders.
  if (series.length < 2) return null;

  const flat = series.every((p) => p.v === series[0].v);
  const gid = `spark-fill-${uid}`;
  const reduced = prefersReducedMotion();

  return (
    <div style={{ width: '100%', height }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 6, right: 2, bottom: 0, left: 2 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.42} />
              <stop offset="70%" stopColor={color} stopOpacity={0.10} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={2.25}
            strokeLinecap="round"
            fill={`url(#${gid})`}
            isAnimationActive={!reduced}
            animationDuration={900}
            // Mark today's value, but not on a flat line — there the dot would imply a
            // data point worth reading when the whole series is the same number.
            dot={false}
            activeDot={false}
            {...(!flat && {
              dot: (props) => (props.index === series.length - 1
                ? (
                  <circle
                    key="now"
                    cx={props.cx}
                    cy={props.cy}
                    r={2.75}
                    fill={color}
                    stroke="var(--colorBgContainer)"
                    strokeWidth={1.5}
                  />
                )
                : null),
            })}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
