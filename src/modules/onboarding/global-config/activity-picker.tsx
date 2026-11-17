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
  // Ocean Teal (UI v1.1): look only — same selection, same data-activity hooks.
  return (
    <div className="sb-gc-families">
      {INDUSTRY_FAMILIES.map((f) => {
        const acts = activitiesOf(f.key);
        const picked = acts.filter((a) => selected.includes(a.key)).length;
        return (
          <fieldset key={f.key} className={`sb-gc-family ${picked ? 'has-on' : ''}`}>
            <legend className="sb-gc-family-head">
              <bdi dir="ltr" className="sb-gc-family-no">{f.order}</bdi>
              <span className="sb-gc-family-name">{ar ? f.name_ar : f.name}</span>
              {picked > 0 && <span className="sb-gc-family-count">{t('gcOcean.picked', { count: picked })}</span>}
            </legend>
            {acts.map((a) => {
              const on = selected.includes(a.key);
              const isPrimary = primary === a.key;
              return (
                <div key={a.key} className={`sb-gc-act ${on ? 'is-on' : ''}`}>
                  <label>
                    <input type="checkbox" checked={on} onChange={() => onToggle(a.key)} data-activity={a.key} />
                    <span>{ar ? a.name_ar : a.name}</span>
                  </label>
                  {on && (
                    <button type="button" onClick={() => onPrimary(a.key)} aria-pressed={isPrimary}
                      className={`sb-gc-primary ${isPrimary ? 'is-primary' : ''}`}>
                      {t('global_config.primary')}
                    </button>
                  )}
                </div>
              );
            })}
          </fieldset>
        );
      })}
    </div>
  );
}
