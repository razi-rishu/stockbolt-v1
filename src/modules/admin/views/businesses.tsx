/**
 * Control Center — Businesses (phase142). Search, status, country, business
 * type and registration-date filters; sortable columns; 50 per page; row →
 * detail. All state lives in the URL so drill-down and back keep the view.
 */
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Search, X, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, FilterX } from 'lucide-react';
import { getAdapter } from '@/data/index';
import { INDUSTRY_FAMILIES, activitiesOf } from '@/core/global-config';
import type { AdminBusinessFilter, AdminBusinessSort, AdminBusinessesPage } from '@/data/adapter';
import { fmtInt } from '../admin-charts';
import { useAdminFormat } from '../admin-explorers';
import { MetricInfo } from '../admin-ui';

const PAGE = 50;
const FILTERS: AdminBusinessFilter[] = ['all', 'active_30d', 'dormant', 'trial', 'paying', 'not_configured'];
const FILTER_KEY: Record<AdminBusinessFilter, string> = {
  all: 'adminOcean.cf_all', active_30d: 'adminOcean.cf_active_30d', dormant: 'adminOcean.cf_dormant',
  trial: 'adminOcean.cf_trial', paying: 'adminOcean.cf_paying', not_configured: 'adminOcean.cf_not_configured',
};

export function BusinessesView() {
  const { t, i18n } = useTranslation();
  const f = useAdminFormat();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const filter = (FILTERS.includes(get('filter') as AdminBusinessFilter) ? get('filter') : 'all') as AdminBusinessFilter;
  const sort = (get('sort') || 'created_at') as AdminBusinessSort;
  const dir = get('dir') === 'asc' ? 'asc' : 'desc';
  const page = Math.max(0, Number(get('page') || 0));
  // ?type= is an industry family key; unknown values are ignored.
  const type = INDUSTRY_FAMILIES.some((fam) => fam.key === get('type')) ? get('type') : '';
  const familyKey = INDUSTRY_FAMILIES.find((fam) => fam.key === type)?.key;
  const activities = familyKey ? activitiesOf(familyKey).map((a) => a.key) : null;

  // Search box: typed text debounced into the URL.
  const [search, setSearch] = useState(get('q'));
  useEffect(() => {
    const id = setTimeout(() => { if (search !== get('q')) set({ q: search || null, page: null }); }, 300);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to typing
  }, [search]);

  function set(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === '') next.delete(k); else next.set(k, v); }
    setParams(next, { replace: true });
  }
  const sortBy = (col: AdminBusinessSort) => set({ sort: col, dir: sort === col && dir === 'desc' ? 'asc' : 'desc', page: null });

  const { data, isFetching, isError, error } = useQuery<AdminBusinessesPage>({
    queryKey: ['admin_businesses', get('q'), filter, get('country'), type, get('from'), get('to'), sort, dir, page],
    queryFn: () => getAdapter().admin.businesses({
      search: get('q'), filter, country: get('country') || null, activities,
      from: get('from') || null, to: get('to') || null, sort, dir, limit: PAGE, offset: page * PAGE }),
    placeholderData: keepPreviousData,
  });
  const s = data?.summary;
  const total = data?.total ?? 0;
  const anyFilter = ['q', 'filter', 'country', 'type', 'from', 'to'].some((k) => params.get(k));

  const Th = ({ col, children, num }: { col: AdminBusinessSort; children: React.ReactNode; num?: boolean }) => (
    <th className={num ? 'is-num' : undefined} aria-sort={sort === col ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="sb-adm-sort" onClick={() => sortBy(col)}>
        {children}
        {sort === col ? (dir === 'asc' ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />)
          : <ArrowUpDown size={13} className="sb-adm-sort-idle" aria-hidden="true" />}
      </button>
    </th>
  );

  return (
    <div className="sb-adm" data-testid="admin-businesses">
      {/* Summary chips = status filters with counts */}
      <div className="sb-adm-chips" role="group" aria-label={t('adminCC.status')}>
        {FILTERS.map((k) => {
          const n = !s ? null : k === 'all' ? s.total : k === 'active_30d' ? s.active_30d : k === 'dormant' ? s.dormant
            : k === 'trial' ? s.trialing : k === 'not_configured' ? s.not_configured : null;
          return (
            <button key={k} type="button" className={`sb-adm-chip ${filter === k ? 'is-on' : ''}`} aria-pressed={filter === k}
              onClick={() => set({ filter: k === 'all' ? null : k, page: null })}>
              {t(FILTER_KEY[k])}{n != null && <span className="sb-adm-chip-n" dir="ltr">{fmtInt(n)}</span>}
            </button>
          );
        })}
      </div>

      <section className="sb-card sb-adm-panel">
        <div className="sb-adm-filters">
          <label className="sb-adm-search">
            <Search size={16} aria-hidden="true" />
            <input type="search" value={search} placeholder={t('adminCC.search_businesses')} onChange={(e) => setSearch(e.target.value)} data-testid="biz-search" />
            {search && <button type="button" aria-label={t('adminOcean.clear')} onClick={() => setSearch('')}><X size={14} aria-hidden="true" /></button>}
          </label>
          <label className="sb-adm-field">
            <span>{t('adminOcean.c_country')}</span>
            <select value={get('country')} onChange={(e) => set({ country: e.target.value || null, page: null })} data-testid="biz-country">
              <option value="">{t('adminCC.any')}</option>
              {(s?.countries ?? []).map((c) => <option key={c} value={c}>{f.country(c)}</option>)}
            </select>
          </label>
          <label className="sb-adm-field">
            <span>{t('adminOcean.c_business')}</span>
            <select value={type} onChange={(e) => set({ type: e.target.value || null, page: null })} data-testid="biz-type">
              <option value="">{t('adminCC.any')}</option>
              {INDUSTRY_FAMILIES.map((fam) => <option key={fam.key} value={fam.key}>{i18n.language === 'ar' ? fam.name_ar : fam.name}</option>)}
            </select>
          </label>
          <label className="sb-adm-field">
            <span>{t('adminCC.registered_from')}</span>
            <input type="date" dir="ltr" value={get('from')} max={get('to') || undefined} onChange={(e) => set({ from: e.target.value || null, page: null })} />
          </label>
          <label className="sb-adm-field">
            <span>{t('adminCC.registered_to')}</span>
            <input type="date" dir="ltr" value={get('to')} min={get('from') || undefined} onChange={(e) => set({ to: e.target.value || null, page: null })} />
          </label>
          {anyFilter && (
            <button type="button" className="sb-secondary-btn sb-btn-inline" onClick={() => { setSearch(''); setParams(new URLSearchParams(), { replace: true }); }}>
              <FilterX size={16} aria-hidden="true" /> {t('adminCC.clear_filters')}
            </button>
          )}
        </div>

        {isError && <p className="sb-alert sb-alert-danger" role="alert">{String((error as Error)?.message ?? '')}</p>}

        <div className={`sb-adm-table-wrap ${isFetching ? 'is-busy' : ''}`}>
          <table className="sb-adm-table">
            <thead><tr>
              <Th col="name">{t('adminOcean.c_company')}</Th>
              <th>{t('adminCC.c_owner')} <MetricInfo metric="owner" /></th>
              <Th col="country_code">{t('adminOcean.c_country')}</Th>
              <th>{t('adminOcean.c_business')}</th>
              <Th col="users" num>{t('adminOcean.c_users')}</Th>
              <Th col="created_at">{t('adminCC.c_registered')}</Th>
              <Th col="last_activity">{t('adminOcean.c_last_activity')}</Th>
              <th>{t('adminOcean.c_plan')}</th>
            </tr></thead>
            <tbody>
              {data && data.rows.length === 0 && <tr><td colSpan={8} className="sb-adm-empty">{t('adminCC.no_match')}</td></tr>}
              {(data?.rows ?? []).map((c) => (
                <tr key={c.id} className="is-link" tabIndex={0} data-testid={`biz-row-${c.id}`}
                  onClick={() => navigate(`/admin/businesses/${c.id}`, { state: { back: location.search } })}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/admin/businesses/${c.id}`, { state: { back: location.search } }); }}>
                  <td><strong>{c.name}</strong></td>
                  <td>{c.owner_name ?? '—'}</td>
                  <td>{f.country(c.country_code)}</td>
                  <td>{c.configured ? f.activity(c.primary_activity_key) : <span className="sb-adm-tag is-warn">{t('adminOcean.not_configured')}</span>}</td>
                  <td className="is-num"><bdi dir="ltr">{fmtInt(c.users)}</bdi></td>
                  <td><bdi dir="ltr">{f.date(c.created_at)}</bdi></td>
                  <td className={!c.last_activity || Date.now() - Date.parse(c.last_activity) > 30 * 86400_000 ? 'is-muted' : ''}>{f.ago(c.last_activity)}</td>
                  <td><span className="sb-adm-tag">{f.plan(c)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="sb-adm-pager">
          <bdi dir="ltr">{t('adminOcean.showing', { from: total === 0 ? 0 : page * PAGE + 1, to: Math.min(total, (page + 1) * PAGE), total })}</bdi>
          <span className="sb-adm-pager-btns">
            <button type="button" className="sb-icon-btn" disabled={page === 0} onClick={() => set({ page: String(page - 1) })} aria-label={t('adminOcean.prev')}>
              <ChevronLeft size={16} className="sb-rtl-flip" aria-hidden="true" />
            </button>
            <button type="button" className="sb-icon-btn" disabled={(page + 1) * PAGE >= total} onClick={() => set({ page: String(page + 1) })} aria-label={t('adminOcean.next')}>
              <ChevronRight size={16} className="sb-rtl-flip" aria-hidden="true" />
            </button>
          </span>
        </div>
      </section>
    </div>
  );
}
