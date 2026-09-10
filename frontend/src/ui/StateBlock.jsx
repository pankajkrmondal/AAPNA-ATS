/**
 * StateBlock — the one empty / loading / error surface.
 *
 * The app has ~40 raw <Spin> and <Empty> instances, each making its own decision
 * about what "nothing here" looks like, and the three existing primitives
 * (EmptyState, ErrorState, LoadingSkeleton) had 4, 2 and 3 consumers respectively
 * out of the ~22 screens that need them.
 *
 * THE RULE THIS ENFORCES, from §I.6 of the rollout plan:
 * "A bare 'No data' is not acceptable on an enterprise screen." An empty state must
 * say WHY it is empty and offer the next action. That is why `title` and `body` are
 * separate and why `action` exists — a component that only took a string would let
 * "No data" back in through the front door.
 *
 * Loading deliberately renders a skeleton shaped like the content, not a centred
 * spinner: a spinner collapses the layout and then everything jumps when it
 * resolves, which reads as the page breaking and recovering.
 */
import { InboxOutlined, WarningOutlined } from '@ant-design/icons';
import Button from './Button';

/**
 * @param {object} props
 * @param {'empty'|'loading'|'error'} [props.variant='empty']
 * @param {React.ReactNode} [props.icon]
 * @param {React.ReactNode} [props.title]
 * @param {React.ReactNode} [props.body]   why it is empty / what failed
 * @param {{label: string, onClick: Function}} [props.action]  the next step
 * @param {number} [props.rows=3]  loading only: how many skeleton rows
 */
export default function StateBlock({
  variant = 'empty',
  icon,
  title,
  body,
  action,
  rows = 3,
  className = '',
}) {
  if (variant === 'loading') {
    return (
      <div className={['ui-state-skeleton', className].filter(Boolean).join(' ')} aria-busy="true" aria-live="polite">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="ui-skeleton-row" style={{ '--ui-delay': `${i * 80}ms` }} />
        ))}
        {/* Visually the skeleton is the message; a screen reader needs it said. */}
        <span className="ui-sr-only">Loading…</span>
      </div>
    );
  }

  const isError = variant === 'error';

  return (
    <div
      className={['ui-state', isError ? 'ui-state--error' : '', className].filter(Boolean).join(' ')}
      role={isError ? 'alert' : undefined}
    >
      <div className="ui-state__icon" aria-hidden>
        {icon || (isError ? <WarningOutlined /> : <InboxOutlined />)}
      </div>
      {title && <div className="ui-state__title">{title}</div>}
      {body && <div className="ui-state__body">{body}</div>}
      {action && (
        <Button
          emphasis={isError ? 'solid' : 'soft'}
          tone={isError ? 'danger' : 'brand'}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
