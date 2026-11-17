/**
 * Global v1 — recommended modules with on/off switches (wizard step 5).
 * Shows why each module is recommended and why a switch was refused.
 */
import { useTranslation } from 'react-i18next';
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
  // Ocean Teal (UI v1.1): look only — the switch is still the same checkbox.
  return (
    <div className="sb-gc-mods">
      {MODULES.map((m) => {
        const on = enabled.includes(m.key);
        const reasons = reasonsFor(m.key);
        const refusal = rejected.find((i) => i.subject === m.key);
        return (
          <div key={m.key} data-module={m.key} data-enabled={on} className={`sb-gc-mod ${on ? 'is-on' : ''}`}>
            <div className="sb-gc-mod-main">
              <div className="sb-gc-mod-name">
                {ar ? m.name_ar : m.name}
                {m.essential && <span className="sb-gc-tag">{t('global_config.essential')}</span>}
                {reasons.length > 0 && !m.essential && <span className="sb-gc-tag is-brand">{t('global_config.recommended')}</span>}
              </div>
              {reasons.length > 0 && (
                <p className="sb-gc-mod-why">{t('global_config.because')}: {reasons.map(reasonLabel).join(' · ')}</p>
              )}
              {refusal && <p className="sb-gc-warn">{t(ISSUE_KEY[refusal.code], { detail: moduleName(refusal.detail) })}</p>}
            </div>
            <label className="sb-gc-switch">
              <span>{on ? t('global_config.on') : t('global_config.off')}</span>
              <input type="checkbox" role="switch" checked={on} disabled={m.essential}
                aria-label={ar ? m.name_ar : m.name} onChange={(e) => onToggle(m.key, e.target.checked)} />
            </label>
          </div>
        );
      })}
    </div>
  );
}
