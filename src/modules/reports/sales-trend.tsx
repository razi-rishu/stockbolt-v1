import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportMessage, ReportTable, exportFromColumns, money as fmt, Num, ltr, type ReportColumn } from '@/components/ocean-report';

export default function SalesTrendPage() {
  const { t } = useTranslation();
  const company_id = useAuthStore(s => s.company_id);
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.sales-trend.period', 'this_month');
  const [bucket, setBucket] = useState<'day' | 'week' | 'month'>('day');

  const { data, isFetching } = useQuery({
    queryKey: ['sales_trend', company_id, from, to, bucket],
    queryFn: () => getAdapter().reports.getSalesTrend(company_id!, from, to, bucket),
    enabled: !!company_id,
  });
  const rows = data ?? [];
  type Row = typeof rows[number];

  const maxAmt = Math.max(...rows.map(r => r.net_sales), 1);
  // Figures strip only — the table has no totals row, as before.
  const totNet = rows.reduce((s, r) => s + r.net_sales, 0);
  const totGP  = rows.reduce((s, r) => s + r.gross_profit, 0);
  const totInv = rows.reduce((s, r) => s + r.invoice_count, 0);

  const columns: ReportColumn<Row>[] = [
    { key: 'period', header: t('reports.period'), cls: 'strong', cell: r => <Num>{r.bucket}</Num>, exp: r => r.bucket },
    { key: 'count', header: t('reports.invoice_count'), num: true, cls: 'muted', cell: r => r.invoice_count, exp: r => r.invoice_count },
    { key: 'gross', header: t('reports.gross_sales'), num: true, cls: 'muted', cell: r => fmt(r.gross_sales), exp: r => r.gross_sales.toFixed(2) },
    { key: 'returns', header: t('reports.returns'), num: true, cls: r => (r.returns > 0 ? 'is-down' : 'muted'), cell: r => (r.returns > 0 ? `(${fmt(r.returns)})` : '—'), exp: r => r.returns.toFixed(2) },
    { key: 'net', header: t('reports.net_sales'), num: true, cls: 'strong', cell: r => fmt(r.net_sales), exp: r => r.net_sales.toFixed(2) },
    { key: 'gp', header: t('reports.gross_profit'), num: true, cls: 'is-up strong', cell: r => fmt(r.gross_profit), exp: r => r.gross_profit.toFixed(2) },
  ];
  const xl = exportFromColumns(columns, rows);

  return (
    <OceanReport
      testid="sales-trend-ocean"
      title={t('reports.sales_trend')}
      subtitle={t('rptOcean.range', { from: ltr(from), to: ltr(to) })}
      controls={<>
        <select
          value={bucket} onChange={e => setBucket(e.target.value as 'day' | 'week' | 'month')}
          className="sb-rpt-select" title={t('reports.bucket')} aria-label={t('reports.bucket')}
        >
          <option value="day">{t('reports.bucket_day')}</option>
          <option value="week">{t('reports.bucket_week')}</option>
          <option value="month">{t('reports.bucket_month')}</option>
        </select>
        <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <ReportActions rows={xl.rows} headers={xl.headers} filename={`sales-trend-${from}_${to}`} disabled={rows.length === 0} />
      </>}
    >
      {rows.length === 0 && <ReportCard><ReportMessage>{isFetching ? t('common.loading') : t('reports.no_data')}</ReportMessage></ReportCard>}

      {rows.length > 0 && (
        <>
          <ReportCard
            figures={[
              { label: t('reports.invoice_count'), value: <Num>{totInv}</Num> },
              { label: t('reports.net_sales'), value: <Num>{fmt(totNet)}</Num>, tone: 'brand' },
              { label: t('reports.gross_profit'), value: <Num>{fmt(totGP)}</Num>, tone: totGP < 0 ? 'bad' : 'good' },
            ]}
          >
            {/* Bar chart — net sales per period */}
            <div className="sb-rpt-bars" dir="ltr">
              {rows.map(r => (
                <div key={r.bucket} className="sb-rpt-bar" title={`${r.bucket}: ${fmt(r.net_sales)}`}>
                  <span style={{ height: `${Math.max(4, (r.net_sales / maxAmt) * 100)}%` }} />
                  <span>{r.bucket.slice(-5)}</span>
                </div>
              ))}
            </div>
          </ReportCard>
          <ReportCard>
            <ReportTable columns={columns} rows={rows} rowKey={r => r.bucket} minWidth={680} />
          </ReportCard>
        </>
      )}
    </OceanReport>
  );
}
