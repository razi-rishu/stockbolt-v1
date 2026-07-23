/**
 * H6-P1 — centralized browser error reporting.
 *
 * Provides ONE seam through which client-side errors are surfaced, and captures
 * the errors React's ErrorBoundary cannot (uncaught window errors and unhandled
 * promise rejections, which previously vanished silently).
 *
 * The default reporter emits a structured console.error. An EXTERNAL error
 * tracker (Sentry, etc.) is intentionally NOT configured here — that is a later
 * step. `setErrorReporter()` is the plug point to install one without changing
 * any call site.
 */

export type ErrorSource = 'react' | 'window.onerror' | 'unhandledrejection' | 'manual';

export interface ReportedError {
  error: unknown;
  source: ErrorSource;
  context?: Record<string, unknown>;
}

export type ErrorReporter = (report: ReportedError) => void;

/** Default reporter: a structured console.error. Replaced via setErrorReporter. */
function defaultReporter({ error, source, context }: ReportedError): void {
  const detail =
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { value: String(error) };
  console.error(`[error:${source}]`, detail, context ?? {});
}

let reporter: ErrorReporter = defaultReporter;

/** Plug point: swap in an external tracker (e.g. Sentry) later, once configured. */
export function setErrorReporter(next: ErrorReporter): void {
  reporter = next;
}

/** Report an error through the active reporter. Never throws. */
export function reportError(
  error: unknown,
  source: ErrorSource = 'manual',
  context?: Record<string, unknown>,
): void {
  try {
    reporter({ error, source, context });
  } catch {
    // Reporting must never itself break the app.
  }
}

let installed = false;

/**
 * Install global handlers for errors React cannot catch: uncaught errors from
 * async code / event handlers (window 'error') and unhandled promise rejections
 * (window 'unhandledrejection'). Idempotent; call once at startup.
 */
export function installGlobalErrorHandlers(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event: ErrorEvent) => {
    reportError(event.error ?? event.message, 'window.onerror', {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    reportError(event.reason, 'unhandledrejection');
  });
}
