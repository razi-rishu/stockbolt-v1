import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import ImportExportButton from '@/modules/settings/import-export/ImportExportButton';
import { Badge } from '@/ui/badge';
import { Table, type Column } from '@/ui/table';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import type { ProductRow } from '@/data/adapter';

const QUALITY_VARIANT: Record<string, 'brand' | 'success' | 'warning' | 'muted'> = {
  genuine: 'brand', oem: 'success', premium: 'warning', economy: 'muted',
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
    { key: 'sku', header: t('products.sku'), width: '120px', render: (r) => <span className="font-mono text-xs font-medium">{r.sku}</span> },
    {
      key: 'name', header: t('products.name'),
      render: (r) => (
        <div>
          <div className="font-medium text-ink-primary">{r.name}</div>
          {r.name_ar && <div className="text-xs text-ink-tertiary" dir="rtl">{r.name_ar}</div>}
        </div>
      ),
    },
    { key: 'oe', header: t('products.oe_number'), render: (r) => <span className="font-mono text-xs">{r.oe_number ?? '—'}</span> },
    {
      key: 'quality', header: t('products.quality_tier'), width: '100px',
      render: (r) => r.quality_tier
        ? <Badge variant={QUALITY_VARIANT[r.quality_tier] ?? 'muted'}>{t(`products.quality_${r.quality_tier}`)}</Badge>
        : null,
    },
    {
      key: 'price', header: t('products.selling_price'), width: '100px',
      render: (r) => <span className="font-medium">{Number(r.selling_price).toFixed(2)}</span>,
    },
    {
      key: 'stock', header: 'Stock', width: '90px',
      render: (r) => {
        // Services are never stock-tracked (Phase 36) — show a badge, not a qty.
        if ((r as { type?: string }).type === 'service') {
          return <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">{t('products.type_service')}</span>;
        }
        const qty = stockMap[r.id]?.qty ?? 0;
        // Red for negative (oversold), amber for low-stock, default ink for
        // healthy. min_stock_level is per-product so we compare against it.
        const min = Number(r.min_stock_level ?? 0);
        const cls = qty < 0
          ? 'text-red-600 font-semibold'
          : (min > 0 && qty <= min)
            ? 'text-amber-700 font-semibold'
            : 'text-ink-primary font-medium';
        // Phase 12.25 — click the cell to jump straight to the Stock
        // Movement tab on the product detail (deep-link via ?tab=stock).
        return (
          <span
            onClick={(e) => { e.stopPropagation(); navigate(`/products/${r.id}?tab=stock`); }}
            className={`cursor-pointer font-mono underline-offset-2 hover:underline ${cls}`}
            title="View this product's stock movements"
          >
            {qty.toFixed(qty % 1 === 0 ? 0 : 2)}
          </span>
        );
      },
    },
    {
      key: 'status', header: '', width: '80px',
      render: (r) => <Badge variant={r.is_active ? 'success' : 'muted'}>{r.is_active ? t('common.active') : t('common.inactive')}</Badge>,
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title={t('products.title')}
        subtitle={`${rows.length} ${rows.length === 1 ? 'item' : 'items'}`}
        actions={
          <div style={{ display: 'flex', gap: '8px' }}>
            <ImportExportButton moduleKey="products" />
            <Button size="sm" onClick={() => navigate('/products/new')}>
              + {t('common.add')} {t('products.singular')}
            </Button>
          </div>
        }
      />

      <div style={{ position: 'relative', maxWidth: '420px' }}>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('products.search_placeholder')}
          style={{
            width: '100%',
            height: '38px',
            padding: '0 14px 0 36px',
            fontSize: '13px',
            border: `1px solid ${theme.border}`,
            borderRadius: '999px',
            background: '#fff',
            color: theme.ink,
            outline: 'none',
            boxShadow: '0 1px 2px rgba(15,23,42,.04)',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = theme.brand;
            e.currentTarget.style.boxShadow = `0 0 0 3px ${theme.brandRing}`;
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = theme.border;
            e.currentTarget.style.boxShadow = '0 1px 2px rgba(15,23,42,.04)';
          }}
        />
        <svg
          viewBox="0 0 24 24" width="14" height="14"
          style={{ position: 'absolute', insetInlineStart: '14px', top: '50%', transform: 'translateY(-50%)', color: theme.inkFaint }}
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
      </div>

      {loading
        ? <div style={{ padding: '48px 0', textAlign: 'center', fontSize: '13px', color: theme.inkFaint }}>{t('common.loading')}</div>
        : <Table columns={columns} rows={rows} keyFn={(r) => r.id} onRowClick={(r) => navigate(`/products/${r.id}`)} emptyMessage={search ? t('products.no_results') : t('products.empty')} />
      }
    </div>
  );
}
