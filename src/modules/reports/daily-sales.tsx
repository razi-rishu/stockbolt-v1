import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportMessage, ReportTable, exportFromColumns, money as fmt, Num, type ReportColumn } from '@/components/ocean-report';

export default function DailySalesReportPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.daily-sales.period', 'this_month');

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['daily-sales-summary', company_id, from, to],
    enabled: !!company_id,
    queryFn: () =>
      getAdapter().pos.getDailySalesSummary(company_id!, { date_from: from, date_to: to }),
  });
  type Row = typeof rows[number];

  const totalCash    = rows.reduce((s, r) => s + r.cash_total,   0);
  const totalCard    = rows.reduce((s, r) => s + r.card_total,   0);
  const totalCredit  = rows.reduce((s, r) => s + r.credit_total, 0);
  const grandTotal   = rows.reduce((s, r) => s + r.grand_total,  0);
  const totalInv     = rows.reduce((s, r) => s + r.invoice_count, 0);

  // Totals row only when there is more than one day, as before.
  const multi = rows.length > 1;
  const columns: ReportColumn<Row>[] = [
    { key: 'date', header: t('common.date'), cls: 'strong', cell: r => <Num>{r.date}</Num>, exp: r => r.date },
    { key: 'cash', header: t('pos.payment_cash'), num: true, cls: 'muted', cell: r => fmt(r.cash_total), foot: multi ? fmt(totalCash) : undefined, exp: r => r.cash_total.toFixed(2) },
    { key: 'card', header: t('pos.payment_card'), num: true, cls: 'muted', cell: r => fmt(r.card_total), foot: multi ? fmt(totalCard) : undefined, exp: r => r.card_total.toFixed(2) },
    { key: 'credit', header: t('pos.payment_credit'), num: true, cls: 'muted', cell: r => fmt(r.credit_total), foot: multi ? fmt(totalCredit) : undefined, exp: r => r.credit_total.toFixed(2) },
    { key: 'inv', header: t('reports.invoices'), num: true, cls: 'muted', cell: r => r.invoice_count, foot: multi ? totalInv : undefined, exp: r => r.invoice_count },
    { key: 'total', header: t('reports.grand_total'), num: true, cls: 'strong', cell: r => fmt(r.grand_total), foot: multi ? fmt(grandTotal) : undefined, exp: r => r.grand_total.toFixed(2) },
  ];
  const xl = exportFromColumns(columns, rows);

  return (
    <OceanReport
      testid="daily-sales-ocean"
      title={t('reports.daily_sales_summary')}
      subtitle={t('reports.daily_sales_summary_desc')}
      controls={<>
        <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <ReportActions rows={xl.rows} headers={xl.headers} filename={`daily-sales-${from}_${to}`} disabled={rows.length === 0} />
      </>}
    >
      <ReportCard
        figures={rows.length > 0 ? [
          { label: t('pos.payment_cash'), value: <Num>{fmt(totalCash)}</Num> },
          { label: t('pos.payment_card'), value: <Num>{fmt(totalCard)}</Num> },
          { label: t('pos.payment_credit'), value: <Num>{fmt(totalCredit)}</Num> },
          { label: t('reports.total_invoices'), value: <Num>{totalInv}</Num> },
          { label: t('reports.grand_total'), value: <Num>{fmt(grandTotal)}</Num>, tone: 'brand' },
        ] : undefined}
      >
        {rows.length === 0
          ? <ReportMessage>{isFetching ? t('common.loading') : t('pos.no_sales')}</ReportMessage>
          : <ReportTable columns={columns} rows={rows} rowKey={r => r.date} footLabel={t('rptOcean.total')} minWidth={640} />}
      </ReportCard>
    </OceanReport>
  );
}
