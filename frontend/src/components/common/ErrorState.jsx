import { Button } from 'antd';
import { ExclamationCircleOutlined, ReloadOutlined } from '@ant-design/icons';

/**
 * ErrorState — the one "this failed" surface.
 *
 * Replaces ad-hoc `<Alert type="error">` blocks, which render as a full-width
 * banner regardless of whether the thing that failed was the whole page or one
 * chart in a corner. This is the same shape as EmptyState with the accent
 * switched to `--red`, so a panel that failed and a panel that is empty read as
 * one system rather than two.
 *
 * `onRetry` is the point of the component. An error the user cannot act on is
 * a dead end; where a retry is possible it should always be one click away.
 *
 * A raw exception message is never shown as the body — `error` is accepted and
 * surfaced only as small print, because "Request failed with status code 500"
 * tells a recruiter nothing. Write `body` for the person reading it.
 *
 * @param {object} props
 * @param {string} [props.title]           defaults to a neutral failure line
 * @param {React.ReactNode} [props.body]   what it means for the reader
 * @param {Error|string} [props.error]     the underlying error, shown as small print
 * @param {() => void} [props.onRetry]     renders the retry button when present
 * @param {string} [props.retryLabel]
 * @param {React.ReactNode} [props.action] an extra control beside retry
 * @param {'sm'|'md'|'lg'} [props.size]
 */
export default function ErrorState({
  title = 'Something went wrong',
  body = 'This section could not be loaded.',
  error,
  onRetry,
  retryLabel = 'Try again',
  action,
  size = 'md',
  style,
}) {
  const detail = error instanceof Error ? error.message : error;

  return (
    <div className="state-block state-block--error" data-size={size} style={style}>
      <span className="state-block__icon"><ExclamationCircleOutlined /></span>
      <div className="state-block__title">{title}</div>
      {body && <div className="state-block__body">{body}</div>}
      {detail && (
        <div className="state-block__body" style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
          {detail}
        </div>
      )}
      {(onRetry || action) && (
        <div className="state-block__actions">
          {onRetry && (
            <Button
              size={size === 'sm' ? 'small' : 'middle'}
              icon={<ReloadOutlined />}
              onClick={onRetry}
            >
              {retryLabel}
            </Button>
          )}
          {action}
        </div>
      )}
    </div>
  );
}
