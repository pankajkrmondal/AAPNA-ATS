/**
 * MetricInfo — the single "what does this number mean?" affordance.
 *
 * Renders one consistent info icon whose tooltip is composed from
 * constants/metricDefinitions.js: the plain-language explanation, then how it is
 * counted and where it comes from, then any caveat. Callers pass a metric key, not
 * prose, so a definition is written once and appears identically everywhere.
 *
 * WHO THIS IS WRITTEN FOR: recruiters and hiring managers, not engineers. The panel
 * used to end with a monospaced `GET /dashboard/stats · rpa_cv` line, and the "how"
 * text named database columns (`approval_status in (pending, waiting, approved)`).
 * That is a developer's answer to a user's question. Everything shown here is now
 * ordinary English; the endpoint and table names live in code comments beside the
 * definitions, where the people who need them actually work.
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
 * @param {string} [props.chart] Overrides the registry's `chart` line. For graphs that
 *   follow a live filter (e.g. the selected date range), which a fixed definition
 *   cannot describe without going stale the moment the reader changes it.
 */
export default function MetricInfo({ metric, size = 11.5, placement = 'top', chart = null }) {
  const def = getMetric(metric);
  // A missing key is a developer error, not a user-facing one — render nothing
  // rather than an icon whose tooltip is empty.
  if (!def) return null;

  const chartLine = chart || def.chart;

  const body = (
    <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{def.label}</div>
      <div>{def.short}</div>
      {def.formula && (
        <div style={{ marginTop: 6, opacity: 0.85 }}>
          <strong>How it&apos;s counted: </strong>{def.formula}
        </div>
      )}
      {/* What the graph plots. Stated separately because a card's line is often a RATE
          while the number above it is a running total — different quantities. */}
      {chartLine && (
        <div style={{ marginTop: 6, opacity: 0.85 }}>
          <strong>The graph shows: </strong>{chartLine}
        </div>
      )}
      {def.source && (
        <div style={{ marginTop: 6, opacity: 0.8 }}>
          <strong>Where it comes from: </strong>{def.source}
        </div>
      )}
      {def.caveat && (
        <div style={{ marginTop: 6, opacity: 0.9, fontStyle: 'italic' }}>
          Good to know: {def.caveat}
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
