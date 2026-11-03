/**
 * Global v1 — recommended modules with on/off switches (wizard step 5).
 * Shows why each module is recommended and why a switch was refused.
 */
import { useTranslation } from 'react-i18next';
import { Badge } from '@/ui/badge';
import { MODULES, getActivity, getModule, isModuleKey, type ConfigIssue, type ModuleKey, type Recommendation } from '@/core/global-config';
import { ISSUE_KEY } from './labels';

interface ModulePanelProps {
  recommendations: Recommendation[];
  enabled: ModuleKey[];
  rejected: ConfigIssue[];
  onToggle: (key: ModuleKey, on: boolean) => void;
}

export function ModulePanel({ recommendations, enabled, rejected, onToggle }: ModulePanelProps) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language === 'ar';
  // Issue details name a module key (required_by) or a country code: show the module's own name.
  const moduleName = (d?: string) => (d && isModuleKey(d) ? getModule(d)[ar ? 'name_ar' : 'name'] : d ?? '');
  const reasonsFor = (k: ModuleKey) => recommendations.find((r) => r.module === k)?.reasons ?? [];
  const reasonLabel = (r: string) => {
    if (r === 'essential') return t('global_config.reason_essential');
    if (r.startsWith('dependency:')) return t('global_config.reason_dependency', { module: getModule(r.slice(11) as ModuleKey)[ar ? 'name_ar' : 'name'] });
    if (r.startsWith('country:')) return t('global_config.reason_country', { country: r.slice(8) });
    const a = getActivity(r);
    return a ? (ar ? a.name_ar : a.name) : r;
  };
  return (
    <div className="space-y-2">
      {MODULES.map((m) => {
        const on = enabled.includes(m.key);
        const reasons = reasonsFor(m.key);
        const refusal = rejected.find((i) => i.subject === m.key);
        return (
          <div key={m.key} data-module={m.key} data-enabled={on}
            className={`flex items-start justify-between gap-3 rounded-card border p-3 ${on ? 'border-brand-200 bg-brand-50' : 'border-border-subtle'}`}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-primary">
                {ar ? m.name_ar : m.name}
                {m.essential && <Badge variant="muted">{t('global_config.essential')}</Badge>}
                {reasons.length > 0 && !m.essential && <Badge variant="brand">{t('global_config.recommended')}</Badge>}
              </div>
              {reasons.length > 0 && (
                <p className="mt-1 text-xs text-ink-secondary">{t('global_config.because')}: {reasons.map(reasonLabel).join(' · ')}</p>
              )}
              {refusal && <p className="mt-1 text-xs text-warning-500">{t(ISSUE_KEY[refusal.code], { detail: moduleName(refusal.detail) })}</p>}
            </div>
            <label className="flex shrink-0 items-center gap-1 text-xs text-ink-secondary">
              <input type="checkbox" checked={on} disabled={m.essential} onChange={(e) => onToggle(m.key, e.target.checked)} />
              {on ? t('global_config.on') : t('global_config.off')}
            </label>
          </div>
        );
      })}
    </div>
  );
}
