import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { DocLink } from '@/ui/doc-link';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportMessage, ReportTable, exportFromColumns, money as fmt, Num, ltr, type ReportColumn } from '@/components/ocean-report';

export default function APAgingPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.ap-aging.period', 'this_month');
  const asOf = to;

  const { data, isFetching } = useQuery({
    queryKey: ['ap_aging', company_id, asOf],
    queryFn: () => getAdapter().reports.getAPAgingReport(company_id!, asOf),
    enabled: !!company_id,
  });
  const buckets = data?.buckets ?? [];
  type Row = typeof buckets[number];
  const dash = (n: number) => (n > 0 ? fmt(n) : '—');

  const columns: ReportColumn<Row>[] = [
    { key: 'supplier', header: t('reports.supplier'), cell: b => <DocLink type="supplier" id={b.contact_id} label={b.contact_name} />, exp: b => b.contact_name },
    { key: 'current', header: t('reports.current'), num: true, cell: b => dash(b.current), foot: data ? fmt(data.total_current) : '', exp: b => b.current.toFixed(2) },
    { key: 'd31', header: '31–60', headerLtr: true, num: true, cls: b => (b.days_31_60 > 0 ? 'is-warn' : 'muted'), cell: b => dash(b.days_31_60), foot: data ? fmt(data.total_31_60) : '', exp: b => b.days_31_60.toFixed(2) },
    { key: 'd61', header: '61–90', headerLtr: true, num: true, cls: b => (b.days_61_90 > 0 ? 'is-warn strong' : 'muted'), cell: b => dash(b.days_61_90), foot: data ? fmt(data.total_61_90) : '', exp: b => b.days_61_90.toFixed(2) },
    { key: 'd90', header: t('reports.over_90'), num: true, cls: b => (b.over_90 > 0 ? 'is-down strong' : 'muted'), cell: b => dash(b.over_90), foot: data ? fmt(data.total_over_90) : '', exp: b => b.over_90.toFixed(2) },
    { key: 'total', header: t('reports.total'), num: true, cls: 'strong', cell: b => fmt(b.total), foot: data ? fmt(data.grand_total) : '', exp: b => b.total.toFixed(2) },
  ];
  const xl = exportFromColumns(columns, buckets);

  return (
    <OceanReport
      testid="ap-aging-ocean"
      title={t('reports.ap_aging')}
      subtitle={t('rptOcean.as_of_date', { date: ltr(asOf) })}
      controls={<>
        <PeriodPicker mode="asOf" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <ReportActions rows={xl.rows} headers={xl.headers} filename={`ap-aging-${asOf}`} disabled={!data} />
      </>}
    >
      {isFetching && !data && <ReportCard><ReportMessage>{t('common.loading')}</ReportMessage></ReportCard>}
      {data && (
        <ReportCard
          figures={[
            { label: t('reports.current'), value: <Num>{fmt(data.total_current)}</Num> },
            { label: t('rptOcean.ar_31_90'), value: <Num>{fmt(data.total_31_60 + data.total_61_90)}</Num>, tone: data.total_31_60 + data.total_61_90 > 0 ? 'warn' : undefined },
            { label: t('rptOcean.ar_over_90'), value: <Num>{fmt(data.total_over_90)}</Num>, tone: data.total_over_90 > 0 ? 'bad' : undefined },
            { label: t('rptOcean.ap_total_payable'), value: <Num>{fmt(data.grand_total)}</Num>, tone: 'brand' },
          ]}
        >
          {buckets.length === 0
            ? <ReportMessage>{t('rptOcean.ap_none')}</ReportMessage>
            : <ReportTable columns={columns} rows={buckets} rowKey={b => b.contact_id} footLabel={t('reports.total')} minWidth={720} />}
        </ReportCard>
      )}
    </OceanReport>
  );
}
