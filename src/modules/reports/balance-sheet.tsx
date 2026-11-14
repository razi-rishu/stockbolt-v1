import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { useComparativePeriods } from '@/hooks/use-comparative-periods';
import { CompareToggle } from '@/ui/compare-toggle';
import { mergeComparativeBalanceSheet, formatVariancePct, makeValue } from '@/lib/comparative';
import { OceanReport, ReportCard, ReportTableWrap, ReportMessage, Num, ltr } from '@/components/ocean-report';
import { ComparativeHead, ComparativeSection, ComparativeAccountRow, VarianceCells } from './_shared/variance';
import { Amount, StmtAccount, StmtBanner, StmtEmpty, StmtKeyRow, StmtSection, StmtSubtotal, fmtParen } from './_shared/statement';
import type { BalanceSheetLine, ControlAccountContactLine, Company } from '@/data/adapter';
import { CONTROL_ACCOUNTS } from './_shared/control-account-drilldown';

/**
 * Per-contact drill-down adapted for the 2-column Balance Sheet shape
 * (label, balance). Same data source as the shared component used by TB,
 * but renders into the narrower BS table.
 */
function BalanceSheetDrillDown({
  companyId, accountCode, asOfDate,
}: { companyId: string; accountCode: string; asOfDate: string }) {
  const { t } = useTranslation();
  const { data, isFetching } = useQuery<ControlAccountContactLine[]>({
    queryKey: ['control_account_breakdown', companyId, accountCode, asOfDate],
    queryFn: () => getAdapter().reports.getControlAccountByContact(companyId, accountCode, asOfDate),
  });

  if (isFetching) {
    return <tr className="sb-rpt-drill"><td colSpan={2} className="indent">{t('rptOcean.drill_loading')}</td></tr>;
  }
  if (!data || data.length === 0) {
    return <tr className="sb-rpt-drill"><td colSpan={2} className="indent">{t('rptOcean.drill_none')}</td></tr>;
  }
  return (
    <>
      <tr className="sb-rpt-drill sb-rpt-drill-head">
        <td colSpan={2} className="indent">{t('rptOcean.drill_head', { count: data.length })}</td>
      </tr>
      {data.map((line) => (
        <tr key={`bs-drill-${accountCode}-${line.contact_id ?? 'none'}`} className="sb-rpt-drill">
          <td className="indent">↳ {line.contact_id ? line.contact_name : t('rptOcean.drill_no_contact', { defaultValue: line.contact_name })}</td>
          <td className="num"><Num>{fmtParen(line.balance)}</Num></td>
        </tr>
      ))}
    </>
  );
}

/**
 * Drill-down-aware Balance Sheet row.
 * - Control accounts (1200, 2400, …): row click toggles per-contact breakdown;
 *   clicking the code navigates to GL ledger.
 * - Leaf accounts: whole row click navigates to GL ledger.
 */
function BSRow({
  line, companyId, asOfDate, expanded, onToggle, onNavigate,
}: {
  line: BalanceSheetLine;
  companyId: string;
  asOfDate: string;
  expanded: boolean;
  onToggle: () => void;
  onNavigate?: (code: string) => void;
}) {
  const isControl = CONTROL_ACCOUNTS.has(line.account_code);
  return (
    <>
      <StmtAccount
        code={line.account_code} name={line.account_name}
        onOpen={onNavigate} onToggle={isControl ? onToggle : undefined} expanded={expanded}
      >
        <Amount>{fmtParen(line.balance)}</Amount>
      </StmtAccount>
      {isControl && expanded && (
        <BalanceSheetDrillDown companyId={companyId} accountCode={line.account_code} asOfDate={asOfDate} />
      )}
    </>
  );
}

function SubSection({
  title, lines, total, totalLabel, emptyText, companyId, asOfDate, expanded, onToggle, onNavigate,
}: {
  title: string;
  lines: BalanceSheetLine[];
  total: number;
  totalLabel: string;
  emptyText: string;
  companyId: string;
  asOfDate: string;
  expanded: Set<string>;
  onToggle: (code: string) => void;
  onNavigate?: (code: string) => void;
}) {
  return (
    <StmtSection
      title={title} cols={2} collapsedValue={fmtParen(total)}
      footer={<StmtSubtotal label={totalLabel}><Amount>{fmtParen(total)}</Amount></StmtSubtotal>}
    >
      {lines.length === 0 ? <StmtEmpty label={emptyText} cols={2} /> : lines.map(l => (
        <BSRow
          key={l.account_code} line={l} companyId={companyId} asOfDate={asOfDate}
          expanded={expanded.has(l.account_code)} onToggle={() => onToggle(l.account_code)} onNavigate={onNavigate}
        />
      ))}
    </StmtSection>
  );
}

export default function BalanceSheetPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  // Phase 46b — as-of period picker (only `.to` matters). Auto-runs on preset.
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.balance-sheet.period', 'this_month');
  const asOf = to;
  // Phase 12.24 — same per-contact drill-down pattern as TB.
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(new Set());

  // AC-2B — company (fiscal-aware Year comparison) + comparison controls.
  const { data: company } = useQuery<Company | null>({
    queryKey: ['company', company_id],
    queryFn: () => getAdapter().companies.getById(company_id!),
    enabled: !!company_id,
  });
  const cmp = useComparativePeriods({
    storageKey: 'stockbolt.report.balance-sheet.compare',
    preset, current: { from, to },
    fiscalYearStart: company?.fiscal_year_start ?? null,
  });

  function toggleExpand(code: string) {
    setExpandedCodes(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  }

  function openLedger(code: string) {
    const yearStart = asOf.slice(0, 4) + '-01-01';
    navigate(`/accounting/general-ledger?code=${encodeURIComponent(code)}&from=${yearStart}&to=${asOf}`);
  }

  const { data: bs, isLoading, error } = useQuery({
    queryKey: ['balance_sheet', company_id, asOf],
    queryFn: () => getAdapter().reports.getBalanceSheet(company_id!, asOf),
    enabled: !!company_id,
  });

  // Previous as-of query (only while comparing). Reuses the same adapter method.
  const { data: bsPrev } = useQuery({
    queryKey: ['balance_sheet', company_id, cmp.asOf.previous],
    queryFn: () => getAdapter().reports.getBalanceSheet(company_id!, cmp.asOf.previous),
    enabled: !!company_id && cmp.compareOn,
  });
  const comparative = cmp.compareOn && bs && bsPrev ? mergeComparativeBalanceSheet(bs, bsPrev) : null;

  const balanced = bs ? Math.abs(bs.total_assets - bs.total_liabilities - bs.total_equity) < 0.02 : true;

  // Section and column names (screen and Excel share them, in the screen language).
  const S = {
    curAssets: t('rptOcean.bs_current_assets'), fixedAssets: t('rptOcean.bs_fixed_assets'),
    curLiab: t('rptOcean.bs_current_liab'), ltLiab: t('rptOcean.bs_lt_liab'), equity: t('rptOcean.type_equity'),
  };
  const H = {
    section: t('rptOcean.col_section'), code: t('rptOcean.col_code'), account: t('rptOcean.col_account'),
    balance: t('rptOcean.col_balance'), current: t('rptOcean.col_current'), previous: t('rptOcean.col_previous'),
    variance: t('rptOcean.col_variance'), varPct: t('rptOcean.col_variance_pct'),
  };
  const secOf = (l: { account_type: string; sub_type?: string | null }) =>
    l.account_type === 'asset' ? (l.sub_type === 'fixed' ? S.fixedAssets : S.curAssets)
    : l.account_type === 'liability' ? (l.sub_type === 'long_term' ? S.ltLiab : S.curLiab)
    : S.equity;
  const exportRows: Record<string, unknown>[] = (bs?.lines ?? []).map((l: BalanceSheetLine) => ({
    [H.section]: secOf(l), [H.code]: l.account_code, [H.account]: l.account_name, [H.balance]: l.balance.toFixed(2),
  }));
  const exportHeaders = [H.section, H.code, H.account, H.balance];

  // Comparative export overrides the single-period rows while compare is on.
  let finalRows = exportRows;
  let finalHeaders = exportHeaders;
  let exportName = `balance-sheet-${asOf}`;
  if (comparative) {
    finalRows = comparative.lines.map((l) => ({
      [H.section]: secOf(l), [H.code]: l.account_code, [H.account]: l.account_name,
      [H.current]: l.current.toFixed(2), [H.previous]: l.previous.toFixed(2),
      [H.variance]: l.variance.toFixed(2), [H.varPct]: formatVariancePct(l.current, l.previous),
    }));
    finalHeaders = [H.section, H.code, H.account, H.current, H.previous, H.variance, H.varPct];
    exportName = `balance-sheet-comparative-${asOf}`;
  }

  const subtitle = cmp.compareOn
    ? t('rptOcean.as_of_vs', { date: ltr(asOf), prev: ltr(cmp.asOf.previous) })
    : t('rptOcean.as_of_date', { date: ltr(asOf) });

  return (
    <OceanReport
      testid="balance-sheet-ocean"
      title={t('reports.bs_title')}
      subtitle={subtitle}
      controls={<>
        <PeriodPicker
          mode="asOf" preset={preset} from={from} to={to}
          onPresetChange={(p) => { setPreset(p); setExpandedCodes(new Set()); }}
          onCustomRange={(f, tt) => { setCustomRange(f, tt); setExpandedCodes(new Set()); }}
        />
        <CompareToggle on={cmp.compareOn} basis={cmp.basis} onToggle={cmp.setCompareOn} onBasis={cmp.setBasis} />
        <ReportActions rows={finalRows} headers={finalHeaders} filename={exportName} disabled={cmp.compareOn ? !comparative : !bs} />
      </>}
    >
      {(isLoading || (cmp.compareOn && bs && !comparative && !error)) && (
        <ReportCard><ReportMessage>{t('common.loading')}</ReportMessage></ReportCard>
      )}
      {error && <ReportCard><ReportMessage tone="bad">{String(error)}</ReportMessage></ReportCard>}

      {!cmp.compareOn && bs && company_id && (() => {
        // NULL sub_type defaults to 'current' — matches the adapter logic.
        const isCurrentAsset = (l: BalanceSheetLine) => l.account_type === 'asset' && l.sub_type !== 'fixed';
        const isFixedAsset   = (l: BalanceSheetLine) => l.account_type === 'asset' && l.sub_type === 'fixed';
        const isCurrentLiab  = (l: BalanceSheetLine) => l.account_type === 'liability' && l.sub_type !== 'long_term';
        const isLongTermLiab = (l: BalanceSheetLine) => l.account_type === 'liability' && l.sub_type === 'long_term';

        const currentAssetLines    = bs.lines.filter(isCurrentAsset);
        const fixedAssetLines      = bs.lines.filter(isFixedAsset);
        const currentLiabLines     = bs.lines.filter(isCurrentLiab);
        const longTermLiabLines    = bs.lines.filter(isLongTermLiab);
        const equityLines          = bs.lines.filter(l => l.account_type === 'equity');
        const shared = { companyId: company_id, asOfDate: asOf, expanded: expandedCodes, onToggle: toggleExpand, onNavigate: openLedger };

        return (
          <ReportCard
            figures={[
              { label: t('reports.total_assets'), value: <Num>{fmtParen(bs.total_assets)}</Num>, tone: 'brand' },
              { label: t('reports.total_liabilities'), value: <Num>{fmtParen(bs.total_liabilities)}</Num> },
              { label: t('reports.total_equity'), value: <Num>{fmtParen(bs.total_equity)}</Num> },
              {
                label: t('rptOcean.bs_working_capital'),
                value: <Num>{fmtParen(bs.working_capital)}</Num>,
                note: t('rptOcean.bs_wc_formula'),
                tone: bs.working_capital < 0 ? 'bad' : 'good',
              },
            ]}
            hint={t('rptOcean.bs_hint')}
          >
            {!balanced && (
              <p className="sb-rpt-warn"><AlertTriangle size={15} aria-hidden="true" /> {t('reports.unbalanced_warning')}</p>
            )}
            {bs.working_capital < 0 && (
              <p className="sb-rpt-warn is-soft"><AlertTriangle size={15} aria-hidden="true" /> {t('rptOcean.bs_wc_negative')}</p>
            )}
            <ReportTableWrap>
              <table className="sb-rpt-table sb-rpt-stmt">
                <tbody>
                  {/* ── ASSETS ── */}
                  <StmtBanner label={t('rptOcean.type_asset')} tone="brand" cols={2} />
                  <SubSection title={S.curAssets} lines={currentAssetLines} total={bs.current_assets}
                    totalLabel={t('rptOcean.bs_total_current_assets')} emptyText={t('rptOcean.bs_no_current_assets')} {...shared} />
                  <SubSection title={S.fixedAssets} lines={fixedAssetLines} total={bs.fixed_assets}
                    totalLabel={t('rptOcean.bs_total_fixed_assets')} emptyText={t('rptOcean.bs_no_fixed_assets')} {...shared} />
                  <StmtKeyRow label={t('reports.total_assets')} tone="brand" big>
                    <Amount>{fmtParen(bs.total_assets)}</Amount>
                  </StmtKeyRow>

                  {/* ── LIABILITIES ── */}
                  <StmtBanner label={t('rptOcean.type_liability')} tone="bad" cols={2} />
                  <SubSection title={S.curLiab} lines={currentLiabLines} total={bs.current_liabilities}
                    totalLabel={t('rptOcean.bs_total_current_liab')} emptyText={t('rptOcean.bs_no_current_liab')} {...shared} />
                  <SubSection title={S.ltLiab} lines={longTermLiabLines} total={bs.long_term_liabilities}
                    totalLabel={t('rptOcean.bs_total_lt_liab')} emptyText={t('rptOcean.bs_no_lt_liab')} {...shared} />
                  <StmtKeyRow label={t('reports.total_liabilities')} tone="bad" big>
                    <Amount>{fmtParen(bs.total_liabilities)}</Amount>
                  </StmtKeyRow>

                  {/* ── EQUITY ── */}
                  <StmtBanner label={t('rptOcean.type_equity')} tone="ink" cols={2} />
                  {equityLines.length === 0 ? <StmtEmpty label={t('rptOcean.bs_no_equity')} cols={2} /> : equityLines.map(l => (
                    <BSRow
                      key={l.account_code} line={l} companyId={company_id} asOfDate={asOf}
                      expanded={expandedCodes.has(l.account_code)} onToggle={() => toggleExpand(l.account_code)} onNavigate={openLedger}
                    />
                  ))}
                  <StmtKeyRow label={t('reports.total_equity')} tone="ink" big>
                    <Amount>{fmtParen(bs.total_equity)}</Amount>
                  </StmtKeyRow>

                  {/* ── Liabilities + Equity grand total (must equal Assets) ── */}
                  <StmtKeyRow label={t('rptOcean.bs_total_le')} tone={balanced ? 'good' : 'bad'} big>
                    <Amount>{fmtParen(bs.total_liabilities + bs.total_equity)}</Amount>
                  </StmtKeyRow>
                </tbody>
              </table>
            </ReportTableWrap>
          </ReportCard>
        );
      })()}

      {comparative && company_id && (() => {
        const c = comparative;
        const curAssets = c.lines.filter(l => l.account_type === 'asset' && l.sub_type !== 'fixed');
        const fixedAssets = c.lines.filter(l => l.account_type === 'asset' && l.sub_type === 'fixed');
        const curLiab = c.lines.filter(l => l.account_type === 'liability' && l.sub_type !== 'long_term');
        const ltLiab = c.lines.filter(l => l.account_type === 'liability' && l.sub_type === 'long_term');
        const equity = c.lines.filter(l => l.account_type === 'equity');
        const rows = (ls: typeof c.lines) => ls.map(l => (
          <ComparativeAccountRow key={l.account_code} code={l.account_code} name={l.account_name} v={l} onNavigate={openLedger} />
        ));
        const empty = (label: string) => <StmtEmpty label={label} cols={5} />;
        const leValue = makeValue(c.total_liabilities.current + c.total_equity.current, c.total_liabilities.previous + c.total_equity.previous);
        return (
          <ReportCard title={t('rptOcean.comparative_title', { title: t('reports.bs_title') })} meta={subtitle} hint={t('rptOcean.stmt_hint')}>
            <ReportTableWrap>
              <table className="sb-rpt-table sb-rpt-stmt" style={{ minWidth: 760 }}>
                <ComparativeHead firstLabel={H.account} />
                <tbody>
                  <StmtBanner label={t('rptOcean.type_asset')} tone="brand" cols={5} />
                  <ComparativeSection title={S.curAssets} total={c.current_assets} totalLabel={t('rptOcean.bs_total_current_assets')}>
                    {curAssets.length ? rows(curAssets) : empty(t('rptOcean.bs_no_current_assets'))}
                  </ComparativeSection>
                  <ComparativeSection title={S.fixedAssets} total={c.fixed_assets} totalLabel={t('rptOcean.bs_total_fixed_assets')}>
                    {fixedAssets.length ? rows(fixedAssets) : empty(t('rptOcean.bs_no_fixed_assets'))}
                  </ComparativeSection>
                  <StmtKeyRow label={t('reports.total_assets')} tone="brand" big><VarianceCells v={c.total_assets} emphasize /></StmtKeyRow>
                  <StmtBanner label={t('rptOcean.type_liability')} tone="bad" cols={5} />
                  <ComparativeSection title={S.curLiab} total={c.current_liabilities} totalLabel={t('rptOcean.bs_total_current_liab')}>
                    {curLiab.length ? rows(curLiab) : empty(t('rptOcean.bs_no_current_liab'))}
                  </ComparativeSection>
                  <ComparativeSection title={S.ltLiab} total={c.long_term_liabilities} totalLabel={t('rptOcean.bs_total_lt_liab')}>
                    {ltLiab.length ? rows(ltLiab) : empty(t('rptOcean.bs_no_lt_liab'))}
                  </ComparativeSection>
                  <StmtKeyRow label={t('reports.total_liabilities')} tone="bad" big><VarianceCells v={c.total_liabilities} emphasize /></StmtKeyRow>
                  <StmtBanner label={t('rptOcean.type_equity')} tone="ink" cols={5} />
                  {equity.length ? rows(equity) : empty(t('rptOcean.bs_no_equity'))}
                  <StmtKeyRow label={t('reports.total_equity')} tone="ink" big><VarianceCells v={c.total_equity} emphasize /></StmtKeyRow>
                  <StmtKeyRow label={t('rptOcean.bs_total_le')} tone="ink" big><VarianceCells v={leValue} emphasize /></StmtKeyRow>
                </tbody>
              </table>
            </ReportTableWrap>
          </ReportCard>
        );
      })()}
    </OceanReport>
  );
}
