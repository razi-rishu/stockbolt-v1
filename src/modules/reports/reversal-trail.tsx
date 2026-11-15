import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportMessage, ReportTable, exportFromColumns, money as fmt, Num, ltr, type ReportColumn } from '@/components/ocean-report';

export default function ReversalTrailPage() {
  const { t } = useTranslation();
  const company_id = useAuthStore(s => s.company_id);
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.reversal-trail.period', 'this_year');

  const { data, isFetching } = useQuery({
    queryKey: ['reversal_trail', company_id, from, to],
    queryFn: () => getAdapter().reports.getReversalTrail(company_id!, from, to),
    enabled: !!company_id,
  });
  const rows = data ?? [];
  type Row = typeof rows[number];

  // Figures strip only — the table has no totals row, as before.
  const totAmount = rows.reduce((s, r) => s + r.amount, 0);
  const srcLabel = (src: string) => t(`jeOcean.src_${src}`, { defaultValue: src.replace(/_/g, ' ') });

  const columns: ReportColumn<Row>[] = [
    { key: 'orig', header: t('reports.original_entry'), cell: r => <Link to="/accounting/journal-entries" className="code">{r.original_entry_number}</Link>, exp: r => r.original_entry_number },
    { key: 'date', header: t('common.date'), cls: 'muted', cell: r => <Num>{r.original_date}</Num>, exp: r => r.original_date },
    { key: 'rev', header: t('reports.reversal_entry'), cell: r => (r.reversal_entry_number ? <span className="code">{r.reversal_entry_number}</span> : '—'), exp: r => r.reversal_entry_number },
    { key: 'rdate', header: t('reports.reversal_date'), cls: 'muted', cell: r => <Num>{r.reversal_date || '—'}</Num>, exp: r => r.reversal_date },
    { key: 'amount', header: t('common.amount'), num: true, cls: 'strong', cell: r => fmt(r.amount), exp: r => r.amount.toFixed(2) },
    { key: 'src', header: t('reports.source_type'), cell: r => <span className="sb-pill sb-pill-muted">{srcLabel(r.source_type)}</span>, exp: r => srcLabel(r.source_type) },
    { key: 'by', header: t('reports.reversed_by'), cls: 'muted', cell: r => <Num>{r.reversed_by || '—'}</Num>, exp: r => r.reversed_by || '' },
  ];
  const xl = exportFromColumns(columns, rows);

  return (
    <OceanReport
      testid="reversal-trail-ocean"
      title={t('reports.reversal_trail')}
      subtitle={t('rptOcean.range', { from: ltr(from), to: ltr(to) })}
      controls={<>
        <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <ReportActions rows={xl.rows} headers={xl.headers} filename={`reversal-trail-${from}_${to}`} disabled={rows.length === 0} />
      </>}
    >
      <ReportCard
        figures={rows.length > 0 ? [
          { label: t('rptOcean.fig_reversals'), value: <Num>{rows.length}</Num> },
          { label: t('rptOcean.fig_reversed_amount'), value: <Num>{fmt(totAmount)}</Num>, tone: 'warn' },
        ] : undefined}
      >
        {rows.length === 0
          ? <ReportMessage>{isFetching ? t('common.loading') : t('reports.no_data')}</ReportMessage>
          : <ReportTable columns={columns} rows={rows} rowKey={(_, i) => String(i)} minWidth={900} />}
      </ReportCard>
    </OceanReport>
  );
}
