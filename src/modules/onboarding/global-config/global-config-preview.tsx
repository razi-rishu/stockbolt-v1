/**
 * Global v1 — DEV-ONLY preview of the Country, Industry & Module Configuration
 * Engine. App.tsx registers its route only when import.meta.env.DEV, so it is
 * not in production or Android builds. It reads and writes nothing: it calls
 * the pure engine and shows the configuration a new organization would get.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/ui/card';
import { Badge } from '@/ui/badge';
import { COUNTRY_PACKS, buildConfiguration, getCountryPack, getModule, isModuleKey, type ModuleKey } from '@/core/global-config';
import { ActivityPicker } from './activity-picker';
import { ModulePanel } from './module-panel';
import { COMPLIANCE_KEY, ISSUE_KEY } from './labels';

const COUNTRY_CHOICES = [...COUNTRY_PACKS.map((p) => p.code), 'GB', 'US'];

export default function GlobalConfigPreviewPage() {
  const { t, i18n } = useTranslation();
  const [country, setCountry] = useState('AE');
  const [activities, setActivities] = useState<string[]>(['retail_store']);
  const [primary, setPrimary] = useState('retail_store');
  const [enable, setEnable] = useState<ModuleKey[]>([]);
  const [disable, setDisable] = useState<ModuleKey[]>([]);

  const config = useMemo(
    () => buildConfiguration({ country_code: country, activities: { activity_keys: activities, primary_activity_key: primary || undefined }, modules: { enable, disable } }),
    [country, activities, primary, enable, disable],
  );
  const pack = getCountryPack(country);

  const ar = i18n.language === 'ar';
  // Issue details are module keys or country codes: show the module's own name.
  const label = (d: string) => (isModuleKey(d) ? getModule(d)[ar ? 'name_ar' : 'name'] : d);
  const toggleActivity = (k: string) => {
    const next = activities.includes(k) ? activities.filter((x) => x !== k) : [...activities, k];
    setActivities(next);
    if (!next.includes(primary)) setPrimary(next[0] ?? '');
  };
  const toggleModule = (k: ModuleKey, on: boolean) => {
    setEnable((e) => (on ? [...e.filter((x) => x !== k), k] : e.filter((x) => x !== k)));
    setDisable((d) => (on ? d.filter((x) => x !== k) : [...d.filter((x) => x !== k), k]));
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4" dir={i18n.dir()}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary">{t('global_config.title')}</h1>
          <p className="text-sm text-ink-secondary">{t('global_config.subtitle')}</p>
        </div>
        <button type="button" className="rounded-pill bg-surface-muted px-3 py-1 text-sm"
          onClick={() => i18n.changeLanguage(i18n.language === 'ar' ? 'en' : 'ar')}>
          {i18n.language === 'ar' ? 'English' : 'العربية'}
        </button>
      </header>

      <Card padding="sm">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-ink-primary">
            {t('global_config.country')}{' '}
            <select value={country} onChange={(e) => setCountry(e.target.value)} className="rounded-pill bg-surface-muted px-3 py-1" data-testid="country">
              {COUNTRY_CHOICES.map((c) => <option key={c} value={c}>{c} — {getCountryPack(c)[i18n.language === 'ar' ? 'name_ar' : 'name']}</option>)}
            </select>
          </label>
          <Badge variant={pack.compliance === 'statutory' ? 'success' : pack.compliance === 'generic' ? 'danger' : 'warning'}>
            {t(COMPLIANCE_KEY[pack.compliance])}
          </Badge>
          {pack.currency && <Badge variant="muted">{pack.currency}</Badge>}
          <Badge variant="muted">{t('global_config.single_entity')}</Badge>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card padding="sm">
          <h2 className="mb-2 font-semibold text-ink-primary">{t('global_config.step2', { count: activities.length })}</h2>
          <ActivityPicker selected={activities} primary={primary} onToggle={toggleActivity} onPrimary={setPrimary} />
        </Card>
        <Card padding="sm">
          <h2 className="mb-2 font-semibold text-ink-primary">{t('global_config.step5', { count: config.modules.length })}</h2>
          <ModulePanel recommendations={config.recommendations} enabled={config.modules} rejected={config.issues} onToggle={toggleModule} />
        </Card>
      </div>

      <Card padding="sm" data-testid="result">
        <h2 className="font-semibold text-ink-primary">
          {t('global_config.step7')}: {config.valid ? <Badge variant="success">{t('global_config.valid')}</Badge> : <Badge variant="danger">{t('global_config.invalid')}</Badge>}
        </h2>
        <ul className="mt-2 list-disc ps-5 text-sm text-ink-secondary">
          {config.issues.map((i, n) => <li key={n}>{t(ISSUE_KEY[i.code], { detail: label(i.detail ?? i.subject) })}</li>)}
        </ul>
        <pre className="mt-2 overflow-x-auto rounded-card bg-surface-subtle p-3 text-xs" dir="ltr">
          {JSON.stringify({ ...config, recommendations: undefined }, null, 2)}
        </pre>
      </Card>
    </div>
  );
}
