/**
 * Global v1 — the seven-step Smart Hybrid wizard for an EXISTING company.
 * App.tsx registers it at /dev/global-setup in development and at
 * Settings → Business Configuration while VITE_GLOBAL_ONBOARDING is on.
 *
 * Opens with the company's saved configuration, or, for a legacy company, with
 * exactly what it has today (legacyConfiguration). Step 2 picks activities,
 * step 5 adjusts modules, step 7 validates and saves through
 * save_company_configuration (global01), which writes only the caller's own
 * company and needs settings.write.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/ui/card';
import { getAdapter } from '@/data/index';
import { useCompany, useProjectsEnabled } from '@/hooks/use-company-currency';
import { useAuthStore } from '@/store/auth';
import { hasPerm } from '@/lib/permissions';
import {
  WIZARD_STEPS, buildConfiguration, choicesFrom, droppedModules, effectiveConfiguration, getCountryPack,
  toStoredConfiguration, type ModuleKey, type WizardChoices,
} from '@/core/global-config';
import { ActivityPicker } from './activity-picker';
import { ModulePanel } from './module-panel';
import { AccountingStep, BranchesStep, IdentityStep, ReviewStep, TaxStep } from './wizard-steps';

const STEP_LABEL: Record<(typeof WIZARD_STEPS)[number]['key'], string> = {
  organization_identity: 'global_config.wizard.s1', business_activities: 'global_config.wizard.s2',
  accounting_setup: 'global_config.wizard.s3', taxation_compliance: 'global_config.wizard.s4',
  module_configuration: 'global_config.wizard.s5', branches_team: 'global_config.wizard.s6',
  review_activation: 'global_config.wizard.s7',
};

export default function GlobalSetupWizardPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const company = useCompany();
  // Viewing needs settings.read (the route); saving needs settings.write,
  // which save_company_configuration also enforces on the server.
  const { role, permissions } = useAuthStore();
  const canWrite = hasPerm(role, permissions, 'settings.write');
  const projectsEnabled = useProjectsEnabled();
  const country = company?.country_code ?? 'AE';
  const pack = getCountryPack(country);
  const [step, setStep] = useState(0);
  const [choices, setChoices] = useState<WizardChoices | null>(null);

  const { data: stored, isLoading } = useQuery({
    queryKey: ['company_configuration', company?.id],
    queryFn: () => getAdapter().companyConfiguration.get(company!.id),
    enabled: !!company?.id,
  });
  const current = useMemo(
    () => (company && !isLoading ? effectiveConfiguration(stored ?? null, { country_code: country, projects_enabled: projectsEnabled }) : null),
    [company, isLoading, stored, country, projectsEnabled],
  );
  useEffect(() => { if (current && !choices) setChoices(choicesFrom(current)); }, [current, choices]);

  const config = useMemo(() => (choices
    ? buildConfiguration({ country_code: country, activities: { activity_keys: choices.activity_keys, primary_activity_key: choices.primary_activity_key || undefined }, modules: { enable: choices.enable, disable: choices.disable } })
    : null), [choices, country]);

  const save = useMutation({
    mutationFn: () => getAdapter().companyConfiguration.save(toStoredConfiguration(config!)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['company_configuration', company?.id] }),
  });

  if (!company || !choices || !config || !current) return <p className="p-4 text-sm text-ink-secondary">{t('common.loading')}</p>;

  const toggleActivity = (k: string) => setChoices((c) => {
    const acts = c!.activity_keys.includes(k) ? c!.activity_keys.filter((x) => x !== k) : [...c!.activity_keys, k];
    return { ...c!, activity_keys: acts, primary_activity_key: acts.includes(c!.primary_activity_key) ? c!.primary_activity_key : acts[0] ?? '' };
  });
  const toggleModule = (k: ModuleKey, on: boolean) => setChoices((c) => ({
    ...c!, enable: on ? [...c!.enable.filter((x) => x !== k), k] : c!.enable.filter((x) => x !== k),
    disable: on ? c!.disable.filter((x) => x !== k) : [...c!.disable.filter((x) => x !== k), k],
  }));
  const key = WIZARD_STEPS[step].key;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <h1 className="text-xl font-semibold text-ink-primary">{t('global_config.wizard.title')}</h1>
      <ol className="flex flex-wrap gap-2" aria-label={t('global_config.wizard.title')}>
        {WIZARD_STEPS.map((s, i) => (
          <li key={s.key}>
            <button type="button" onClick={() => setStep(i)} aria-current={i === step ? 'step' : undefined}
              className={`rounded-pill px-3 py-1 text-xs ${i === step ? 'bg-brand-500 text-white' : 'bg-surface-muted text-ink-secondary'}`}>
              {s.step}. {t(STEP_LABEL[s.key])}
            </button>
          </li>
        ))}
      </ol>
      <Card padding="md" data-testid={`step-${key}`}>
        {key === 'organization_identity' && <IdentityStep company_name={company.name} pack={pack} />}
        {key === 'business_activities' && <ActivityPicker selected={choices.activity_keys} primary={choices.primary_activity_key}
          onToggle={toggleActivity} onPrimary={(k) => setChoices((c) => ({ ...c!, primary_activity_key: k }))} />}
        {key === 'accounting_setup' && <AccountingStep pack={pack} />}
        {key === 'taxation_compliance' && <TaxStep pack={pack} />}
        {key === 'module_configuration' && <ModulePanel recommendations={config.recommendations} enabled={config.modules} rejected={config.issues} onToggle={toggleModule} />}
        {key === 'branches_team' && <BranchesStep />}
        {key === 'review_activation' && <ReviewStep config={config} dropped={droppedModules(current, config)} saving={save.isPending}
          saved={save.isSuccess} error={save.error instanceof Error ? save.error.message : ''} canWrite={canWrite} onSave={() => save.mutate()} />}
      </Card>
      <div className="flex justify-between">
        <button type="button" disabled={step === 0} onClick={() => setStep((s) => s - 1)} className="rounded-pill bg-surface-muted px-4 py-2 text-sm disabled:opacity-50">{t('global_config.wizard.back')}</button>
        <button type="button" disabled={step === WIZARD_STEPS.length - 1} onClick={() => setStep((s) => s + 1)} className="rounded-pill bg-brand-500 px-4 py-2 text-sm text-white disabled:opacity-50">{t('global_config.wizard.next')}</button>
      </div>
    </div>
  );
}
