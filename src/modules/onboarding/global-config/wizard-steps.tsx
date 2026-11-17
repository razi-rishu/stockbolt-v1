/**
 * Global v1 wizard — the information steps (1, 4) and the Review step (7).
 * Steps 2 and 5 reuse ActivityPicker and ModulePanel; step 3 is
 * accounting-step.tsx (Phase 3) and step 6 is branches-step.tsx (Phase 6).
 */
import { useTranslation } from 'react-i18next';
import { getModule, type CountryPack, type GlobalConfiguration, type ModuleKey } from '@/core/global-config';
import { COMPLIANCE_KEY, ISSUE_KEY } from './labels';

// Ocean Teal (UI v1.1): look only.
const COMPLIANCE_TONE = { statutory: 'is-success', generic: 'is-danger' } as Record<string, string>;

export function IdentityStep({ company_name, pack }: { company_name: string; pack: CountryPack }) {
  const { t, i18n } = useTranslation();
  return (
    <dl className="sb-gc-rows">
      <div className="sb-gc-row"><dt>{t('global_config.wizard.company')}</dt><dd>{company_name}</dd></div>
      <div className="sb-gc-row"><dt>{t('global_config.country')}</dt><dd>{i18n.language === 'ar' ? pack.name_ar : pack.name}</dd></div>
      <div className="sb-gc-row"><dt>{t('global_config.single_entity')}</dt><dd><span className="sb-gc-tag" dir="ltr">v1</span></dd></div>
    </dl>
  );
}

export function TaxStep({ pack }: { pack: CountryPack }) {
  const { t } = useTranslation();
  return (
    <dl className="sb-gc-rows">
      <div className="sb-gc-row">
        <dt>{t('global_config.wizard.compliance')}</dt>
        <dd><span className={`sb-gc-tag ${COMPLIANCE_TONE[pack.compliance] ?? 'is-warn'}`}>{t(COMPLIANCE_KEY[pack.compliance])}</span></dd>
      </div>
      <div className="sb-gc-row"><dt>{t('global_config.wizard.tax_system')}</dt><dd dir="ltr">{pack.tax_system.toUpperCase()}</dd></div>
    </dl>
  );
}

interface ReviewStepProps {
  config: GlobalConfiguration;
  dropped: ModuleKey[];
  saving: boolean;
  saved: boolean;
  error: string;
  canWrite: boolean;
  onSave: () => void;
}

export function ReviewStep({ config, dropped, saving, saved, error, canWrite, onSave }: ReviewStepProps) {
  const { t, i18n } = useTranslation();
  const name = (k: ModuleKey) => getModule(k)[i18n.language === 'ar' ? 'name_ar' : 'name'];
  return (
    <div className="sb-gc">
      <p className="sb-gc-fine">
        {config.valid
          ? <span className="sb-gc-tag is-success">{t('global_config.valid')}</span>
          : <span className="sb-gc-tag is-danger">{t('global_config.invalid')}</span>}
      </p>
      {config.issues.length > 0 && (
        <ul className="sb-gc-issues">
          {config.issues.map((i, n) => <li key={n}>{t(ISSUE_KEY[i.code], { detail: i.detail ?? i.subject })}</li>)}
        </ul>
      )}
      <div className="sb-gc-field">
        <span className="sb-gc-label">{t('global_config.wizard.modules_on', { count: config.modules.length })}</span>
        <div className="sb-gc-chips">{config.modules.map((k) => <span key={k} className="sb-gc-tag is-brand">{name(k)}</span>)}</div>
      </div>
      {dropped.length > 0 && (
        <p className="sb-alert sb-alert-warn" data-testid="dropped">{t('global_config.wizard.will_turn_off')}: {dropped.map(name).join(', ')}</p>
      )}
      {error && <p className="sb-gc-err">{error}</p>}
      {saved && <p className="sb-gc-ok" data-testid="saved">{t('global_config.wizard.saved')}</p>}
      {canWrite ? (
        <div className="sb-gc-actions">
          <button type="button" disabled={!config.valid || saving} onClick={onSave} data-testid="save" className="sb-primary-btn">
            {saving ? t('global_config.wizard.saving') : t('global_config.wizard.save')}
          </button>
        </div>
      ) : (
        <p className="sb-gc-fine" data-testid="read-only">{t('global_config.wizard.read_only')}</p>
      )}
    </div>
  );
}
