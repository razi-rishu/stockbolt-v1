/**
 * Admin explorers (phase141): every user, searchable, filterable and paged
 * (50 per page). Companies moved to the Businesses view (phase142).
 * All data comes from owner-only RPCs that refuse anyone else.
 */
import { useEffect, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Search, X, ChevronLeft, ChevronRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { getAdapter } from '@/data/index';
import { getActivity } from '@/core/global-config';
import type { AdminUserFilter, AdminUserRow } from '@/data/adapter';
import { fmtInt } from './admin-charts';

const PAGE = 50;

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
