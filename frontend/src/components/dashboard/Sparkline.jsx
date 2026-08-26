/**
 * Sparkline — the gradient area chart in the KPI card bands.
 *
 * Three things it does that the naive version did not, all of which are why the KPI
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
 *  3. IT ANSWERS A HOVER. Every other chart on the dashboard names its values when you
 *     point at them; these four did not, so the one graph on the busiest row of the
 *     page was the only undreadable one. Hovering now names the day and its value.
 *
 * WHY THE TOOLTIP IS ANT DESIGN'S AND NOT RECHARTS': the band that holds this chart is
 * 54px tall and `overflow: hidden` (it has to be — it bleeds to the card's rounded
 * bottom corners). A Recharts tooltip renders INSIDE the chart container, so it would
 * be clipped to that strip and mostly invisible. AntD's renders in a portal at body
 * level, so it escapes the band. Recharts still does the hit-testing — `onMouseMove`
 * hands us the active point and we drive the tooltip's content from it.
 *
 * The "now" dot on the final point is what turns a decorative squiggle into something
 * readable — it tells you which end is today.
 */
import { useId, useMemo, useRef, useState } from 'react';
import { Tooltip } from 'antd';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';

const prefersReducedMotion = () => typeof window !== 'undefined'
  && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * @param {object} props
 * @param {Array<number|{label?: string, value: number}>} props.data Bare counts or
 *   labelled points. Labelled points are preferred — they let the hover name the day.
 * @param {string} [props.color]
 * @param {number} [props.height]
 * @param {string} [props.unit] What one point counts, e.g. "added" — used in the hover
 *   readout and in the chart's accessible description.
 * @param {string} [props.summary] Plain-language description of the whole line, shown
 *   above the hovered value and read out to screen readers.
 */
export default function Sparkline({
  data = [],
  color = '#7a922e',
  height = 34,
  unit = '',
  summary = '',
}) {
  const uid = useId().replace(/:/g, '');
  const wrapRef = useRef(null);
  const [hovered, setHovered] = useState(null);
  // Horizontal nudge so the readout sits over the point being pointed at rather than
  // dead-centre over the card. AntD anchors to the whole 54px band, so without this a
  // reader sweeping a 90-day line watches a stationary label while the dot moves.
  const [offsetX, setOffsetX] = useState(0);

  const trackPoint = (state) => {
    const idx = state?.activeTooltipIndex;
    if (typeof idx !== 'number' || idx < 0) {
      setHovered(null);
      return;
    }
    setHovered(idx);
    const width = wrapRef.current?.offsetWidth || 0;
    const x = state?.activeCoordinate?.x;
    if (width && typeof x === 'number') setOffsetX(Math.round(x - width / 2));
  };

  // Accept both shapes: a bare number series (legacy callers) and labelled points.
  const series = useMemo(
    () => (data || []).map((d, i) => (typeof d === 'object' && d !== null
      ? { i, v: Number(d.value) || 0, label: d.label || '' }
      : { i, v: Number(d) || 0, label: '' })),
    [data],
  );

  // A single point cannot describe a trend; below that there is genuinely nothing
  // to draw. Everything else — including an all-zero week — renders.
  if (series.length < 2) return null;

  const flat = series.every((p) => p.v === series[0].v);
  const gid = `spark-fill-${uid}`;
  const reduced = prefersReducedMotion();

  const point = hovered !== null ? series[hovered] : null;
  const tip = point && (
    <span style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
      {point.label && <strong>{point.label}</strong>}
      {point.label ? ' · ' : ''}
      {point.v.toLocaleString()}{unit ? ` ${unit}` : ''}
    </span>
  );

  return (
    <Tooltip
      title={tip}
      open={Boolean(point)}
      placement="top"
      align={{ offset: [offsetX, 0] }}
      overlayStyle={{ pointerEvents: 'none' }}
    >
      <div
        ref={wrapRef}
        style={{ width: '100%', height }}
        role="img"
        aria-label={summary || `Trend chart, ${series.length} points`}
        onMouseLeave={() => setHovered(null)}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={series}
            margin={{ top: 6, right: 2, bottom: 0, left: 2 }}
            onMouseMove={trackPoint}
            onMouseLeave={() => setHovered(null)}
          >
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
              // The hover marker. `activeDot` needs a tooltip in the chart to fire, so
              // the dot is drawn from our own hover state through `dot` instead.
              activeDot={false}
              {...((!flat || hovered !== null) && {
                dot: (props) => {
                  const isNow = props.index === series.length - 1 && !flat;
                  const isHover = props.index === hovered;
                  if (!isNow && !isHover) return null;
                  return (
                    <circle
                      key={`dot-${props.index}`}
                      cx={props.cx}
                      cy={props.cy}
                      r={isHover ? 3.5 : 2.75}
                      fill={color}
                      stroke="var(--colorBgContainer)"
                      strokeWidth={1.5}
                    />
                  );
                },
              })}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Tooltip>
  );
}
