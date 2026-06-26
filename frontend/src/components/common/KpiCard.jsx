import useCountUp from '../../hooks/useCountUp';

/**
 * Elegant animated KPI card — colour-themed via CSS custom properties, with a
 * count-up value, soft glow, hover lift and an accent bar that sweeps in on hover.
 * Styling lives in theme/index.css (`.kpi-card`). Shared by the Vendor Dashboard
 * and the Vendor / HR upload screens.
 *
 * @param {object} props
 * @param {React.ReactNode} props.icon
 * @param {string} props.label
 * @param {number} props.value
 * @param {string} props.color   accent / icon colour
 * @param {string} props.tint    icon background tint
 * @param {string} props.accent  top accent bar (gradient)
 * @param {number} [props.index] stagger index for entrance delay
 */
export default function KpiCard({ icon, label, value, color, tint, accent, index = 0 }) {
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
      <span className="kpi-card__label">{label}</span>
      <span className="kpi-card__value">{display}</span>
    </div>
  );
}
