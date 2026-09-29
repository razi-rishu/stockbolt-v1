import { useTranslation } from 'react-i18next';

/**
 * Z4 — "Show voided" next to the period filter on every document list.
 *
 * Voided documents are hidden by default. They cannot be deleted (their
 * numbers are issued and their journal entries are already reversed), so the
 * answer to "I don't want to see them" is to take them out of the way and
 * leave them one click behind, not to destroy the trail.
 *
 * Shows a count so the trail is discoverable rather than merely available:
 * a list with nothing voided renders nothing at all, which keeps the control
 * out of the way of companies that never void anything.
 *
 * Styled to match PeriodPicker's trigger exactly — the two sit together and a
 * near-match reads as a mistake.
 */
export function VoidedToggle({
  hideVoided, onChange, count,
}: {
  hideVoided: boolean;
  onChange: (next: boolean) => void;
  /** How many voided rows the current filter is holding back. */
  count: number;
}) {
  const { t } = useTranslation();

  if (count === 0) return null;

  return (
    <button
      type="button"
      onClick={() => onChange(!hideVoided)}
      aria-pressed={!hideVoided}
      title={t('common.voided_toggle_hint')}
      className={
        'inline-flex h-[30px] items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors ' +
        (hideVoided
          ? 'border-border-subtle bg-white text-ink-secondary hover:border-border-strong hover:text-ink-primary'
          : 'border-border-strong bg-surface-muted text-ink-primary')
      }
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-ink-tertiary"
        fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {hideVoided ? (
          <>
            <path d="M3 3l18 18" />
            <path d="M10.6 5.1A9.5 9.5 0 0112 5c5 0 9 4.5 9 7a12 12 0 01-2.3 3.3" />
            <path d="M6.6 6.6A12.4 12.4 0 003 12c0 2.5 4 7 9 7a9.3 9.3 0 004.3-1" />
          </>
        ) : (
          <>
            <path d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7z" />
            <circle cx="12" cy="12" r="2.5" />
          </>
        )}
      </svg>
      {hideVoided ? t('common.show_voided', { count }) : t('common.hide_voided')}
    </button>
  );
}
