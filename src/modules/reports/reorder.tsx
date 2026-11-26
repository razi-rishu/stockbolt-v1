import { fmtQty2 } from '@/lib/packs';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportMessage, ReportTable, exportFromColumns, money as fmt, Num, NameSku, type ReportColumn } from '@/components/ocean-report';

export default function ReorderReportPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['report_reorder', company_id],
    queryFn: () => getAdapter().reports.getReorderReport(company_id!),
    enabled: !!company_id,
  });
  type Row = typeof rows[number];

  const shortageOf = (r: Row) => Math.max(0, r.min_stock_level - r.qty_on_hand);
  const valueOf = (r: Row) => shortageOf(r) * (r.unit_cost ?? 0);
  // Figures strip only — the table has no totals row, as before.
  const totValue = rows.reduce((s, r) => s + valueOf(r), 0);

  const columns: ReportColumn<Row>[] = [
    { key: 'product', header: t('inventory.product'), cell: r => <NameSku name={r.product_name} sku={r.sku} />, exp: r => r.product_name },
    { key: 'wh', header: t('inventory.warehouse'), cls: 'muted', cell: r => r.warehouse_name, exp: r => r.warehouse_name },
    { key: 'qty', header: t('inventory.qty_on_hand'), num: true, cls: 'is-down strong', cell: r => fmtQty2(r.qty_on_hand), exp: r => r.qty_on_hand },
    { key: 'min', header: t('reports.min_stock_level'), num: true, cls: 'muted', cell: r => fmt(r.min_stock_level), exp: r => r.min_stock_level },
    { key: 'short', header: t('reports.shortage'), num: true, cls: 'is-warn strong', cell: r => fmt(shortageOf(r)), exp: r => shortageOf(r) },
    { key: 'cost', header: t('inventory.unit_cost'), num: true, cls: 'muted', cell: r => (r.unit_cost != null ? fmt(r.unit_cost) : '—'), exp: r => (r.unit_cost != null ? r.unit_cost.toFixed(2) : '') },
    { key: 'value', header: t('reports.reorder_value'), num: true, cls: 'strong', cell: r => fmt(valueOf(r)), exp: r => valueOf(r).toFixed(2) },
  ];
  // SKU is shown beside the name on screen but keeps its own Excel column.
  const xl = exportFromColumns<Row>([
    columns[0],
    { key: 'sku', header: t('products.sku'), cell: r => r.sku ?? '', exp: r => r.sku ?? '' },
    ...columns.slice(1),
  ], rows);

  return (
    <OceanReport
      testid="reorder-ocean"
      title={t('reports.reorder')}
      subtitle={t('reports.reorder_desc')}
      controls={<ReportActions rows={xl.rows} headers={xl.headers} filename="reorder-report" disabled={rows.length === 0} />}
    >
      <ReportCard
        figures={rows.length > 0 ? [
          { label: t('rptOcean.fig_items'), value: <Num>{rows.length}</Num>, tone: 'warn' },
          { label: t('reports.reorder_value'), value: <Num>{fmt(totValue)}</Num>, tone: 'brand' },
        ] : undefined}
      >
        {isLoading
          ? <ReportMessage>{t('common.loading')}</ReportMessage>
          : rows.length === 0
            ? <ReportMessage>{t('reports.no_reorder_needed')}</ReportMessage>
            : <ReportTable columns={columns} rows={rows} rowKey={(_, i) => String(i)} minWidth={820} />}
      </ReportCard>
    </OceanReport>
  );
}
