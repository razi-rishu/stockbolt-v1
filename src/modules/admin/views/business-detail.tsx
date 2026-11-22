/**
 * Control Center — one business (phase142). Owner, members (emails masked
 * except the owner's), usage, 12-month activity, business setup and plan. No
 * tenant data beyond counts is shown. The only changes possible here are the
 * phase151 billing actions (extend free period, mark exempt) in
 * BusinessAccessPanel — owner-only on the server and logged.
 */
import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { ChevronLeft, Crown, FileText, Receipt, Package, Users, BookOpen, HardDrive, Wallet, FileSpreadsheet } from 'lucide-react';
import { getAdapter } from '@/data/index';
import { getModule, isModuleKey } from '@/core/global-config';
import type { AdminBusinessDetail } from '@/data/adapter';
import { fmtInt } from '../admin-charts';
import { useAdminFormat } from '../admin-explorers';
import { MetricInfo } from '../admin-ui';
import { BusinessAccessPanel } from './business-access';

function fmtBytes(b: number): string {
  if (b <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function BusinessDetailView() {
  const { t, i18n } = useTranslation();
  const f = useAdminFormat();
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const back = (location.state as { back?: string } | null)?.back ?? '';
  const [measure, setMeasure] = useState<'journal_entries' | 'invoices'>('journal_entries');
  const { data, isLoading, isError, error } = useQuery<AdminBusinessDetail | null>({
    queryKey: ['admin_business', id],
    queryFn: () => getAdapter().admin.businessDetail(id),
    enabled: !!id,
  });
  const ar = i18n.language === 'ar';
  const monthFmt = new Intl.DateTimeFormat(ar ? 'ar-u-nu-latn' : 'en-GB', { month: 'short', year: '2-digit' });

  const backBtn = (
    <button type="button" className="sb-secondary-btn sb-btn-inline sb-adm-back" onClick={() => navigate(`/admin/businesses${back}`)}>
      <ChevronLeft size={16} className="sb-rtl-flip" aria-hidden="true" /> {t('adminCC.back_to_businesses')}
    </button>
  );

  if (isLoading) return <div className="sb-adm">{backBtn}<div className="sb-card sb-adm-panel"><p className="sb-adm-empty">{t('adminOcean.loading')}</p></div></div>;
  if (isError || !data) {
    return <div className="sb-adm">{backBtn}<p className="sb-alert sb-alert-danger" role="alert">{isError ? String((error as Error)?.message) : t('adminCC.not_found')}</p></div>;
  }

  const c = data.company;
  const sub = data.subscription;
  const usage: [string, number | null, React.ReactNode][] = [
    [t('adminOcean.c_users'), data.counts.users, <Users key="u" size={16} />],
    [t('adminOcean.k_invoices'), data.counts.invoices, <FileText key="i" size={16} />],
    [t('adminCC.k_quotes'), data.counts.quotes, <FileSpreadsheet key="q" size={16} />],
    [t('adminOcean.k_bills'), data.counts.bills, <Receipt key="b" size={16} />],
    [t('adminCC.k_payments'), data.counts.payments, <Wallet key="p" size={16} />],
    [t('adminOcean.k_products'), data.counts.products, <Package key="pr" size={16} />],
    [t('adminOcean.k_contacts'), data.counts.contacts, <Users key="c" size={16} />],
    [t('adminOcean.k_journal_entries'), data.counts.journal_entries, <BookOpen key="j" size={16} />],
  ];
  const series = data.activity.map((m) => ({ ...m, label: monthFmt.format(new Date(m.month)) }));

  return (
    <div className="sb-adm" data-testid="admin-business-detail">
      {backBtn}

      <section className="sb-card sb-adm-panel sb-adm-hero">
        <div>
          <h2 className="sb-adm-hero-name">{c.name}</h2>
          <p className="sb-adm-hint">
            {f.country(c.country_code)}{c.city ? ` · ${c.city}` : ''} · <bdi dir="ltr">{c.currency ?? ''}</bdi> · {t('adminCC.registered_on', { date: f.date(c.created_at) })}
          </p>
        </div>
        <div className="sb-gc-inline">
          <span className="sb-adm-tag">{data.config ? f.activity(data.config.primary) : t('adminOcean.not_configured')}</span>
          <span className="sb-adm-tag">{sub ? f.plan({ sub_status: sub.status, provider: sub.provider, grandfathered: sub.grandfathered }) : t('adminOcean.p_none')}</span>
        </div>
      </section>

      <section className="sb-card sb-adm-panel">
      <h2 className="sb-adm-h">{t('adminCC.usage')}</h2>
      <div className="sb-adm-mini">
        {usage.map(([label, v, icon]) => (
          <div key={label} className="sb-adm-mini-tile"><span className="sb-gc-inline">{icon}{label}</span><b dir="ltr">{v == null ? '—' : fmtInt(v)}</b></div>
        ))}
        <div className="sb-adm-mini-tile">
          <span className="sb-gc-inline"><HardDrive size={16} />{t('adminCC.k_storage')} <MetricInfo metric="storage" /></span>
          <b dir="ltr">{data.storage_bytes == null ? t('adminCC.unavailable') : fmtBytes(data.storage_bytes)}</b>
        </div>
      </div>
      </section>

      <div className="sb-adm-grid2">
        <section className="sb-card sb-adm-panel">
          <div className="sb-adm-panel-head">
            <h2 className="sb-adm-h">{t('adminCC.activity_title')} <MetricInfo metric="last_activity" /></h2>
            <div className="sb-adm-chips" role="group">
              <button type="button" className={`sb-adm-chip ${measure === 'journal_entries' ? 'is-on' : ''}`} aria-pressed={measure === 'journal_entries'} onClick={() => setMeasure('journal_entries')}>{t('adminOcean.k_journal_entries')}</button>
              <button type="button" className={`sb-adm-chip ${measure === 'invoices' ? 'is-on' : ''}`} aria-pressed={measure === 'invoices'} onClick={() => setMeasure('invoices')}>{t('adminOcean.k_invoices')}</button>
            </div>
          </div>
          <p className="sb-adm-hint">{t('adminCC.activity_hint', { last: f.ago(data.last_activity) })}</p>
          <div className="sb-adm-chart" dir="ltr">
            <ResponsiveContainer width="100%" height={220} minWidth={0}>
              <BarChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 4" stroke="#E1E9ED" vertical={false} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#607185' }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#607185' }} width={40} />
                <Tooltip cursor={{ fill: 'rgba(0,143,135,0.08)' }} content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as { label: string; journal_entries: number; invoices: number };
                  return (<div className="sb-adm-tip"><strong>{p.label}</strong>
                    <span>{t('adminOcean.k_journal_entries')}: <b>{fmtInt(p.journal_entries)}</b></span>
                    <span>{t('adminOcean.k_invoices')}: <b>{fmtInt(p.invoices)}</b></span></div>);
                }} />
                <Bar dataKey={measure} fill="#008F87" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="sb-card sb-adm-panel">
          <h2 className="sb-adm-h">{t('adminCC.team')}</h2>
          {data.owner && (
            <div className="sb-adm-owner">
              <Crown size={16} aria-hidden="true" />
              <span className="sb-adm-person-txt">
                <strong>{data.owner.name || '—'} <span className="sb-adm-muted">· {t('adminCC.owner')}</span></strong>
                <bdi dir="ltr">{data.owner.email}</bdi>
              </span>
            </div>
          )}
          <ul className="sb-gc-list">
            {data.members.filter((m) => !m.is_owner).map((m, i) => (
              <li key={`${m.email_masked}-${i}`} className={`sb-gc-item ${m.is_active ? '' : 'is-off'}`}>
                <span className="sb-adm-person-txt"><strong>{m.name || '—'}</strong><bdi dir="ltr">{m.email_masked}</bdi></span>
                <span className="sb-gc-inline"><span className="sb-gc-tag">{f.role(m.role)}</span><span className="sb-adm-muted">{f.ago(m.last_seen_at)}</span></span>
              </li>
            ))}
          </ul>
          <p className="sb-adm-note">{t('adminCC.masked_note')}</p>
        </section>
      </div>

      <div className="sb-adm-grid2">
        <section className="sb-card sb-adm-panel">
          <h2 className="sb-adm-h">{t('adminCC.setup')}</h2>
          {!data.config ? <p className="sb-adm-note">{t('adminCC.setup_missing')}</p> : (
            <>
              <p className="sb-adm-hint">{data.config.activities.map((a) => f.activity(a)).join(' · ')}</p>
              <div className="sb-gc-chips">
                {data.config.modules.filter(isModuleKey).map((m) => <span key={m} className="sb-gc-tag is-brand">{getModule(m)[ar ? 'name_ar' : 'name']}</span>)}
              </div>
            </>
          )}
        </section>
        <section className="sb-card sb-adm-panel">
          <h2 className="sb-adm-h">{t('adminOcean.c_plan')} <MetricInfo metric="plans" /></h2>
          {!data.billing.configured && <p className="sb-adm-note" data-testid="billing-not-configured">{t('adminCC.plans_note')}</p>}
          <dl className="sb-gc-rows">
            <div className="sb-gc-row"><dt>{t('adminCC.status')}</dt><dd>{sub ? f.plan({ sub_status: sub.status, provider: sub.provider, grandfathered: sub.grandfathered }) : t('adminOcean.p_none')}</dd></div>
            {sub?.trial_end && <div className="sb-gc-row"><dt>{t('adminCC.trial_end')}</dt><dd><bdi dir="ltr">{f.date(sub.trial_end)}</bdi></dd></div>}
            {data.billing.configured && <div className="sb-gc-row"><dt>{t('adminCC.next_billing')}</dt><dd><bdi dir="ltr">{f.date(sub?.next_billing_date)}</bdi></dd></div>}
          </dl>
        </section>
      </div>

      {sub && <BusinessAccessPanel companyId={id} />}
    </div>
  );
}
