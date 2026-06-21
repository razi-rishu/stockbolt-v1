/**
 * ProductStockTab — "where did this item move?" view embedded in the
 * product detail page (Phase 12.25).
 *
 * Before this, the only way to see a per-item movement history was to go
 * to /inventory/stock-ledger and manually filter the product dropdown.
 * Users couldn't find their way there. Now: open a product → "Stock
 * Movement" tab → full history with sane defaults.
 *
 * What it shows (top → bottom):
 *   1. Summary tiles — current on-hand qty, last movement date, total in /
 *      out for the selected date range.
 *   2. Filters — date range (default: last 12 months), warehouse, hide-
 *      reversed toggle (default ON, matches the main stock-ledger page).
 *   3. Movement table — date, type, warehouse, qty in / out, running qty,
 *      unit cost, running value, and source-document link when present.
 *
 * Data source: getStockMovement(company_id, { product_id, ... }) — the
 * same adapter call the main stock-ledger page uses, so behaviour stays
 * consistent across pages.
 */
import { useState, useMemo } from 'react';
import { formatDate } from '@/lib/locale';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import type { WarehouseRow } from '@/data/adapter';

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayIso() { return new Date().toISOString().slice(0, 10); }
function monthsAgoIso(n: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

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

const TYPE_TONE: Record<string, string> = {
  purchase:        'bg-green-50 text-green-700',
  sale:            'bg-blue-50 text-blue-700',
  sales_return:    'bg-blue-50 text-blue-700',
  purchase_return: 'bg-green-50 text-green-700',
  transfer_in:     'bg-purple-50 text-purple-700',
  transfer_out:    'bg-purple-50 text-purple-700',
  adjustment_in:   'bg-amber-50 text-amber-700',
  adjustment_out:  'bg-amber-50 text-amber-700',
  opening_balance: 'bg-gray-100 text-gray-700',
  opening:         'bg-gray-100 text-gray-700',
  void:            'bg-red-50 text-red-700',
  edit_reversal:   'bg-orange-50 text-orange-700',
};

export function ProductStockTab({
  companyId, productId,
}: { companyId: string; productId: string }) {
  const navigate = useNavigate();
  const [dateFrom, setDateFrom] = useState(monthsAgoIso(12));
  const [dateTo,   setDateTo]   = useState(todayIso);
  const [warehouseId, setWarehouseId] = useState('');
  const [hideReversed, setHideReversed] = useState(true);

  const { data: warehouses = [] } = useQuery<WarehouseRow[]>({
    queryKey: ['warehouses', companyId],
    queryFn: () => getAdapter().warehouses.list(companyId),
  });

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['product_stock_movement', companyId, productId, dateFrom, dateTo, warehouseId, hideReversed],
    queryFn: () => getAdapter().reports.getStockMovement(companyId, {
      product_id: productId,
      warehouse_id: warehouseId || undefined,
      date_from: dateFrom,
      date_to: dateTo,
      hide_reversed: hideReversed,
    }),
  });

  // Current on-hand qty (across all warehouses) — pulled from the
  // company-wide stockMap; cached, so no extra round-trip if the products
  // list already fetched it.
  const { data: stockMap = {} } = useQuery({
    queryKey: ['products_stock_map', companyId],
    queryFn: () => getAdapter().stockLedger.getCurrentStockMap(companyId),
  });
  const onHand = stockMap[productId]?.qty ?? 0;
  const mac    = stockMap[productId]?.mac ?? 0;

  // Summary stats over the visible (filtered) rows.
  const stats = useMemo(() => {
    let totalIn = 0, totalOut = 0;
    let lastDate: string | null = null;
    for (const r of rows) {
      const signed = r.direction * r.quantity;
      if (signed > 0) totalIn += signed;
      else totalOut += -signed;
      if (!lastDate || (r.date as string) > lastDate) lastDate = r.date as string;
    }
    return { totalIn, totalOut, lastDate };
  }, [rows]);

  const warehouseOpts = [
    { value: '', label: 'All warehouses' },
    ...warehouses.map(w => ({ value: w.id, label: w.name })),
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* ── Summary tiles ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-card border border-border-subtle bg-surface-card px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-tertiary">On hand</p>
          <p className={`mt-1 font-mono text-lg font-semibold ${
            onHand < 0 ? 'text-red-600' : onHand === 0 ? 'text-ink-tertiary' : 'text-ink-primary'
          }`}>
            {fmt(onHand)}
          </p>
          <p className="mt-0.5 text-xs text-ink-tertiary">across all warehouses</p>
        </div>
        <div className="rounded-card border border-border-subtle bg-surface-card px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-tertiary">Moving Avg Cost</p>
          <p className="mt-1 font-mono text-lg font-semibold text-ink-primary">{fmt(mac)}</p>
          <p className="mt-0.5 text-xs text-ink-tertiary">per unit</p>
        </div>
        <div className="rounded-card border border-border-subtle bg-surface-card px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-tertiary">Received (range)</p>
          <p className="mt-1 font-mono text-lg font-semibold text-green-700">+{fmt(stats.totalIn)}</p>
          <p className="mt-0.5 text-xs text-ink-tertiary">sum of inbound qty</p>
        </div>
        <div className="rounded-card border border-border-subtle bg-surface-card px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-tertiary">Issued (range)</p>
          <p className="mt-1 font-mono text-lg font-semibold text-red-700">−{fmt(stats.totalOut)}</p>
          <p className="mt-0.5 text-xs text-ink-tertiary">sum of outbound qty</p>
        </div>
      </div>

      {/* ── Filters ──────────────────────────────────────────────────── */}
      <div className="rounded-card border border-border-subtle bg-surface-card p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Input label="From" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          <Input label="To"   type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)} />
          <Select label="Warehouse" options={warehouseOpts} value={warehouseId} onChange={e => setWarehouseId(e.target.value)} />
        </div>
        <label className="mt-3 flex cursor-pointer select-none items-center gap-2 text-sm text-ink-secondary">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border-strong text-brand-600 focus:ring-brand-500/30"
            checked={hideReversed}
            onChange={(e) => setHideReversed(e.target.checked)}
          />
          <span>Hide reversed entries (voids &amp; edits)</span>
          <span className="text-xs text-ink-tertiary">
            {hideReversed ? '— showing only entries that affect current stock' : '— showing full audit trail'}
          </span>
        </label>
      </div>

      {/* ── Movement table ───────────────────────────────────────────── */}
      <div className="rounded-card border border-border-subtle bg-surface-card overflow-x-auto">
        {isFetching ? (
          <p className="py-8 text-center text-sm text-ink-tertiary">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-ink-secondary">No stock movements in this range.</p>
            <p className="mt-1 text-xs text-ink-tertiary">
              Try widening the date range or unchecking "Hide reversed entries".
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                <th className="px-4 py-2 text-start font-medium">Date</th>
                <th className="px-4 py-2 text-start font-medium">Type</th>
                <th className="px-4 py-2 text-start font-medium">Warehouse</th>
                <th className="px-4 py-2 text-end font-medium w-24">Qty in</th>
                <th className="px-4 py-2 text-end font-medium w-24">Qty out</th>
                <th className="px-4 py-2 text-end font-medium w-28">Running</th>
                <th className="px-4 py-2 text-end font-medium w-24">Unit cost</th>
                <th className="px-4 py-2 text-end font-medium w-28">Running value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const isIn  = row.direction === 1;
                const isOut = row.direction === -1;
                const typeLabel = TYPE_LABELS[row.movement_type] ?? row.movement_type;
                const typeTone  = TYPE_TONE[row.movement_type]  ?? 'bg-gray-100 text-gray-700';
                return (
                  <tr key={i} className="border-b border-border-subtle last:border-0 hover:bg-surface-muted/30">
                    <td className="px-4 py-2 text-ink-secondary font-mono text-xs">{formatDate(row.date as string)}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-pill px-2 py-0.5 text-[10px] font-medium ${typeTone}`}>
                        {typeLabel}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-ink-secondary text-xs">{row.warehouse_name || row.warehouse_id}</td>
                    <td className="px-4 py-2 text-end font-mono text-green-700">
                      {isIn ? fmt(row.quantity) : '—'}
                    </td>
                    <td className="px-4 py-2 text-end font-mono text-red-700">
                      {isOut ? fmt(row.quantity) : '—'}
                    </td>
                    <td className={`px-4 py-2 text-end font-mono font-semibold ${
                      row.running_qty < 0 ? 'text-red-600' : 'text-ink-primary'
                    }`}>
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

      <div className="text-end">
        <button
          onClick={() => navigate(`/inventory/stock-ledger?product=${productId}`)}
          className="text-xs text-brand-600 hover:underline"
          title="Open the full stock ledger filtered to this product"
        >
          Open in Stock Ledger →
        </button>
      </div>
    </div>
  );
}
