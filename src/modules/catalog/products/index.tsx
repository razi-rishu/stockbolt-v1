import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import ImportExportButton from '@/modules/settings/import-export/ImportExportButton';
import type { Column } from '@/ui/table';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import { Plus, Search } from 'lucide-react';
import type { ProductRow } from '@/data/adapter';

// Quality tier pills — Ocean tones, same tiers as before.
const QUALITY_TONE: Record<string, string> = {
  genuine: '', oem: 'sb-pill-good', premium: 'sb-pill-warn', economy: 'sb-pill-muted',
};

export default function ProductsListPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);

  const { data: all = [], isLoading } = useQuery({
    queryKey: ['products', company_id],
    queryFn: () => getAdapter().products.list(company_id!),
    enabled: !!company_id && !search,
  });

  const { data: results = [] } = useQuery({
    queryKey: ['products_search', company_id, search],
    queryFn: async () => {
      setSearching(true);
      try { return await getAdapter().products.search(company_id!, search); }
      finally { setSearching(false); }
    },
    enabled: !!company_id && search.trim().length >= 2,
  });

  // Current on-hand qty per product (summed across warehouses). One round
  // trip via the cached getCurrentStockMap RPC. Negative qty is surfaced
  // explicitly — silently clamping it to 0 hides the inventory mismatch
  // a user would otherwise need to discover by opening each product.
  const { data: stockMap = {} } = useQuery({
    queryKey: ['products_stock_map', company_id],
    queryFn: () => getAdapter().stockLedger.getCurrentStockMap(company_id!),
    enabled: !!company_id,
  });

  const rows = search.trim().length >= 2 ? results : all;
  const loading = isLoading || searching;

  const columns: Column<ProductRow>[] = [
    { key: 'sku', header: t('products.sku'), render: (r) => <bdi dir="ltr" className="sb-inv-no">{r.sku}</bdi> },
    {
      key: 'name', header: t('products.name'),
      render: (r) => (
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontWeight: 600 }}>{r.name}</span>
          {r.name_ar && <span className="sb-fx-name" dir="rtl" style={{ fontSize: 12 }}>{r.name_ar}</span>}
        </span>
      ),
    },
    { key: 'oe', header: t('products.oe_number'), render: (r) => r.oe_number ? <bdi dir="ltr" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{r.oe_number}</bdi> : '—' },
    {
      key: 'quality', header: t('products.quality_tier'),
      render: (r) => r.quality_tier
        ? <span className={`sb-pill ${QUALITY_TONE[r.quality_tier] ?? 'sb-pill-muted'}`} style={{ marginTop: 0 }}>{t(`products.quality_${r.quality_tier}`)}</span>
        : '—',
    },
    {
      key: 'price', header: t('products.selling_price'), align: 'end',
      render: (r) => <bdi dir="ltr" className="sb-dash-num">{Number(r.selling_price).toFixed(2)}</bdi>,
    },
    {
      key: 'stock', header: t('invOcean.stock'), align: 'end',
      render: (r) => {
        // Services are never stock-tracked (Phase 36) — show a pill, not a qty.
        if ((r as { type?: string }).type === 'service') {
          return <span className="sb-pill sb-pill-muted" style={{ marginTop: 0 }}>{t('products.type_service')}</span>;
        }
        const qty = stockMap[r.id]?.qty ?? 0;
        // Red for negative (oversold), amber for low-stock, default ink for
        // healthy. min_stock_level is per-product so we compare against it.
        const min = Number(r.min_stock_level ?? 0);
        const color = qty < 0 ? 'var(--sb-danger)' : (min > 0 && qty <= min) ? '#B45309' : 'var(--sb-text)';
        // Phase 12.25 — click the cell to jump straight to the Stock
        // Movement tab on the product detail (deep-link via ?tab=stock).
        return (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); navigate(`/products/${r.id}?tab=stock`); }}
            className="sb-row-link"
            style={{ color, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
            title={t('prodOcean.stock_link_title')}
          >
            <bdi dir="ltr">{qty.toFixed(qty % 1 === 0 ? 0 : 2)}</bdi>
          </button>
        );
      },
    },
    {
      key: 'status', header: '',
      render: (r) => <span className={`sb-pill ${r.is_active ? 'sb-pill-good' : 'sb-pill-muted'}`} style={{ marginTop: 0 }}>{r.is_active ? t('common.active') : t('common.inactive')}</span>,
    },
  ];

  // Ocean Teal (UI v1.1): look only — same products, search (2+ letters),
  // stock map, stock deep-link, import/export and add.
  return (
    <OceanPage
      testid="products-ocean"
      title={t('products.title')}
      subtitle={t('prodOcean.items_count', { count: rows.length })}
      actions={<>
        <ImportExportButton moduleKey="products" />
        <button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => navigate('/products/new')}>
          <Plus size={18} aria-hidden="true" />{t('common.add')} {t('products.singular')}
        </button>
      </>}
      below={
        <label className="sb-search" style={{ marginTop: 14 }}>
          <Search size={18} className="sb-icon" aria-hidden="true" />
          <span className="sr-only">{t('products.search_placeholder')}</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('products.search_placeholder')}
          />
        </label>
      }
    >
      {loading
        ? <div className="sb-card sb-empty">{t('common.loading')}</div>
        : <OceanTable columns={columns} rows={rows} keyFn={(r) => r.id} cardTitleKey="name"
            onRowClick={(r) => navigate(`/products/${r.id}`)} rowMuted={(r) => !r.is_active}
            emptyMessage={search ? t('products.no_results') : t('products.empty')} />}
    </OceanPage>
  );
}
