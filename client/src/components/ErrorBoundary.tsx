import { Component, type ReactNode } from 'react';
import { PageError } from './PageError.js';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

// Error boundaries must be class components, there is still no hook
// equivalent (componentDidCatch has no functional-component counterpart).
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('Unhandled render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      // Same shared error card every page's own load-failure state uses
      // now (see PageError.tsx) rather than this having its own one-off
      // plain red box — this message won't match PageError's "not
      // found"/network inference, so it falls through to the generic
      // "Something went wrong" framing, exactly what a render crash is.
      return (
        <PageError
          message="The page hit an unexpected error. Reloading usually fixes it."
          className="mt-16 px-4"
        />
      );
    }
    return this.props.children;
  }
}
