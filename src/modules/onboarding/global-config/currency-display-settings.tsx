/**
 * Settings → Business configuration → Accounting → Currency & display
 * (phase143). Choose whether amounts show the currency code (AED 1,234.00 —
 * default) or the symbol (د.إ 1,234.00). Presentation only: the base currency,
 * document currencies, amounts and postings are untouched.
 *
 * Saved on its own (explicit Save, no auto-save) through companies.update; the
 * database allows it only to users with settings.write (RLS), everyone else
 * sees it read-only.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CheckCircle2 } from 'lucide-react';
import { getAdapter } from '@/data/index';
import { DIRHAM_SIGN, currencyLabel, displayOf, useCurrencyDisplayStore, type CurrencyDisplay } from '@/lib/currency-display';

const num = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CurrencyDisplaySettings({ company, canWrite }: {
  company: { id: string; base_currency?: string | null; currency?: string | null };
  canWrite: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const setMode = useCurrencyDisplayStore((s) => s.setMode);
  const saved = displayOf(company);
  const [choice, setChoice] = useState<CurrencyDisplay>(saved);
  const base = (company.base_currency ?? company.currency ?? 'AED').toUpperCase();
  // A second currency for the preview, so it shows how a foreign document reads.
  const other = base === 'USD' ? 'EUR' : 'USD';

  const save = useMutation({
    mutationFn: () => getAdapter().companies.update(company.id, { currency_display: choice } as never),
    onSuccess: () => {
      setMode(choice);
      void qc.invalidateQueries({ queryKey: ['company', company.id] });
    },
  });
  const dirty = choice !== saved;

  const option = (mode: CurrencyDisplay, title: string, hint: string) => (
    <label className={`sb-gc-mod sb-cdisp-opt ${choice === mode ? 'is-on' : ''}`}>
      <span className="sb-gc-mod-main">
        <span className="sb-gc-mod-name">{title}</span>
        <span className="sb-gc-mod-why">{hint}</span>
        <bdi dir="ltr" className="sb-cdisp-sample">{currencyLabel(base, mode)} {num(1234.5)}</bdi>
      </span>
      <input type="radio" name="currency_display" value={mode} checked={choice === mode} disabled={!canWrite}
        onChange={() => { setChoice(mode); save.reset(); }} data-testid={`cdisp-${mode}`} />
    </label>
  );

  return (
    <section className="sb-gc sb-gc-legal" data-testid="currency-display-settings">
      <div>
        <h3 className="sb-gc-h">{t('cdisp.title')}</h3>
        <p className="sb-gc-fine">{t('cdisp.intro')}</p>
      </div>
      <div className="sb-gc-grid2">
        {option('code', t('cdisp.code'), t('cdisp.code_hint'))}
        {option('symbol', t('cdisp.symbol'), t('cdisp.symbol_hint', { aed: DIRHAM_SIGN }))}
      </div>

      <div className="sb-cdisp-preview" data-testid="cdisp-preview">
        <span className="sb-gc-label">{t('cdisp.preview')}</span>
        <dl className="sb-gc-rows">
          <div className="sb-gc-row"><dt>{t('cdisp.p_invoice', { code: base })}</dt><dd><bdi dir="ltr">{currencyLabel(base, choice)} {num(12500)}</bdi></dd></div>
          <div className="sb-gc-row"><dt>{t('cdisp.p_refund')}</dt><dd><bdi dir="ltr">{currencyLabel(base, choice)} {num(-350.75)}</bdi></dd></div>
          <div className="sb-gc-row"><dt>{t('cdisp.p_foreign', { code: other })}</dt><dd><bdi dir="ltr">{currencyLabel(other, choice)} {num(980)}</bdi></dd></div>
        </dl>
        <p className="sb-gc-fine">{t('cdisp.note')}</p>
      </div>

      {canWrite ? (
        <div className="sb-gc-actions">
          <button type="button" className="sb-primary-btn" disabled={!dirty || save.isPending} onClick={() => save.mutate()} data-testid="cdisp-save">
            {save.isPending ? t('cdisp.saving') : t('cdisp.save')}
          </button>
          <button type="button" className="sb-secondary-btn" disabled={!dirty || save.isPending} onClick={() => { setChoice(saved); save.reset(); }}>
            {t('cdisp.cancel')}
          </button>
          {save.isSuccess && !dirty && <span role="status" className="sb-gc-ok sb-gc-inline"><CheckCircle2 size={15} aria-hidden="true" />{t('cdisp.saved')}</span>}
          {save.isError && <span role="alert" className="sb-gc-err">{t('cdisp.save_failed')} {(save.error as Error).message}</span>}
        </div>
      ) : <p className="sb-gc-fine">{t('cdisp.read_only')}</p>}
    </section>
  );
}
