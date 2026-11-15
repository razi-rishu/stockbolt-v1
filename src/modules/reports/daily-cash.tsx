import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportMessage, ReportTable, exportFromColumns, money as fmt, Num, type ReportColumn } from '@/components/ocean-report';
import type { DailyCashLine } from '@/data/adapter';

export default function DailyCashPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.daily-cash.period', 'today');
  const reportDate = to;

  const { data: lines = [], isFetching } = useQuery<DailyCashLine[]>({
    queryKey: ['report_daily_cash', company_id, reportDate],
    queryFn:  () => getAdapter().reports.dailyCash(company_id!, reportDate),
    enabled:  !!company_id,
  });

  const totalIn  = lines.reduce((s, l) => s + l.total_in, 0);
  const totalOut = lines.reduce((s, l) => s + l.total_out, 0);
  const netFlow  = totalIn - totalOut;
  const neg = (n: number) => (n < 0 ? `(${fmt(-n)})` : fmt(n));

  const columns: ReportColumn<DailyCashLine>[] = [
    { key: 'code', header: t('reports.account_code'), cell: l => <span className="code">{l.account_code}</span>, exp: l => l.account_code },
    { key: 'name', header: t('reports.account_name'), cls: 'strong', cell: l => l.account_name, exp: l => l.account_name },
    { key: 'open', header: t('reports.opening_balance'), num: true, cls: 'muted', cell: l => neg(l.opening_balance), exp: l => l.opening_balance.toFixed(2) },
    { key: 'in', header: t('reports.total_in'), num: true, cls: 'is-up', cell: l => fmt(l.total_in), foot: fmt(totalIn), exp: l => l.total_in.toFixed(2) },
    { key: 'out', header: t('reports.total_out'), num: true, cls: 'is-down', cell: l => fmt(l.total_out), foot: fmt(totalOut), exp: l => l.total_out.toFixed(2) },
    // The totals row shows the day's net flow under Closing, as before.
    { key: 'close', header: t('reports.closing_balance'), num: true, cls: l => (l.closing_balance < 0 ? 'is-down strong' : 'strong'), cell: l => neg(l.closing_balance), foot: neg(netFlow), exp: l => l.closing_balance.toFixed(2) },
  ];
  const xl = exportFromColumns(columns, lines);

  return (
    <OceanReport
      testid="daily-cash-ocean"
      title={t('reports.daily_cash_title')}
      subtitle={t('reports.daily_cash_desc')}
      controls={<>
        <PeriodPicker mode="asOf" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <ReportActions rows={xl.rows} headers={xl.headers} filename={`daily-cash-${reportDate}`} disabled={lines.length === 0} />
      </>}
    >
      <ReportCard
        figures={[
          { label: t('reports.total_in'), value: <Num>{fmt(totalIn)}</Num>, tone: 'good' },
          { label: t('reports.total_out'), value: <Num>{fmt(totalOut)}</Num>, tone: 'bad' },
          { label: t('reports.net_flow'), value: <Num>{neg(netFlow)}</Num>, tone: netFlow >= 0 ? 'brand' : 'bad' },
        ]}
      >
        {lines.length === 0
          ? <ReportMessage>{isFetching ? t('common.loading') : t('reports.no_data')}</ReportMessage>
          : <ReportTable columns={columns} rows={lines} rowKey={l => l.account_id} footLabel={t('rptOcean.total')} minWidth={720} />}
      </ReportCard>
    </OceanReport>
  );
}
