import { createPortal } from 'react-dom';
import { Card, Spin, Typography } from 'antd';

const { Text } = Typography;

/**
 * Full-viewport "working on it" scrim, portalled to <body>.
 *
 * Used when a refetch replaces content the user is already looking at: without
 * it the old numbers sit there looking current, then silently swap — which
 * reads as "nothing happened" and invites a second click on the same control.
 * The scrim also blocks input, so a slow request cannot be queued up twice.
 *
 * Extracted from the Candidate Screening page ("Matching and scoring
 * candidates…") so every screen that blocks on a fetch looks identical rather
 * than each inventing its own spinner.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {string} [props.message] - what is being waited on, in plain words
 * @param {string} [props.hint] - optional second line, e.g. an expected duration
 */
export default function LoadingOverlay({ open, message = 'Loading…', hint }) {
  if (!open) return null;

  return createPortal(
    <div
      // aria-live so a screen reader announces the wait; the sighted cue is
      // the scrim itself.
      role="status"
      aria-live="polite"
      className="lo-scrim"
    >
      <Card
        bordered={false}
        className="lo-card"
      >
        <div className="lo-body">
          <Spin size="large" />
          <Text strong className="lo-label">
            {message}
          </Text>
          {hint && (
            <Text type="secondary" className="cmp-caption">{hint}</Text>
          )}
        </div>
      </Card>
    </div>,
    document.body,
  );
}
