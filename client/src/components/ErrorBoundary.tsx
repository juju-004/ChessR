import { Component, type ReactNode } from 'react';

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
      return (
        <div className="mx-auto mt-16 max-w-md rounded-lg border border-red-900 bg-red-950/40 p-6 text-center">
          <h1 className="mb-2 text-xl font-bold text-red-400">Something went wrong</h1>
          <p className="mb-4 text-sm text-base-content/60">
            The page hit an unexpected error. Reloading usually fixes it.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-md bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
