/**
 * StatCard — Premium dashboard stat card with gradient surface, glowing icon tile,
 * animated count-up value, and hover lift. Uses glassmorphism styling.
 *
 * @param {{ icon: React.ReactNode, title: string, value: number|string, trend?: number, trendLabel?: string, color?: string, loading?: boolean, style?: object }} props
 */
import { Card, Typography, Tooltip } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, MinusOutlined } from '@ant-design/icons';
import Sparkline from '../dashboard/Sparkline';
import MetricInfo from './MetricInfo';
import useCountUp from '../../hooks/useCountUp';

const { Text } = Typography;

// The count-up implementation that used to live here is now the shared
// hooks/useCountUp — it was the best of three near-duplicate copies (this one,
// hooks/useCountUp and a third in VendorDashboard) and the only one that respected
// prefers-reduced-motion. See that file for the consolidation note.

export default function StatCard({
  icon,
  title,
  value,
  trend,
  trendLabel = 'vs last month',
  color = '#7a922e',
  loading = false,
  style,
  /** Bare counts, or `[{ label, value }]` points so the hover can name each day. */
  sparklineData = null,
  /** What one sparkline point counts, e.g. "added" — shown in the hover readout. */
  sparklineUnit = '',
  /** Plain-language description of what the sparkline plots, for hover + a11y. */
  sparklineSummary = '',
  delta = null, // { value: number (percent), label?: string }
  /** Key into constants/metricDefinitions.js — renders the info affordance. */
  metric = null,
  /** Overrides the registry's `chart` line when the graph follows a live filter
   *  (the selected date range), which a static definition cannot describe. */
  chartNote = null,
  /** One line of real context under the value; keeps card anatomy uniform. */
  footnote = null,
}) {
  const isPositive = trend > 0;
  const isNegative = trend < 0;
  const trendColor = isPositive ? '#4a7c59' : isNegative ? '#c0392b' : '#5f6664';
  const displayValue = useCountUp(value);

  // Week-over-week delta badge (independent of the optional `trend` prop).
  const hasDelta = delta && delta.value !== null && delta.value !== undefined;
  const deltaUp = hasDelta && delta.value > 0;
  const deltaDown = hasDelta && delta.value < 0;

  const hasSpark = Array.isArray(sparklineData) && sparklineData.length > 1;

  return (
    <Card
      loading={loading}
      bordered={false}
      /* `spotlight` opts this surface into the cursor-tracked highlight driven by
         usePointerSpotlight on the page root (a no-op outside `.ats-v2`). */
      className="premium-stat-card spotlight"
      /* Only the colour is passed inline, as a custom property. The top edge and
         the surface wash that used to live here are now CSS rules keyed off
         --stat-color — an inline background cannot be overridden by a stylesheet,
         which would have forced !important on every V2 rule below it. */
      style={{ '--stat-color': color, ...style }}
      styles={{
        body: { padding: 0, position: 'relative', zIndex: 1, height: '100%' },
      }}
    >
      {/* Soft corner aura — subtle, behind content */}
      <span
        className="premium-stat-aura"
        aria-hidden
        style={{ background: `radial-gradient(circle, ${color}26 0%, transparent 70%)` }}
      />

      <div className="premium-stat-inner">
        {/* Header: icon tile + compact trend chip */}
        <div className="premium-stat-head">
          <div
            className="premium-stat-icon"
            style={{
              background: `linear-gradient(135deg, ${color} 0%, ${color}cc 100%)`,
              boxShadow: `0 6px 16px ${color}55`,
            }}
          >
            {icon}
          </div>
          {hasDelta && (
            /* An AntD tooltip, not the `title` attribute this used to carry: the native
               one waits a second, renders in the OS's styling, and never appears on
               keyboard focus. The text spells the comparison out in words, because an
               arrow and a percentage alone do not say what was compared to what. */
            <Tooltip
              title={delta.label || `${deltaUp ? 'Up' : deltaDown ? 'Down' : 'Unchanged'}${
                deltaUp || deltaDown ? ` ${Math.abs(delta.value)}%` : ''} compared with the previous period of the same length`}
              placement="top"
            >
              <span
                className={`delta-chip ${deltaUp ? 'is-up' : deltaDown ? 'is-down' : 'is-flat'}`}
                tabIndex={0}
              >
                {deltaUp ? <ArrowUpOutlined /> : deltaDown ? <ArrowDownOutlined /> : <MinusOutlined />}
                {Math.abs(delta.value)}%
              </span>
            </Tooltip>
          )}
        </div>

        {/* Label + its definition. MetricInfo pulls the explanation from
            constants/metricDefinitions.js, so the affordance and the text it reveals
            live together — previously the icon was here but the tooltip prose was a
            local const in Dashboard.jsx, and they drifted. */}
        <Text className="premium-stat-label">
          {title}
          {metric && (
            <span style={{ marginLeft: 4 }}>
              <MetricInfo metric={metric} size={10.5} chart={chartNote} />
            </span>
          )}
        </Text>
        {/* The number itself answers a hover too. It counts up on load, so for the first
            second the figure on screen is not the figure — a reader who points at it
            gets the settled value rather than a digit mid-flight. */}
        <Tooltip
          title={`${title} — ${typeof value === 'number' ? value.toLocaleString() : value}`}
          placement="top"
        >
          <div className="premium-stat-value" style={{ width: 'fit-content' }}>{displayValue}</div>
        </Tooltip>

        {/* Optional legacy trend line */}
        {trend !== undefined && trend !== null && (
          <span className="premium-stat-trend" style={{ color: trendColor }}>
            {isPositive ? <ArrowUpOutlined /> : isNegative ? <ArrowDownOutlined /> : <MinusOutlined />}
            {Math.abs(trend)}%
            <Text type="secondary" style={{ fontSize: 12, marginLeft: 4 }}>{trendLabel}</Text>
          </span>
        )}

        {/* Footnote — one line of real context, on every card. */}
        {footnote && <div className="premium-stat-footnote">{footnote}</div>}
      </div>

      {/* Full-bleed sparkline band. Sits OUTSIDE .premium-stat-inner so it can bleed
          to the card's edges while the content above stays padded. Every card gets one,
          driven by a real series over the period the reader has selected (see the note
          in Dashboard.jsx); the gradient wash keeps the band's silhouette identical
          even on a flat series, so a quiet metric still looks finished rather than
          broken. `sparklineUnit` is what makes the hover readable — "3" alone means
          nothing, "3 added" does. */}
      <div
        className="premium-stat-band"
        style={{ background: `linear-gradient(180deg, transparent 0%, ${color}38 100%)` }}
      >
        {hasSpark && (
          <Sparkline
            data={sparklineData}
            color={color}
            height={54}
            unit={sparklineUnit}
            summary={sparklineSummary}
          />
        )}
      </div>
    </Card>
  );
}
