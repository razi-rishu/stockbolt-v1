/**
 * Small shared pieces for the Control Center views (phase142): the metric
 * info popover, the KPI tile, and the date-range control (URL-backed).
 */
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Info, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { METRICS, type MetricKey } from './admin-metrics';

/** ⓘ with the metric's definition and data source (hover, focus or tap). */
export function MetricInfo({ metric }: { metric: MetricKey }) {
  const { t } = useTranslation();
  const m = METRICS[metric];
  return (
    <span className="sb-adm-info" tabIndex={0} role="button" aria-label={`${t(m.label)}: ${t(m.definition)}`}
      onClick={(e) => e.stopPropagation()}>
      <Info size={13} aria-hidden="true" />
      <span className="sb-adm-info-pop" role="tooltip">
        <strong>{t(m.label)}</strong>
        <span>{t(m.definition)}</span>
        <code dir="ltr">{m.source}</code>
      </span>
    </span>
  );
}

export function KpiTile({ icon, metric, label, value, sub, delta, tone, onClick, testid }: {
  icon: ReactNode; metric: MetricKey; label: string; value: string; sub?: string; delta?: number | null;
  tone?: 'warn' | 'muted'; onClick?: () => void; testid?: string;
}) {
  return (
    <div className={`sb-card sb-adm-kpi ${tone ? `is-${tone}` : ''} ${onClick ? 'is-click' : ''}`} data-testid={testid}
      role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick}
      onKeyDown={(e) => { if (onClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick(); } }}>
      <span className="sb-adm-kpi-top">
        <span className="sb-adm-kpi-ico" aria-hidden="true">{icon}</span>
        <span className="sb-adm-kpi-right">
          {delta != null && Number.isFinite(delta) && (
            <span className={`sb-adm-delta ${delta >= 0 ? 'is-up' : 'is-down'}`} dir="ltr">
              {delta >= 0 ? <ArrowUpRight size={13} aria-hidden="true" /> : <ArrowDownRight size={13} aria-hidden="true" />}
              {Math.abs(Math.round(delta))}%
            </span>
          )}
          <MetricInfo metric={metric} />
        </span>
      </span>
      <span className="sb-adm-kpi-label">{label}</span>
      <bdi dir="ltr" className="sb-adm-kpi-val">{value}</bdi>
      {sub && <span className="sb-adm-kpi-sub">{sub}</span>}
    </div>
  );
}

export function pctChange(now: number, prev: number): number | null {
  return prev > 0 ? ((now - prev) / prev) * 100 : null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
export function presetRange(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(Date.now() - (days - 1) * 86400_000);
  return { from: iso(from), to: iso(to) };
}

/** Date range stored in the URL (?from=&to=) so a view can be bookmarked or shared. */
export function useUrlRange(defaultDays = 30): { from: string; to: string; setRange: (from: string, to: string) => void } {
  const [params, setParams] = useSearchParams();
  const def = presetRange(defaultDays);
  const from = params.get('from') ?? def.from;
  const to = params.get('to') ?? def.to;
  const setRange = (f: string, tt: string) => {
    const next = new URLSearchParams(params);
    next.set('from', f); next.set('to', tt);
    setParams(next, { replace: true });
  };
  return { from, to, setRange };
}

const PRESETS = [7, 30, 90, 365] as const;

export function RangeControl({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const { t } = useTranslation();
  const [custom, setCustom] = useState(false);
  const [f, setF] = useState(from);
  const [tt, setT] = useState(to);
  const activeDays = PRESETS.find((n) => { const p = presetRange(n); return p.from === from && p.to === to; });
  const label = (n: number) => (n === 365 ? t('adminCC.r_12m') : t('adminCC.r_days', { count: n }));
  const invalid = !f || !tt || f > tt;
  return (
    <div className="sb-adm-range" data-testid="admin-range">
      <div className="sb-adm-chips" role="group" aria-label={t('adminCC.range')}>
        {PRESETS.map((n) => (
          <button key={n} type="button" className={`sb-adm-chip ${activeDays === n && !custom ? 'is-on' : ''}`}
            aria-pressed={activeDays === n && !custom}
            onClick={() => { const p = presetRange(n); setCustom(false); onChange(p.from, p.to); }}>{label(n)}</button>
        ))}
        <button type="button" className={`sb-adm-chip ${custom || !activeDays ? 'is-on' : ''}`} aria-pressed={custom || !activeDays}
          onClick={() => { setF(from); setT(to); setCustom(true); }}>{t('adminCC.r_custom')}</button>
      </div>
      {(custom || !activeDays) && (
        <form className="sb-adm-range-form" onSubmit={(e) => { e.preventDefault(); if (!invalid) { onChange(f, tt); } }}>
          <label><span>{t('adminCC.r_from')}</span><input type="date" dir="ltr" value={f} max={tt || undefined} onChange={(e) => setF(e.target.value)} /></label>
          <label><span>{t('adminCC.r_to')}</span><input type="date" dir="ltr" value={tt} min={f || undefined} onChange={(e) => setT(e.target.value)} /></label>
          <button type="submit" className="sb-primary-btn sb-btn-inline" disabled={invalid}>{t('adminCC.r_apply')}</button>
          {invalid && <span className="sb-adm-range-err" role="alert">{t('adminCC.r_invalid')}</span>}
        </form>
      )}
    </div>
  );
}
