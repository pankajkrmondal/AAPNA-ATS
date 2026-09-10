/**
 * StatTile — one metric card.
 *
 * Merges the three parallel families the app had grown, which did the same job with
 * different numbers and no stated reason for any of them:
 *
 *   StatCard / .premium-stat-card   value 38px/800, --depth-2,   icon r10, lift -4
 *   KpiCard  / .kpi-card            value 34px/800, --shadow-sm, icon r14, lift -4
 *   .admin-stat                     value 32px/700, --shadow-md, icon r13, lift -3
 *
 * ACCENT IS A TOKEN NAME, NEVER A HEX.
 * The old StatCard defaulted to `color = '#7a922e'` — a raw hex, inside the very
 * component the design law forbids one in — and then built its surfaces by
 * string-concatenating alpha onto it (`${color}26`, `${color}cc`, `${color}55`,
 * `${color}38`). That made it structurally incapable of accepting a CSS variable, so
 * it could never follow a tenant brand. Here the accent names a token; CSS resolves
 * it and does its own mixing with color-mix(), which works on any colour space and
 * on a variable.
 */
import { CaretUpFilled, CaretDownFilled, MinusOutlined } from '@ant-design/icons';
import Surface from './Surface';
import CountUp from './CountUp';
import MetricInfo from '../components/common/MetricInfo';
import Sparkline from '../components/dashboard/Sparkline';

/**
 * The accent vocabulary. Every entry resolves to a token that already exists in
 * theme/index.css, so adding a stat colour is picking from this list rather than
 * inventing a hex. `brand` follows the tenant palette; the rest are semantic and
 * deliberately do not move when a brand is swapped.
 */
const ACCENTS = {
  brand: 'var(--brand-primary)',
  info: 'var(--kpi-b)',
  success: 'var(--kpi-c)',
  danger: 'var(--kpi-d)',
  warning: 'var(--kpi-e)',
  violet: 'var(--violet)',
  /* Added in Stage 5.5 for /analytics' "Total" tile. A count that is neither good nor
     bad needs a way to say so: every other entry here carries a verdict, and painting
     a plain total brand-green makes it read as a positive result. This is the one
     accent that deliberately recedes. */
  neutral: 'var(--text-2)',
};

const SIZES = { sm: 'ui-stat--sm', md: '', lg: 'ui-stat--lg' };

/**
 * @param {object} props
 * @param {React.ReactNode} [props.icon]
 * @param {string} props.label
 * @param {number|string} props.value
 * @param {'brand'|'info'|'success'|'danger'|'warning'|'violet'|'neutral'} [props.accent='brand']
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {{value:number,label?:string}} [props.delta]  period-over-period change
 * @param {React.ReactNode} [props.footnote]  one line of real context
 * @param {boolean} [props.interactive]
 * @param {boolean} [props.bloom]
 * @param {boolean} [props.countUp=true]
 * @param {Array<number|{label?:string,value:number}>} [props.sparkline] Trend series
 *   for the full-bleed band. Labelled points are preferred — they let the hover name
 *   the day rather than showing a bare number.
 * @param {string} [props.sparklineUnit] What one point counts, e.g. "added". Without
 *   it the hover reads "3", which means nothing.
 * @param {string} [props.sparklineSummary] Plain-language description of the line,
 *   used for the hover readout and the accessible description.
 * @param {string} [props.metric] Key into constants/metricDefinitions.js. Optional —
 *   renders the ⓘ affordance beside the label when supplied.
 * @param {string} [props.chartNote] Overrides the metric registry's static `chart`
 *   line. Needed when the graph follows a LIVE filter — /dashboard's sparklines cover
 *   whatever date range the reader has selected, which a fixed definition cannot
 *   describe. Dropping this silently degrades the tooltip from "the last 30 days you
 *   chose" to a generic sentence, so it is worth the extra prop.
 */
export default function StatTile({
  icon,
  label,
  value,
  accent = 'brand',
  size = 'md',
  delta = null,
  footnote,
  interactive = false,
  bloom = false,
  countUp = true,
  sparkline = null,
  sparklineUnit = '',
  sparklineSummary = '',
  metric = null,
  chartNote = null,
  className = '',
  ...rest
}) {
  /* MIGRATION GUARD.
     The predecessor `StatCard` took a `color` prop holding a hex; StatTile takes an
     `accent` holding a TOKEN NAME. Because `accent` has a default, a call site that
     still passes `color` renders perfectly happily — in the default brand colour. That
     is precisely what happened converting /dashboard: three of four KPI cards kept
     `color:` through a scripted edit, so the whole row silently went green and nothing
     failed. Four more routes have StatCards to migrate, so the failure is worth making
     loud rather than trusting the next edit to be complete. */
  if (import.meta.env?.DEV) {
    if (rest.color !== undefined) {
      console.warn(
        `[StatTile] "${label}" was passed a \`color\` prop. That is StatCard's API. `
        + 'Use `accent` with a token name (brand | info | success | danger | warning | violet) — '
        + 'otherwise this tile silently renders in the default brand colour.',
      );
    }
    if (accent && !ACCENTS[accent]) {
      console.warn(`[StatTile] "${label}" has unknown accent "${accent}"; falling back to brand.`);
    }
  }

  const hasDelta = delta && delta.value !== null && delta.value !== undefined;
  const dir = !hasDelta ? 'flat' : delta.value > 0 ? 'up' : delta.value < 0 ? 'down' : 'flat';

  // Always render the band when a series is supplied, even if it is flat or empty.
  // Sparkline itself draws a baseline rather than bailing, so every card in a row
  // keeps the same silhouette — a quiet metric reads as quiet, not as broken.
  const hasSpark = Array.isArray(sparkline) && sparkline.length > 0;

  return (
    <Surface
      tier={2}
      interactive={interactive}
      bloom={bloom}
      padding="none"
      className={['ui-stat-card', className].filter(Boolean).join(' ')}
      // The ONE inline style in this component, and it is the prescribed escape
      // hatch: a data-derived value passed as a custom property so CSS owns the
      // property. Precedent is --stat-color / --kpi-color in the existing system.
      style={{ '--ui-accent': ACCENTS[accent] || ACCENTS.brand }}
      {...rest}
    >
      {/* The accent rail. Rendered even under flat-slate: it encodes which metric
          this is, so it is data and not decoration. */}
      <span className="ui-stat__rail" aria-hidden />

      <div className={['ui-stat', SIZES[size] ?? ''].filter(Boolean).join(' ')}>
        <div className="ui-stat__head">
          {icon && <div className="ui-stat__icon">{icon}</div>}
          {hasDelta && (
            <span className={`ui-delta ui-delta--${dir}`}>
              {dir === 'up' ? <CaretUpFilled /> : dir === 'down' ? <CaretDownFilled /> : <MinusOutlined />}
              {Math.abs(delta.value)}%
            </span>
          )}
        </div>

        <div className="ui-stat__label">
          {label}
          {metric && (
            <span className="ui-stat__info">
              <MetricInfo metric={metric} size={11} chart={chartNote} />
            </span>
          )}
        </div>

        <div className="ui-stat__value">
          {countUp && typeof value === 'number' ? <CountUp value={value} /> : value}
        </div>

        {footnote && <div className="ui-stat__footnote">{footnote}</div>}
      </div>

      {hasSpark && (
        <div className="ui-stat-band">
          {/* `var(--ui-accent)` rather than a resolved hex: Sparkline already passes
              CSS variables straight into SVG presentation attributes (see the "now"
              dot's stroke), so the chart follows the tenant brand and the theme for
              free. Resolving it in JS would need a re-render on every theme switch. */}
          <Sparkline
            data={sparkline}
            color="var(--ui-accent)"
            height={56}
            unit={sparklineUnit}
            summary={sparklineSummary}
          />
        </div>
      )}
    </Surface>
  );
}
