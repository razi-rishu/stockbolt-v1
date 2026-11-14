/**
 * AC-2B — Comparative "Compare with previous period" control.
 *
 * Presentational only: a checkbox to turn comparison on/off + a basis selector
 * (Previous period / Same period last year). Wiring lives in each report page
 * via useComparativePeriods. Hidden in print (data-print-hide) like the rest of
 * the report action bar.
 */
import { useTranslation } from 'react-i18next';
import type { CompareBasis } from '@/lib/comparative';

const selectCls =
  'h-8 rounded-lg border border-border-subtle bg-white px-2 text-xs font-semibold text-ink-secondary focus:outline-none focus:ring-2 focus:ring-brand-500';

export function CompareToggle({
  on, basis, onToggle, onBasis,
}: {
  on: boolean;
  basis: CompareBasis;
  onToggle: (on: boolean) => void;
  onBasis: (basis: CompareBasis) => void;
}) {
  const { t } = useTranslation();
  return (
    <div data-print-hide className="sb-cmp inline-flex items-center gap-2">
      <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-ink-secondary">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => onToggle(e.target.checked)}
          className="h-3.5 w-3.5 accent-brand-600"
        />
        {t('rptOcean.compare')}
      </label>
      {on && (
        <select
          value={basis}
          onChange={(e) => onBasis(e.target.value as CompareBasis)}
          className={selectCls}
          title={t('rptOcean.compare_title')}
        >
          <option value="previous_period">{t('rptOcean.vs_prev_period')}</option>
          <option value="previous_year">{t('rptOcean.vs_prev_year')}</option>
        </select>
      )}
    </div>
  );
}
