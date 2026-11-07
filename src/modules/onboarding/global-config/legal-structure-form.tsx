/**
 * Global v1, Phase 2 — legal structure and registration (global05), shown on
 * the Organization step of Settings → Business configuration.
 *
 * Saved on its own (explicit Save button, no auto-save) through the existing
 * companies.update path: RLS already limits it to the caller's company and
 * settings.write. The same rules are enforced by the database checks.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import {
  legalFormsFor, normaliseLegal, registrationKind, validateLegal,
  type LegalError, type LegalForm, type LegalStructure,
} from '@/core/global-config';

const input = 'w-full rounded-pill border border-border-subtle bg-surface-card px-3 py-1.5 text-sm';
const label = 'mb-1 block text-xs font-medium text-ink-secondary';

export function LegalStructureForm({ company_id, country_code, initial, canWrite }: {
  company_id: string; country_code: string; initial: LegalStructure; canWrite: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [v, setV] = useState<LegalStructure>(initial);
  const [shown, setShown] = useState(false);
  const errors = validateLegal(country_code, v);
  const dirty = JSON.stringify(normaliseLegal(v)) !== JSON.stringify(normaliseLegal(initial));

  const save = useMutation({
    mutationFn: () => getAdapter().companies.update(company_id, normaliseLegal(v) as never),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['company', company_id] }),
  });

  const formName = (f: LegalForm): string => {
    switch (f) {
      case 'sole_proprietorship': return t('global_config.legal.form_sole_proprietorship');
      case 'partnership': return t('global_config.legal.form_partnership');
      case 'llp': return t('global_config.legal.form_llp');
      case 'private_limited': return t('global_config.legal.form_private_limited');
      case 'public_limited': return t('global_config.legal.form_public_limited');
      case 'one_person_company': return t('global_config.legal.form_one_person_company');
      case 'llc': return t('global_config.legal.form_llc');
      case 'free_zone_entity': return t('global_config.legal.form_free_zone_entity');
      case 'branch_of_foreign_company': return t('global_config.legal.form_branch_of_foreign_company');
      case 'civil_company': return t('global_config.legal.form_civil_company');
      case 'joint_stock_company': return t('global_config.legal.form_joint_stock_company');
      case 'nonprofit': return t('global_config.legal.form_nonprofit');
      case 'government': return t('global_config.legal.form_government');
      default: return t('global_config.legal.form_other');
    }
  };
  const regLabel = (): string => {
    switch (registrationKind(country_code, v.legal_form)) {
      case 'cin': return t('global_config.legal.reg_cin');
      case 'llpin': return t('global_config.legal.reg_llpin');
      case 'trade_licence': return t('global_config.legal.reg_trade_licence');
      default: return t('global_config.legal.reg_registration');
    }
  };
  const errText = (e?: LegalError): string | null => {
    switch (e) {
      case 'cin_format': return t('global_config.legal.err_cin_format');
      case 'llpin_format': return t('global_config.legal.err_llpin_format');
      case 'too_long': return t('global_config.legal.err_too_long');
      case 'bad_date': return t('global_config.legal.err_bad_date');
      case 'unknown_form': return t('global_config.legal.err_unknown_form');
      default: return null;
    }
  };
  const set = (k: keyof LegalStructure) => (e: { target: { value: string } }) =>
    setV((p) => ({ ...p, [k]: e.target.value || null }));
  const err = (k: keyof LegalStructure) => {
    const m = shown ? errText(errors[k]) : null;
    return m ? <p className="mt-1 text-xs text-danger-500" data-testid={`legal-error-${k}`}>{m}</p> : null;
  };

  return (
    <section className="mt-4 space-y-3 text-sm" data-testid="legal-structure">
      <h3 className="font-semibold text-ink-primary">{t('global_config.legal.title')}</h3>
      <p className="text-xs text-ink-tertiary">{t('global_config.legal.intro')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="legal_form">{t('global_config.legal.legal_form')}</label>
          <select id="legal_form" className={input} value={v.legal_form ?? ''} disabled={!canWrite}
            onChange={(e) => setV((p) => ({ ...p, legal_form: (e.target.value || null) as LegalForm | null }))}>
            <option value="">{t('global_config.legal.choose')}</option>
            {legalFormsFor(country_code).map((f) => <option key={f} value={f}>{formName(f)}</option>)}
          </select>
          {err('legal_form')}
        </div>
        <div>
          <label className={label} htmlFor="legal_name">{t('global_config.legal.legal_name')}</label>
          <input id="legal_name" className={input} value={v.legal_name ?? ''} maxLength={200} disabled={!canWrite} onChange={set('legal_name')} />
          {err('legal_name')}
        </div>
        <div>
          <label className={label} htmlFor="registration_number">{regLabel()}</label>
          <input id="registration_number" dir="ltr" className={input} value={v.registration_number ?? ''} maxLength={50}
            disabled={!canWrite} onChange={set('registration_number')} />
          {err('registration_number')}
        </div>
        <div>
          <label className={label} htmlFor="registration_authority">{t('global_config.legal.registration_authority')}</label>
          <input id="registration_authority" className={input} value={v.registration_authority ?? ''} maxLength={120}
            disabled={!canWrite} onChange={set('registration_authority')} />
          {err('registration_authority')}
        </div>
        <div>
          <label className={label} htmlFor="incorporation_date">{t('global_config.legal.incorporation_date')}</label>
          <input id="incorporation_date" type="date" dir="ltr" className={input} value={v.incorporation_date ?? ''}
            disabled={!canWrite} onChange={set('incorporation_date')} />
          {err('incorporation_date')}
        </div>
      </div>
      {canWrite ? (
        <div className="flex items-center gap-3">
          <button type="button" data-testid="legal-save" disabled={!dirty || save.isPending}
            className="rounded-pill bg-brand-500 px-4 py-1.5 text-sm text-white disabled:opacity-50"
            onClick={() => { setShown(true); if (Object.keys(errors).length === 0) save.mutate(); }}>
            {t('global_config.legal.save')}
          </button>
          <button type="button" disabled={!dirty || save.isPending} className="rounded-pill px-4 py-1.5 text-sm text-ink-secondary disabled:opacity-50"
            onClick={() => { setV(initial); setShown(false); }}>
            {t('global_config.legal.cancel')}
          </button>
          {save.isSuccess && !dirty && <span role="status" className="text-xs text-success-500">{t('global_config.legal.saved')}</span>}
          {save.isError && <span className="text-xs text-danger-500">{(save.error as Error).message}</span>}
        </div>
      ) : <p className="text-xs text-ink-tertiary">{t('global_config.legal.read_only')}</p>}
    </section>
  );
}
