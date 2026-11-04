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
  buildConfiguration, getActivity, getModule, toStoredConfiguration, validateActivities, type ModuleKey,
} from '@/core/global-config';
import { ActivityPicker } from './activity-picker';
import { ModulePanel } from './module-panel';

export const GLOBAL_ONBOARDING = import.meta.env.VITE_GLOBAL_ONBOARDING === 'true';

export function useGlobalOnboarding(country_code: string) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language === 'ar';
  const [activityKeys, setActivityKeys] = useState<string[]>([]);
  const [primary, setPrimary] = useState('');
  const [enable, setEnable] = useState<ModuleKey[]>([]);
  const [disable, setDisable] = useState<ModuleKey[]>([]);

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

  return {
    config,
    activitiesError,
    saveAfterCreate,
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
