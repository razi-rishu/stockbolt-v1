import { fmtQty2 } from '@/lib/packs';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportMessage, ReportTable, exportFromColumns, money as fmt, Num, NameSku, type ReportColumn } from '@/components/ocean-report';
import { BucketPill, useBucketLabel } from './_shared/aging-bucket';

export default function SlowMovingReportPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const [thresholdDays, setThresholdDays] = useState('60');
  const bucketLabel = useBucketLabel();

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['report_slow_moving', company_id, thresholdDays],
    queryFn: () => getAdapter().reports.getSlowMoving(company_id!, {
      threshold_days: parseInt(thresholdDays) || 60,
    }),
    enabled: !!company_id,
  });
  type Row = typeof rows[number];

  // Figures strip only — the table has no totals row, as before.
  const totValue = rows.reduce((s, r) => s + (r.stock_value ?? 0), 0);

  const columns: ReportColumn<Row>[] = [
    { key: 'product', header: t('inventory.product'), cell: r => <NameSku name={r.product_name} sku={r.sku} />, exp: r => r.product_name },
    { key: 'wh', header: t('inventory.warehouse'), cls: 'muted', cell: r => r.warehouse_name, exp: r => r.warehouse_name },
    { key: 'qty', header: t('inventory.qty_on_hand'), num: true, cell: r => fmtQty2(r.qty_on_hand), exp: r => r.qty_on_hand },
    { key: 'cost', header: t('inventory.unit_cost'), num: true, cls: 'muted', cell: r => (r.unit_cost != null ? fmt(r.unit_cost) : '—'), exp: r => (r.unit_cost != null ? r.unit_cost.toFixed(2) : '') },
    { key: 'value', header: t('inventory.stock_value'), num: true, cls: 'strong', cell: r => (r.stock_value != null ? fmt(r.stock_value) : '—'), exp: r => (r.stock_value != null ? r.stock_value.toFixed(2) : '') },
    { key: 'last', header: t('reports.last_movement'), cls: 'muted', cell: r => (r.last_movement_date ? <Num>{r.last_movement_date as string}</Num> : t('inventory.never')), exp: r => (r.last_movement_date ? (r.last_movement_date as string) : '') },
    { key: 'idle', header: t('reports.days_idle'), num: true, cls: 'is-warn strong', cell: r => r.days_idle, exp: r => r.days_idle },
    { key: 'bucket', header: t('reports.aging_bucket'), cell: r => <BucketPill bucket={r.aging_bucket} />, exp: r => bucketLabel(r.aging_bucket) },
  ];
  // SKU is shown beside the name on screen but keeps its own Excel column.
  const xl = exportFromColumns<Row>([
    columns[0],
    { key: 'sku', header: t('products.sku'), cell: r => r.sku ?? '', exp: r => r.sku ?? '' },
    ...columns.slice(1),
  ], rows);

  return (
    <OceanReport
      testid="slow-moving-ocean"
      title={t('reports.slow_moving')}
      controls={<>
        <label className="sb-rpt-field">
          {t('reports.threshold_days')}
          <input type="number" value={thresholdDays} onChange={e => setThresholdDays(e.target.value)} />
        </label>
        <ReportActions rows={xl.rows} headers={xl.headers} filename={`slow-moving-${thresholdDays}d`} disabled={rows.length === 0} />
      </>}
    >
      <ReportCard
        figures={rows.length > 0 ? [
          { label: t('rptOcean.fig_items'), value: <Num>{rows.length}</Num> },
          { label: t('inventory.stock_value'), value: <Num>{fmt(totValue)}</Num>, tone: 'warn' },
        ] : undefined}
      >
        {rows.length === 0
          ? <ReportMessage>{isFetching ? t('common.loading') : t('reports.no_slow_moving')}</ReportMessage>
          : <ReportTable columns={columns} rows={rows} rowKey={(_, i) => String(i)} minWidth={940} />}
      </ReportCard>
    </OceanReport>
  );
}
