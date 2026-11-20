/**
 * Control Center — Overview (phase142). Any date range (URL ?from=&to=);
 * every tile, funnel step and bar opens the Businesses or Users view with the
 * matching filter. Billing figures read "Not configured" until a payment
 * provider is switched on (payment_provider_configs).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { RefreshCw, UserPlus, Activity, UserX, Building2, TrendingUp, CreditCard } from 'lucide-react';
import { getAdapter } from '@/data/index';
import { INDUSTRY_FAMILIES, activitiesOf } from '@/core/global-config';
import type { AdminOverviewRange } from '@/data/adapter';
import { BarList, Funnel, SignupsChart, fmtInt } from '../admin-charts';
import { useAdminFormat } from '../admin-explorers';
import { KpiTile, MetricInfo, RangeControl, pctChange, useUrlRange } from '../admin-ui';

export function OverviewView() {
  const { t, i18n } = useTranslation();
  const f = useAdminFormat();
  const navigate = useNavigate();
  const { from, to, setRange } = useUrlRange(30);
  const [measure, setMeasure] = useState<'signups' | 'companies'>('signups');
  const q = useQuery<AdminOverviewRange>({
    queryKey: ['admin_overview_range', from, to],
    queryFn: () => getAdapter().admin.overviewRange(from, to),
    refetchInterval: 60_000,
  });
  const d = q.data;
  const k = d?.kpis;
  const billingOn = !!d?.billing.configured;
  const rangeText = d ? `${f.date(d.from)} – ${f.date(d.to)}` : '';
  const go = (path: string, params: Record<string, string>) => navigate(`${path}?${new URLSearchParams(params).toString()}`);
  // A business type bar opens Businesses filtered to that activity's family.
  const familyOf = (activity: string) => INDUSTRY_FAMILIES.find((fam) => activitiesOf(fam.key).some((a) => a.key === activity))?.key;

  return (
    <div className="sb-adm" data-testid="admin-overview">
      <div className="sb-adm-toolbar">
        <RangeControl from={from} to={to} onChange={setRange} />
        <button type="button" className="sb-secondary-btn sb-btn-inline" onClick={() => void q.refetch()} disabled={q.isFetching}>
          <RefreshCw size={16} className={q.isFetching ? 'sb-spin' : ''} aria-hidden="true" /> {t('adminOcean.refresh')}
        </button>
      </div>

      {q.isLoading && <div className="sb-card sb-adm-panel"><p className="sb-adm-empty">{t('adminOcean.loading')}</p></div>}
      {q.isError && <p className="sb-alert sb-alert-danger" role="alert">{String((q.error as Error)?.message ?? t('adminOcean.load_failed'))}</p>}

      {d && k && (
        <>
          <div className="sb-adm-kpis">
            <KpiTile icon={<UserPlus size={18} />} metric="signups" label={t('adminCC.k_signups')} value={fmtInt(k.signups_range)}
              delta={pctChange(k.signups_range, k.signups_prev_range)}
              sub={t('adminCC.k_signups_sub', { range: rangeText, total: fmtInt(k.signups_total) })}
              onClick={() => go('/admin/users', { filter: 'all' })} testid="kpi-signups" />
            <KpiTile icon={<Activity size={18} />} metric="active_people" label={t('adminOcean.k_active')} value={fmtInt(k.active_7d)}
              sub={t('adminOcean.k_active_sub')} onClick={() => go('/admin/users', { filter: 'active_7d' })} testid="kpi-active" />
            <KpiTile icon={<UserX size={18} />} metric="stuck" label={t('adminOcean.k_stuck')} value={fmtInt(k.no_company)}
              tone={k.no_company > 0 ? 'warn' : undefined} sub={t('adminOcean.k_stuck_sub')}
              onClick={() => go('/admin/users', { filter: 'no_company' })} testid="kpi-stuck" />
            <KpiTile icon={<Building2 size={18} />} metric="companies" label={t('adminCC.k_companies')} value={fmtInt(k.companies_range)}
              delta={pctChange(k.companies_range, k.companies_prev_range)}
              sub={t('adminCC.k_companies_sub', { total: fmtInt(k.companies_total) })}
              onClick={() => go('/admin/businesses', { from: d.from, to: d.to })} testid="kpi-companies" />
            <KpiTile icon={<TrendingUp size={18} />} metric="active_companies" label={t('adminOcean.k_active_companies')} value={fmtInt(k.companies_active_30d)}
              sub={t('adminOcean.k_active_companies_sub')} onClick={() => go('/admin/businesses', { filter: 'active_30d' })} testid="kpi-active-companies" />
            <KpiTile icon={<CreditCard size={18} />} metric="paying" label={t('adminOcean.k_paying')}
              value={billingOn ? fmtInt(d.plans.paying) : t('adminCC.not_configured')} tone={billingOn ? undefined : 'muted'}
              sub={billingOn ? t('adminOcean.k_paying_sub', { trial: fmtInt(d.plans.trialing) }) : t('adminCC.billing_off_sub')}
              onClick={billingOn ? () => go('/admin/businesses', { filter: 'paying' }) : undefined} testid="kpi-paying" />
          </div>

          <div className="sb-adm-grid2">
            <section className="sb-card sb-adm-panel">
              <div className="sb-adm-panel-head">
                <h2 className="sb-adm-h">{measure === 'signups' ? t('adminOcean.chart_signups') : t('adminOcean.chart_companies')}
                  <MetricInfo metric={measure === 'signups' ? 'signups' : 'companies'} /></h2>
                <div className="sb-adm-chips" role="group">
                  <button type="button" className={`sb-adm-chip ${measure === 'signups' ? 'is-on' : ''}`} aria-pressed={measure === 'signups'} onClick={() => setMeasure('signups')}>{t('adminOcean.m_signups')}</button>
                  <button type="button" className={`sb-adm-chip ${measure === 'companies' ? 'is-on' : ''}`} aria-pressed={measure === 'companies'} onClick={() => setMeasure('companies')}>{t('adminOcean.m_companies')}</button>
                </div>
              </div>
              <p className="sb-adm-hint">{t('adminCC.chart_hint', { range: rangeText })}</p>
              <SignupsChart series={d.series} measure={measure} lang={i18n.language} />
            </section>
            <section className="sb-card sb-adm-panel">
              <h2 className="sb-adm-h">{t('adminOcean.funnel_title')} <MetricInfo metric="funnel" /></h2>
              <p className="sb-adm-hint">{t('adminCC.funnel_hint')}</p>
              <Funnel steps={[
                { key: 'signed_up', label: t('adminOcean.f_signed_up'), value: d.funnel.signed_up, onPick: () => go('/admin/users', { filter: 'all' }) },
                { key: 'verified', label: t('adminOcean.f_verified'), value: d.funnel.verified, onPick: () => go('/admin/users', { filter: 'unverified' }), hint: t('adminOcean.f_hint_unverified') },
                { key: 'in_company', label: t('adminOcean.f_in_company'), value: d.funnel.in_company, onPick: () => go('/admin/users', { filter: 'no_company' }), hint: t('adminOcean.f_hint_no_company') },
                { key: 'configured', label: t('adminOcean.f_configured'), value: d.funnel.configured, onPick: () => go('/admin/businesses', { filter: 'not_configured' }) },
                { key: 'active', label: t('adminOcean.f_active'), value: d.funnel.active_30d, onPick: () => go('/admin/businesses', { filter: 'dormant' }) },
                ...(billingOn ? [{ key: 'paying', label: t('adminOcean.f_paying'), value: d.funnel.paying, onPick: () => go('/admin/businesses', { filter: 'paying' }) }] : []),
              ]} />
              {!billingOn && <p className="sb-adm-hint">{t('adminCC.funnel_no_billing')}</p>}
            </section>
          </div>

          <div className="sb-adm-grid3">
            <section className="sb-card sb-adm-panel">
              <h2 className="sb-adm-h">{t('adminOcean.countries')} <MetricInfo metric="companies" /></h2>
              <BarList testid="admin-countries" total={k.companies_total} emptyText={t('adminOcean.no_companies')}
                items={d.countries.map((c) => ({ key: c.code, label: f.country(c.code), value: c.n }))}
                onPick={(code) => go('/admin/businesses', { country: code })} />
            </section>
            <section className="sb-card sb-adm-panel">
              <h2 className="sb-adm-h">{t('adminOcean.industries')} <MetricInfo metric="business_types" /></h2>
              <BarList total={k.companies_total} emptyText={t('adminOcean.no_companies')}
                items={d.industries.map((x) => ({ key: x.key, label: f.activity(x.key), value: x.n }))}
                onPick={(key) => {
                  if (key === '_not_set') go('/admin/businesses', { filter: 'not_configured' });
                  else { const fam = familyOf(key); if (fam) go('/admin/businesses', { type: fam }); }
                }} />
            </section>
            <section className="sb-card sb-adm-panel">
              <h2 className="sb-adm-h">{t('adminOcean.plans')} <MetricInfo metric="plans" /></h2>
              {!billingOn && <p className="sb-adm-note" data-testid="billing-not-configured">{t('adminCC.plans_note')}</p>}
              <BarList total={k.companies_total} emptyText={t('adminOcean.no_companies')}
                items={[
                  { key: 'trialing', label: t('adminOcean.p_trialing'), value: d.plans.trialing },
                  ...(billingOn ? [{ key: 'paying', label: t('adminOcean.p_paying'), value: d.plans.paying }] : []),
                  { key: 'complimentary', label: t('adminOcean.p_complimentary'), value: d.plans.complimentary },
                  { key: 'at_risk', label: t('adminOcean.p_at_risk'), value: d.plans.at_risk },
                  { key: 'ended', label: t('adminOcean.p_ended'), value: d.plans.ended },
                ].filter((x) => x.value > 0)}
                onPick={(key) => { if (key === 'trialing') go('/admin/businesses', { filter: 'trial' }); else if (key === 'paying') go('/admin/businesses', { filter: 'paying' }); }} />
            </section>
          </div>
          <p className="sb-adm-foot">{t('adminCC.updated', { time: f.ago(d.generated_at) })}</p>
        </>
      )}
    </div>
  );
}
