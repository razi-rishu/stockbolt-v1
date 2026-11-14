import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportMessage, ReportTable, exportFromColumns, money as fmt, Num, ltr, type ReportColumn } from '@/components/ocean-report';

export default function SalesByBrandPage() {
  const { t } = useTranslation();
  const company_id = useAuthStore(s => s.company_id);
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.sales-by-brand.period', 'this_month');

  const { data, isFetching } = useQuery({
    queryKey: ['sales_by_brand', company_id, from, to],
    queryFn: () => getAdapter().reports.getSalesByBrand(company_id!, from, to),
    enabled: !!company_id,
  });
  const rows = data ?? [];
  type Row = typeof rows[number];

  const totRev = rows.reduce((s, r) => s + r.revenue, 0);
  const totGP  = rows.reduce((s, r) => s + r.gross_profit, 0);
  const totPct = `${totRev > 0 ? (totGP / totRev * 100).toFixed(1) : 0}%`;

  const columns: ReportColumn<Row>[] = [
    { key: 'brand', header: t('products.brand'), cls: 'strong', cell: r => r.brand_name, exp: r => r.brand_name },
    { key: 'qty', header: t('reports.qty_sold'), num: true, cls: 'muted', cell: r => r.qty_sold, exp: r => r.qty_sold },
    { key: 'rev', header: t('reports.revenue'), num: true, cls: 'strong', cell: r => fmt(r.revenue), foot: fmt(totRev), exp: r => r.revenue.toFixed(2) },
    { key: 'gp', header: t('reports.gross_profit'), num: true, cls: 'is-up strong', cell: r => fmt(r.gross_profit), foot: fmt(totGP), exp: r => r.gross_profit.toFixed(2) },
    { key: 'pct', header: t('reports.gp_pct'), num: true, cls: 'muted', cell: r => `${r.gp_pct.toFixed(1)}%`, foot: totPct, exp: r => r.gp_pct.toFixed(1) },
  ];
  const xl = exportFromColumns(columns, rows);

  return (
    <OceanReport
      testid="sales-by-brand-ocean"
      title={t('reports.sales_by_brand')}
      subtitle={t('rptOcean.range', { from: ltr(from), to: ltr(to) })}
      controls={<>
        <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <ReportActions rows={xl.rows} headers={xl.headers} filename={`sales-by-brand-${from}_${to}`} disabled={rows.length === 0} />
      </>}
    >
      <ReportCard
        figures={rows.length > 0 ? [
          { label: t('rptOcean.fig_brands'), value: <Num>{rows.length}</Num> },
          { label: t('reports.revenue'), value: <Num>{fmt(totRev)}</Num>, tone: 'brand' },
          { label: t('reports.gross_profit'), value: <Num>{fmt(totGP)}</Num>, tone: totGP < 0 ? 'bad' : 'good' },
          { label: t('reports.gp_pct'), value: <Num>{totPct}</Num> },
        ] : undefined}
      >
        {rows.length === 0
          ? <ReportMessage>{isFetching ? t('common.loading') : t('reports.no_data')}</ReportMessage>
          : <ReportTable columns={columns} rows={rows} rowKey={r => r.brand_id} footLabel={t('rptOcean.total')} minWidth={560} />}
      </ReportCard>
    </OceanReport>
  );
}
