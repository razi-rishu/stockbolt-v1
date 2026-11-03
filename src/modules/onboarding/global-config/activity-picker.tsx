/**
 * Global v1 — pick business activities across the 18 families (wizard step 2).
 * Presentational: the parent owns the selection.
 */
import { useTranslation } from 'react-i18next';
import { INDUSTRY_FAMILIES, activitiesOf } from '@/core/global-config';

interface ActivityPickerProps {
  selected: string[];
  primary: string;
  onToggle: (key: string) => void;
  onPrimary: (key: string) => void;
}

export function ActivityPicker({ selected, primary, onToggle, onPrimary }: ActivityPickerProps) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language === 'ar';
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {INDUSTRY_FAMILIES.map((f) => (
        <fieldset key={f.key} className="rounded-card border border-border-subtle p-3">
          <legend className="px-1 text-sm font-semibold text-ink-primary">
            {f.order}. {ar ? f.name_ar : f.name}
          </legend>
          {activitiesOf(f.key).map((a) => {
            const on = selected.includes(a.key);
            return (
              <div key={a.key} className="flex items-center justify-between gap-2 py-1">
                <label className="flex items-center gap-2 text-sm text-ink-primary">
                  <input type="checkbox" checked={on} onChange={() => onToggle(a.key)} data-activity={a.key} />
                  {ar ? a.name_ar : a.name}
                </label>
                {on && (
                  <button type="button" onClick={() => onPrimary(a.key)}
                    className={`rounded-pill px-2 py-0.5 text-xs ${primary === a.key ? 'bg-brand-500 text-white' : 'bg-surface-muted text-ink-secondary'}`}>
                    {t('global_config.primary')}
                  </button>
                )}
              </div>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}
