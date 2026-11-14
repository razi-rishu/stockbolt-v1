import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { OceanReport, ReportCard, ReportTableWrap, ReportMessage, Num, ltr } from '@/components/ocean-report';
import { Amount, StmtKeyRow, StmtSection, StmtSubtotal } from './_shared/statement';
import type { CashFlowStatement } from '@/data/adapter';

// Outflows in brackets, as on a printed cash flow statement.
function fmt(n: number) {
  const s = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
  return n < 0 ? `(${s})` : s;
}

function Row({ label, amount, indent }: { label: string; amount: number; indent?: boolean }) {
  return (
    <tr>
      <td className={indent ? 'sb-rpt-indent' : undefined}>{label}</td>
      <Amount tone={amount < 0 ? 'down' : undefined}>{fmt(amount)}</Amount>
    </tr>
  );
}

export default function CashFlowPage() {
  const { t } = useTranslation();
  const company_id = useAuthStore(s => s.company_id);

  // Phase 46b — range period picker; preset clicks auto-run. Default this year.
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.cash-flow.period', 'this_year');

  const { data, isLoading: loading } = useQuery<CashFlowStatement>({
    queryKey: ['cash_flow', company_id, from, to],
    queryFn: () => getAdapter().reports.getCashFlow(company_id!, from, to),
    enabled: !!company_id,
  });

  // Section and column names (screen and Excel share them, in the screen language).
  const S = {
    op: t('reports.cf_operating'), wc: t('reports.cf_working_capital'), inv: t('reports.cf_investing'),
    fin: t('reports.cf_financing'), sum: t('rptOcean.sec_summary'),
  };
  const H = { section: t('rptOcean.col_section'), line: t('rptOcean.col_line'), amount: t('rptOcean.col_amount') };
  const exportRows: Record<string, unknown>[] = [];
  if (data) {
    const push = (section: string, label: string, amount: number) =>
      exportRows.push({ [H.section]: section, [H.line]: label, [H.amount]: amount.toFixed(2) });
    push(S.op, t('reports.net_profit'), data.net_profit);
    for (const s of data.operating_adjustments) push(S.op, s.label, s.amount);
    for (const s of data.working_capital_changes) push(S.wc, s.label, s.amount);
    push(S.op, t('reports.net_operating'), data.net_operating);
    for (const s of data.investing_activities) push(S.inv, s.label, s.amount);
    push(S.inv, t('reports.net_investing'), data.net_investing);
    for (const s of data.financing_activities) push(S.fin, s.label, s.amount);
    push(S.fin, t('reports.net_financing'), data.net_financing);
    push(S.sum, t('reports.net_increase_cash'), data.net_increase);
    push(S.sum, t('reports.opening_cash'), data.opening_cash);
    push(S.sum, t('reports.closing_cash'), data.closing_cash);
  }
  const exportHeaders = [H.section, H.line, H.amount];

  const range = data
    ? t('rptOcean.range', { from: ltr(data.period_start), to: ltr(data.period_end) })
    : t('rptOcean.range', { from: ltr(from), to: ltr(to) });
  const section = (title: string, total: number, totalLabel: string, body: ReactNode) => (
    <StmtSection
      title={title} cols={2} collapsedValue={fmt(total)}
      footer={<StmtSubtotal label={totalLabel}><Amount tone={total < 0 ? 'down' : undefined}>{fmt(total)}</Amount></StmtSubtotal>}
    >{body}</StmtSection>
  );

  return (
    <OceanReport
      testid="cash-flow-ocean"
      title={t('reports.cash_flow')}
      subtitle={range}
      controls={<>
        <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <ReportActions rows={exportRows} headers={exportHeaders} filename={`cash-flow-${from}_${to}`} disabled={!data} />
      </>}
    >
      {loading && !data && <ReportCard><ReportMessage>{t('common.loading')}</ReportMessage></ReportCard>}

      {data && (
        <ReportCard
          figures={[
            { label: t('reports.opening_cash'), value: <Num>{fmt(data.opening_cash)}</Num> },
            { label: t('reports.net_operating'), value: <Num>{fmt(data.net_operating)}</Num>, tone: data.net_operating < 0 ? 'bad' : undefined },
            { label: t('reports.net_increase_cash'), value: <Num>{fmt(data.net_increase)}</Num>, tone: data.net_increase < 0 ? 'bad' : 'good' },
            { label: t('reports.closing_cash'), value: <Num>{fmt(data.closing_cash)}</Num>, tone: data.closing_cash < 0 ? 'bad' : 'brand' },
          ]}
        >
          <ReportTableWrap>
            <table className="sb-rpt-table sb-rpt-stmt">
              <tbody>
                {/* ── Operating Activities ── */}
                {section(S.op, data.net_operating, t('reports.net_operating'), <>
                  <Row label={t('reports.net_profit')} amount={data.net_profit} />
                  {data.operating_adjustments.map((s, i) => <Row key={`a${i}`} label={s.label} amount={s.amount} />)}
                  {data.working_capital_changes.length > 0 && (
                    <tr className="sb-rpt-minor"><td colSpan={2}>{S.wc}</td></tr>
                  )}
                  {data.working_capital_changes.map((s, i) => <Row key={`w${i}`} label={s.label} amount={s.amount} indent />)}
                </>)}

                {/* ── Investing Activities ── */}
                {section(S.inv, data.net_investing, t('reports.net_investing'),
                  data.investing_activities.length === 0
                    ? <Row label={t('common.none')} amount={0} />
                    : data.investing_activities.map((s, i) => <Row key={i} label={s.label} amount={s.amount} />))}

                {/* ── Financing Activities ── */}
                {section(S.fin, data.net_financing, t('reports.net_financing'),
                  data.financing_activities.length === 0
                    ? <Row label={t('common.none')} amount={0} />
                    : data.financing_activities.map((s, i) => <Row key={i} label={s.label} amount={s.amount} />))}

                {/* ── Summary — always visible ── */}
                <StmtKeyRow label={t('reports.net_increase_cash')} tone={data.net_increase < 0 ? 'bad' : 'brand'}>
                  <Amount>{fmt(data.net_increase)}</Amount>
                </StmtKeyRow>
                <Row label={t('reports.opening_cash')} amount={data.opening_cash} />
                <StmtKeyRow label={t('reports.closing_cash')} tone={data.closing_cash < 0 ? 'bad' : 'good'} big>
                  <Amount>{fmt(data.closing_cash)}</Amount>
                </StmtKeyRow>
              </tbody>
            </table>
          </ReportTableWrap>
        </ReportCard>
      )}
    </OceanReport>
  );
}
