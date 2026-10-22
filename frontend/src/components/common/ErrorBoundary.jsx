import { Component } from 'react';
import { Button } from 'antd';
import ErrorState from './ErrorState';
import { reportError } from '../../services/errorReporter';

/**
 * ErrorBoundary — keeps a render error from blanking the whole page (N30).
 *
 * Without one, React unmounts the ENTIRE tree on an uncaught render error:
 * one bad value in the pipeline drawer turned the whole app white. Two shapes,
 * matching the approved design:
 *
 *   - `variant="page"` around the routes: "Something went wrong" with Reload
 *     and Go to Dashboard;
 *   - `variant="panel"` inside a drawer/panel: "This candidate could not be
 *     shown" with Try again (re-renders) and an optional Close.
 *
 * `resetKey` clears the error when it changes (e.g. another candidate is
 * opened), so one failure does not stick to every later render. The error is
 * logged to the console and reported to Logs & errors (N42).
 *
 * @param {object} props
 * @param {'page'|'panel'} [props.variant]
 * @param {string} [props.title]
 * @param {string} [props.body]
 * @param {unknown} [props.resetKey]
 * @param {() => void} [props.onClose] panel only: renders a Close button
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info?.componentStack);
    reportError({ kind: 'render', error, componentStack: info?.componentStack, component: this.props.variant || 'page' });
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      // eslint-disable-next-line react/no-did-update-set-state
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    const { children, variant = 'page', title, body, onClose } = this.props;
    if (!error) return children;

    if (variant === 'panel') {
      return (
        <ErrorState
          size="sm"
          title={title || 'This candidate could not be shown'}
          body={body || 'The board behind it still works. Close this panel or try again.'}
          onRetry={() => this.setState({ error: null })}
          action={onClose ? <Button onClick={onClose}>Close</Button> : null}
        />
      );
    }

    return (
      <div style={{ padding: '64px 24px', maxWidth: 560, margin: '0 auto' }}>
        <ErrorState
          size="lg"
          title={title || 'Something went wrong'}
          body={body || 'This screen hit an error and could not be shown. Your saved work is not affected.'}
          onRetry={() => window.location.reload()}
          retryLabel="Reload"
          action={<Button href="/dashboard">Go to Dashboard</Button>}
        />
      </div>
    );
  }
}
