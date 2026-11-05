/**
 * Global v1 — the business-activity and module steps of NEW-company
 * onboarding (setup-wizard.tsx), behind VITE_GLOBAL_ONBOARDING.
 *
 * With the flag off (the default, and production until global01 is applied
 * there) onboarding is exactly what it was: three steps and no configuration
 * row, so the new company is a legacy company with every module on.
 *
 * With the flag on, the company is created first (complete_onboarding, which
 * also sets companies.country_code) and the configuration is saved right
 * after through save_company_configuration — the RPC only ever writes the
 * caller's own company, so it can only run once the company exists. If that
 * save fails the company is still fully usable: it has no row, which reads as
 * the legacy configuration, and the configuration can be saved again later.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import {
  buildConfiguration, getActivity, getModule, isModuleKey, toStoredConfiguration, validateActivities, type ModuleKey,
} from '@/core/global-config';
import { ActivityPicker } from './activity-picker';
import { ModulePanel } from './module-panel';
import { BranchesOnboardingForm, branchCodeFrom, type BranchesDraft } from './branches-step';

export { GLOBAL_ONBOARDING } from '@/core/global-config/flag';

export function useGlobalOnboarding(country_code: string) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language === 'ar';
  const [activityKeys, setActivityKeys] = useState<string[]>([]);
  const [primary, setPrimary] = useState('');
  const [enable, setEnable] = useState<ModuleKey[]>([]);
  const [disable, setDisable] = useState<ModuleKey[]>([]);
  const [branches, setBranches] = useState<BranchesDraft>({ head_office: '', main_warehouse: '', extra: [] });

  // Rebuilt whenever the country or a choice changes: changing the country on
  // step 2 re-runs the recommendations, and country-only modules follow it.
  const config = useMemo(() => buildConfiguration({
    country_code,
    activities: { activity_keys: activityKeys, primary_activity_key: primary || undefined },
    modules: { enable, disable },
  }), [country_code, activityKeys, primary, enable, disable]);

  const toggleActivity = (k: string) => {
    const next = activityKeys.includes(k) ? activityKeys.filter((x) => x !== k) : [...activityKeys, k];
    setActivityKeys(next);
    if (!next.includes(primary)) setPrimary(next[0] ?? '');
  };
  const toggleModule = (k: ModuleKey, on: boolean) => {
    setEnable((e) => (on ? [...e.filter((x) => x !== k), k] : e.filter((x) => x !== k)));
    setDisable((d) => (on ? d.filter((x) => x !== k) : [...d.filter((x) => x !== k), k]));
  };

  /** The message that keeps the user on the activities step, or '' when it may continue. */
  const activitiesError = () =>
    validateActivities({ activity_keys: activityKeys, primary_activity_key: primary || undefined }).length > 0
      ? t('global_config.onboarding.need_activity') : '';

  /** Save after the company exists. Never throws: the company is usable without it. */
  const saveAfterCreate = async (): Promise<boolean> => {
    try {
      await getAdapter().companyConfiguration.save(toStoredConfiguration(config));
      return true;
    } catch (err) {
      // The company stays a legacy company (every module on) until saved again.
      // eslint-disable-next-line no-console
      console.error('[setup-wizard] company created; business configuration not saved:', err);
      return false;
    }
  };

  /**
   * Phase 6, after the company exists: name the Head Office (created by the
   * database with the company) and add the other branches. Never throws; a
   * failure leaves the default Head Office, which is a working setup.
   */
  const applyBranches = async (company_id: string): Promise<boolean> => {
    try {
      const ad = getAdapter();
      const existing = await ad.branches.list(company_id);
      const hq = existing.find((b) => b.is_default);
      const name = branches.head_office.trim();
      // A custom name replaces the default's Arabic name too, or Arabic users would
      // keep seeing 'المكتب الرئيسي' for a branch the owner renamed.
      if (hq && name && name !== hq.name) await ad.branches.update(hq.id, { name, name_ar: null });
      const taken = existing.map((b) => b.code);
      for (const extra of branches.extra) {
        if (existing.some((b) => b.name === extra)) continue; // resumed activation: already created
        const code = branchCodeFrom(extra, taken);
        taken.push(code);
        await ad.branches.create({ company_id, code, name: extra });
      }
      return true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[setup-wizard] company created; branches not fully set up:', err);
      return false;
    }
  };

  /** Phase 7: everything this hook holds, for the draft. */
  const snapshot = () => ({ activity_keys: activityKeys, primary, enable, disable, branches });
  /** Phase 7: restore a snapshot from a saved draft (unknown keys are re-validated by the engine). */
  const restore = (s: Partial<ReturnType<typeof snapshot>>) => {
    if (Array.isArray(s.activity_keys)) setActivityKeys(s.activity_keys.filter((k): k is string => typeof k === 'string'));
    if (typeof s.primary === 'string') setPrimary(s.primary);
    if (Array.isArray(s.enable)) setEnable(s.enable.filter(isModuleKey));
    if (Array.isArray(s.disable)) setDisable(s.disable.filter(isModuleKey));
    if (s.branches && typeof s.branches === 'object') {
      const b = s.branches;
      setBranches({ head_office: String(b.head_office ?? ''), main_warehouse: String(b.main_warehouse ?? ''),
        extra: Array.isArray(b.extra) ? b.extra.map(String).slice(0, 20) : [] });
    }
  };

  return {
    config,
    activitiesError,
    saveAfterCreate,
    applyBranches,
    snapshot,
    restore,
    branches,
    branchesStep: (
      <BranchesOnboardingForm value={branches} showWarehouse={config.modules.includes('inventory')} onChange={setBranches} />
    ),
    activitiesStep: (
      <ActivityPicker selected={activityKeys} primary={primary} onToggle={toggleActivity} onPrimary={setPrimary} />
    ),
    modulesStep: (
      <ModulePanel recommendations={config.recommendations} enabled={config.modules} rejected={config.issues} onToggle={toggleModule} />
    ),
    summary: {
      activities: activityKeys.map((k) => { const a = getActivity(k); return a ? (ar ? a.name_ar : a.name) : k; }).join(', '),
      modules: config.modules.map((k) => getModule(k)[ar ? 'name_ar' : 'name']).join(', '),
    },
  };
}
