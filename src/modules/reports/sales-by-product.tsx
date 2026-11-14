import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportMessage, ReportTable, exportFromColumns, money as fmt, Num, ltr, type ReportColumn } from '@/components/ocean-report';

export default function SalesByProductPage() {
  const { t } = useTranslation();
  const company_id = useAuthStore(s => s.company_id);
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.sales-by-product.period', 'this_month');

  const { data, isFetching } = useQuery({
    queryKey: ['sales_by_product', company_id, from, to],
    queryFn: () => getAdapter().reports.getSalesByProduct(company_id!, from, to),
    enabled: !!company_id,
  });
  const rows = data ?? [];
  type Row = typeof rows[number];

  // Figures strip only — the table itself has no totals row, as before.
  const totNet = rows.reduce((s, r) => s + r.net_sales, 0);
  const totGP  = rows.reduce((s, r) => s + r.gross_profit, 0);

  const columns: ReportColumn<Row>[] = [
    { key: 'sku', header: t('products.sku'), cell: r => <span className="code">{r.sku}</span>, exp: r => r.sku },
    { key: 'name', header: t('products.name'), cls: 'strong', cell: r => r.product_name, exp: r => r.product_name },
    { key: 'brand', header: t('products.brand'), cls: 'muted', hideSm: true, cell: r => r.brand_name || '—', exp: r => r.brand_name || '' },
    { key: 'qty', header: t('reports.qty_sold'), num: true, cls: 'muted', cell: r => r.qty_sold, exp: r => r.qty_sold },
    { key: 'net', header: t('reports.net_sales'), num: true, cls: 'strong', cell: r => fmt(r.net_sales), exp: r => r.net_sales.toFixed(2) },
    { key: 'gp', header: t('reports.gross_profit'), num: true, cls: 'is-up strong', cell: r => fmt(r.gross_profit), exp: r => r.gross_profit.toFixed(2) },
    { key: 'pct', header: t('reports.gp_pct'), num: true, cls: 'muted', cell: r => `${r.gp_pct.toFixed(1)}%`, exp: r => r.gp_pct.toFixed(1) },
  ];
  const xl = exportFromColumns(columns, rows);

  return (
    <OceanReport
      testid="sales-by-product-ocean"
      title={t('reports.sales_by_product')}
      subtitle={t('rptOcean.range', { from: ltr(from), to: ltr(to) })}
      controls={<>
        <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <ReportActions rows={xl.rows} headers={xl.headers} filename={`sales-by-product-${from}_${to}`} disabled={rows.length === 0} />
      </>}
    >
      <ReportCard
        figures={rows.length > 0 ? [
          { label: t('rptOcean.fig_products'), value: <Num>{rows.length}</Num> },
          { label: t('reports.net_sales'), value: <Num>{fmt(totNet)}</Num>, tone: 'brand' },
          { label: t('reports.gross_profit'), value: <Num>{fmt(totGP)}</Num>, tone: totGP < 0 ? 'bad' : 'good' },
        ] : undefined}
      >
        {rows.length === 0
          ? <ReportMessage>{isFetching ? t('common.loading') : t('reports.no_data')}</ReportMessage>
          : <ReportTable columns={columns} rows={rows} rowKey={r => r.product_id} minWidth={720} />}
      </ReportCard>
    </OceanReport>
  );
}
