import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { theme } from '@/ui/theme';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';

/**
 * Reusable filter bar for transaction list pages (invoices, bills, etc.).
 * Search box + a compact preset **period picker** (Phase 47c — replaces the old
 * raw From/To inputs) + a Clear button that only shows when a filter is active.
 *
 * The period is owned here via usePeriodPicker (persisted per `storageKey`) and
 * defaults to **All time** so the list still shows every row on first load — the
 * presets (This Month / This Year / …) are opt-in. The resolved bounds are
 * pushed up through onDateFrom/onDateTo ('' = unbounded); the parent keeps doing
 * its own client-side row filtering exactly as before.
 */
export interface ListFiltersProps {
  search: string;
  onSearch: (v: string) => void;
  searchPlaceholder?: string;
  /** Unique localStorage key for the period preset, e.g. 'stockbolt.list.invoices.period'. */
  storageKey: string;
  /** Receive the resolved period bounds ('' = no bound). */
  onDateFrom: (v: string) => void;
  onDateTo: (v: string) => void;
}

export function ListFilters({
  search, onSearch, searchPlaceholder,
  storageKey, onDateFrom, onDateTo,
}: ListFiltersProps) {
  const { t } = useTranslation();
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker(storageKey, 'all_time');

  // Push the resolved range up whenever the period changes (and once on mount).
  // Depends only on from/to (stable primitives) — the parent callbacks are
  // intentionally excluded so this can't loop.
  useEffect(() => { onDateFrom(from); onDateTo(to); }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasActive = !!(search || preset !== 'all_time');

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
        <label style={labelStyle}>{t('reports.period') || 'Period'}</label>
        <PeriodPicker
          mode="range" allowAllTime
          preset={preset} from={from} to={to}
          onPresetChange={setPreset} onCustomRange={setCustomRange}
        />
      </div>
      {hasActive && (
        <button
          type="button"
          onClick={() => { onSearch(''); setPreset('all_time'); }}
          style={{
            ...fieldStyle, cursor: 'pointer', color: theme.inkMuted,
            fontWeight: 600, whiteSpace: 'nowrap',
          }}
        >✕ {t('common.clear') || 'Clear'}</button>
      )}
    </div>
  );
}
