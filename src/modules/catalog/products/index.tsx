import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Table, type Column } from '@/ui/table';
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
        const qty = stockMap[r.id]?.qty ?? 0;
        // Red for negative (oversold), amber for low-stock, default ink for
        // healthy. min_stock_level is per-product so we compare against it.
        const min = Number(r.min_stock_level ?? 0);
        const cls = qty < 0
          ? 'text-red-600 font-semibold'
          : (min > 0 && qty <= min)
            ? 'text-amber-700 font-semibold'
            : 'text-ink-primary font-medium';
        return <span className={`font-mono ${cls}`}>{qty.toFixed(qty % 1 === 0 ? 0 : 2)}</span>;
      },
    },
    {
      key: 'status', header: '', width: '80px',
      render: (r) => <Badge variant={r.is_active ? 'success' : 'muted'}>{r.is_active ? t('common.active') : t('common.inactive')}</Badge>,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink-primary">{t('products.title')}</h1>
        <Button size="sm" onClick={() => navigate('/products/new')}>{t('common.add')} {t('products.singular')}</Button>
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('products.search_placeholder')}
        className="h-10 w-full max-w-md rounded-input border border-border-strong bg-surface-subtle px-4 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      />

      {loading
        ? <div className="py-12 text-center text-ink-tertiary">{t('common.loading')}</div>
        : <Table columns={columns} rows={rows} keyFn={(r) => r.id} onRowClick={(r) => navigate(`/products/${r.id}`)} emptyMessage={search ? t('products.no_results') : t('products.empty')} />
      }
    </div>
  );
}
