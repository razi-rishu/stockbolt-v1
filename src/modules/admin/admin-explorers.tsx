/**
 * Admin explorers (phase141): every user and every company, searchable,
 * filterable and paged (50 per page), plus a company detail panel.
 * All data comes from owner-only RPCs that refuse anyone else.
 */
import { useEffect, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Search, X, ChevronLeft, ChevronRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { getAdapter } from '@/data/index';
import { Modal } from '@/ui/modal';
import { getActivity } from '@/core/global-config';
import type { AdminCompanyFilter, AdminCompanyRow, AdminUserFilter, AdminUserRow } from '@/data/adapter';
import { fmtInt } from './admin-charts';

const PAGE = 50;
const COUNT_KEY = {
  invoices: 'adminOcean.k_invoices', bills: 'adminOcean.k_bills', products: 'adminOcean.k_products',
  contacts: 'adminOcean.k_contacts', journal_entries: 'adminOcean.k_journal_entries',
} as const;

/** Literal keys so the i18n key test sees every one. */
const ROLE_KEY: Record<string, string> = {
  admin: 'global_config.branches.role.admin', accountant: 'global_config.branches.role.accountant',
  sales: 'global_config.branches.role.sales', counter: 'global_config.branches.role.counter',
  viewer: 'global_config.branches.role.viewer',
};
const PLAN_KEY: Record<string, string> = {
  trialing: 'adminOcean.p_trialing', active: 'adminOcean.p_active', past_due: 'adminOcean.p_at_risk',
  payment_failed: 'adminOcean.p_at_risk', suspended: 'adminOcean.p_at_risk', cancelled: 'adminOcean.p_ended',
  expired: 'adminOcean.p_ended', pending_payment: 'adminOcean.p_trialing',
};

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}

export function useAdminFormat() {
  const { i18n, t } = useTranslation();
  const lang = i18n.language === 'ar' ? 'ar-u-nu-latn' : 'en-GB';
  const date = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' });
  const rtf = new Intl.RelativeTimeFormat(i18n.language === 'ar' ? 'ar-u-nu-latn' : 'en', { numeric: 'auto' });
  let regions: Intl.DisplayNames | null = null;
  try { regions = new Intl.DisplayNames([i18n.language === 'ar' ? 'ar' : 'en'], { type: 'region' }); } catch { regions = null; }
  return {
    date: (iso: string | null | undefined) => (iso ? date.format(new Date(iso)) : '—'),
    ago: (iso: string | null | undefined) => {
      if (!iso) return t('adminOcean.never');
      const mins = Math.round((Date.parse(iso) - Date.now()) / 60000);
      if (Math.abs(mins) < 60) return rtf.format(mins, 'minute');
      const hrs = Math.round(mins / 60);
      if (Math.abs(hrs) < 48) return rtf.format(hrs, 'hour');
      return rtf.format(Math.round(hrs / 24), 'day');
    },
    country: (code: string | null | undefined) => {
      if (!code || code === '—') return t('adminOcean.unknown');
      try { return regions?.of(code) ?? code; } catch { return code; }
    },
    activity: (key: string | null | undefined) => {
      if (!key || key === '_not_set') return t('adminOcean.not_configured');
      const a = getActivity(key);
      return a ? (i18n.language === 'ar' ? a.name_ar : a.name) : key;
    },
    role: (r: string | null | undefined) => (r ? (ROLE_KEY[r] ? t(ROLE_KEY[r]) : t('adminOcean.custom_role')) : '—'),
    plan: (row: { sub_status: string | null; provider: string | null; grandfathered: boolean }) => {
      if (!row.sub_status) return t('adminOcean.p_none');
      if (row.sub_status === 'active' && (row.grandfathered || row.provider === 'manual')) return t('adminOcean.p_complimentary');
      if (row.sub_status === 'active') return t('adminOcean.p_paying');
      return t(PLAN_KEY[row.sub_status] ?? 'adminOcean.p_none');
    },
  };
}

function Chips<T extends string>({ value, options, onChange }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="sb-adm-chips" role="group">
      {options.map((o) => (
        <button key={o.key} type="button" className={`sb-adm-chip ${value === o.key ? 'is-on' : ''}`} aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}>{o.label}</button>
      ))}
    </div>
  );
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const { t } = useTranslation();
  const from = total === 0 ? 0 : page * PAGE + 1;
  const to = Math.min(total, (page + 1) * PAGE);
  return (
    <div className="sb-adm-pager">
      <bdi dir="ltr">{t('adminOcean.showing', { from, to, total })}</bdi>
      <span className="sb-adm-pager-btns">
        <button type="button" className="sb-icon-btn" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label={t('adminOcean.prev')}>
          <ChevronLeft size={16} className="sb-rtl-flip" aria-hidden="true" />
        </button>
        <button type="button" className="sb-icon-btn" disabled={to >= total} onClick={() => onPage(page + 1)} aria-label={t('adminOcean.next')}>
          <ChevronRight size={16} className="sb-rtl-flip" aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const { t } = useTranslation();
  return (
    <label className="sb-adm-search">
      <Search size={16} aria-hidden="true" />
      <input type="search" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {value && <button type="button" aria-label={t('adminOcean.clear')} onClick={() => onChange('')}><X size={14} aria-hidden="true" /></button>}
    </label>
  );
}

// ── Users ──────────────────────────────────────────────────────────────────
export function UsersExplorer({ filter, onFilter }: { filter: AdminUserFilter; onFilter: (f: AdminUserFilter) => void }) {
  const { t } = useTranslation();
  const f = useAdminFormat();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const q = useDebounced(search);
  useEffect(() => setPage(0), [q, filter]);
  const { data, isFetching } = useQuery({
    queryKey: ['admin_users', q, filter, page],
    queryFn: () => getAdapter().admin.listUsers({ search: q, filter, limit: PAGE, offset: page * PAGE }),
    placeholderData: keepPreviousData,
  });
  const rows: AdminUserRow[] = data?.rows ?? [];
  return (
    <section className="sb-card sb-adm-panel" id="admin-users" data-testid="admin-users">
      <div className="sb-adm-panel-head">
        <h2 className="sb-adm-h">{t('adminOcean.users_title')} <span className="sb-adm-count" dir="ltr">{fmtInt(data?.total ?? 0)}</span></h2>
        <SearchBox value={search} onChange={setSearch} placeholder={t('adminOcean.search_users')} />
      </div>
      <Chips<AdminUserFilter> value={filter} onChange={onFilter} options={[
        { key: 'all', label: t('adminOcean.uf_all') }, { key: 'new_7d', label: t('adminOcean.uf_new_7d') },
        { key: 'active_7d', label: t('adminOcean.uf_active_7d') }, { key: 'no_company', label: t('adminOcean.uf_no_company') },
        { key: 'unverified', label: t('adminOcean.uf_unverified') }, { key: 'inactive_30d', label: t('adminOcean.uf_inactive_30d') },
      ]} />
      <div className={`sb-adm-table-wrap ${isFetching ? 'is-busy' : ''}`}>
        <table className="sb-adm-table">
          <thead><tr>
            <th>{t('adminOcean.c_user')}</th><th>{t('adminOcean.c_company')}</th><th>{t('adminOcean.c_role')}</th>
            <th>{t('adminOcean.c_signed_up')}</th><th>{t('adminOcean.c_last_seen')}</th><th>{t('adminOcean.c_signin')}</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="sb-adm-empty">{t('adminOcean.no_users')}</td></tr>}
            {rows.map((u) => (
              <tr key={u.id} className={u.is_active ? '' : 'is-off'}>
                <td>
                  <span className="sb-adm-person">
                    <span className="sb-adm-avatar" aria-hidden="true">{(u.full_name || u.email).slice(0, 1).toUpperCase()}</span>
                    <span className="sb-adm-person-txt">
                      <strong>{u.full_name || '—'}</strong>
                      <bdi dir="ltr">{u.email}</bdi>
                    </span>
                  </span>
                </td>
                <td>{u.company_name ?? <span className="sb-adm-tag is-warn">{t('adminOcean.no_company_yet')}</span>}</td>
                <td>{f.role(u.role)}</td>
                <td><bdi dir="ltr">{f.date(u.created_at)}</bdi></td>
                <td title={u.last_seen_at ?? ''}>{f.ago(u.last_seen_at)}</td>
                <td>
                  <span className="sb-adm-signin">
                    {u.provider === 'google' ? 'Google' : t('adminOcean.email_pw')}
                    {u.verified
                      ? <CheckCircle2 size={14} className="sb-adm-ok" aria-label={t('adminOcean.verified')} />
                      : <AlertCircle size={14} className="sb-adm-warn" aria-label={t('adminOcean.not_verified')} />}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} total={data?.total ?? 0} onPage={setPage} />
    </section>
  );
}

// ── Companies ──────────────────────────────────────────────────────────────
export function CompaniesExplorer({ filter, onFilter, country, onCountry }: {
  filter: AdminCompanyFilter; onFilter: (f: AdminCompanyFilter) => void;
  country: string | null; onCountry: (c: string | null) => void;
}) {
  const { t } = useTranslation();
  const f = useAdminFormat();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<AdminCompanyRow | null>(null);
  const q = useDebounced(search);
  useEffect(() => setPage(0), [q, filter, country]);
  const { data, isFetching } = useQuery({
    queryKey: ['admin_companies', q, filter, country, page],
    queryFn: () => getAdapter().admin.listCompanies({ search: q, filter, country, limit: PAGE, offset: page * PAGE }),
    placeholderData: keepPreviousData,
  });
  const rows: AdminCompanyRow[] = data?.rows ?? [];
  const dormant = (r: AdminCompanyRow) => !r.last_activity || Date.now() - Date.parse(r.last_activity) > 30 * 86400_000;
  return (
    <section className="sb-card sb-adm-panel" id="admin-companies" data-testid="admin-companies">
      <div className="sb-adm-panel-head">
        <h2 className="sb-adm-h">{t('adminOcean.companies_title')} <span className="sb-adm-count" dir="ltr">{fmtInt(data?.total ?? 0)}</span></h2>
        <SearchBox value={search} onChange={setSearch} placeholder={t('adminOcean.search_companies')} />
      </div>
      <div className="sb-adm-chips-row">
        <Chips<AdminCompanyFilter> value={filter} onChange={onFilter} options={[
          { key: 'all', label: t('adminOcean.cf_all') }, { key: 'new_30d', label: t('adminOcean.cf_new_30d') },
          { key: 'active_30d', label: t('adminOcean.cf_active_30d') }, { key: 'dormant', label: t('adminOcean.cf_dormant') },
          { key: 'trial', label: t('adminOcean.cf_trial') }, { key: 'paying', label: t('adminOcean.cf_paying') },
          { key: 'not_configured', label: t('adminOcean.cf_not_configured') },
        ]} />
        {country && (
          <button type="button" className="sb-adm-chip is-on is-removable" onClick={() => onCountry(null)}>
            {f.country(country)} <X size={13} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className={`sb-adm-table-wrap ${isFetching ? 'is-busy' : ''}`}>
        <table className="sb-adm-table">
          <thead><tr>
            <th>{t('adminOcean.c_company')}</th><th>{t('adminOcean.c_country')}</th><th>{t('adminOcean.c_business')}</th>
            <th className="is-num">{t('adminOcean.c_users')}</th><th>{t('adminOcean.c_created')}</th>
            <th>{t('adminOcean.c_last_activity')}</th><th>{t('adminOcean.c_plan')}</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="sb-adm-empty">{t('adminOcean.no_companies')}</td></tr>}
            {rows.map((c) => (
              <tr key={c.id} className="is-link" tabIndex={0} onClick={() => setOpen(c)}
                onKeyDown={(e) => { if (e.key === 'Enter') setOpen(c); }}>
                <td><strong>{c.name}</strong></td>
                <td>{f.country(c.country_code)}</td>
                <td>{c.configured ? f.activity(c.primary_activity_key) : <span className="sb-adm-tag is-warn">{t('adminOcean.not_configured')}</span>}</td>
                <td className="is-num"><bdi dir="ltr">{fmtInt(c.users)}</bdi></td>
                <td><bdi dir="ltr">{f.date(c.created_at)}</bdi></td>
                <td className={dormant(c) ? 'is-muted' : ''}>{f.ago(c.last_activity)}</td>
                <td><span className="sb-adm-tag">{f.plan(c)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} total={data?.total ?? 0} onPage={setPage} />
      {open && <CompanyDrawer row={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function CompanyDrawer({ row, onClose }: { row: AdminCompanyRow; onClose: () => void }) {
  const { t } = useTranslation();
  const f = useAdminFormat();
  const { data, isLoading } = useQuery({
    queryKey: ['admin_company', row.id],
    queryFn: () => getAdapter().admin.companyDetail(row.id),
  });
  const counts = data?.counts;
  return (
    <Modal open onClose={onClose} title={row.name} width="lg">
      <div className="sb-ocean sb-adm-drawer" data-testid="admin-company-detail">
        {isLoading || !data ? <p className="sb-adm-empty">{t('adminOcean.loading')}</p> : (
          <>
            <dl className="sb-gc-rows">
              <div className="sb-gc-row"><dt>{t('adminOcean.c_country')}</dt><dd>{f.country(data.company.country_code)} · <bdi dir="ltr">{data.company.currency ?? ''}</bdi></dd></div>
              <div className="sb-gc-row"><dt>{t('adminOcean.c_created')}</dt><dd><bdi dir="ltr">{f.date(data.company.created_at)}</bdi></dd></div>
              <div className="sb-gc-row"><dt>{t('adminOcean.c_last_activity')}</dt><dd>{f.ago(data.last_activity)}</dd></div>
              <div className="sb-gc-row"><dt>{t('adminOcean.c_business')}</dt><dd>{data.config ? f.activity(data.config.primary) : t('adminOcean.not_configured')}</dd></div>
              <div className="sb-gc-row"><dt>{t('adminOcean.c_plan')}</dt>
                <dd>{data.subscription ? f.plan({ sub_status: data.subscription.status, provider: data.subscription.provider, grandfathered: data.subscription.grandfathered }) : t('adminOcean.p_none')}
                  {data.subscription?.trial_end && data.subscription.status === 'trialing' && <span className="sb-gc-row-sub">{t('adminOcean.trial_until', { date: f.date(data.subscription.trial_end) })}</span>}
                </dd></div>
            </dl>
            {counts && (
              <div className="sb-adm-mini">
                {([['invoices', counts.invoices], ['bills', counts.bills], ['products', counts.products], ['contacts', counts.contacts], ['journal_entries', counts.journal_entries]] as const).map(([k, v]) => (
                  <div key={k} className="sb-adm-mini-tile"><span>{t(COUNT_KEY[k])}</span><b dir="ltr">{fmtInt(v)}</b></div>
                ))}
              </div>
            )}
            <h3 className="sb-gc-h">{t('adminOcean.users_title')}</h3>
            <ul className="sb-gc-list">
              {data.users.map((u) => (
                <li key={u.email} className={`sb-gc-item ${u.is_active ? '' : 'is-off'}`}>
                  <span className="sb-adm-person-txt"><strong>{u.full_name || '—'}</strong><bdi dir="ltr">{u.email}</bdi></span>
                  <span className="sb-gc-inline"><span className="sb-gc-tag">{f.role(u.role)}</span><span className="sb-adm-muted">{f.ago(u.last_seen_at)}</span></span>
                </li>
              ))}
            </ul>
            {data.config && data.config.modules.length > 0 && (
              <>
                <h3 className="sb-gc-h">{t('adminOcean.modules_on', { count: data.config.modules.length })}</h3>
                <p className="sb-gc-fine">{data.config.activities.map((a) => f.activity(a)).join(' · ')}</p>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
