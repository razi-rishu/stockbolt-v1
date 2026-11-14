import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportMessage, ReportTable, exportFromColumns, money as fmt, ltr, type ReportColumn } from '@/components/ocean-report';

export default function SalesByVehiclePage() {
  const { t } = useTranslation();
  const company_id = useAuthStore(s => s.company_id);
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.sales-by-vehicle.period', 'this_month');

  const { data, isFetching } = useQuery({
    queryKey: ['sales_by_vehicle', company_id, from, to],
    queryFn: () => getAdapter().reports.getSalesByVehicle(company_id!, from, to),
    enabled: !!company_id,
  });
  const rows = data ?? [];
  type Row = typeof rows[number];

  // No totals here: a part that fits several vehicles is counted under each
  // of them (see the note), so a column sum would overstate sales.
  const columns: ReportColumn<Row>[] = [
    { key: 'make', header: t('products.vehicle_make'), cls: 'strong', cell: r => r.make_name, exp: r => r.make_name },
    { key: 'model', header: t('products.vehicle_model'), cls: 'muted', cell: r => r.model_name ?? t('common.all'), exp: r => r.model_name ?? t('common.all') },
    { key: 'qty', header: t('reports.qty_sold'), num: true, cls: 'muted', cell: r => r.qty, exp: r => r.qty },
    { key: 'rev', header: t('reports.revenue'), num: true, cls: 'strong', cell: r => fmt(r.revenue), exp: r => r.revenue.toFixed(2) },
    { key: 'gp', header: t('reports.gross_profit'), num: true, cls: 'is-up strong', cell: r => fmt(r.gross_profit), exp: r => r.gross_profit.toFixed(2) },
  ];
  const xl = exportFromColumns(columns, rows);

  return (
    <OceanReport
      testid="sales-by-vehicle-ocean"
      title={t('reports.sales_by_vehicle')}
      subtitle={t('rptOcean.range', { from: ltr(from), to: ltr(to) })}
      controls={<>
        <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <ReportActions rows={xl.rows} headers={xl.headers} filename={`sales-by-vehicle-${from}_${to}`} disabled={rows.length === 0} />
      </>}
    >
      <ReportCard hint={t('reports.sales_by_vehicle_note')}>
        {rows.length === 0
          ? <ReportMessage>{isFetching ? t('common.loading') : t('reports.no_data')}</ReportMessage>
          : <ReportTable columns={columns} rows={rows} rowKey={(_, i) => String(i)} minWidth={560} />}
      </ReportCard>
    </OceanReport>
  );
}
