/**
 * ErrorBoundary — catches runtime React errors and shows a fallback UI.
 * Wraps the entire app so an uncaught error in one module doesn't blank the screen.
 */
import { Component, type ReactNode, type ErrorInfo } from 'react';
import { reportError } from '@/lib/error-reporting';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // H6-P1: route through the central error reporter (the single plug point for
    // an external tracker). The default reporter still console.errors, so local
    // dev visibility is unchanged; the componentStack is attached as context.
    reportError(error, 'react', { componentStack: info.componentStack });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface-page p-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-500">
            <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path strokeLinecap="round" d="M12 8v4m0 4h.01" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-ink-primary">Something went wrong</h2>
            <p className="mt-1 text-sm text-ink-secondary">
              An unexpected error occurred. Try refreshing or go back to the dashboard.
            </p>
            {this.state.error && (
              <details className="mt-3 text-left">
                <summary className="cursor-pointer text-xs text-ink-tertiary">Error details</summary>
                <pre className="mt-2 max-h-40 overflow-auto rounded border border-border-subtle bg-surface-muted p-3 text-xs text-red-700">
                  {this.state.error.message}
                </pre>
              </details>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={this.handleReset}
              className="rounded-lg border border-border-strong px-4 py-2 text-sm font-medium text-ink-secondary hover:bg-surface-muted"
            >
              Try again
            </button>
            <a
              href="/dashboard"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Go to Dashboard
            </a>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
