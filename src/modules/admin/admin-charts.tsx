/**
 * Admin dashboard charts (phase141). One hue (Ocean teal), values labelled,
 * hover tooltips, and every bar/step clickable to filter the explorers below.
 */
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import { useTranslation } from 'react-i18next';

const TEAL = '#008F87';
const TEAL_SOFT = '#9ED9D3';

export function fmtInt(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString('en-US');
}

/** Daily bars for the chosen measure. Single series → no legend (the toggle names it). */
export function SignupsChart({ series, measure, lang }: {
  series: { day: string; signups: number; companies: number }[];
  measure: 'signups' | 'companies';
  lang: string;
}) {
  const { t } = useTranslation();
  const dayFmt = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short' });
  const fullFmt = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const data = series.map((s) => ({ ...s, label: dayFmt.format(new Date(s.day)) }));
  const today = series.length ? series[series.length - 1].day : '';
  const max = Math.max(1, ...series.map((s) => s[measure]));
  return (
    <div className="sb-adm-chart" dir="ltr" data-testid="admin-signups-chart">
      <ResponsiveContainer width="100%" height={240} minWidth={0}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barCategoryGap={series.length > 60 ? 1 : 3}>
          <CartesianGrid strokeDasharray="3 4" stroke="#E1E9ED" vertical={false} />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#607185' }}
            interval="preserveStartEnd" minTickGap={18} />
          <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#607185' }}
            domain={[0, Math.ceil(max * 1.15)]} width={40} />
          <Tooltip
            cursor={{ fill: 'rgba(0,143,135,0.08)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as { day: string; signups: number; companies: number };
              return (
                <div className="sb-adm-tip">
                  <strong>{fullFmt.format(new Date(p.day))}</strong>
                  <span>{t('adminOcean.m_signups')}: <b>{fmtInt(p.signups)}</b></span>
                  <span>{t('adminOcean.m_companies')}: <b>{fmtInt(p.companies)}</b></span>
                </div>
              );
            }}
          />
          <Bar dataKey={measure} radius={[4, 4, 0, 0]} maxBarSize={28}>
            {data.map((d) => <Cell key={d.day} fill={d.day === today ? TEAL : TEAL_SOFT} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface BarItem { key: string; label: string; value: number }

/** Horizontal bars with value and share; click a row to filter. */
export function BarList({ items, total, activeKey, onPick, emptyText, testid }: {
  items: BarItem[]; total: number; activeKey?: string | null;
  onPick?: (key: string) => void; emptyText: string; testid?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) return <p className="sb-adm-empty">{emptyText}</p>;
  return (
    <ul className="sb-adm-bars" data-testid={testid}>
      {items.map((i) => {
        const pct = total > 0 ? Math.round((i.value / total) * 100) : 0;
        const inner = (
          <>
            <span className="sb-adm-bar-label">{i.label}</span>
            <span className="sb-adm-bar-track"><span className="sb-adm-bar-fill" style={{ width: `${(i.value / max) * 100}%` }} /></span>
            <bdi dir="ltr" className="sb-adm-bar-val">{fmtInt(i.value)}<small>{pct}%</small></bdi>
          </>
        );
        return (
          <li key={i.key}>
            {onPick ? (
              <button type="button" className={`sb-adm-bar ${activeKey === i.key ? 'is-active' : ''}`} onClick={() => onPick(i.key)}
                title={`${i.label}: ${fmtInt(i.value)} (${pct}%)`} aria-pressed={activeKey === i.key}>
                {inner}
              </button>
            ) : <div className="sb-adm-bar">{inner}</div>}
          </li>
        );
      })}
    </ul>
  );
}

export interface FunnelStep { key: string; label: string; value: number; hint?: string; onPick?: () => void }

/** Each step as a bar against the first step, with the drop from the previous step. */
export function Funnel({ steps }: { steps: FunnelStep[] }) {
  const { t } = useTranslation();
  const first = Math.max(1, steps[0]?.value ?? 1);
  return (
    <ol className="sb-adm-funnel" data-testid="admin-funnel">
      {steps.map((s, i) => {
        const pct = Math.round((s.value / first) * 100);
        const prev = i > 0 ? steps[i - 1].value : null;
        const lost = prev != null ? Math.max(0, prev - s.value) : 0;
        const body = (
          <>
            <span className="sb-adm-fun-head">
              <span className="sb-adm-fun-no" dir="ltr">{i + 1}</span>
              <span className="sb-adm-fun-label">{s.label}</span>
              <bdi dir="ltr" className="sb-adm-fun-val">{fmtInt(s.value)} <small>{pct}%</small></bdi>
            </span>
            <span className="sb-adm-bar-track is-tall"><span className="sb-adm-bar-fill" style={{ width: `${Math.max(pct, s.value > 0 ? 2 : 0)}%` }} /></span>
            {lost > 0 && <span className="sb-adm-fun-lost">{t('adminOcean.f_lost', { count: lost })}{s.hint ? ` · ${s.hint}` : ''}</span>}
          </>
        );
        return (
          <li key={s.key}>
            {s.onPick
              ? <button type="button" className="sb-adm-fun-step" onClick={s.onPick}>{body}</button>
              : <div className="sb-adm-fun-step">{body}</div>}
          </li>
        );
      })}
    </ol>
  );
}
