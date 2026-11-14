import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportMessage, ReportTable, exportFromColumns, money as fmt, Num, ltr, type ReportColumn } from '@/components/ocean-report';

export default function PurchasesByProductPage() {
  const { t } = useTranslation();
  const company_id = useAuthStore(s => s.company_id);
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.purchases-by-product.period', 'this_month');

  const { data, isFetching } = useQuery({
    queryKey: ['purchases_by_product', company_id, from, to],
    queryFn: () => getAdapter().reports.getPurchasesByProduct(company_id!, from, to),
    enabled: !!company_id,
  });
  const rows = data ?? [];
  type Row = typeof rows[number];

  // Figures strip only — the table has no totals row, as before.
  const totCost = rows.reduce((s, r) => s + r.total_cost, 0);

  const columns: ReportColumn<Row>[] = [
    { key: 'sku', header: t('products.sku'), cell: r => <span className="code">{r.sku}</span>, exp: r => r.sku },
    { key: 'name', header: t('products.name'), cls: 'strong', cell: r => r.product_name, exp: r => r.product_name },
    { key: 'qty', header: t('reports.qty_purchased'), num: true, cls: 'muted', cell: r => r.qty_purchased, exp: r => r.qty_purchased },
    { key: 'cost', header: t('reports.total_cost'), num: true, cls: 'strong', cell: r => fmt(r.total_cost), exp: r => r.total_cost.toFixed(2) },
    { key: 'avg', header: t('reports.avg_unit_cost'), num: true, cls: 'muted', cell: r => fmt(r.avg_unit_cost), exp: r => r.avg_unit_cost.toFixed(2) },
  ];
  const xl = exportFromColumns(columns, rows);

  return (
    <OceanReport
      testid="purchases-by-product-ocean"
      title={t('reports.purchases_by_product')}
      subtitle={t('rptOcean.range', { from: ltr(from), to: ltr(to) })}
      controls={<>
        <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <ReportActions rows={xl.rows} headers={xl.headers} filename={`purchases-by-product-${from}_${to}`} disabled={rows.length === 0} />
      </>}
    >
      <ReportCard
        figures={rows.length > 0 ? [
          { label: t('rptOcean.fig_products'), value: <Num>{rows.length}</Num> },
          { label: t('reports.total_cost'), value: <Num>{fmt(totCost)}</Num>, tone: 'brand' },
        ] : undefined}
      >
        {rows.length === 0
          ? <ReportMessage>{isFetching ? t('common.loading') : t('reports.no_data')}</ReportMessage>
          : <ReportTable columns={columns} rows={rows} rowKey={r => r.product_id} minWidth={620} />}
      </ReportCard>
    </OceanReport>
  );
}
