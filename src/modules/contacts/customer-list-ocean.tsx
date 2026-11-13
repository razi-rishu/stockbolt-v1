/**
 * Customers / Suppliers listing, Ocean Teal design (UI Design System v1.1).
 * `side` picks the title, labels and detail route; everything else is shared.
 *
 * Presentation only. contact-list.tsx still owns the data (same query), the
 * search rule (contactMatches), pagination size, the add / edit form, delete
 * and Import / Export; this component receives them as props. The Suppliers
 * list keeps the original layout — contact-list.tsx renders this only when it
 * is showing customers.
 *
 * The one addition is the All / COD / Credit terms chips, which filter the
 * already-loaded rows by payment_terms_days — no new query.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Search, Phone, MapPin, Pencil, Trash2, Plus, ChevronRight } from 'lucide-react';
import ImportExportButton from '@/modules/settings/import-export/ImportExportButton';
import { Pagination, paginate } from '@/ui/pagination';
import type { ContactRow } from '@/data/adapter';
import { useArabicEnabled } from '@/hooks/use-arabic-enabled';
import '@/styles/stockbolt-ocean-teal.css';

type TermsFilter = 'all' | 'cod' | 'credit';

export interface CustomerListOceanProps {
  /** Which list this is. Default customer. */
  side?: 'customer' | 'supplier';
  /** Rows already matched against the search box (contactMatches). */
  rows: ContactRow[];
  isLoading: boolean;
  search: string;
  onSearch: (q: string) => void;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
  onAdd: () => void;
  onEdit: (row: ContactRow) => void;
  onDelete: (row: ContactRow) => void;
}

const terms = (r: ContactRow, cod: string) => (r.payment_terms_days > 0 ? `Net ${r.payment_terms_days}` : cod);

export function CustomerListOcean(p: CustomerListOceanProps) {
  const { t } = useTranslation();
  const arabicOn = useArabicEnabled();   // India companies: English only
  const navigate = useNavigate();
  const [filter, setFilter] = useState<TermsFilter>('all');

  const shown = p.rows.filter(r => filter === 'all' || (filter === 'cod' ? r.payment_terms_days <= 0 : r.payment_terms_days > 0));
  const paged = paginate(shown, p.page, p.pageSize);
  const supplier = p.side === 'supplier';
  const L = supplier
    ? { title: 'contacts.suppliers_title', one: 'contacts.supplier', count: 'customerList.count_suppliers', empty: 'customerList.empty_filter_suppliers', base: '/contacts/suppliers' }
    : { title: 'contacts.customers_title', one: 'contacts.customer', count: 'customerList.count', empty: 'customerList.empty_filter', base: '/contacts/customers' };
  const open = (r: ContactRow) => navigate(`${L.base}/${r.id}`);
  const del = (r: ContactRow) => { if (confirm(t('common.confirm_delete'))) p.onDelete(r); };
  const cod = t('contacts.cod');

  const chips: { value: TermsFilter; label: string; count: number }[] = [
    { value: 'all',    label: t('customerList.filter_all'),    count: p.rows.length },
    { value: 'cod',    label: t('customerList.filter_cod'),    count: p.rows.filter(r => r.payment_terms_days <= 0).length },
    { value: 'credit', label: t('customerList.filter_credit'), count: p.rows.filter(r => r.payment_terms_days > 0).length },
  ];

  return (
    <div className="sb-ocean sb-page sb-clist" data-testid={supplier ? 'supplier-list-ocean' : 'customer-list-ocean'}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="sb-hero">
        <div className="sb-clist-head">
          <div style={{ minWidth: 0 }}>
            <h1 className="sb-title" style={{ marginTop: 0 }}>{t(L.title)}</h1>
            <div className="sb-clist-count">{t(L.count, { count: shown.length })}</div>
          </div>
          <div className="sb-actions" style={{ marginTop: 0 }}>
            <span className="sb-clist-io"><ImportExportButton moduleKey="contacts" /></span>
            <button type="button" className="sb-primary-btn" onClick={p.onAdd}>
              <Plus size={18} aria-hidden="true" />{t('common.add')} {t(L.one)}
            </button>
          </div>
        </div>

        {/* Search — same matching rule as before. */}
        <label className="sb-search">
          <Search size={18} className="sb-icon" aria-hidden="true" />
          <span className="sr-only">{t('contacts.search_placeholder')}</span>
          <input
            type="search"
            value={p.search}
            onChange={e => p.onSearch(e.target.value)}
            placeholder={t('contacts.search_placeholder')}
          />
        </label>

        {/* Terms filter chips (loaded rows only). */}
        <div className="sb-chips" role="group" aria-label={t('contacts.payment_terms')}>
          {chips.map(c => (
            <button key={c.value} type="button" aria-pressed={filter === c.value}
              className={`sb-chip ${filter === c.value ? 'active' : ''}`}
              onClick={() => { setFilter(c.value); p.onPage(1); }}>
              {c.label}<span className="sb-chip-count">{c.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="sb-body">
        {p.isLoading ? (
          <div className="sb-card sb-empty">{t('common.loading')}</div>
        ) : shown.length === 0 ? (
          <div className="sb-card sb-empty">{p.rows.length === 0 ? t('contacts.empty') : t(L.empty)}</div>
        ) : (
          <>
            {/* Phone: one card per customer. */}
            <ul className="sb-clist-cards" aria-label={t(L.title)}>
              {paged.map(r => (
                <li key={r.id} className="sb-card sb-ccard">
                  <button type="button" className="sb-ccard-main" onClick={() => open(r)}>
                    <span className="sb-avatar" aria-hidden="true">{(r.name || '?').trim().charAt(0).toUpperCase()}</span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span className="sb-ccard-name">{r.name}</span>
                      {r.name_ar && <span className="sb-ccard-ar"><bdi>{r.name_ar}</bdi></span>}
                      <span className="sb-ccard-meta">
                        {(r.phone || r.mobile) && <span><Phone size={14} aria-hidden="true" /><bdi dir="ltr">{r.phone ?? r.mobile}</bdi></span>}
                        {r.address_city && <span><MapPin size={14} aria-hidden="true" />{r.address_city}</span>}
                      </span>
                    </span>
                    <ChevronRight size={20} className="sb-icon sb-flip" aria-hidden="true" />
                  </button>
                  <div className="sb-ccard-foot">
                    <span className="sb-pill">{terms(r, cod)}</span>
                    {r.type === 'both' && <span className="sb-pill sb-pill-muted">{t('contacts.type_both')}</span>}
                    <span style={{ flex: 1 }} />
                    <button type="button" className="sb-icon-btn" onClick={() => p.onEdit(r)} aria-label={`${t('common.edit')} ${r.name}`}>
                      <Pencil size={18} aria-hidden="true" /><span>{t('common.edit')}</span>
                    </button>
                    <button type="button" className="sb-icon-btn sb-danger" onClick={() => del(r)} aria-label={`${t('common.delete')} ${r.name}`}>
                      <Trash2 size={18} aria-hidden="true" /><span>{t('common.delete')}</span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop: the same columns as before, in an Ocean table. */}
            <div className="sb-card sb-ctable-wrap">
              <table className="sb-ctable">
                <thead>
                  <tr>
                    <th>{t('contacts.name')}</th>
                    {arabicOn && <th>{t('contacts.name_ar')}</th>}
                    <th>{t('contacts.phone')}</th>
                    <th>{t('contacts.email')}</th>
                    <th>{t('contacts.payment_terms')}</th>
                    <th>{t('contacts.city')}</th>
                    <th aria-label={t('common.edit')} />
                  </tr>
                </thead>
                <tbody>
                  {paged.map(r => (
                    <tr key={r.id}>
                      <td>
                        <button type="button" className="sb-link" onClick={() => open(r)}>{r.name}</button>
                        {r.type === 'both' && <span className="sb-pill sb-pill-muted" style={{ marginInlineStart: 8 }}>{t('contacts.type_both')}</span>}
                      </td>
                      {arabicOn && <td>{r.name_ar ? <bdi>{r.name_ar}</bdi> : '—'}</td>}
                      <td><bdi dir="ltr">{r.phone ?? r.mobile ?? '—'}</bdi></td>
                      <td>{r.email ?? '—'}</td>
                      <td><span className="sb-pill">{terms(r, cod)}</span></td>
                      <td>{r.address_city ?? '—'}</td>
                      <td>
                        <div className="sb-row-actions">
                          <button type="button" className="sb-icon-btn" onClick={() => p.onEdit(r)} aria-label={`${t('common.edit')} ${r.name}`}>
                            <Pencil size={16} aria-hidden="true" /><span>{t('common.edit')}</span>
                          </button>
                          <button type="button" className="sb-icon-btn sb-danger" onClick={() => del(r)} aria-label={`${t('common.delete')} ${r.name}`}>
                            <Trash2 size={16} aria-hidden="true" /><span>{t('common.delete')}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination page={p.page} pageSize={p.pageSize} total={shown.length} onChange={p.onPage} />
          </>
        )}
      </div>
    </div>
  );
}
