/**
 * Global v1 Phase 3 — the accounting review (Smart Hybrid, simplified v1).
 *
 * Shows what the posting engine will use: base currency, financial year, the
 * country chart template (the real list seedCOA installs) and the costing
 * method. Nothing here adds or renames an account. The financial year can be
 * changed only while the company has no transaction: global02 enforces that in
 * the database, this only mirrors it.
 */
import { useTranslation } from 'react-i18next';
import { Badge } from '@/ui/badge';
import { chartTemplateFor } from '@/core/seeds/seedCOA';

const row = 'flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle py-2 text-sm';
const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));

interface AccountingStepProps {
  country_code: string;
  currency: string;
  /** 'MM' — the month the financial year starts. */
  fy_month: string;
  /** Accounts the company has today (existing company); undefined during onboarding. */
  existing_accounts?: number;
  /** True once the company has a transaction: everything is read-only. */
  locked?: boolean;
  /** Present when the month may be changed (no transaction, permission to write). */
  onFyMonth?: (month: string) => void;
  /** Existing company: persist the changed month. */
  onSaveFy?: () => void;
  saving?: boolean;
  saved?: boolean;
  error?: string;
}

export function AccountingStep(p: AccountingStepProps) {
  const { t, i18n } = useTranslation();
  const tpl = chartTemplateFor(p.country_code);
  const monthName = (m: string) => new Date(2000, Number(m) - 1, 1).toLocaleString(i18n.language === 'ar' ? 'ar' : 'en', { month: 'long' });

  return (
    <div className="space-y-1">
      <div className={row}><span className="text-ink-secondary">{t('global_config.accounting.base_currency')}</span><span dir="ltr" className="font-medium">{p.currency}</span></div>
      <div className={row}>
        <span className="text-ink-secondary">{t('global_config.accounting.financial_year')}</span>
        {p.onFyMonth && !p.locked ? (
          <span className="flex items-center gap-2">
            <select aria-label={t('global_config.accounting.month')} value={p.fy_month} onChange={(e) => p.onFyMonth!(e.target.value)}
              className="rounded-pill border border-border-subtle bg-surface-card px-3 py-1 text-sm" data-testid="fy-month">
              {MONTHS.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
            </select>
            {p.onSaveFy && (
              <button type="button" onClick={p.onSaveFy} disabled={p.saving} data-testid="save-fy"
                className="rounded-pill bg-brand-500 px-3 py-1 text-xs text-white disabled:opacity-50">
                {p.saved ? t('global_config.accounting.saved') : t('global_config.accounting.save_fy')}
              </button>
            )}
          </span>
        ) : <span className="font-medium">{monthName(p.fy_month)}</span>}
      </div>
      <div className={row}>
        <span className="text-ink-secondary">{t('global_config.accounting.chart')}</span>
        <span className="text-end">
          <span className="font-medium">{tpl.key === 'india_gst' ? t('global_config.accounting.chart_india_gst') : t('global_config.accounting.chart_gcc_vat')}</span>
          <span className="block text-xs text-ink-tertiary">
            {p.existing_accounts !== undefined
              ? t('global_config.accounting.existing_accounts', { count: p.existing_accounts })
              : t('global_config.accounting.accounts_count', { count: tpl.account_count })}
          </span>
        </span>
      </div>
      <div className={row}><span className="text-ink-secondary">{t('global_config.accounting.costing')}</span><span>{t('global_config.accounting.costing_mac')}</span></div>
      <p className="pt-2 text-xs text-ink-tertiary">{t('global_config.accounting.no_new_accounts')}</p>
      {p.locked
        ? <p className="text-xs" data-testid="fin-locked"><Badge variant="warning">{t('global_config.accounting.locked')}</Badge></p>
        : p.onFyMonth && <p className="text-xs text-ink-tertiary">{t('global_config.accounting.editable_hint')}</p>}
      {p.error && <p className="text-xs text-danger-500">{p.error}</p>}
    </div>
  );
}
