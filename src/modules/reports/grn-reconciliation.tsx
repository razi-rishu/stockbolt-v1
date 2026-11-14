import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportMessage, ReportTable, exportFromColumns, money as fmt, Num, ltr, type ReportColumn } from '@/components/ocean-report';

export default function GRNReconciliationPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.grn-reconciliation.period', 'this_month');
  const asOf = to;

  const { data, isFetching } = useQuery({
    queryKey: ['grn_reconciliation', company_id, asOf],
    queryFn: () => getAdapter().reports.getGRNReconciliation(company_id!, asOf),
    enabled: !!company_id,
  });
  const lines = data?.lines ?? [];
  type Row = typeof lines[number];

  const columns: ReportColumn<Row>[] = [
    { key: 'grn', header: t('purchasing.grn_number'), cell: l => <span className="code">{l.grn_number}</span>, exp: l => l.grn_number },
    { key: 'supplier', header: t('purchasing.supplier'), cell: l => l.supplier_name, exp: l => l.supplier_name },
    { key: 'date', header: t('purchasing.date'), cls: 'muted', cell: l => <Num>{l.date}</Num>, exp: l => l.date },
    { key: 'cost', header: t('reports.total_cost'), num: true, cell: l => fmt(l.total_cost), exp: l => l.total_cost.toFixed(2) },
    { key: 'billed', header: t('reports.billed'), num: true, cls: 'is-up', cell: l => fmt(l.billed_amount), exp: l => l.billed_amount.toFixed(2) },
    { key: 'unbilled', header: t('reports.unbilled'), num: true, cls: l => (l.unbilled_amount > 0 ? 'is-warn strong' : 'muted'), cell: l => fmt(l.unbilled_amount), exp: l => l.unbilled_amount.toFixed(2) },
  ];
  const xl = exportFromColumns(columns, lines);

  return (
    <OceanReport
      testid="grn-reconciliation-ocean"
      title={t('reports.grn_reconciliation')}
      subtitle={t('rptOcean.as_of_date', { date: ltr(asOf) })}
      controls={<>
        <PeriodPicker mode="asOf" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <ReportActions rows={xl.rows} headers={xl.headers} filename={`grn-reconciliation-${asOf}`} disabled={!data} />
      </>}
    >
      {isFetching && !data && <ReportCard><ReportMessage>{t('common.loading')}</ReportMessage></ReportCard>}
      {data && (
        <ReportCard
          figures={[
            { label: t('reports.total_accrual'), value: <Num>{fmt(data.total_accrual)}</Num> },
            { label: t('reports.total_billed'), value: <Num>{fmt(data.total_billed)}</Num>, tone: 'good' },
            { label: t('reports.total_unbilled'), value: <Num>{fmt(data.total_unbilled)}</Num>, tone: data.total_unbilled > 0 ? 'warn' : undefined },
          ]}
          hint={t('reports.grn_reconciliation_desc')}
        >
          {lines.length === 0
            ? <ReportMessage>{t('reports.no_data')}</ReportMessage>
            : <ReportTable columns={columns} rows={lines} rowKey={l => l.grn_id} minWidth={720} />}
        </ReportCard>
      )}
    </OceanReport>
  );
}
