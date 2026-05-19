import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { Button } from '@/ui/button';
import type { ProductRow, WarehouseRow } from '@/data/adapter';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TYPE_LABELS: Record<string, string> = {
  purchase:        'Purchase',
  sale:            'Sale',
  sales_return:    'Sales Return',
  purchase_return: 'Purchase Return',
  transfer_in:     'Transfer In',
  transfer_out:    'Transfer Out',
  adjustment_in:   'Adjustment In',
  adjustment_out:  'Adjustment Out',
  opening_balance: 'Opening',
  opening:         'Opening',
  void:            'Void (reversal)',
  edit_reversal:   'Edit Reversal',
};

export default function StockLedgerPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();

  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 7) + '-01';

  // Phase 12.25 — accept ?product=<id> on the URL so the product detail
  // page's "Open in Stock Ledger →" link can deep-link with the filter
  // pre-applied AND auto-run.
  const [searchParams] = useSearchParams();
  const initialProductId = searchParams.get('product') ?? '';

  const [productId, setProductId] = useState(initialProductId);
  const [warehouseId, setWarehouseId] = useState('');
  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(today);
  // Default ON: show only entries that contribute to current stock — hides
  // both halves of any void/edit-reversal pair so the user sees a clean
  // state instead of the raw audit log. Toggle OFF for the full history.
  const [hideReversed, setHideReversed] = useState(true);
  // Auto-submit when arriving from a deep-link (?product=…) so the user
  // doesn't have to click Run on every navigation.
  const [submitted, setSubmitted] = useState(!!initialProductId);

  const { data: products = [] } = useQuery<ProductRow[]>({
    queryKey: ['products', company_id],
    queryFn: () => getAdapter().products.list(company_id!),
    enabled: !!company_id,
  });

  const { data: warehouses = [] } = useQuery<WarehouseRow[]>({
    queryKey: ['warehouses', company_id],
    queryFn: () => getAdapter().warehouses.list(company_id!),
    enabled: !!company_id,
  });

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['stock_movement', company_id, productId, warehouseId, dateFrom, dateTo, hideReversed, submitted],
    queryFn: () => getAdapter().reports.getStockMovement(company_id!, {
      product_id: productId || undefined,
      warehouse_id: warehouseId || undefined,
      date_from: dateFrom,
      date_to: dateTo,
      hide_reversed: hideReversed,
    }),
    enabled: !!company_id && submitted,
  });

  const productOpts = [
    { value: '', label: t('inventory.all_products') },
    ...products.map(p => ({ value: p.id, label: `${p.sku} — ${p.name}` })),
  ];
  const warehouseOpts = [
    { value: '', label: t('inventory.all_warehouses') },
    ...warehouses.map(w => ({ value: w.id, label: w.name })),
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-ink-primary">{t('inventory.stock_ledger_title')}</h1>

      {/* Filters */}
      <div className="rounded-card border border-border-subtle bg-surface-card p-5">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Select label={t('inventory.product')} options={productOpts} value={productId}
            onChange={e => { setProductId(e.target.value); setSubmitted(false); }} />
          <Select label={t('inventory.warehouse')} options={warehouseOpts} value={warehouseId}
            onChange={e => { setWarehouseId(e.target.value); setSubmitted(false); }} />
          <Input label={t('inventory.date_from')} type="date" value={dateFrom}
            onChange={e => { setDateFrom(e.target.value); setSubmitted(false); }} />
          <Input label={t('inventory.date_to')} type="date" value={dateTo}
            onChange={e => { setDateTo(e.target.value); setSubmitted(false); }} />
        </div>
        <div className="mt-4 flex items-center justify-between gap-4">
          <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-ink-secondary">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border-strong text-brand-600 focus:ring-brand-500/30"
              checked={hideReversed}
              onChange={(e) => { setHideReversed(e.target.checked); setSubmitted(false); }}
            />
            <span>Hide reversed entries (voids &amp; edits)</span>
            <span className="text-xs text-ink-tertiary">
              {hideReversed ? '— showing only entries that affect current stock' : '— showing full audit trail'}
            </span>
          </label>
          <Button size="sm" onClick={() => setSubmitted(true)} disabled={isFetching}>
            {isFetching ? t('common.loading') : t('common.run')}
          </Button>
        </div>
      </div>

      {/* Results */}
      {submitted && (
        <div className="rounded-card border border-border-subtle bg-surface-card overflow-x-auto">
          {rows.length === 0 && !isFetching ? (
            <p className="py-12 text-center text-sm text-ink-tertiary">{t('inventory.no_movements')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle bg-surface-muted text-ink-tertiary text-xs">
                  <th className="px-4 py-3 text-start font-medium">{t('inventory.date')}</th>
                  <th className="px-4 py-3 text-start font-medium">{t('inventory.product')}</th>
                  <th className="px-4 py-3 text-start font-medium">{t('inventory.warehouse')}</th>
                  <th className="px-4 py-3 text-start font-medium">{t('inventory.type')}</th>
                  <th className="px-4 py-3 text-end font-medium w-24">{t('inventory.qty_in')}</th>
                  <th className="px-4 py-3 text-end font-medium w-24">{t('inventory.qty_out')}</th>
                  <th className="px-4 py-3 text-end font-medium w-28">{t('inventory.running_qty')}</th>
                  <th className="px-4 py-3 text-end font-medium w-28">{t('inventory.unit_cost')}</th>
                  <th className="px-4 py-3 text-end font-medium w-28">{t('inventory.running_value')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const isIn = row.direction === 1;
                  const isOut = row.direction === -1;
                  return (
                    <tr key={i} className="border-b border-border-subtle last:border-0">
                      <td className="px-4 py-2 text-ink-secondary">{row.date as string}</td>
                      <td className="px-4 py-2 font-medium text-ink-primary text-xs">{row.product_id}</td>
                      <td className="px-4 py-2 text-ink-secondary text-xs">{row.warehouse_id}</td>
                      <td className="px-4 py-2 text-ink-secondary">{TYPE_LABELS[row.movement_type] ?? row.movement_type}</td>
                      <td className="px-4 py-2 text-end text-green-700 font-mono">
                        {isIn ? fmt(row.quantity) : '—'}
                      </td>
                      <td className="px-4 py-2 text-end text-red-700 font-mono">
                        {isOut ? fmt(row.quantity) : '—'}
                      </td>
                      <td className="px-4 py-2 text-end font-mono font-semibold text-ink-primary">
                        {fmt(row.running_qty)}
                      </td>
                      <td className="px-4 py-2 text-end font-mono text-ink-secondary">
                        {row.unit_cost != null ? fmt(row.unit_cost) : '—'}
                      </td>
                      <td className="px-4 py-2 text-end font-mono text-ink-primary">
                        {row.running_value != null ? fmt(row.running_value) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
