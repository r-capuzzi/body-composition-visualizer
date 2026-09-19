import { Component } from "react";

/**
 * Catches a render-time error in its subtree and shows `fallback` instead of
 * letting it unmount the whole app.
 *
 * This exists for the 3D avatar. <Suspense> catches thrown *promises*, not
 * thrown *errors* - so when the ~940KB body-model fetch fails (a flaky
 * connection, a bad deploy, a CDN hiccup), the error propagates all the way
 * up and React tears the entire tree down to a blank page. The projection
 * numbers, chart and warnings need no mesh at all, so there is no reason for
 * them to die with it.
 *
 * Error boundaries have no hook equivalent; a class is the only way.
 */
export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error("Avatar failed to render:", error);
  }

  // Let the subtree try again when the thing it depends on changes (e.g. the
  // user switches sex, which points at a different model file). loadBodyData
  // drops failed entries from its cache, so a remount genuinely refetches.
  componentDidUpdate(prevProps) {
    if (this.state.failed && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    return this.state.failed ? this.props.fallback ?? null : this.props.children;
  }
}
