/**
 * Global v1 wizard — the information steps (1, 3, 4, 6) and the Review step
 * (7). Steps 2 and 5 reuse ActivityPicker and ModulePanel.
 */
import { useTranslation } from 'react-i18next';
import { Badge } from '@/ui/badge';
import { getModule, type CountryPack, type GlobalConfiguration, type ModuleKey } from '@/core/global-config';
import { COMPLIANCE_KEY, ISSUE_KEY } from './labels';

const row = 'flex items-center justify-between gap-3 border-b border-border-subtle py-2 text-sm';

export function IdentityStep({ company_name, pack }: { company_name: string; pack: CountryPack }) {
  const { t, i18n } = useTranslation();
  return (
    <div>
      <div className={row}><span className="text-ink-secondary">{t('global_config.wizard.company')}</span><span>{company_name}</span></div>
      <div className={row}><span className="text-ink-secondary">{t('global_config.country')}</span><span>{i18n.language === 'ar' ? pack.name_ar : pack.name}</span></div>
      <div className={row}><span className="text-ink-secondary">{t('global_config.single_entity')}</span><Badge variant="muted">v1</Badge></div>
    </div>
  );
}

export function AccountingStep({ pack }: { pack: CountryPack }) {
  const { t } = useTranslation();
  return (
    <div>
      <div className={row}><span className="text-ink-secondary">{t('global_config.wizard.base_currency')}</span><span dir="ltr">{pack.currency}</span></div>
      <div className={row}><span className="text-ink-secondary">{t('global_config.wizard.fiscal_start_month')}</span><span dir="ltr">{pack.fiscal_year_start_month}</span></div>
      <div className={row}><span className="text-ink-secondary">{t('global_config.wizard.costing')}</span><span>{t('global_config.wizard.costing_mac')}</span></div>
    </div>
  );
}

export function TaxStep({ pack }: { pack: CountryPack }) {
  const { t } = useTranslation();
  return (
    <div>
      <div className={row}>
        <span className="text-ink-secondary">{t('global_config.wizard.compliance')}</span>
        <Badge variant={pack.compliance === 'statutory' ? 'success' : pack.compliance === 'generic' ? 'danger' : 'warning'}>{t(COMPLIANCE_KEY[pack.compliance])}</Badge>
      </div>
      <div className={row}><span className="text-ink-secondary">{t('global_config.wizard.tax_system')}</span><span dir="ltr">{pack.tax_system.toUpperCase()}</span></div>
    </div>
  );
}

export function BranchesStep() {
  const { t } = useTranslation();
  return <p className="text-sm text-ink-secondary">{t('global_config.wizard.branches_v1')}</p>;
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
    <div className="space-y-3 text-sm">
      <p>{config.valid ? <Badge variant="success">{t('global_config.valid')}</Badge> : <Badge variant="danger">{t('global_config.invalid')}</Badge>}</p>
      {config.issues.length > 0 && (
        <ul className="list-disc ps-5 text-ink-secondary">
          {config.issues.map((i, n) => <li key={n}>{t(ISSUE_KEY[i.code], { detail: i.detail ?? i.subject })}</li>)}
        </ul>
      )}
      <p className="text-ink-secondary">{t('global_config.wizard.modules_on', { count: config.modules.length })}: {config.modules.map(name).join(', ')}</p>
      {dropped.length > 0 && (
        <p className="text-warning-500" data-testid="dropped">{t('global_config.wizard.will_turn_off')}: {dropped.map(name).join(', ')}</p>
      )}
      {error && <p className="text-danger-500">{error}</p>}
      {saved && <p className="text-success-500" data-testid="saved">{t('global_config.wizard.saved')}</p>}
      {canWrite ? (
        <button type="button" disabled={!config.valid || saving} onClick={onSave} data-testid="save"
          className="rounded-pill bg-brand-500 px-4 py-2 text-white disabled:opacity-50">
          {saving ? t('global_config.wizard.saving') : t('global_config.wizard.save')}
        </button>
      ) : (
        <p className="text-ink-secondary" data-testid="read-only">{t('global_config.wizard.read_only')}</p>
      )}
    </div>
  );
}
