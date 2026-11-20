/**
 * StockBolt Admin — platform-owner dashboard (cross-tenant), phase141.
 *
 * Reached only via /admin (RequirePlatformAdmin). Every figure comes from
 * owner-only RPCs (admin_overview, admin_list_*, admin_company_detail and the
 * phase20 get_admin_dashboard), which refuse anyone else — so nothing here is
 * customer-reachable.
 *
 * Interactive: the period switch drives the chart and the "in period" KPIs;
 * KPI tiles, funnel steps, country bars and plan bars filter the user and
 * company explorers below and scroll to them.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ShieldCheck, RefreshCw, UserPlus, Activity, UserX, Building2, TrendingUp, CreditCard, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';
import { OceanPage } from '@/components/ocean-list';
import { BackButton } from '@/ui/back-button';
import { getAdapter } from '@/data/index';
import type { AdminCompanyFilter, AdminDashboard, AdminOverview, AdminUserFilter } from '@/data/adapter';
import { BarList, Funnel, SignupsChart, fmtInt } from './admin-charts';
import { CompaniesExplorer, UsersExplorer, useAdminFormat } from './admin-explorers';

const PERIODS = [7, 30, 90, 365] as const;

function fmtBytes(b: number): string {
  const n = Number(b ?? 0);
  if (n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function Kpi({ icon, label, value, sub, delta, tone, onClick, testid }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; delta?: number | null;
  tone?: 'warn'; onClick?: () => void; testid?: string;
}) {
  return (
    <button type="button" className={`sb-card sb-adm-kpi ${tone === 'warn' ? 'is-warn' : ''}`} onClick={onClick} data-testid={testid}>
      <span className="sb-adm-kpi-top">
        <span className="sb-adm-kpi-ico" aria-hidden="true">{icon}</span>
        {delta != null && Number.isFinite(delta) && (
          <span className={`sb-adm-delta ${delta >= 0 ? 'is-up' : 'is-down'}`} dir="ltr">
            {delta >= 0 ? <ArrowUpRight size={13} aria-hidden="true" /> : <ArrowDownRight size={13} aria-hidden="true" />}
            {Math.abs(Math.round(delta))}%
          </span>
        )}
      </span>
      <span className="sb-adm-kpi-label">{label}</span>
      <bdi dir="ltr" className="sb-adm-kpi-val">{value}</bdi>
      {sub && <span className="sb-adm-kpi-sub">{sub}</span>}
    </button>
  );
}

export default function AdminDashboardPage() {
  const { t, i18n } = useTranslation();
  const f = useAdminFormat();
  const [days, setDays] = useState<number>(30);
  const [measure, setMeasure] = useState<'signups' | 'companies'>('signups');
  const [userFilter, setUserFilter] = useState<AdminUserFilter>('all');
  const [companyFilter, setCompanyFilter] = useState<AdminCompanyFilter>('all');
  const [country, setCountry] = useState<string | null>(null);

  const ov = useQuery<AdminOverview>({
    queryKey: ['admin_overview', days],
    queryFn: () => getAdapter().admin.overview(days),
    refetchInterval: 60_000,
  });
  const sys = useQuery<AdminDashboard>({
    queryKey: ['admin_dashboard'],
    queryFn: () => getAdapter().admin.getDashboard(),
    refetchOnWindowFocus: false,
  });
  const d = ov.data;
  const k = d?.kpis;
  const delta = k && k.signups_prev_period > 0 ? ((k.signups_period - k.signups_prev_period) / k.signups_prev_period) * 100 : null;

  const users = (fl: AdminUserFilter) => { setUserFilter(fl); scrollTo('admin-users'); };
  const companies = (fl: AdminCompanyFilter, c: string | null = null) => { setCompanyFilter(fl); setCountry(c); scrollTo('admin-companies'); };
  const periodLabel = (n: number) => (n === 365 ? t('adminOcean.period_1y') : t('adminOcean.period_days', { count: n }));

  return (
    <div className="sb-ocean sb-admin-shell">
    <OceanPage
      testid="admin-dashboard-ocean"
      title={t('adminOcean.title')}
      subtitle={<>
        {t('adminOcean.subtitle')}
        {d?.generated_at && <> · <bdi dir="ltr">{t('adminOcean.updated', { time: f.ago(d.generated_at) })}</bdi></>}
      </>}
      back={<BackButton to="/dashboard" label={t('adminOcean.back_to_app')} />}
      actions={<>
        <button type="button" className="sb-secondary-btn sb-btn-inline" onClick={() => { void ov.refetch(); void sys.refetch(); }} disabled={ov.isFetching}>
          <RefreshCw size={16} className={ov.isFetching ? 'sb-spin' : ''} aria-hidden="true" /> {t('adminOcean.refresh')}
        </button>
        <span className="sb-pill sb-pill-good" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ShieldCheck size={14} aria-hidden="true" /> {t('adminOcean.badge')}</span>
      </>}
    >
      <div className="sb-adm">
        {ov.isLoading && <div className="sb-card sb-adm-panel"><p className="sb-adm-empty">{t('adminOcean.loading')}</p></div>}
        {ov.isError && <p className="sb-alert sb-alert-danger" role="alert">{String((ov.error as Error)?.message ?? t('adminOcean.load_failed'))}</p>}

        {d && k && (
          <>
            {/* Period */}
            <div className="sb-adm-periods" role="group" aria-label={t('adminOcean.period')}>
              {PERIODS.map((n) => (
                <button key={n} type="button" className={`sb-adm-chip ${days === n ? 'is-on' : ''}`} aria-pressed={days === n} onClick={() => setDays(n)}>
                  {periodLabel(n)}
                </button>
              ))}
            </div>

            {/* KPIs — click to filter the explorers */}
            <div className="sb-adm-kpis">
              <Kpi icon={<UserPlus size={18} />} label={t('adminOcean.k_signups', { period: periodLabel(days) })} value={fmtInt(k.signups_period)}
                sub={t('adminOcean.k_signups_sub', { today: fmtInt(k.signups_today), total: fmtInt(k.signups_total) })}
                delta={delta} onClick={() => users('new_7d')} testid="kpi-signups" />
              <Kpi icon={<Activity size={18} />} label={t('adminOcean.k_active')} value={fmtInt(k.active_7d)}
                sub={t('adminOcean.k_active_sub')} onClick={() => users('active_7d')} testid="kpi-active" />
              <Kpi icon={<UserX size={18} />} label={t('adminOcean.k_stuck')} value={fmtInt(k.no_company)} tone={k.no_company > 0 ? 'warn' : undefined}
                sub={t('adminOcean.k_stuck_sub')} onClick={() => users('no_company')} testid="kpi-stuck" />
              <Kpi icon={<Building2 size={18} />} label={t('adminOcean.k_companies')} value={fmtInt(k.companies_total)}
                sub={t('adminOcean.k_companies_sub', { count: k.companies_period, period: periodLabel(days) })} onClick={() => companies('new_30d')} testid="kpi-companies" />
              <Kpi icon={<TrendingUp size={18} />} label={t('adminOcean.k_active_companies')} value={fmtInt(k.companies_active_30d)}
                sub={t('adminOcean.k_active_companies_sub')} onClick={() => companies('active_30d')} testid="kpi-active-companies" />
              <Kpi icon={<CreditCard size={18} />} label={t('adminOcean.k_paying')} value={fmtInt(d.plans.paying)}
                sub={t('adminOcean.k_paying_sub', { trial: fmtInt(d.plans.trialing) })} onClick={() => companies('paying')} testid="kpi-paying" />
            </div>

            {/* Trend + funnel */}
            <div className="sb-adm-grid2">
              <section className="sb-card sb-adm-panel">
                <div className="sb-adm-panel-head">
                  <h2 className="sb-adm-h">{measure === 'signups' ? t('adminOcean.chart_signups') : t('adminOcean.chart_companies')}</h2>
                  <div className="sb-adm-chips" role="group">
                    <button type="button" className={`sb-adm-chip ${measure === 'signups' ? 'is-on' : ''}`} aria-pressed={measure === 'signups'} onClick={() => setMeasure('signups')}>{t('adminOcean.m_signups')}</button>
                    <button type="button" className={`sb-adm-chip ${measure === 'companies' ? 'is-on' : ''}`} aria-pressed={measure === 'companies'} onClick={() => setMeasure('companies')}>{t('adminOcean.m_companies')}</button>
                  </div>
                </div>
                <p className="sb-adm-hint">{t('adminOcean.chart_hint', { period: periodLabel(days) })}</p>
                <SignupsChart series={d.series} measure={measure} lang={i18n.language} />
              </section>
              <section className="sb-card sb-adm-panel">
                <h2 className="sb-adm-h">{t('adminOcean.funnel_title')}</h2>
                <p className="sb-adm-hint">{t('adminOcean.funnel_hint')}</p>
                <Funnel steps={[
                  { key: 'signed_up', label: t('adminOcean.f_signed_up'), value: d.funnel.signed_up, onPick: () => users('all') },
                  { key: 'verified', label: t('adminOcean.f_verified'), value: d.funnel.verified, onPick: () => users('unverified'), hint: t('adminOcean.f_hint_unverified') },
                  { key: 'in_company', label: t('adminOcean.f_in_company'), value: d.funnel.in_company, onPick: () => users('no_company'), hint: t('adminOcean.f_hint_no_company') },
                  { key: 'configured', label: t('adminOcean.f_configured'), value: d.funnel.configured, onPick: () => companies('not_configured') },
                  { key: 'active', label: t('adminOcean.f_active'), value: d.funnel.active_30d, onPick: () => users('inactive_30d') },
                  { key: 'paying', label: t('adminOcean.f_paying'), value: d.funnel.paying, onPick: () => companies('paying') },
                ]} />
              </section>
            </div>

            {/* Breakdowns */}
            <div className="sb-adm-grid3">
              <section className="sb-card sb-adm-panel">
                <h2 className="sb-adm-h">{t('adminOcean.countries')}</h2>
                <BarList testid="admin-countries" total={k.companies_total} activeKey={country} emptyText={t('adminOcean.no_companies')}
                  items={d.countries.map((c) => ({ key: c.code, label: f.country(c.code), value: c.n }))}
                  onPick={(code) => companies('all', country === code ? null : code)} />
              </section>
              <section className="sb-card sb-adm-panel">
                <h2 className="sb-adm-h">{t('adminOcean.industries')}</h2>
                <BarList total={k.companies_total} emptyText={t('adminOcean.no_companies')}
                  items={d.industries.map((x) => ({ key: x.key, label: f.activity(x.key), value: x.n }))}
                  onPick={(key) => { if (key === '_not_set') companies('not_configured'); }} />
              </section>
              <section className="sb-card sb-adm-panel">
                <h2 className="sb-adm-h">{t('adminOcean.plans')}</h2>
                <BarList total={k.companies_total} emptyText={t('adminOcean.no_companies')}
                  items={[
                    { key: 'trialing', label: t('adminOcean.p_trialing'), value: d.plans.trialing },
                    { key: 'paying', label: t('adminOcean.p_paying'), value: d.plans.paying },
                    { key: 'complimentary', label: t('adminOcean.p_complimentary'), value: d.plans.complimentary },
                    { key: 'at_risk', label: t('adminOcean.p_at_risk'), value: d.plans.at_risk },
                    { key: 'ended', label: t('adminOcean.p_ended'), value: d.plans.ended },
                  ].filter((x) => x.value > 0)}
                  onPick={(key) => { if (key === 'trialing') companies('trial'); else if (key === 'paying') companies('paying'); }} />
              </section>
            </div>

            <UsersExplorer filter={userFilter} onFilter={setUserFilter} />
            <CompaniesExplorer filter={companyFilter} onFilter={setCompanyFilter} country={country} onCountry={setCountry} />

            {/* System health (phase20 figures) */}
            {sys.data && (
              <section className="sb-card sb-adm-panel">
                <h2 className="sb-adm-h">{t('adminOcean.system')}</h2>
                <div className="sb-adm-mini">
                  <div className="sb-adm-mini-tile"><span>{t('adminOcean.total_invoices')}</span><b dir="ltr">{fmtInt(sys.data.total_invoices)}</b></div>
                  <div className="sb-adm-mini-tile"><span>{t('adminOcean.total_products')}</span><b dir="ltr">{fmtInt(sys.data.total_products)}</b></div>
                  <div className="sb-adm-mini-tile"><span>{t('adminOcean.db_usage')}</span><b dir="ltr">{fmtBytes(sys.data.database_bytes)}</b></div>
                  <div className="sb-adm-mini-tile"><span>{t('adminOcean.storage_usage')}</span><b dir="ltr">{fmtBytes(sys.data.storage_bytes)}</b></div>
                  <div className={`sb-adm-mini-tile ${sys.data.failed_logins_30d > 0 ? 'is-warn' : ''}`}><span>{t('adminOcean.failed_logins')} · {t('adminOcean.last_30')}</span><b dir="ltr">{fmtInt(sys.data.failed_logins_30d)}</b></div>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </OceanPage>
    </div>
  );
}
