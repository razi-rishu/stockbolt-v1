import { useTranslation } from 'react-i18next';
import { theme } from '@/ui/theme';

/**
 * Reusable filter bar for transaction list pages (invoices, bills, etc.).
 * Owns no state — the parent holds the values and does the actual filtering.
 * Renders a search box + a date-range (From / To) + a Clear button that only
 * appears when at least one filter is active.
 */
export interface ListFiltersProps {
  search: string;
  onSearch: (v: string) => void;
  searchPlaceholder?: string;
  dateFrom: string;
  onDateFrom: (v: string) => void;
  dateTo: string;
  onDateTo: (v: string) => void;
}

export function ListFilters({
  search, onSearch, searchPlaceholder,
  dateFrom, onDateFrom, dateTo, onDateTo,
}: ListFiltersProps) {
  const { t } = useTranslation();
  const hasActive = !!(search || dateFrom || dateTo);

  const fieldStyle: React.CSSProperties = {
    border: `1px solid ${theme.border}`,
    borderRadius: '8px',
    padding: '7px 10px',
    fontSize: '13px',
    color: theme.ink,
    background: '#fff',
    outline: 'none',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: '10px', fontWeight: 700, color: theme.inkFaint,
    textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '3px',
  };

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 220px', minWidth: '200px' }}>
        <label style={labelStyle}>{t('common.search')}</label>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={searchPlaceholder ?? t('common.search')}
          style={fieldStyle}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <label style={labelStyle}>{t('common.date_from')}</label>
        <input type="date" value={dateFrom} onChange={(e) => onDateFrom(e.target.value)} style={fieldStyle} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <label style={labelStyle}>{t('common.date_to')}</label>
        <input type="date" value={dateTo} onChange={(e) => onDateTo(e.target.value)} style={fieldStyle} />
      </div>
      {hasActive && (
        <button
          type="button"
          onClick={() => { onSearch(''); onDateFrom(''); onDateTo(''); }}
          style={{
            ...fieldStyle, cursor: 'pointer', color: theme.inkMuted,
            fontWeight: 600, whiteSpace: 'nowrap',
          }}
        >✕ {t('common.clear') || 'Clear'}</button>
      )}
    </div>
  );
}
