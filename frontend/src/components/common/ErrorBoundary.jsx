import { Component } from 'react';
import ErrorState from './ErrorState';

/**
 * ErrorBoundary — catches a render-time exception anywhere below it and shows
 * ErrorState instead of letting React unmount the whole tree.
 *
 * React has no default recovery from a thrown render: without a boundary
 * anywhere in the app, one bad popup blanks the entire page and the only way
 * back is a full browser refresh. This is the app's first Error Boundary —
 * wrapped around the whole tree in main.jsx, and again around the Pipeline
 * route specifically, so a crash there resets just that route.
 *
 * `resetKey` lets a wrapper force the boundary to try rendering its children
 * again — e.g. pass the pathname so navigating to a different page recovers
 * automatically instead of continuing to show a stale fallback.
 */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] caught a render error', {
      error,
      componentStack: info?.componentStack,
      route: typeof window !== 'undefined' ? window.location.pathname : null,
    });
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 48 }}>
          <ErrorState
            title="Something went wrong"
            body="This page hit an unexpected error. You can try again, or refresh if it keeps happening."
            onRetry={this.handleRetry}
            size="lg"
          />
        </div>
      );
    }
    return this.props.children;
  }
}
