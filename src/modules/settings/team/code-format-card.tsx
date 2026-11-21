/**
 * Team (phase144) — employee code format: prefix, digits and the first number.
 * Applies to NEW employees only; existing codes never change. Saved through
 * companies.update (settings.write, RLS); the database CHECK enforces the same
 * rules as this form. The preview mirrors the server's code generator.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Hash } from 'lucide-react';
import { getAdapter } from '@/data/index';
import { CODE_PREFIX_RE, previewNextCode } from './team-lists';

export interface CodeFormat { employee_code_prefix: string; employee_code_digits: number; employee_code_start: number }

export function CodeFormatCard({ companyId, format, codes, canWrite }: {
  companyId: string;
  format: CodeFormat;
  codes: (string | null)[];
  canWrite: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [prefix, setPrefix] = useState(format.employee_code_prefix);
  const [digits, setDigits] = useState(String(format.employee_code_digits));
  const [start, setStart] = useState(String(format.employee_code_start));

  const d = Number(digits);
  const s = Number(start);
  const prefixOk = CODE_PREFIX_RE.test(prefix);
  const digitsOk = Number.isInteger(d) && d >= 1 && d <= 8;
  const startOk = Number.isInteger(s) && s >= 1 && s <= 99999999;
  const valid = prefixOk && digitsOk && startOk;
  const dirty = prefix !== format.employee_code_prefix || d !== format.employee_code_digits || s !== format.employee_code_start;
  const next = valid ? previewNextCode(codes, prefix, d, s) : '—';

  const save = useMutation({
    mutationFn: () => getAdapter().companies.update(companyId, {
      employee_code_prefix: prefix, employee_code_digits: d, employee_code_start: s,
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['company', companyId] }); },
  });

  return (
    <section className="sb-card sb-team-format" data-testid="team-code-format">
      <div className="sb-form-head">
        <span className="sb-form-icon" aria-hidden="true"><Hash size={20} /></span>
        <div>
          <h2 className="sb-form-title">{t('teamOcean.code_title')}</h2>
          <p className="sb-team-muted">{t('teamOcean.code_intro')}</p>
        </div>
      </div>
      <div className="sb-team-format-grid">
        <label className="sb-gc-field">
          <span className="sb-gc-label">{t('teamOcean.code_prefix')}</span>
          <input className="sb-team-input" dir="ltr" value={prefix} maxLength={10} disabled={!canWrite}
            onChange={(e) => { setPrefix(e.target.value); save.reset(); }} data-testid="team-code-prefix" />
          {!prefixOk && <span className="sb-gc-err">{t('teamOcean.code_prefix_rule')}</span>}
        </label>
        <label className="sb-gc-field">
          <span className="sb-gc-label">{t('teamOcean.code_digits')}</span>
          <input className="sb-team-input" dir="ltr" type="number" min={1} max={8} value={digits} disabled={!canWrite}
            onChange={(e) => { setDigits(e.target.value); save.reset(); }} data-testid="team-code-digits" />
          {!digitsOk && <span className="sb-gc-err">{t('teamOcean.code_digits_rule')}</span>}
        </label>
        <label className="sb-gc-field">
          <span className="sb-gc-label">{t('teamOcean.code_start')}</span>
          <input className="sb-team-input" dir="ltr" type="number" min={1} value={start} disabled={!canWrite}
            onChange={(e) => { setStart(e.target.value); save.reset(); }} data-testid="team-code-start" />
          {!startOk && <span className="sb-gc-err">{t('teamOcean.code_start_rule')}</span>}
        </label>
        <div className="sb-gc-field">
          <span className="sb-gc-label">{t('teamOcean.code_next')}</span>
          <bdi dir="ltr" className="sb-team-next" data-testid="team-code-preview">{next}</bdi>
        </div>
      </div>
      <p className="sb-team-muted">{t('teamOcean.code_note')}</p>
      {canWrite ? (
        <div className="sb-gc-actions">
          <button type="button" className="sb-primary-btn" disabled={!dirty || !valid || save.isPending} onClick={() => save.mutate()} data-testid="team-code-save">
            {save.isPending ? t('teamOcean.saving') : t('teamOcean.save')}
          </button>
          <button type="button" className="sb-secondary-btn" disabled={!dirty || save.isPending} onClick={() => {
            setPrefix(format.employee_code_prefix); setDigits(String(format.employee_code_digits)); setStart(String(format.employee_code_start)); save.reset();
          }}>{t('teamOcean.cancel')}</button>
          {save.isSuccess && !dirty && <span role="status" className="sb-gc-ok sb-gc-inline">{t('teamOcean.saved')}</span>}
          {save.isError && <span role="alert" className="sb-gc-err">{t('teamOcean.save_failed')} {(save.error as Error).message}</span>}
        </div>
      ) : <p className="sb-team-muted">{t('teamOcean.code_read_only')}</p>}
    </section>
  );
}
