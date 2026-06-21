import { useState } from 'react';
import { formatDate } from '@/lib/locale';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { Button } from '@/ui/button';
import { PageHeader, Panel } from '@/ui/primitives';
import { theme } from '@/ui/theme';
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title={t('inventory.stock_ledger_title')}
        subtitle={submitted ? `${rows.length} ${rows.length === 1 ? 'movement' : 'movements'}` : 'Filter and run to see stock movements'}
      />

      {/* Filters */}
      <Panel icon="🔍" title="Filters">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
          <Select label={t('inventory.product')} options={productOpts} value={productId}
            onChange={e => { setProductId(e.target.value); setSubmitted(false); }} />
          <Select label={t('inventory.warehouse')} options={warehouseOpts} value={warehouseId}
            onChange={e => { setWarehouseId(e.target.value); setSubmitted(false); }} />
          <Input label={t('inventory.date_from')} type="date" value={dateFrom}
            onChange={e => { setDateFrom(e.target.value); setSubmitted(false); }} />
          <Input label={t('inventory.date_to')} type="date" value={dateTo}
            onChange={e => { setDateTo(e.target.value); setSubmitted(false); }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none', fontSize: '13px', color: theme.inkMuted }}>
            <input
              type="checkbox"
              style={{ width: '16px', height: '16px', accentColor: theme.brand, cursor: 'pointer' }}
              checked={hideReversed}
              onChange={(e) => { setHideReversed(e.target.checked); setSubmitted(false); }}
            />
            <span style={{ color: theme.ink, fontWeight: 500 }}>Hide reversed entries (voids &amp; edits)</span>
            <span style={{ fontSize: '11px', color: theme.inkFaint }}>
              {hideReversed ? '— affecting current stock only' : '— full audit trail'}
            </span>
          </label>
          <Button size="sm" onClick={() => setSubmitted(true)} disabled={isFetching}>
            {isFetching ? t('common.loading') : t('common.run')}
          </Button>
        </div>
      </Panel>

      {/* Results */}
      {submitted && (
        <div
          className="overflow-x-auto bg-white"
          style={{ border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: theme.shadowSm }}
        >
          {rows.length === 0 && !isFetching ? (
            <p style={{ padding: '48px 0', textAlign: 'center', fontSize: '13px', color: theme.inkFaint }}>{t('inventory.no_movements')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}` }}>
                  {[
                    { l: t('inventory.date'),         a: 'start' as const, w: undefined },
                    { l: t('inventory.product'),      a: 'start' as const, w: undefined },
                    { l: t('inventory.warehouse'),    a: 'start' as const, w: undefined },
                    { l: t('inventory.type'),         a: 'start' as const, w: undefined },
                    { l: t('inventory.qty_in'),       a: 'end'   as const, w: '96px' },
                    { l: t('inventory.qty_out'),      a: 'end'   as const, w: '96px' },
                    { l: t('inventory.running_qty'),  a: 'end'   as const, w: '110px' },
                    { l: t('inventory.unit_cost'),    a: 'end'   as const, w: '110px' },
                    { l: t('inventory.running_value'),a: 'end'   as const, w: '110px' },
                  ].map(c => (
                    <th
                      key={c.l}
                      className="px-4 py-3 font-semibold"
                      style={{
                        fontSize: '11px', color: theme.inkMuted,
                        textTransform: 'uppercase', letterSpacing: '.06em',
                        textAlign: c.a, width: c.w, whiteSpace: 'nowrap',
                      }}
                    >{c.l}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const isIn = row.direction === 1;
                  const isOut = row.direction === -1;
                  return (
                    <tr key={i} style={{ borderTop: i === 0 ? 'none' : '1px solid #f1f5f9' }}>
                      <td className="px-4 py-2" style={{ color: theme.inkMuted, fontSize: '13px' }}>{formatDate(row.date as string)}</td>
                      <td className="px-4 py-2" style={{ color: theme.ink, fontSize: '13px' }}>
                        <span style={{ fontWeight: 600 }}>{row.product_name}</span>
                        {row.sku && <span style={{ marginInlineStart: '6px', fontSize: '11px', color: theme.inkMuted }}>({row.sku})</span>}
                      </td>
                      <td className="px-4 py-2" style={{ color: theme.inkMuted, fontSize: '13px' }}>{row.warehouse_name}</td>
                      <td className="px-4 py-2" style={{ color: theme.inkMuted, fontSize: '13px' }}>{TYPE_LABELS[row.movement_type] ?? row.movement_type}</td>
                      <td className="px-4 py-2 font-mono" style={{ textAlign: 'end', color: '#059669' }}>
                        {isIn ? fmt(row.quantity) : '—'}
                      </td>
                      <td className="px-4 py-2 font-mono" style={{ textAlign: 'end', color: '#dc2626' }}>
                        {isOut ? fmt(row.quantity) : '—'}
                      </td>
                      <td className="px-4 py-2 font-mono" style={{ textAlign: 'end', color: theme.ink, fontWeight: 600 }}>
                        {fmt(row.running_qty)}
                      </td>
                      <td className="px-4 py-2 font-mono" style={{ textAlign: 'end', color: theme.inkMuted }}>
                        {row.unit_cost != null ? fmt(row.unit_cost) : '—'}
                      </td>
                      <td className="px-4 py-2 font-mono" style={{ textAlign: 'end', color: theme.ink }}>
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
