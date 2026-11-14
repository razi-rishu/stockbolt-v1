import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportMessage, ReportTable, exportFromColumns, money as fmt, Num, ltr, type ReportColumn } from '@/components/ocean-report';

export default function PurchasesBySupplierPage() {
  const { t } = useTranslation();
  const company_id = useAuthStore(s => s.company_id);
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.purchases-by-supplier.period', 'this_month');

  const { data, isFetching } = useQuery({
    queryKey: ['purchases_by_supplier', company_id, from, to],
    queryFn: () => getAdapter().reports.getPurchasesBySupplier(company_id!, from, to),
    enabled: !!company_id,
  });
  const rows = data ?? [];
  type Row = typeof rows[number];

  const totNet = rows.reduce((s, r) => s + r.net_purchases, 0);
  const totBills = rows.reduce((s, r) => s + r.bill_count, 0);

  const columns: ReportColumn<Row>[] = [
    { key: 'supplier', header: t('contacts.supplier'), cls: 'strong', cell: r => r.contact_name, exp: r => r.contact_name },
    { key: 'count', header: t('reports.bill_count'), num: true, cls: 'muted', cell: r => r.bill_count, exp: r => r.bill_count },
    { key: 'gross', header: t('reports.gross_purchases'), num: true, cls: 'muted', cell: r => fmt(r.gross_purchases), exp: r => r.gross_purchases.toFixed(2) },
    { key: 'net', header: t('reports.net_purchases'), num: true, cls: 'strong', cell: r => fmt(r.net_purchases), foot: fmt(totNet), exp: r => r.net_purchases.toFixed(2) },
    { key: 'pct', header: t('reports.pct_of_total'), num: true, cls: 'muted', cell: r => `${r.pct_of_total.toFixed(1)}%`, foot: '100%', exp: r => r.pct_of_total.toFixed(1) },
  ];
  const xl = exportFromColumns(columns, rows);

  return (
    <OceanReport
      testid="purchases-by-supplier-ocean"
      title={t('reports.purchases_by_supplier')}
      subtitle={t('rptOcean.range', { from: ltr(from), to: ltr(to) })}
      controls={<>
        <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <ReportActions rows={xl.rows} headers={xl.headers} filename={`purchases-by-supplier-${from}_${to}`} disabled={rows.length === 0} />
      </>}
    >
      <ReportCard
        figures={rows.length > 0 ? [
          { label: t('rptOcean.fig_suppliers'), value: <Num>{rows.length}</Num> },
          { label: t('reports.bill_count'), value: <Num>{totBills}</Num> },
          { label: t('reports.net_purchases'), value: <Num>{fmt(totNet)}</Num>, tone: 'brand' },
        ] : undefined}
      >
        {rows.length === 0
          ? <ReportMessage>{isFetching ? t('common.loading') : t('reports.no_data')}</ReportMessage>
          : <ReportTable columns={columns} rows={rows} rowKey={r => r.contact_id} footLabel={t('rptOcean.total')} minWidth={620} />}
      </ReportCard>
    </OceanReport>
  );
}
