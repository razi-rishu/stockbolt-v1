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
import { useTranslation } from 'react-i18next';
import { DocLink } from '@/ui/doc-link';
import { stockMovementKey, stockMovementTone } from '@/lib/stock-movement';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { Select } from '@/ui/select';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import type { WarehouseRow } from '@/data/adapter';

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}



export function ProductStockTab({
  companyId, productId,
}: { companyId: string; productId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Phase 47c — preset period picker (replaces raw From/To). This feeds a
  // server query that requires date bounds, so no "All time" here; default
  // = this year (year-to-date movement).
  const { preset, from: dateFrom, to: dateTo, setPreset, setCustomRange } =
    usePeriodPicker('stockbolt.tab.product-stock.period', 'this_year');
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
    { value: '', label: t('prodOcean.all_warehouses') },
    ...warehouses.map(w => ({ value: w.id, label: w.name })),
  ];

  return (
    // Ocean Teal (UI v1.1): look only — same figures, filters and movements.
    <div className="flex flex-col gap-4" data-testid="product-stock-ocean">
      {/* ── Summary tiles ────────────────────────────────────────────── */}
      <div className="sb-exp-kpis">
        <div className="sb-exp-kpi">
          <div className="sb-exp-kpi-txt">
            <span className="sb-exp-kpi-label">{t('prodOcean.on_hand')}</span>
            <bdi dir="ltr" className="sb-exp-kpi-val" style={{ color: onHand < 0 ? 'var(--sb-danger)' : onHand === 0 ? 'var(--sb-text-secondary)' : undefined }}>{fmt(onHand)}</bdi>
            <span className="sb-exp-kpi-sub">{t('prodOcean.on_hand_sub')}</span>
          </div>
        </div>
        <div className="sb-exp-kpi">
          <div className="sb-exp-kpi-txt">
            <span className="sb-exp-kpi-label">{t('prodOcean.mac')}</span>
            <bdi dir="ltr" className="sb-exp-kpi-val">{fmt(mac)}</bdi>
            <span className="sb-exp-kpi-sub">{t('prodOcean.per_unit')}</span>
          </div>
        </div>
        <div className="sb-exp-kpi">
          <div className="sb-exp-kpi-txt">
            <span className="sb-exp-kpi-label">{t('prodOcean.received')}</span>
            <bdi dir="ltr" className="sb-exp-kpi-val" style={{ color: '#067647' }}>+{fmt(stats.totalIn)}</bdi>
            <span className="sb-exp-kpi-sub">{t('prodOcean.received_sub')}</span>
          </div>
        </div>
        <div className="sb-exp-kpi">
          <div className="sb-exp-kpi-txt">
            <span className="sb-exp-kpi-label">{t('prodOcean.issued')}</span>
            <bdi dir="ltr" className="sb-exp-kpi-val" style={{ color: 'var(--sb-danger)' }}>−{fmt(stats.totalOut)}</bdi>
            <span className="sb-exp-kpi-sub">{t('prodOcean.issued_sub')}</span>
          </div>
        </div>
      </div>

      {/* ── Filters ──────────────────────────────────────────────────── */}
      <div className="sb-card sb-form sb-doc-card">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-ink-secondary">{t('prodOcean.period')}</label>
            <PeriodPicker
              mode="range" preset={preset} from={dateFrom} to={dateTo}
              onPresetChange={setPreset} onCustomRange={setCustomRange}
            />
          </div>
          <div className="min-w-[200px] flex-1"><Select label={t('billOcean.warehouse')} options={warehouseOpts} value={warehouseId} onChange={e => setWarehouseId(e.target.value)} /></div>
        </div>
        <label className="mt-3 flex cursor-pointer select-none items-center gap-2 text-sm text-ink-secondary">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border-strong text-brand-600 focus:ring-brand-500/30"
            checked={hideReversed}
            onChange={(e) => setHideReversed(e.target.checked)}
          />
          <span>{t('prodOcean.hide_reversed')}</span>
          <span className="text-xs text-ink-tertiary">
            {hideReversed ? t('prodOcean.hide_reversed_on') : t('prodOcean.hide_reversed_off')}
          </span>
        </label>
      </div>

      {/* ── Movement table ───────────────────────────────────────────── */}
      <div className="sb-card sb-doc-lines overflow-x-auto">
        {isFetching ? (
          <p className="sb-empty" style={{ textAlign: 'center' }}>{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <div className="sb-empty" style={{ textAlign: 'center' }}>
            <p className="text-sm text-ink-secondary">{t('prodOcean.no_moves')}</p>
            <p className="mt-1 text-xs text-ink-tertiary">{t('prodOcean.no_moves_hint')}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="px-4 py-2 text-start font-medium">{t('common.date')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('prodOcean.c_type')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('prodOcean.c_document')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('billOcean.warehouse')}</th>
                <th className="px-4 py-2 text-end font-medium w-24">{t('prodOcean.c_qty_in')}</th>
                <th className="px-4 py-2 text-end font-medium w-24">{t('prodOcean.c_qty_out')}</th>
                <th className="px-4 py-2 text-end font-medium w-28">{t('prodOcean.c_running')}</th>
                <th className="px-4 py-2 text-end font-medium w-24">{t('prodOcean.c_unit_cost')}</th>
                <th className="px-4 py-2 text-end font-medium w-28">{t('prodOcean.c_running_value')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const isIn  = row.direction === 1;
                const isOut = row.direction === -1;
                // One shared map, translated — the Stock Ledger page reads the
                // same one, so the two pages cannot drift apart again.
                const typeLabel = t(stockMovementKey(row.movement_type), { defaultValue: row.movement_type });
                const typeTone  = stockMovementTone(row.movement_type);
                return (
                  <tr key={i} className="border-b border-border-subtle last:border-0 hover:bg-surface-muted/30">
                    <td className="px-4 py-2 text-ink-secondary font-mono text-xs"><bdi dir="ltr">{formatDate(row.date as string)}</bdi></td>
                    <td className="px-4 py-2">
                      <span className={`rounded-pill px-2 py-0.5 text-[10px] font-medium ${typeTone}`}>
                        {typeLabel}
                      </span>
                    </td>
                    {/* DocLink resolves the route and checks the permission. */}
                    <td className="px-4 py-2 text-xs">
                      {row.related_doc_id
                        ? <DocLink type={row.related_doc_type} id={row.related_doc_id}
                            className="text-brand-600 hover:underline" />
                        : <span className="text-ink-tertiary">{'—'}</span>}
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
          type="button"
          className="sb-row-link text-brand-600"
          title={t('prodOcean.open_ledger_title')}
        >
          {t('prodOcean.open_ledger')}
        </button>
      </div>
    </div>
  );
}
