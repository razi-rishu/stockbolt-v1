import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportMessage, ReportTable, exportFromColumns, money as fmt, Num, ltr, type ReportColumn } from '@/components/ocean-report';

export default function SalesByCustomerPage() {
  const { t } = useTranslation();
  const company_id = useAuthStore(s => s.company_id);
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.sales-by-customer.period', 'this_month');

  const { data, isFetching } = useQuery({
    queryKey: ['sales_by_customer', company_id, from, to],
    queryFn: () => getAdapter().reports.getSalesByCustomer(company_id!, from, to),
    enabled: !!company_id,
  });
  const rows = data ?? [];
  type Row = typeof rows[number];

  const totNet = rows.reduce((s, r) => s + r.net_sales, 0);
  const totGP  = rows.reduce((s, r) => s + r.gross_profit, 0);
  const totPct = `${totNet > 0 ? (totGP / totNet * 100).toFixed(1) : 0}%`;

  const columns: ReportColumn<Row>[] = [
    { key: 'customer', header: t('contacts.customer'), cls: 'strong', cell: r => r.contact_name, exp: r => r.contact_name },
    { key: 'count', header: t('reports.invoice_count'), num: true, cls: 'muted', cell: r => r.invoice_count, exp: r => r.invoice_count },
    { key: 'gross', header: t('reports.gross_sales'), num: true, cls: 'muted', cell: r => fmt(r.gross_sales), exp: r => r.gross_sales.toFixed(2) },
    { key: 'returns', header: t('reports.returns'), num: true, cls: r => (r.returns > 0 ? 'is-down' : 'muted'), cell: r => (r.returns > 0 ? `(${fmt(r.returns)})` : '—'), exp: r => r.returns.toFixed(2) },
    { key: 'net', header: t('reports.net_sales'), num: true, cls: 'strong', cell: r => fmt(r.net_sales), foot: fmt(totNet), exp: r => r.net_sales.toFixed(2) },
    { key: 'gp', header: t('reports.gross_profit'), num: true, cls: 'is-up strong', cell: r => fmt(r.gross_profit), foot: fmt(totGP), exp: r => r.gross_profit.toFixed(2) },
    { key: 'pct', header: t('reports.gp_pct'), num: true, cls: 'muted', cell: r => `${r.gp_pct.toFixed(1)}%`, foot: totPct, exp: r => r.gp_pct.toFixed(1) },
  ];
  const xl = exportFromColumns(columns, rows);

  return (
    <OceanReport
      testid="sales-by-customer-ocean"
      title={t('reports.sales_by_customer')}
      subtitle={t('rptOcean.range', { from: ltr(from), to: ltr(to) })}
      controls={<>
        <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <ReportActions rows={xl.rows} headers={xl.headers} filename={`sales-by-customer-${from}_${to}`} disabled={rows.length === 0} />
      </>}
    >
      <ReportCard
        figures={rows.length > 0 ? [
          { label: t('rptOcean.fig_customers'), value: <Num>{rows.length}</Num> },
          { label: t('reports.net_sales'), value: <Num>{fmt(totNet)}</Num>, tone: 'brand' },
          { label: t('reports.gross_profit'), value: <Num>{fmt(totGP)}</Num>, tone: totGP < 0 ? 'bad' : 'good' },
          { label: t('reports.gp_pct'), value: <Num>{totPct}</Num> },
        ] : undefined}
      >
        {rows.length === 0
          ? <ReportMessage>{isFetching ? t('common.loading') : t('reports.no_data')}</ReportMessage>
          : <ReportTable columns={columns} rows={rows} rowKey={r => r.contact_id} footLabel={t('rptOcean.total')} minWidth={760} />}
      </ReportCard>
    </OceanReport>
  );
}
