/**
 * MetricInfo — the single "what does this number mean?" affordance.
 *
 * Renders one consistent info icon whose tooltip is composed from
 * constants/metricDefinitions.js: the plain-language explanation, then the formula
 * and data source when present, then any caveat. Callers pass a metric key, not
 * prose, so a definition is written once and appears identically everywhere.
 *
 * Accessibility: the trigger is a real <button>, so the definition is reachable by
 * keyboard (AntD shows Tooltip on focus) rather than hover-only.
 */
import { Tooltip } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { getMetric } from '../../constants/metricDefinitions';

/**
 * @param {object} props
 * @param {string} props.metric Key in metricDefinitions.
 * @param {number} [props.size] Icon font size in px.
 * @param {'top'|'bottom'|'left'|'right'} [props.placement]
 */
export default function MetricInfo({ metric, size = 11.5, placement = 'top' }) {
  const def = getMetric(metric);
  // A missing key is a developer error, not a user-facing one — render nothing
  // rather than an icon whose tooltip is empty.
  if (!def) return null;

  const body = (
    <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{def.label}</div>
      <div>{def.short}</div>
      {def.formula && (
        <div style={{ marginTop: 6, opacity: 0.85 }}>
          <strong>How: </strong>{def.formula}
        </div>
      )}
      {/* What the sparkline plots. Stated separately because the line is a RATE while
          the number above it is a running total — different quantities. */}
      {def.chart && (
        <div style={{ marginTop: 6, opacity: 0.85 }}>
          <strong>Chart: </strong>{def.chart.replace(/^Line:\s*/, '')}
        </div>
      )}
      {def.source && (
        <div style={{ marginTop: 4, opacity: 0.7, fontFamily: 'var(--mono)', fontSize: 11 }}>
          {def.source}
        </div>
      )}
      {def.caveat && (
        <div style={{ marginTop: 6, opacity: 0.9, fontStyle: 'italic' }}>
          Note: {def.caveat}
        </div>
      )}
    </div>
  );

  return (
    <Tooltip title={body} placement={placement} mouseEnterDelay={0.25} overlayStyle={{ maxWidth: 340 }}>
      <button
        type="button"
        aria-label={`About ${def.label}`}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          margin: 0,
          lineHeight: 1,
          cursor: 'help',
          color: 'var(--text-3)',
          display: 'inline-flex',
          verticalAlign: 'middle',
        }}
      >
        <InfoCircleOutlined style={{ fontSize: size }} />
      </button>
    </Tooltip>
  );
}
