import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { StatusBadge } from '@/ui/status-badge';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportMessage, ReportTable, exportFromColumns, money as fmt, Num, type ReportColumn } from '@/components/ocean-report';

export default function POSSessionReportPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.pos-session.period', 'this_month');
  const [status, setStatus] = useState<'all' | 'open' | 'closed'>('all');

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['pos-session-report', company_id, from, to, status],
    enabled: !!company_id,
    queryFn: () =>
      getAdapter().pos.getPOSSessionReport(company_id!, {
        date_from: from,
        date_to: to,
        ...(status !== 'all' ? { status } : {}),
      }),
  });
  type Row = typeof rows[number];

  const totalSales    = rows.reduce((s, r) => s + (r.total_sales_amount ?? 0), 0);
  const totalInvoices = rows.reduce((s, r) => s + (r.total_sales_count ?? 0), 0);
  const totalVariance = rows.reduce((s, r) => s + (r.cash_variance ?? 0), 0);
  const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString() : '');
  const varCls = (v: number | null | undefined) => (v == null ? 'muted' : Math.abs(v) < 0.01 ? 'is-up strong' : 'is-down strong');

  const columns: ReportColumn<Row>[] = [
    { key: 'no', header: t('pos.session_number'), cell: r => <span className="code">{r.session_number}</span>, exp: r => r.session_number },
    { key: 'wh', header: t('pos.warehouse'), cls: 'muted', cell: r => r.warehouse_name, exp: r => r.warehouse_name },
    { key: 'status', header: t('common.status'), cell: r => <StatusBadge status={r.status} />, exp: r => r.status },
    { key: 'opened', header: t('pos.opened_at'), cls: 'muted', cell: r => <Num>{when(r.opened_at) || '—'}</Num>, exp: r => when(r.opened_at) },
    { key: 'closed', header: t('pos.closed_at'), cls: 'muted', cell: r => <Num>{when(r.closed_at) || '—'}</Num>, exp: r => when(r.closed_at) },
    { key: 'open_cash', header: t('pos.opening_cash'), num: true, cls: 'muted', cell: r => fmt(r.opening_cash ?? 0), exp: r => (r.opening_cash ?? 0).toFixed(2) },
    { key: 'inv', header: t('pos.invoices'), num: true, cls: 'muted', cell: r => r.total_sales_count ?? 0, exp: r => r.total_sales_count ?? 0 },
    { key: 'sales', header: t('pos.total_sales'), num: true, cls: 'strong', cell: r => fmt(r.total_sales_amount ?? 0), exp: r => (r.total_sales_amount ?? 0).toFixed(2) },
    { key: 'counted', header: t('pos.counted_cash'), num: true, cls: 'muted', cell: r => (r.closing_cash_counted != null ? fmt(r.closing_cash_counted) : '—'), exp: r => (r.closing_cash_counted != null ? r.closing_cash_counted.toFixed(2) : '') },
    { key: 'var', header: t('pos.cash_variance'), num: true, cls: r => varCls(r.cash_variance), cell: r => (r.cash_variance != null ? fmt(r.cash_variance) : '—'), exp: r => (r.cash_variance != null ? r.cash_variance.toFixed(2) : '') },
  ];
  const xl = exportFromColumns(columns, rows);

  return (
    <OceanReport
      testid="pos-session-ocean"
      title={t('reports.pos_session_report')}
      subtitle={t('reports.pos_session_report_desc')}
      controls={<>
        <select
          value={status} onChange={e => setStatus(e.target.value as 'all' | 'open' | 'closed')}
          className="sb-rpt-select" title={t('common.status')} aria-label={t('common.status')}
        >
          <option value="all">{t('common.all')}</option>
          <option value="open">{t('pos.session_open')}</option>
          <option value="closed">{t('pos.session_closed')}</option>
        </select>
        <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <ReportActions rows={xl.rows} headers={xl.headers} filename={`pos-sessions-${from}_${to}`} disabled={rows.length === 0} />
      </>}
    >
      <ReportCard
        figures={rows.length > 0 ? [
          { label: t('reports.total_sessions'), value: <Num>{rows.length}</Num> },
          { label: t('reports.total_invoices'), value: <Num>{totalInvoices}</Num> },
          { label: t('reports.total_sales'), value: <Num>{fmt(totalSales)}</Num>, tone: 'brand' },
          { label: t('pos.cash_variance'), value: <Num>{fmt(totalVariance)}</Num>, tone: Math.abs(totalVariance) < 0.01 ? 'good' : 'bad' },
        ] : undefined}
      >
        {rows.length === 0
          ? <ReportMessage>{isFetching ? t('common.loading') : t('pos.no_sessions')}</ReportMessage>
          : <ReportTable columns={columns} rows={rows} rowKey={r => r.session_id} minWidth={1080} />}
      </ReportCard>
    </OceanReport>
  );
}
