/**
 * FormErrorBanner — Phase 14.14l.
 *
 * Lightweight inline banner used by every RHF-driven form to surface
 * the first validation error (or any other top-of-form error). Pairs
 * with the `useFormInvalidBanner` hook.
 */
interface FormErrorBannerProps {
  message: string | null;
  onDismiss?: () => void;
}

export function FormErrorBanner({ message, onDismiss }: FormErrorBannerProps) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-card border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-0.5 h-4 w-4 flex-shrink-0"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-red-500 hover:text-red-700"
          aria-label="Dismiss"
        >
          ×
        </button>
      )}
    </div>
  );
}
