import { Button } from 'antd';
import { InboxOutlined } from '@ant-design/icons';

/**
 * EmptyState — the one "there is nothing here" surface.
 *
 * The app had ~30 ad-hoc empty states, most of them a bare `<Empty
 * description="No data" />`. On an enterprise screen that is not an answer: it
 * tells the reader nothing about WHY the list is empty (no records yet? a
 * filter excluded everything? the wrong role selected?) and offers no way
 * forward. The rollout plan makes that explicit — every table, board and list
 * owns an empty state that explains itself and offers the next action.
 *
 * So `title` alone is not enough here by design. Pass `body` saying why, and
 * an `action` where one exists. The two common shapes:
 *
 *   nothing exists yet   → "No candidates yet" / "Uploaded resumes will appear
 *                           here." / [Upload resumes]
 *   filters hid it all   → "No candidates match these filters" / "Try widening
 *                           the date range or clearing the role." / [Clear filters]
 *
 * Styling is `.state-block` in theme/index.css. Deliberately not translucent:
 * it renders inside an already-glass card, and glass over glass reads as a
 * smudge.
 *
 * @param {object} props
 * @param {React.ReactNode} [props.icon]    defaults to an inbox
 * @param {string} props.title              what is (not) here — one short line
 * @param {React.ReactNode} [props.body]    why it is empty / what to do about it
 * @param {React.ReactNode} [props.action]  a ready-made control, overrides actionLabel
 * @param {string} [props.actionLabel]      convenience: renders a Button
 * @param {() => void} [props.onAction]     handler for actionLabel
 * @param {'sm'|'md'|'lg'} [props.size]     md by default; sm inside a small panel
 * @param {string} [props.accent]           icon colour; a brand token, not a hex
 */
export default function EmptyState({
  icon = <InboxOutlined />,
  title,
  body,
  action,
  actionLabel,
  onAction,
  size = 'md',
  accent,
  style,
}) {
  const cta = action ?? (actionLabel ? (
    <Button type="primary" size={size === 'sm' ? 'small' : 'middle'} onClick={onAction}>
      {actionLabel}
    </Button>
  ) : null);

  return (
    <div
      className="state-block"
      data-size={size}
      // Accent arrives as a custom property rather than an inline colour, so the
      // stylesheet keeps ownership of how it is used (the icon tint is derived
      // from it with color-mix). Same pattern as --kpi-color / --stat-color.
      style={accent ? { '--state-accent': accent, ...style } : style}
    >
      {icon && <span className="state-block__icon">{icon}</span>}
      <div className="state-block__title">{title}</div>
      {body && <div className="state-block__body">{body}</div>}
      {cta && <div className="state-block__actions">{cta}</div>}
    </div>
  );
}
