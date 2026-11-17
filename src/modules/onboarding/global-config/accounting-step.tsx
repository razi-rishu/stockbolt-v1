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
import { chartTemplateFor } from '@/core/seeds/seedCOA';

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

  // Ocean Teal (UI v1.1): look only — same values, same fy-month / save-fy hooks.
  return (
    <div className="sb-gc">
      <dl className="sb-gc-rows">
        <div className="sb-gc-row"><dt>{t('global_config.accounting.base_currency')}</dt><dd dir="ltr">{p.currency}</dd></div>
        <div className="sb-gc-row">
          <dt>{t('global_config.accounting.financial_year')}</dt>
          {p.onFyMonth && !p.locked ? (
            <dd className="sb-gc-inline">
              <select aria-label={t('global_config.accounting.month')} value={p.fy_month} onChange={(e) => p.onFyMonth!(e.target.value)}
                className="sb-gc-select is-sm" data-testid="fy-month">
                {MONTHS.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
              </select>
              {p.onSaveFy && (
                <button type="button" onClick={p.onSaveFy} disabled={p.saving} data-testid="save-fy" className="sb-gc-btn is-sm">
                  {p.saved ? t('global_config.accounting.saved') : t('global_config.accounting.save_fy')}
                </button>
              )}
            </dd>
          ) : <dd>{monthName(p.fy_month)}</dd>}
        </div>
        <div className="sb-gc-row">
          <dt>{t('global_config.accounting.chart')}</dt>
          <dd>
            {tpl.key === 'india_gst' ? t('global_config.accounting.chart_india_gst') : t('global_config.accounting.chart_gcc_vat')}
            <span className="sb-gc-row-sub">
              {p.existing_accounts !== undefined
                ? t('global_config.accounting.existing_accounts', { count: p.existing_accounts })
                : t('global_config.accounting.accounts_count', { count: tpl.account_count })}
            </span>
          </dd>
        </div>
        <div className="sb-gc-row"><dt>{t('global_config.accounting.costing')}</dt><dd>{t('global_config.accounting.costing_mac')}</dd></div>
      </dl>
      <p className="sb-gc-fine">{t('global_config.accounting.no_new_accounts')}</p>
      {p.locked
        ? <p className="sb-gc-fine" data-testid="fin-locked"><span className="sb-gc-tag is-warn">{t('global_config.accounting.locked')}</span></p>
        : p.onFyMonth && <p className="sb-gc-fine">{t('global_config.accounting.editable_hint')}</p>}
      {p.error && <p className="sb-gc-err">{p.error}</p>}
    </div>
  );
}
