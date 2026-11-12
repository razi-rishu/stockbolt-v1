import { useState } from 'react';
import { formatDate } from '@/lib/locale';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Select } from '@/ui/select';
import { Button } from '@/ui/button';
import { OceanPage } from '@/components/ocean-list';
import { Play, SlidersHorizontal } from 'lucide-react';
import { DocLink } from '@/ui/doc-link';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { stockMovementKey, stockMovementTone } from '@/lib/stock-movement';
import type { ProductRow, WarehouseRow } from '@/data/adapter';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });


export default function StockLedgerPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();

  // Phase 12.25 — accept ?product=<id> on the URL so the product detail
  // page's "Open in Stock Ledger →" link can deep-link with the filter
  // pre-applied AND auto-run.
  const [searchParams] = useSearchParams();
  const initialProductId = searchParams.get('product') ?? '';

  const [productId, setProductId] = useState(initialProductId);
  const [warehouseId, setWarehouseId] = useState('');
  // Phase 47c — preset period picker (replaces raw From/To). Default this month
  // (= the page's previous firstOfMonth→today default). Like the other filters,
  // changing the period requires a Run click, so the heavy query stays gated.
  const { preset, from: dateFrom, to: dateTo, setPreset, setCustomRange } =
    usePeriodPicker('stockbolt.list.stock-ledger.period', 'this_month');
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

  const cols = [
    { l: t('inventory.date'),          a: 'start' as const },
    { l: t('inventory.product'),       a: 'start' as const },
    { l: t('inventory.warehouse'),     a: 'start' as const },
    { l: t('inventory.type'),          a: 'start' as const },
    { l: t('inventory.document'),      a: 'start' as const },
    { l: t('inventory.qty_in'),        a: 'end'   as const },
    { l: t('inventory.qty_out'),       a: 'end'   as const },
    { l: t('inventory.running_qty'),   a: 'end'   as const },
    { l: t('inventory.unit_cost'),     a: 'end'   as const },
    { l: t('inventory.running_value'), a: 'end'   as const },
  ];

  // Ocean Teal (UI v1.1): look only — same filters, Run gate, deep-link
  // auto-run, reversed-entry toggle and movement rows as before.
  return (
    <OceanPage
      testid="stock-ledger-ocean"
      title={t('inventory.stock_ledger_title')}
      subtitle={submitted ? t('stockOcean.movements_count', { count: rows.length }) : t('stockOcean.run_hint')}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Filters */}
        <div className="sb-card sb-form sb-doc-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 className="sb-doc-card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <SlidersHorizontal size={17} aria-hidden="true" style={{ color: 'var(--sb-primary)' }} /> {t('stockOcean.filters')}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: '12px' }}>
            <Select label={t('inventory.product')} options={productOpts} value={productId}
              onChange={e => { setProductId(e.target.value); setSubmitted(false); }} />
            <Select label={t('inventory.warehouse')} options={warehouseOpts} value={warehouseId}
              onChange={e => { setWarehouseId(e.target.value); setSubmitted(false); }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label className="text-xs font-medium text-ink-secondary">{t('reports.period') || 'Period'}</label>
              <PeriodPicker
                mode="range" preset={preset} from={dateFrom} to={dateTo}
                onPresetChange={(p) => { setPreset(p); setSubmitted(false); }}
                onCustomRange={(f, tt) => { setCustomRange(f, tt); setSubmitted(false); }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none', fontSize: '14px', flexWrap: 'wrap' }}>
              <input
                type="checkbox"
                style={{ width: '16px', height: '16px', accentColor: 'var(--sb-primary)', cursor: 'pointer' }}
                checked={hideReversed}
                onChange={(e) => { setHideReversed(e.target.checked); setSubmitted(false); }}
              />
              <span style={{ color: 'var(--sb-text)', fontWeight: 600 }}>{t('prodOcean.hide_reversed')}</span>
              <span className="sb-form-hint" style={{ margin: 0 }}>
                {hideReversed ? t('prodOcean.hide_reversed_on') : t('prodOcean.hide_reversed_off')}
              </span>
            </label>
            <Button size="sm" onClick={() => setSubmitted(true)} disabled={isFetching}>
              <Play size={15} aria-hidden="true" /> {isFetching ? t('common.loading') : t('common.run')}
            </Button>
          </div>
        </div>

        {/* Results */}
        {submitted && (
          <div className="sb-card sb-doc-lines">
            {rows.length === 0 && !isFetching ? (
              <p className="sb-empty" style={{ textAlign: 'center', margin: 0 }}>{t('inventory.no_movements')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: 980 }}>
                  <thead>
                    <tr>
                      {cols.map(c => (
                        <th key={c.l} className="px-4 py-3" style={{ textAlign: c.a, whiteSpace: 'nowrap' }}>{c.l}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => {
                      const isIn = row.direction === 1;
                      const isOut = row.direction === -1;
                      return (
                        <tr key={i} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--sb-border)' }}>
                          <td className="px-4 py-2" style={{ color: 'var(--sb-text-secondary)', fontSize: '13px', whiteSpace: 'nowrap' }}><bdi dir="ltr">{formatDate(row.date as string)}</bdi></td>
                          <td className="px-4 py-2" style={{ fontSize: '13px' }}>
                            <DocLink type="product" id={row.product_id} label={row.product_name} className="font-semibold text-brand-600 hover:underline" />
                            {row.sku && <bdi dir="ltr" style={{ marginInlineStart: '6px', fontSize: '11px', color: 'var(--sb-text-secondary)' }}>({row.sku})</bdi>}
                          </td>
                          <td className="px-4 py-2" style={{ color: 'var(--sb-text-secondary)', fontSize: '13px' }}>{row.warehouse_name}</td>
                          {/* Translated and toned, from the one shared map. */}
                          <td className="px-4 py-2">
                            <span className={`inline-block rounded-pill px-2 py-0.5 text-xs font-semibold ${stockMovementTone(row.movement_type)}`}>
                              {t(stockMovementKey(row.movement_type), { defaultValue: row.movement_type })}
                            </span>
                          </td>
                          {/* The document that caused the movement. DocLink
                              resolves the route from related_doc_type and checks
                              the permission for it, so an unauthorised reader
                              gets plain text rather than a dead link. */}
                          <td className="px-4 py-2" style={{ fontSize: '13px' }}>
                            {row.related_doc_id
                              ? <DocLink type={row.related_doc_type} id={row.related_doc_id}
                                  className="text-brand-600 hover:underline" />
                              : <span style={{ color: 'var(--sb-text-secondary)' }}>{'—'}</span>}
                          </td>
                          <td className="px-4 py-2 font-mono" dir="ltr" style={{ textAlign: 'end', color: '#067647' }}>
                            {isIn ? fmt(row.quantity) : '—'}
                          </td>
                          <td className="px-4 py-2 font-mono" dir="ltr" style={{ textAlign: 'end', color: 'var(--sb-danger)' }}>
                            {isOut ? fmt(row.quantity) : '—'}
                          </td>
                          <td className="px-4 py-2 font-mono" dir="ltr" style={{ textAlign: 'end', color: 'var(--sb-text)', fontWeight: 700 }}>
                            {fmt(row.running_qty)}
                          </td>
                          <td className="px-4 py-2 font-mono" dir="ltr" style={{ textAlign: 'end', color: 'var(--sb-text-secondary)' }}>
                            {row.unit_cost != null ? fmt(row.unit_cost) : '—'}
                          </td>
                          <td className="px-4 py-2 font-mono" dir="ltr" style={{ textAlign: 'end', color: 'var(--sb-text)' }}>
                            {row.running_value != null ? fmt(row.running_value) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </OceanPage>
  );
}
