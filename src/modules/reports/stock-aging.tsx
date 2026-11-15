import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportMessage, ReportTable, exportFromColumns, money as fmt, Num, NameSku, type ReportColumn, type ReportTone } from '@/components/ocean-report';
import { AGING_BUCKETS, BucketPill, useBucketLabel } from './_shared/aging-bucket';

const TILE_TONE: Record<string, ReportTone | undefined> = { '0_30': 'good', '31_60': undefined, '61_90': 'warn', over_90: 'bad' };

export default function StockAgingReportPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const bucketLabel = useBucketLabel();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['report_stock_aging', company_id],
    queryFn: () => getAdapter().reports.getStockAging(company_id!),
    enabled: !!company_id,
  });
  type Row = typeof rows[number];

  // Group by bucket for summary
  const summary = rows.reduce((acc, row) => {
    const b = row.aging_bucket;
    acc[b] = (acc[b] ?? 0) + (row.stock_value ?? 0);
    return acc;
  }, {} as Record<string, number>);

  const columns: ReportColumn<Row>[] = [
    { key: 'product', header: t('inventory.product'), cell: r => <NameSku name={r.product_name} sku={r.sku} />, exp: r => r.product_name },
    { key: 'wh', header: t('inventory.warehouse'), cls: 'muted', cell: r => r.warehouse_name, exp: r => r.warehouse_name },
    { key: 'qty', header: t('inventory.qty_on_hand'), num: true, cell: r => fmt(r.qty_on_hand), exp: r => r.qty_on_hand },
    { key: 'cost', header: t('inventory.unit_cost'), num: true, cls: 'muted', cell: r => (r.unit_cost != null ? fmt(r.unit_cost) : '—'), exp: r => (r.unit_cost != null ? r.unit_cost.toFixed(2) : '') },
    { key: 'value', header: t('inventory.stock_value'), num: true, cls: 'strong', cell: r => (r.stock_value != null ? fmt(r.stock_value) : '—'), exp: r => (r.stock_value != null ? r.stock_value.toFixed(2) : '') },
    { key: 'last', header: t('reports.last_movement'), cls: 'muted', cell: r => <Num>{r.last_movement_date ? (r.last_movement_date as string) : '—'}</Num>, exp: r => (r.last_movement_date ? (r.last_movement_date as string) : '') },
    { key: 'idle', header: t('reports.days_idle'), num: true, cell: r => r.days_idle, exp: r => r.days_idle },
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
      testid="stock-aging-ocean"
      title={t('reports.stock_aging')}
      controls={<ReportActions rows={xl.rows} headers={xl.headers} filename="stock-aging" disabled={rows.length === 0} />}
    >
      <ReportCard
        figures={rows.length > 0 ? AGING_BUCKETS.map(b => ({
          label: bucketLabel(b),
          value: <Num>{fmt(summary[b] ?? 0)}</Num>,
          tone: (summary[b] ?? 0) > 0 ? TILE_TONE[b] : undefined,
        })) : undefined}
      >
        {isLoading
          ? <ReportMessage>{t('common.loading')}</ReportMessage>
          : rows.length === 0
            ? <ReportMessage>{t('reports.no_stock_aging')}</ReportMessage>
            : <ReportTable columns={columns} rows={rows} rowKey={(_, i) => String(i)} minWidth={940} />}
      </ReportCard>
    </OceanReport>
  );
}
