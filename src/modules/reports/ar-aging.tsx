import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { DocLink } from '@/ui/doc-link';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportMessage, ReportTable, exportFromColumns, money as fmt, Num, ltr, type ReportColumn } from '@/components/ocean-report';

/**
 * Accounting-style signed formatter — negatives wrapped in parens.
 *   -100 → "(100.00)" ; 100 → "100.00"
 * Used for the "Net Due" column: a negative means the customer is in
 * credit with us (we owe them).
 */
function fmtSigned(n: number) {
  if (n < -0.005) return `(${fmt(-n)})`;
  return fmt(n);
}

export default function ARAgingPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  // Phase 46b — as-of picker: only `.to` matters; a past-period preset
  // resolves to that period's end date. Default = today (This Month → today).
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.ar-aging.period', 'this_month');
  const asOf = to;

  const { data: ar, isLoading, error } = useQuery({
    queryKey: ['ar_aging', company_id, asOf],
    queryFn: () => getAdapter().reports.getARAgingReport(company_id!, asOf),
    enabled: !!company_id,
  });
  const buckets = ar?.buckets ?? [];
  type Row = typeof buckets[number];

  const totAdvance = buckets.reduce((s, b) => s + b.advance_credit, 0);
  const totCN      = buckets.reduce((s, b) => s + b.credit_note_credit, 0);
  const totNet     = buckets.reduce((s, b) => s + b.net_due, 0);
  const dash = (n: number, min = 0) => (n > min ? fmt(n) : '—');

  const columns: ReportColumn<Row>[] = [
    { key: 'customer', header: t('reports.customer'), cell: b => <DocLink type="customer" id={b.contact_id} label={b.contact_name} />, exp: b => b.contact_name },
    { key: 'current', header: t('reports.current'), num: true, cell: b => dash(b.current), foot: ar ? fmt(ar.total_current) : '', exp: b => b.current.toFixed(2) },
    { key: 'd31', header: '31–60', headerLtr: true, num: true, cls: b => (b.days_31_60 > 0 ? 'is-warn' : 'muted'), cell: b => dash(b.days_31_60), foot: ar ? fmt(ar.total_31_60) : '', exp: b => b.days_31_60.toFixed(2) },
    { key: 'd61', header: '61–90', headerLtr: true, num: true, cls: b => (b.days_61_90 > 0 ? 'is-down' : 'muted'), cell: b => dash(b.days_61_90), foot: ar ? fmt(ar.total_61_90) : '', exp: b => b.days_61_90.toFixed(2) },
    { key: 'd90', header: '>90', headerLtr: true, num: true, cls: b => (b.over_90 > 0 ? 'is-down strong' : 'muted'), cell: b => dash(b.over_90), foot: ar ? fmt(ar.total_over_90) : '', exp: b => b.over_90.toFixed(2) },
    { key: 'total', header: t('reports.total'), num: true, cls: 'strong', cell: b => fmt(b.total), foot: ar ? fmt(ar.grand_total) : '', exp: b => b.total.toFixed(2) },
    // Phase 12.24 — advance + net due columns
    { key: 'advance', header: t('rptOcean.ar_advance'), title: t('rptOcean.ar_advance_hint'), num: true, cls: b => (b.advance_credit > 0.005 ? 'is-up' : 'muted'), cell: b => dash(b.advance_credit, 0.005), foot: fmt(totAdvance), exp: b => b.advance_credit.toFixed(2) },
    // Phase 94 — a credit note still owed to the customer. Not aged,
    // because a credit note is not an overdue receivable.
    { key: 'cn', header: t('reports.credit_note_credit'), title: t('reports.credit_note_credit_hint'), num: true, cls: b => (b.credit_note_credit > 0.005 ? 'is-up' : 'muted'), cell: b => dash(b.credit_note_credit, 0.005), foot: fmt(totCN), exp: b => b.credit_note_credit.toFixed(2) },
    { key: 'net', header: t('rptOcean.ar_net_due'), title: t('rptOcean.ar_net_due_hint'), num: true, cls: b => (b.net_due < -0.005 ? 'is-up strong' : 'strong'), cell: b => fmtSigned(b.net_due), foot: fmtSigned(totNet), exp: b => b.net_due.toFixed(2) },
  ];
  const xl = exportFromColumns(columns, buckets);

  return (
    <OceanReport
      testid="ar-aging-ocean"
      title={t('reports.ar_aging_title')}
      subtitle={t('rptOcean.as_of_date', { date: ltr(asOf) })}
      controls={<>
        <PeriodPicker mode="asOf" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <ReportActions rows={xl.rows} headers={xl.headers} filename={`ar-aging-${asOf}`} disabled={!ar} />
      </>}
    >
      {isLoading && <ReportCard><ReportMessage>{t('common.loading')}</ReportMessage></ReportCard>}
      {error && <ReportCard><ReportMessage tone="bad">{String(error)}</ReportMessage></ReportCard>}

      {ar && buckets.length === 0 && <ReportCard><ReportMessage>{t('reports.no_outstanding')}</ReportMessage></ReportCard>}

      {ar && buckets.length > 0 && (
        <ReportCard
          figures={[
            { label: t('reports.current'), value: <Num>{fmt(ar.total_current)}</Num> },
            { label: t('rptOcean.ar_31_90'), value: <Num>{fmt(ar.total_31_60 + ar.total_61_90)}</Num>, tone: ar.total_31_60 + ar.total_61_90 > 0 ? 'warn' : undefined },
            { label: t('rptOcean.ar_over_90'), value: <Num>{fmt(ar.total_over_90)}</Num>, tone: ar.total_over_90 > 0 ? 'bad' : undefined },
            { label: t('rptOcean.ar_net_due'), value: <Num>{fmtSigned(totNet)}</Num>, tone: 'brand' },
          ]}
        >
          <ReportTable columns={columns} rows={buckets} rowKey={b => b.contact_id} footLabel={t('reports.total')} minWidth={940} />
        </ReportCard>
      )}
    </OceanReport>
  );
}
