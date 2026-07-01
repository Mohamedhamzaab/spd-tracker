// ---------------------------------------------------------------------------
//  ErrorBoundary — catches render/lifecycle errors in its subtree and shows a
//  fallback instead of letting an uncaught throw unmount the whole React tree
//  (which leaves the user on a blank page). React error boundaries must be
//  class components. Pass `resetKey`: when it changes, the boundary clears a
//  prior error so the subtree can try to render again (e.g. a new document).
// ---------------------------------------------------------------------------
import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surface it for debugging without taking the app down.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info?.componentStack || '');
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.reset();
    }
  }

  reset() {
    this.setState({ error: null });
  }

  render() {
    if (this.state.error) {
      const { fallback } = this.props;
      return typeof fallback === 'function'
        ? fallback(this.state.error, this.reset)
        : fallback || null;
    }
    return this.props.children;
  }
}
