/**
 * CountUp — a number that counts up on mount.
 *
 * A component wrapper over the existing hooks/useCountUp, so a value can animate
 * without the caller needing to be a function component that calls a hook. That
 * matters because the hook's own consolidation note records the reason it exists:
 * three near-identical copies had drifted, and only one of them respected
 * prefers-reduced-motion. Routing every animated number through one place is what
 * keeps that guard applying everywhere.
 *
 * Currently only StatCard and KpiCard animate; Analytics, Vendor, Pipeline and Admin
 * numbers snap in. This is what lets that be fixed by wrapping rather than by
 * copying the hook a fourth time.
 */
import useCountUp from '../hooks/useCountUp';

/**
 * @param {object} props
 * @param {number|string} props.value  non-numeric values pass through unanimated
 * @param {number} [props.duration=1100] ms
 */
export default function CountUp({ value, duration = 1100 }) {
  const display = useCountUp(value, duration);

  // A count-up shifts its own width as digits change, which reads as jitter. The
  // tabular-nums that fixes it lives on .ui-stat__value and the .t-metric-* classes,
  // so anything rendering this outside those needs to supply it — hence the note.
  return <>{display}</>;
}
