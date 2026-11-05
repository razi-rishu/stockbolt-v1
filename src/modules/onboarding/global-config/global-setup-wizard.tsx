/**
 * Global v1 — the seven-step Smart Hybrid wizard for an EXISTING company.
 * App.tsx registers it at /dev/global-setup in development and at
 * Settings → Business Configuration while VITE_GLOBAL_ONBOARDING is on.
 *
 * Opens with the company's saved configuration, or, for a legacy company, with
 * exactly what it has today (legacyConfiguration).
 *  - Step 2 picks activities, step 5 adjusts modules, step 7 saves through
 *    save_company_configuration (global01: own company, settings.write).
 *  - Step 3 (Phase 3) reviews currency, financial year, chart template and
 *    costing; the financial year can change only before the first transaction
 *    (global02 enforces it in the database).
 *  - Step 6 (Phase 6) manages branches, warehouse branches and user branch
 *    assignments (global03; assignments don't restrict access in v1).
 *  - Phase 7: choices autosave to the user's draft and resume after a reload.
 *    A new company whose activation stopped after the company was created
 *    (its onboarding draft points at this company and no configuration was
 *    saved) is offered here to finish, starting from what it had chosen.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/ui/card';
import { getAdapter } from '@/data/index';
import { useCompany, useProjectsEnabled } from '@/hooks/use-company-currency';
import { useAuthStore } from '@/store/auth';
import { hasPerm } from '@/lib/permissions';
import {
  WIZARD_STEPS, buildConfiguration, choicesFrom, droppedModules, effectiveConfiguration, getCountryPack,
  isModuleKey, toStoredConfiguration, type ModuleKey, type WizardChoices,
} from '@/core/global-config';
import { ActivityPicker } from './activity-picker';
import { ModulePanel } from './module-panel';
import { IdentityStep, ReviewStep, TaxStep } from './wizard-steps';
import { AccountingStep } from './accounting-step';
import { BranchesManager } from './branches-step';
import { useSetupDraft } from './use-setup-draft';

const STEP_LABEL: Record<(typeof WIZARD_STEPS)[number]['key'], string> = {
  organization_identity: 'global_config.wizard.s1', business_activities: 'global_config.wizard.s2',
  accounting_setup: 'global_config.wizard.s3', taxation_compliance: 'global_config.wizard.s4',
  module_configuration: 'global_config.wizard.s5', branches_team: 'global_config.wizard.s6',
  review_activation: 'global_config.wizard.s7',
};

/** Choices from a stored draft, keeping only well-formed keys (the engine re-validates the rest). */
function choicesFromDraft(raw: unknown): WizardChoices | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const acts = strs(r.activity_keys);
  if (acts.length === 0) return null;
  const primary = typeof r.primary_activity_key === 'string' ? r.primary_activity_key : typeof r.primary === 'string' ? r.primary : acts[0];
  return { activity_keys: acts, primary_activity_key: acts.includes(primary) ? primary : acts[0],
    enable: strs(r.enable).filter(isModuleKey), disable: strs(r.disable).filter(isModuleKey) };
}

export default function GlobalSetupWizardPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const company = useCompany();
  // Viewing needs settings.read (the route); saving needs settings.write,
  // which save_company_configuration also enforces on the server.
  const { role, permissions } = useAuthStore();
  const canWrite = hasPerm(role, permissions, 'settings.write');
  const canUsers = hasPerm(role, permissions, 'users.manage');
  const projectsEnabled = useProjectsEnabled();
  const country = company?.country_code ?? 'AE';
  const pack = getCountryPack(country);
  const [step, setStep] = useState(0);
  const [choices, setChoices] = useState<WizardChoices | null>(null);
  const [unfinished, setUnfinished] = useState(false);

  const { data: stored, isLoading } = useQuery({
    queryKey: ['company_configuration', company?.id],
    queryFn: () => getAdapter().companyConfiguration.get(company!.id),
    enabled: !!company?.id,
  });
  const { data: locked = false } = useQuery({
    queryKey: ['company_has_transactions', company?.id],
    queryFn: () => getAdapter().companyConfiguration.hasTransactions(company!.id),
    enabled: !!company?.id,
  });
  const { data: coa = [] } = useQuery({
    queryKey: ['coa', company?.id],
    queryFn: () => getAdapter().coa.list(company!.id),
    enabled: !!company?.id,
  });
  const current = useMemo(
    () => (company && !isLoading ? effectiveConfiguration(stored ?? null, { country_code: country, projects_enabled: projectsEnabled }) : null),
    [company, isLoading, stored, country, projectsEnabled],
  );

  // Phase 7 — drafts: this wizard's own, and a new company's unfinished activation.
  const own = useSetupDraft('configuration', canWrite);
  const onboarding = useSetupDraft('onboarding', canWrite);
  const started = useRef(false);
  useEffect(() => {
    if (!current || started.current || !own.loaded || !onboarding.loaded || !company) return;
    started.current = true;
    const leftover = onboarding.draft?.company_id === company.id && !stored
      ? choicesFromDraft((onboarding.draft.payload as { global?: unknown }).global) : null;
    const mine = own.draft?.company_id === company.id ? choicesFromDraft((own.draft.payload as { choices?: unknown }).choices) : null;
    setChoices(leftover ?? mine ?? choicesFrom(current));
    if (leftover) setUnfinished(true);
    if (!leftover && mine) {
      const at = WIZARD_STEPS.findIndex((s) => s.key === own.draft!.step);
      if (at >= 0) setStep(at);
    }
  }, [current, own.loaded, onboarding.loaded, own.draft, onboarding.draft, company, stored]);

  useEffect(() => {
    if (!choices || !company || !canWrite || !started.current) return;
    own.save(WIZARD_STEPS[step].key, { choices }, company.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- save on every change of what the user chose
  }, [choices, step]);

  const config = useMemo(() => (choices
    ? buildConfiguration({ country_code: country, activities: { activity_keys: choices.activity_keys, primary_activity_key: choices.primary_activity_key || undefined }, modules: { enable: choices.enable, disable: choices.disable } })
    : null), [choices, country]);

  const save = useMutation({
    mutationFn: () => getAdapter().companyConfiguration.save(toStoredConfiguration(config!)),
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ['company_configuration', company?.id] });
      await own.remove();
      if (unfinished) { await onboarding.remove(); setUnfinished(false); }
    },
  });

  // Phase 3 — the financial year, only before the first transaction.
  const fyFromCompany = (company?.fiscal_year_start ?? '2000-01-01').slice(5, 7);
  const [fyMonth, setFyMonth] = useState<string | null>(null);
  const saveFy = useMutation({
    mutationFn: () => getAdapter().companies.update(company!.id, {
      fiscal_year_start: `${(company!.fiscal_year_start ?? `${new Date().getFullYear()}-01-01`).slice(0, 4)}-${fyMonth}-01`,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company', company?.id] });
      qc.invalidateQueries({ queryKey: ['company_has_transactions', company?.id] });
    },
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
  const fyEditable = canWrite && !locked;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <h1 className="text-xl font-semibold text-ink-primary">{t('global_config.wizard.title')}</h1>
      {unfinished && <p className="rounded-card border border-warning-500 p-3 text-sm" data-testid="unfinished-activation">{t('global_config.draft.unfinished')}</p>}
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
        {key === 'accounting_setup' && (
          <AccountingStep country_code={country} currency={company.base_currency ?? company.currency ?? pack.currency}
            fy_month={fyMonth ?? fyFromCompany} existing_accounts={coa.length} locked={locked}
            onFyMonth={fyEditable ? setFyMonth : undefined}
            onSaveFy={fyEditable && fyMonth && fyMonth !== fyFromCompany ? () => saveFy.mutate() : undefined}
            saving={saveFy.isPending} saved={saveFy.isSuccess}
            error={saveFy.error instanceof Error ? saveFy.error.message : ''} />
        )}
        {key === 'taxation_compliance' && <TaxStep pack={pack} />}
        {key === 'module_configuration' && <ModulePanel recommendations={config.recommendations} enabled={config.modules} rejected={config.issues} onToggle={toggleModule} />}
        {key === 'branches_team' && (
          <BranchesManager company_id={company.id} canSettings={canWrite} canUsers={canUsers}
            showWarehouses={config.modules.includes('inventory')} />
        )}
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
