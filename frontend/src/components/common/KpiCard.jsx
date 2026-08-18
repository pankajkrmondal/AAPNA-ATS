import useCountUp from '../../hooks/useCountUp';
import MetricInfo from './MetricInfo';

/**
 * Elegant animated KPI card — colour-themed via CSS custom properties, with a
 * count-up value, soft glow, hover lift and an accent bar that sweeps in on hover.
 * Styling lives in theme/index.css (`.kpi-card`). Shared by the Vendor Dashboard,
 * the Vendor / HR upload screens and the Analytics headline strip.
 *
 * @param {object} props
 * @param {React.ReactNode} props.icon
 * @param {string} props.label
 * @param {number} props.value
 * @param {string} props.color   accent / icon colour
 * @param {string} props.tint    icon background tint
 * @param {string} props.accent  top accent bar (gradient)
 * @param {number} [props.index] stagger index for entrance delay
 * @param {string} [props.metric] key in constants/metricDefinitions — renders the
 *   shared info affordance beside the label. Optional so existing callers are
 *   unchanged, but every number a user sees should have one: this component's
 *   consumers (vendor KPIs, upload counts, the Analytics tiles) explained
 *   nothing at all before Phase 6, which is exactly the gap MetricInfo exists
 *   to close on the dashboard.
 */
export default function KpiCard({ icon, label, value, color, tint, accent, index = 0, metric }) {
  const display = useCountUp(value);
  return (
    <div
      className="kpi-card"
      style={{
        '--kpi-color': color,
        '--kpi-tint': tint,
        '--kpi-accent': accent,
        animationDelay: `${index * 0.08}s`,
      }}
    >
      <span className="kpi-card__glow" />
      <span className="kpi-card__icon">{icon}</span>
      <span className="kpi-card__label">
        {label}
        {metric && (
          <span style={{ marginLeft: 5 }}>
            <MetricInfo metric={metric} size={10.5} />
          </span>
        )}
      </span>
      <span className="kpi-card__value">{display}</span>
    </div>
  );
}
