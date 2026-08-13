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
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        background: 'var(--overlay-scrim)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 11000,
      }}
    >
      <Card
        bordered={false}
        style={{
          background: 'var(--colorBgElevated)',
          padding: '16px 32px',
          borderRadius: '16px',
          boxShadow: '0 20px 40px -10px rgba(0, 0, 0, 0.12), 0 10px 20px -5px rgba(0, 0, 0, 0.08)',
          border: '1px solid var(--color-primary-border)',
        }}
      >
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
        }}
        >
          <Spin size="large" />
          <Text strong style={{ color: 'var(--color-primary)', fontSize: 15 }}>
            {message}
          </Text>
          {hint && (
            <Text type="secondary" style={{ fontSize: 12 }}>{hint}</Text>
          )}
        </div>
      </Card>
    </div>,
    document.body,
  );
}
