import { fmtQty2 } from '@/lib/packs';
import { stockMovementKey } from '@/lib/stock-movement';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportMessage, ReportTable, exportFromColumns, money as fmt, Num, NameSku, ltr, type ReportColumn } from '@/components/ocean-report';
import type { ProductRow, WarehouseRow } from '@/data/adapter';

export default function StockMovementReportPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.stock-movement.period', 'this_month');

  const [productId, setProductId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');

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
    queryKey: ['report_stock_movement', company_id, productId, warehouseId, from, to],
    queryFn: () => getAdapter().reports.getStockMovement(company_id!, {
      product_id: productId || undefined,
      warehouse_id: warehouseId || undefined,
      date_from: from,
      date_to: to,
    }),
    enabled: !!company_id,
  });
  type Row = typeof rows[number];

  const totalIn  = rows.filter(r => r.direction === 1).reduce((s, r) => s + r.quantity, 0);
  const totalOut = rows.filter(r => r.direction === -1).reduce((s, r) => s + r.quantity, 0);
  const typeLabel = (type: string) => t(stockMovementKey(type), { defaultValue: type });

  const columns: ReportColumn<Row>[] = [
    { key: 'date', header: t('inventory.date'), cls: 'muted', cell: r => <Num>{r.date as string}</Num>, exp: r => r.date as string },
    { key: 'product', header: t('inventory.product'), cell: r => <NameSku name={r.product_name} sku={r.sku} />, exp: r => r.product_name },
    { key: 'wh', header: t('inventory.warehouse'), cls: 'muted', cell: r => r.warehouse_name, exp: r => r.warehouse_name },
    { key: 'type', header: t('inventory.type'), cls: 'muted', cell: r => typeLabel(r.movement_type), exp: r => typeLabel(r.movement_type) },
    { key: 'in', header: t('inventory.qty_in'), num: true, cls: r => (r.direction === 1 ? 'is-up' : 'muted'), cell: r => (r.direction === 1 ? fmtQty2(r.quantity) : '—'), exp: r => (r.direction === 1 ? r.quantity : 0) },
    { key: 'out', header: t('inventory.qty_out'), num: true, cls: r => (r.direction === -1 ? 'is-down' : 'muted'), cell: r => (r.direction === -1 ? fmtQty2(r.quantity) : '—'), exp: r => (r.direction === -1 ? r.quantity : 0) },
    { key: 'run', header: t('inventory.running_qty'), num: true, cls: 'strong', cell: r => fmtQty2(r.running_qty), exp: r => r.running_qty },
    { key: 'cost', header: t('inventory.unit_cost'), num: true, cls: 'muted', cell: r => (r.unit_cost != null ? fmt(r.unit_cost) : '—'), exp: r => (r.unit_cost != null ? r.unit_cost.toFixed(2) : '') },
  ];
  // SKU is shown beside the name on screen but keeps its own Excel column.
  const xl = exportFromColumns<Row>([
    ...columns.slice(0, 2),
    { key: 'sku', header: t('products.sku'), cell: r => r.sku ?? '', exp: r => r.sku ?? '' },
    ...columns.slice(2),
  ], rows);

  return (
    <OceanReport
      testid="stock-movement-ocean"
      title={t('reports.stock_movement')}
      subtitle={t('rptOcean.range', { from: ltr(from), to: ltr(to) })}
      controls={<>
        <select value={productId} onChange={e => setProductId(e.target.value)} className="sb-rpt-select sb-rpt-select-wide" aria-label={t('inventory.product')}>
          <option value="">{t('inventory.all_products')}</option>
          {products.map(p => <option key={p.id} value={p.id}>{`${p.sku} — ${p.name}`}</option>)}
        </select>
        <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className="sb-rpt-select sb-rpt-select-wide" aria-label={t('inventory.warehouse')}>
          <option value="">{t('inventory.all_warehouses')}</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <ReportActions rows={xl.rows} headers={xl.headers} filename={`stock-movement-${from}_${to}`} disabled={rows.length === 0} />
      </>}
    >
      <ReportCard
        figures={rows.length > 0 ? [
          { label: t('rptOcean.fig_movements'), value: <Num>{rows.length}</Num> },
          { label: t('inventory.total_in'), value: <Num>{fmtQty2(totalIn)}</Num>, tone: 'good' },
          { label: t('inventory.total_out'), value: <Num>{fmtQty2(totalOut)}</Num>, tone: 'bad' },
        ] : undefined}
      >
        {rows.length === 0
          ? <ReportMessage>{isFetching ? t('common.loading') : t('inventory.no_movements')}</ReportMessage>
          : <ReportTable columns={columns} rows={rows} rowKey={(_, i) => String(i)} minWidth={940} />}
      </ReportCard>
    </OceanReport>
  );
}
