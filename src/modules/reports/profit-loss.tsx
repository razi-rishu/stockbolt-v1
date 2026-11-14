import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { useComparativePeriods } from '@/hooks/use-comparative-periods';
import { CompareToggle } from '@/ui/compare-toggle';
import { mergeComparativeProfitAndLoss, formatVariancePct } from '@/lib/comparative';
import { OceanReport, ReportCard, ReportTableWrap, ReportMessage, Num, ltr } from '@/components/ocean-report';
import { ComparativeHead, ComparativeSection, ComparativeAccountRow, VarianceCells } from './_shared/variance';
import { Amount, StmtAccount, StmtEmpty, StmtKeyRow, StmtSection, StmtSubtotal, fmtNum as fmt, fmtParen } from './_shared/statement';
import type { Company } from '@/data/adapter';

export default function ProfitLossPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  // Phase 46b — preset period picker. Preset clicks auto-run; default = this month.
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.profit-loss.period', 'this_month');

  // AC-2B — company (for fiscal-aware Year comparison). Cached app-wide.
  const { data: company } = useQuery<Company | null>({
    queryKey: ['company', company_id],
    queryFn: () => getAdapter().companies.getById(company_id!),
    enabled: !!company_id,
  });

  const cmp = useComparativePeriods({
    storageKey: 'stockbolt.report.profit-loss.compare',
    preset, current: { from, to },
    fiscalYearStart: company?.fiscal_year_start ?? null,
  });
  // Off-compare, the current window IS the picker range → query key unchanged.
  const curFrom = cmp.compareOn ? cmp.range.current.from : from;
  const curTo   = cmp.compareOn ? cmp.range.current.to   : to;

  function openLedger(code: string) {
    navigate(`/accounting/general-ledger?code=${encodeURIComponent(code)}&from=${curFrom}&to=${curTo}`);
  }

  const { data: pl, isLoading, error } = useQuery({
    queryKey: ['pl', company_id, curFrom, curTo],
    queryFn: () => getAdapter().reports.getProfitAndLoss(company_id!, curFrom, curTo),
    enabled: !!company_id,
  });

  // Previous-period query (only while comparing). Reuses the same adapter method.
  const { data: plPrev } = useQuery({
    queryKey: ['pl', company_id, cmp.range.previous.from, cmp.range.previous.to],
    queryFn: () => getAdapter().reports.getProfitAndLoss(company_id!, cmp.range.previous.from, cmp.range.previous.to),
    enabled: !!company_id && cmp.compareOn,
  });

  const comparative = cmp.compareOn && pl && plPrev ? mergeComparativeProfitAndLoss(pl, plPrev) : null;

  // Section and column names (screen and Excel share them, in the screen language).
  const S = {
    revenue: t('rptOcean.pl_revenue'), cogs: t('rptOcean.pl_cogs'),
    other: t('rptOcean.pl_other_income'), opex: t('rptOcean.pl_opex'),
    totals: t('rptOcean.sec_totals'),
    gross: t('reports.gross_profit'), net: t('reports.net_profit'),
  };
  const H = {
    section: t('rptOcean.col_section'), code: t('rptOcean.col_account_code'), account: t('rptOcean.col_account'),
    amount: t('rptOcean.col_amount'), current: t('rptOcean.col_current'), previous: t('rptOcean.col_previous'),
    variance: t('rptOcean.col_variance'), varPct: t('rptOcean.col_variance_pct'),
  };

  // Phase 46b — flatten the P&L into rows for Excel export (Section column
  // preserves the grouping that the collapsible UI can't carry into a sheet).
  const exportRows: Record<string, unknown>[] = [];
  if (pl) {
    const push = (section: string, code: string, name: string, amount: number) =>
      exportRows.push({ [H.section]: section, [H.code]: code, [H.account]: name, [H.amount]: amount.toFixed(2) });
    const isDirect = (l: typeof pl.lines[number]) => l.sub_type !== 'indirect';
    for (const l of pl.lines.filter(l => l.account_type === 'income'  &&  isDirect(l))) push(S.revenue, l.account_code, l.account_name, l.amount);
    for (const l of pl.lines.filter(l => l.account_type === 'expense' &&  isDirect(l))) push(S.cogs, l.account_code, l.account_name, -l.amount);
    push(S.totals, '', S.gross, pl.gross_profit);
    for (const l of pl.lines.filter(l => l.account_type === 'income'  && !isDirect(l))) push(S.other, l.account_code, l.account_name, l.amount);
    for (const l of pl.lines.filter(l => l.account_type === 'expense' && !isDirect(l))) push(S.opex, l.account_code, l.account_name, -l.amount);
    push(S.totals, '', S.net, pl.net_profit);
  }
  const exportHeaders = [H.section, H.code, H.account, H.amount];

  // Comparative export overrides the single-period rows while compare is on.
  let finalRows = exportRows;
  let finalHeaders = exportHeaders;
  let exportName = `profit-loss-${curFrom}_${curTo}`;
  if (comparative) {
    const rows: Record<string, unknown>[] = [];
    const isDir = (l: typeof comparative.lines[number]) => l.sub_type !== 'indirect';
    const pushC = (section: string, l: typeof comparative.lines[number]) => rows.push({
      [H.section]: section, [H.code]: l.account_code, [H.account]: l.account_name,
      [H.current]: l.current.toFixed(2), [H.previous]: l.previous.toFixed(2),
      [H.variance]: l.variance.toFixed(2), [H.varPct]: formatVariancePct(l.current, l.previous),
    });
    for (const l of comparative.lines.filter(l => l.account_type === 'income'  &&  isDir(l))) pushC(S.revenue, l);
    for (const l of comparative.lines.filter(l => l.account_type === 'expense' &&  isDir(l))) pushC(S.cogs, l);
    for (const l of comparative.lines.filter(l => l.account_type === 'income'  && !isDir(l))) pushC(S.other, l);
    for (const l of comparative.lines.filter(l => l.account_type === 'expense' && !isDir(l))) pushC(S.opex, l);
    const nv = comparative.net_profit;
    rows.push({ [H.section]: S.totals, [H.code]: '', [H.account]: S.net,
      [H.current]: nv.current.toFixed(2), [H.previous]: nv.previous.toFixed(2),
      [H.variance]: nv.variance.toFixed(2), [H.varPct]: formatVariancePct(nv.current, nv.previous) });
    finalRows = rows;
    finalHeaders = [H.section, H.code, H.account, H.current, H.previous, H.variance, H.varPct];
    exportName = `profit-loss-comparative-${curFrom}_${curTo}`;
  }

  const rangeText = cmp.compareOn
    ? t('rptOcean.range_vs', { from: ltr(curFrom), to: ltr(curTo), pfrom: ltr(cmp.range.previous.from), pto: ltr(cmp.range.previous.to) })
    : t('rptOcean.range', { from: ltr(from), to: ltr(to) });

  return (
    <OceanReport
      testid="profit-loss-ocean"
      title={t('reports.pl_title')}
      subtitle={rangeText}
      controls={<>
        <PeriodPicker mode="range" preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <CompareToggle on={cmp.compareOn} basis={cmp.basis} onToggle={cmp.setCompareOn} onBasis={cmp.setBasis} />
        <ReportActions rows={finalRows} headers={finalHeaders} filename={exportName} disabled={cmp.compareOn ? !comparative : !pl} />
      </>}
    >
      {(isLoading || (cmp.compareOn && pl && !comparative && !error)) && (
        <ReportCard><ReportMessage>{t('common.loading')}</ReportMessage></ReportCard>
      )}
      {error && <ReportCard><ReportMessage tone="bad">{String(error)}</ReportMessage></ReportCard>}

      {!cmp.compareOn && pl && (() => {
        // NULL sub_type defaults to 'direct' (matches adapter) so legacy
        // accounts still appear above Gross Profit rather than disappearing.
        const isDirect = (l: typeof pl.lines[number]) => l.sub_type !== 'indirect';
        const directIncome   = pl.lines.filter(l => l.account_type === 'income'  &&  isDirect(l));
        const directExpense  = pl.lines.filter(l => l.account_type === 'expense' &&  isDirect(l));
        const otherIncome    = pl.lines.filter(l => l.account_type === 'income'  && !isDirect(l));
        const operatingExp   = pl.lines.filter(l => l.account_type === 'expense' && !isDirect(l));

        const cogsTotal = pl.revenue - pl.gross_profit;
        const paren = (n: number) => `(${fmt(n)})`;

        return (
          <ReportCard
            figures={[
              { label: t('reports.total_revenue'), value: <Num>{fmt(pl.revenue)}</Num> },
              { label: t('reports.gross_profit'), value: <Num>{fmtParen(pl.gross_profit)}</Num>, tone: pl.gross_profit < 0 ? 'bad' : 'brand' },
              { label: t('rptOcean.pl_total_opex'), value: <Num>{fmt(pl.operating_expenses)}</Num> },
              { label: t('reports.net_profit'), value: <Num>{fmtParen(pl.net_profit)}</Num>, tone: pl.net_profit < 0 ? 'bad' : 'good' },
            ]}
            hint={t('rptOcean.stmt_hint')}
          >
            <ReportTableWrap>
              <table className="sb-rpt-table sb-rpt-stmt">
                <tbody>
                  {/* ── Revenue (Direct Income) ── */}
                  <StmtSection
                    title={S.revenue} cols={2} collapsedValue={fmt(pl.revenue)}
                    footer={<StmtSubtotal label={t('reports.total_revenue')}><Amount>{fmt(pl.revenue)}</Amount></StmtSubtotal>}
                  >
                    {directIncome.length === 0 ? <StmtEmpty label={t('rptOcean.pl_no_revenue')} cols={2} /> : directIncome.map(l => {
                      const isContra = l.amount < 0;
                      return (
                        <StmtAccount key={l.account_code} code={l.account_code} name={l.account_name} prefix={isContra ? t('rptOcean.less') : undefined} onOpen={openLedger}>
                          <Amount muted={isContra}>{fmtParen(l.amount)}</Amount>
                        </StmtAccount>
                      );
                    })}
                  </StmtSection>

                  {/* ── Cost of Goods Sold ── */}
                  <StmtSection
                    title={S.cogs} cols={2} collapsedValue={paren(cogsTotal)}
                    footer={<StmtSubtotal label={t('rptOcean.pl_total_cogs')}><Amount>{paren(cogsTotal)}</Amount></StmtSubtotal>}
                  >
                    {directExpense.length === 0 ? <StmtEmpty label={t('rptOcean.pl_no_direct')} cols={2} /> : directExpense.map(l => (
                      <StmtAccount key={l.account_code} code={l.account_code} name={l.account_name} onOpen={openLedger}>
                        <Amount>{paren(l.amount)}</Amount>
                      </StmtAccount>
                    ))}
                  </StmtSection>

                  {/* ── Gross Profit — always visible, never collapsible ── */}
                  <StmtKeyRow label={t('reports.gross_profit')} tone={pl.gross_profit < 0 ? 'bad' : 'brand'}>
                    <Amount>{fmt(pl.gross_profit)}</Amount>
                  </StmtKeyRow>

                  {/* ── Other Income (Indirect) — only when present ── */}
                  {otherIncome.length > 0 && (
                    <StmtSection
                      title={S.other} cols={2} collapsedValue={fmt(pl.other_income)}
                      footer={<StmtSubtotal label={t('rptOcean.pl_total_other_income')}><Amount>{fmt(pl.other_income)}</Amount></StmtSubtotal>}
                    >
                      {otherIncome.map(l => (
                        <StmtAccount key={l.account_code} code={l.account_code} name={l.account_name} onOpen={openLedger}>
                          <Amount>{fmt(l.amount)}</Amount>
                        </StmtAccount>
                      ))}
                    </StmtSection>
                  )}

                  {/* ── Operating Expenses (Indirect) ── */}
                  <StmtSection
                    title={S.opex} cols={2} collapsedValue={paren(pl.operating_expenses)}
                    footer={<StmtSubtotal label={t('rptOcean.pl_total_opex')}><Amount>{paren(pl.operating_expenses)}</Amount></StmtSubtotal>}
                  >
                    {operatingExp.length === 0 ? <StmtEmpty label={t('rptOcean.pl_no_opex')} cols={2} /> : operatingExp.map(l => (
                      <StmtAccount key={l.account_code} code={l.account_code} name={l.account_name} onOpen={openLedger}>
                        <Amount>{paren(l.amount)}</Amount>
                      </StmtAccount>
                    ))}
                  </StmtSection>

                  {/* ── Net Profit — always visible, never collapsible ── */}
                  <StmtKeyRow label={t('reports.net_profit')} tone={pl.net_profit < 0 ? 'bad' : 'good'} big>
                    <Amount>{fmt(pl.net_profit)}</Amount>
                  </StmtKeyRow>
                </tbody>
              </table>
            </ReportTableWrap>
          </ReportCard>
        );
      })()}

      {comparative && (() => {
        const c = comparative;
        const isDirect = (l: typeof c.lines[number]) => l.sub_type !== 'indirect';
        const directIncome  = c.lines.filter(l => l.account_type === 'income'  &&  isDirect(l));
        const directExpense = c.lines.filter(l => l.account_type === 'expense' &&  isDirect(l));
        const otherIncome   = c.lines.filter(l => l.account_type === 'income'  && !isDirect(l));
        const operatingExp  = c.lines.filter(l => l.account_type === 'expense' && !isDirect(l));
        const rows = (ls: typeof c.lines) => ls.map(l => (
          <ComparativeAccountRow key={l.account_code} code={l.account_code} name={l.account_name} v={l} onNavigate={openLedger} />
        ));
        return (
          <ReportCard title={t('rptOcean.comparative_title', { title: t('reports.pl_title') })} meta={rangeText} hint={t('rptOcean.stmt_hint')}>
            <ReportTableWrap>
              <table className="sb-rpt-table sb-rpt-stmt" style={{ minWidth: 760 }}>
                <ComparativeHead firstLabel={H.account} />
                <tbody>
                  <ComparativeSection title={S.revenue} total={c.revenue} totalLabel={t('reports.total_revenue')}>
                    {directIncome.length ? rows(directIncome) : <StmtEmpty label={t('rptOcean.pl_no_revenue')} cols={5} />}
                  </ComparativeSection>
                  <ComparativeSection title={S.cogs} total={c.cogs} totalLabel={t('rptOcean.pl_total_cogs')}>
                    {directExpense.length ? rows(directExpense) : <StmtEmpty label={t('rptOcean.pl_no_direct')} cols={5} />}
                  </ComparativeSection>
                  <StmtKeyRow label={t('reports.gross_profit')} tone={c.gross_profit.current < 0 ? 'bad' : 'brand'}>
                    <VarianceCells v={c.gross_profit} emphasize />
                  </StmtKeyRow>
                  {otherIncome.length > 0 && (
                    <ComparativeSection title={S.other} total={c.other_income} totalLabel={t('rptOcean.pl_total_other_income')}>
                      {rows(otherIncome)}
                    </ComparativeSection>
                  )}
                  <ComparativeSection title={S.opex} total={c.operating_expenses} totalLabel={t('rptOcean.pl_total_opex')}>
                    {operatingExp.length ? rows(operatingExp) : <StmtEmpty label={t('rptOcean.pl_no_opex')} cols={5} />}
                  </ComparativeSection>
                  <StmtKeyRow label={t('reports.net_profit')} tone={c.net_profit.current < 0 ? 'bad' : 'good'} big>
                    <VarianceCells v={c.net_profit} emphasize />
                  </StmtKeyRow>
                </tbody>
              </table>
            </ReportTableWrap>
          </ReportCard>
        );
      })()}
    </OceanReport>
  );
}
