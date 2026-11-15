import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { DocLink } from '@/ui/doc-link';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportMessage, ReportTable, exportFromColumns, money as fmt, Num, ltr, type ReportColumn } from '@/components/ocean-report';

export default function StockValuationPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.stock-valuation.period', 'this_month');
  const asOf = to;

  const { data: sv, isFetching, error } = useQuery({
    queryKey: ['stock_valuation', company_id, asOf],
    queryFn: () => getAdapter().reports.getStockValuation(company_id!, asOf),
    enabled: !!company_id,
  });
  const lines = sv?.lines ?? [];
  type Row = typeof lines[number];

  const columns: ReportColumn<Row>[] = [
    { key: 'code', header: t('products.code'), cell: l => <span className="code">{l.product_code}</span>, exp: l => l.product_code },
    { key: 'name', header: t('products.name'), cell: l => <DocLink type="product" id={l.product_id} label={l.product_name} />, exp: l => l.product_name },
    { key: 'wh', header: t('reports.warehouse'), cls: 'muted', cell: l => l.warehouse_name, exp: l => l.warehouse_name },
    { key: 'qty', header: t('reports.qty'), num: true, cell: l => l.quantity.toLocaleString('en-US'), exp: l => l.quantity },
    { key: 'cost', header: t('reports.unit_cost'), num: true, cls: 'muted', cell: l => fmt(l.unit_cost), exp: l => l.unit_cost.toFixed(2) },
    { key: 'value', header: t('reports.total_value'), num: true, cls: 'strong', cell: l => fmt(l.total_value), foot: sv ? fmt(sv.total_value) : '', exp: l => l.total_value.toFixed(2) },
  ];
  const xl = exportFromColumns(columns, lines);

  return (
    <OceanReport
      testid="stock-valuation-ocean"
      title={t('reports.stock_valuation_title')}
      subtitle={t('rptOcean.as_of_date', { date: ltr(asOf) })}
      controls={<>
        <PeriodPicker mode="asOf" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <ReportActions rows={xl.rows} headers={xl.headers} filename={`stock-valuation-${asOf}`} disabled={!sv || lines.length === 0} />
      </>}
    >
      {isFetching && !sv && <ReportCard><ReportMessage>{t('common.loading')}</ReportMessage></ReportCard>}
      {error && <ReportCard><ReportMessage tone="bad">{String(error)}</ReportMessage></ReportCard>}
      {sv && lines.length === 0 && <ReportCard><ReportMessage>{t('reports.no_stock')}</ReportMessage></ReportCard>}

      {sv && lines.length > 0 && (
        <ReportCard
          figures={[
            { label: t('rptOcean.fig_items'), value: <Num>{lines.length}</Num> },
            { label: t('reports.total_stock_value'), value: <Num>{fmt(sv.total_value)}</Num>, tone: 'brand' },
          ]}
        >
          <ReportTable columns={columns} rows={lines} rowKey={(_, i) => String(i)} footLabel={t('reports.total_stock_value')} minWidth={720} />
        </ReportCard>
      )}
    </OceanReport>
  );
}
