import { useTranslation } from 'react-i18next';
import { theme } from '@/ui/theme';
import { DocLink } from '@/ui/doc-link';
import type { DuplicateHit } from '@/lib/duplicate-check';

/**
 * "You have typed an identifier that already belongs to something else."
 *
 * Deliberately a warning and not a block: every identifier here has a
 * legitimate repeat (a shared mobile, a branch on head office's TRN, two
 * brands making the same OE part). The operator decides. The system only
 * makes sure they decide knowingly, and shows them WHICH record already has
 * it so they can go and look rather than guess.
 *
 * The exception is a hit marked `blocking` - a duplicate SKU, which the
 * database refuses outright. That one is not advice, it is a preview of the
 * error, so it is styled as an error and says so.
 */
export function DuplicateWarning({
  hits, docType,
}: {
  hits: DuplicateHit[];
  /** Document type for the drill-through link, e.g. 'customer', 'product'. */
  docType: string;
}) {
  const { t } = useTranslation();
  if (!hits.length) return null;

  const blocking = hits.some(h => h.blocking);
  const tone = blocking
    ? { bg: theme.dangerSoft, border: '#fecaca', text: theme.danger }
    : { bg: theme.warnSoft,   border: theme.warnBorder, text: theme.warn };

  return (
    <div
      role="status"
      style={{
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        borderRadius: theme.radiusLg,
        padding: '10px 12px',
        display: 'flex',
        gap: '10px',
        alignItems: 'flex-start',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={tone.text}
           strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
           style={{ flexShrink: 0, marginTop: '1px' }} aria-hidden="true">
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: '12px', fontWeight: 700, color: tone.text, marginBottom: '3px' }}>
          {blocking ? t('duplicates.blocked_title') : t('duplicates.warning_title')}
        </div>
        <ul style={{ margin: 0, paddingInlineStart: '16px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {hits.map(h => (
            <li key={`${h.id}:${h.field}`} style={{ fontSize: '12px', color: theme.ink }}>
              {t(`duplicates.field.${h.field}`)}{' '}
              <span className="font-mono" style={{ fontSize: '11px' }}>{h.value}</span>
              {' — '}
              <DocLink type={docType} id={h.id} label={h.label} />
            </li>
          ))}
        </ul>
        <div style={{ fontSize: '11px', color: theme.inkMuted, marginTop: '4px' }}>
          {blocking ? t('duplicates.blocked_hint') : t('duplicates.warning_hint')}
        </div>
      </div>
    </div>
  );
}
