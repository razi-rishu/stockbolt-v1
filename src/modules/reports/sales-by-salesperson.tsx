import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportMessage, ReportTable, exportFromColumns, money as fmt, Num, ltr, type ReportColumn } from '@/components/ocean-report';

export default function SalesBySalespersonPage() {
  const { t } = useTranslation();
  const company_id = useAuthStore(s => s.company_id);
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.sales-by-salesperson.period', 'this_month');

  const { data, isFetching } = useQuery({
    queryKey: ['sales_by_salesperson', company_id, from, to],
    queryFn: () => getAdapter().reports.getSalesBySalesperson(company_id!, from, to),
    enabled: !!company_id,
  });
  const rows = data ?? [];
  type Row = typeof rows[number];

  const totCount = rows.reduce((s, r) => s + r.invoice_count, 0);
  const totRet   = rows.reduce((s, r) => s + r.returns_total, 0);
  const totNet   = rows.reduce((s, r) => s + r.net_sales, 0);
  const totGP    = rows.reduce((s, r) => s + r.gross_profit, 0);
  const totComm  = rows.reduce((s, r) => s + r.commission, 0);

  const columns: ReportColumn<Row>[] = [
    { key: 'name', header: t('reports.salesperson'), cls: 'strong', cell: r => r.salesperson_name, exp: r => r.salesperson_name },
    { key: 'count', header: t('reports.invoice_count'), num: true, cls: 'muted', cell: r => r.invoice_count, foot: totCount, exp: r => r.invoice_count },
    { key: 'returns', header: t('reports.returns'), num: true, cls: r => (r.returns_total > 0 ? 'is-down' : 'muted'), cell: r => (r.returns_total > 0 ? `(${fmt(r.returns_total)})` : '—'), foot: fmt(totRet), exp: r => r.returns_total.toFixed(2) },
    { key: 'net', header: t('reports.net_sales'), num: true, cls: 'strong', cell: r => fmt(r.net_sales), foot: fmt(totNet), exp: r => r.net_sales.toFixed(2) },
    { key: 'gp', header: t('reports.gross_profit'), num: true, cls: 'is-up strong', cell: r => fmt(r.gross_profit), foot: fmt(totGP), exp: r => r.gross_profit.toFixed(2) },
    { key: 'pct', header: t('reports.gp_pct'), num: true, cls: 'muted', cell: r => `${r.gp_pct.toFixed(1)}%`, exp: r => r.gp_pct.toFixed(1) },
    { key: 'avg', header: t('reports.avg_invoice'), num: true, cls: 'muted', cell: r => fmt(r.avg_invoice_value), exp: r => r.avg_invoice_value.toFixed(2) },
    { key: 'cpct', header: t('reports.commission_pct'), num: true, cls: 'muted', cell: r => (r.commission_pct != null ? `${r.commission_pct.toFixed(1)}%` : '—'), exp: r => (r.commission_pct != null ? r.commission_pct.toFixed(1) : '') },
    { key: 'comm', header: t('reports.commission'), num: true, cls: 'strong', cell: r => (r.commission_pct != null ? fmt(r.commission) : '—'), foot: fmt(totComm), exp: r => (r.commission_pct != null ? r.commission.toFixed(2) : '') },
  ];
  const xl = exportFromColumns(columns, rows);

  return (
    <OceanReport
      testid="sales-by-salesperson-ocean"
      title={t('reports.sales_by_salesperson')}
      subtitle={t('rptOcean.range', { from: ltr(from), to: ltr(to) })}
      controls={<>
        <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <ReportActions rows={xl.rows} headers={xl.headers} filename={`sales-by-salesperson-${from}_${to}`} disabled={rows.length === 0} />
      </>}
    >
      <ReportCard
        figures={rows.length > 0 ? [
          { label: t('reports.invoice_count'), value: <Num>{totCount}</Num> },
          { label: t('reports.net_sales'), value: <Num>{fmt(totNet)}</Num>, tone: 'brand' },
          { label: t('reports.gross_profit'), value: <Num>{fmt(totGP)}</Num>, tone: totGP < 0 ? 'bad' : 'good' },
          { label: t('reports.commission'), value: <Num>{fmt(totComm)}</Num> },
        ] : undefined}
      >
        {rows.length === 0
          ? <ReportMessage>{isFetching ? t('common.loading') : t('reports.no_data')}</ReportMessage>
          : <>
              <ReportTable columns={columns} rows={rows} rowKey={r => r.salesperson_id ?? 'unassigned'} footLabel={t('rptOcean.total')} minWidth={980} />
              <p className="sb-rpt-foot">{t('reports.commission_note')}</p>
            </>}
      </ReportCard>
    </OceanReport>
  );
}
