import { useNavigate } from 'react-router-dom';

/**
 * BackButton — the one shared "go back" affordance (Phase 48).
 *
 * Premium frosted-glass pill built on the app's glass tokens (--glass-bg /
 * --glass-blur / --glass-shadow in index.css) so it reads as native to the
 * design system. A left chevron that slides on hover; violet accent on hover;
 * subtle lift. RTL-aware (arrow flips). Hidden in print via data-print-hide.
 *
 * Behaviour — the "proper way" to leave a leaf page:
 *  • Always navigates to an explicit parent route (`to`), never browser
 *    history(-1) — that's unreliable after a save→redirect or a deep-link.
 *  • If `confirm` is passed (an editor's useUnsavedChangesGuard), it runs
 *    first; when it returns false (user cancelled the "discard changes?"
 *    prompt) navigation is aborted and the user stays on the page.
 */
interface BackButtonProps {
  /** Destination route — the logical parent list, e.g. '/sales/quotes'. */
  to: string;
  /** Text beside the chevron. Pass the parent's name (e.g. "Quotes"); defaults to "Back". */
  label?: string;
  /** Unsaved-changes guard: if it returns false, navigation is cancelled. */
  confirm?: () => boolean;
  className?: string;
}

export function BackButton({ to, label = 'Back', confirm, className }: BackButtonProps) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      data-print-hide
      onClick={() => { if (!confirm || confirm()) navigate(to); }}
      className={`sb-back-btn${className ? ` ${className}` : ''}`}
      title={`Back to ${label}`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      <span className="truncate">{label}</span>
    </button>
  );
}
