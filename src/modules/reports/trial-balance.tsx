import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { useComparativePeriods } from '@/hooks/use-comparative-periods';
import { CompareToggle } from '@/ui/compare-toggle';
import { mergeComparativeTrialBalance } from '@/lib/comparative';
import type { TrialBalance, TrialBalanceLine, Company } from '@/data/adapter';
import { OceanReport, ReportCard, ReportTableWrap, ReportMessage, Num, ltr } from '@/components/ocean-report';
import { ControlAccountDrillDown, CONTROL_ACCOUNTS } from './_shared/control-account-drilldown';

function fmtVar(n: number): string {
  return n < 0 ? `(${fmt(-n)})` : fmt(n);
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// DB type values per CHECK constraint: ('asset','liability','equity','income','expense').
// 'revenue' is kept as an alias so legacy/test data using the old label still renders.
const TYPE_ORDER = ['asset', 'liability', 'equity', 'income', 'revenue', 'expense'];

export default function TrialBalancePage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();

  // Phase 46b — as-of period picker (only `.to` matters). Auto-runs on preset.
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.trial-balance.period', 'this_month');
  const asOf = to;
  // Phase 12.24 — set of account codes whose per-contact drill-down is open.
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(new Set());

  // AC-2B — company (fiscal-aware Year comparison) + comparison controls.
  const { data: company } = useQuery<Company | null>({
    queryKey: ['company', company_id],
    queryFn: () => getAdapter().companies.getById(company_id!),
    enabled: !!company_id,
  });
  const cmp = useComparativePeriods({
    storageKey: 'stockbolt.report.trial-balance.compare',
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

  // Drill-down: clicking the account code opens the General Ledger for that
  // account. Clicking the rest of the row expands the per-contact view.
  function openLedgerForAccount(code: string) {
    const yearStart = asOf.slice(0, 4) + '-01-01';
    navigate(`/accounting/general-ledger?code=${encodeURIComponent(code)}&from=${yearStart}&to=${asOf}`);
  }

  const { data, isFetching } = useQuery<TrialBalance>({
    queryKey: ['trial_balance', company_id, asOf],
    queryFn: () => getAdapter().accounting.getTrialBalance(company_id!, asOf),
    enabled: !!company_id,
  });

  // Previous as-of query (only while comparing). Reuses the same adapter method.
  const { data: dataPrev } = useQuery<TrialBalance>({
    queryKey: ['trial_balance', company_id, cmp.asOf.previous],
    queryFn: () => getAdapter().accounting.getTrialBalance(company_id!, cmp.asOf.previous),
    enabled: !!company_id && cmp.compareOn,
  });
  const comparative = cmp.compareOn && data && dataPrev ? mergeComparativeTrialBalance(data, dataPrev) : null;

  // Group lines by account type
  const grouped: Record<string, TrialBalanceLine[]> = {};
  for (const line of data?.lines ?? []) {
    if (!grouped[line.account_type]) grouped[line.account_type] = [];
    grouped[line.account_type].push(line);
  }
  const types = TYPE_ORDER.filter((t2) => grouped[t2]?.length > 0);

  const isBalanced = data ? Math.abs(data.total_debit - data.total_credit) <= 0.01 : true;
  const typeLabel = (type: string) => t(`rptOcean.type_${type}`, { defaultValue: type });

  // Excel columns follow the screen language.
  const H = {
    code: t('rptOcean.col_code'), account: t('rptOcean.col_account'), type: t('rptOcean.col_type'),
    debit: t('rptOcean.col_debit'), credit: t('rptOcean.col_credit'),
    curDr: t('rptOcean.col_current_dr'), curCr: t('rptOcean.col_current_cr'),
    prevDr: t('rptOcean.col_previous_dr'), prevCr: t('rptOcean.col_previous_cr'),
    diff: t('rptOcean.col_difference'),
  };
  const exportRows: Record<string, unknown>[] = (data?.lines ?? []).map(l => ({
    [H.code]: l.account_code,
    [H.account]: l.account_name,
    [H.type]: typeLabel(l.account_type),
    [H.debit]: (l.debit ?? 0).toFixed(2),
    [H.credit]: (l.credit ?? 0).toFixed(2),
  }));
  const exportHeaders = [H.code, H.account, H.type, H.debit, H.credit];

  // Comparative export overrides the single-period rows while compare is on.
  let finalRows = exportRows;
  let finalHeaders = exportHeaders;
  let exportName = `trial-balance-${asOf}`;
  if (comparative) {
    finalRows = comparative.lines.map((l) => ({
      [H.code]: l.account_code, [H.account]: l.account_name, [H.type]: typeLabel(l.account_type),
      [H.curDr]: l.current_debit.toFixed(2), [H.curCr]: l.current_credit.toFixed(2),
      [H.prevDr]: l.previous_debit.toFixed(2), [H.prevCr]: l.previous_credit.toFixed(2),
      [H.diff]: l.difference.toFixed(2),
    }));
    finalHeaders = [H.code, H.account, H.type, H.curDr, H.curCr, H.prevDr, H.prevCr, H.diff];
    exportName = `trial-balance-comparative-${asOf}`;
  }

  const subtitle = cmp.compareOn
    ? t('rptOcean.as_of_vs', { date: ltr(asOf), prev: ltr(cmp.asOf.previous) })
    : (data ? t('rptOcean.as_of_date', { date: ltr(data.as_of_date) }) : undefined);

  return (
    <OceanReport
      testid="trial-balance-ocean"
      title={t('reports.trial_balance')}
      subtitle={subtitle}
      controls={<>
        <PeriodPicker
          mode="asOf" preset={preset} from={from} to={to}
          onPresetChange={(p) => { setPreset(p); setExpandedCodes(new Set()); }}
          onCustomRange={(f, tt) => { setCustomRange(f, tt); setExpandedCodes(new Set()); }}
        />
        <CompareToggle on={cmp.compareOn} basis={cmp.basis} onToggle={cmp.setCompareOn} onBasis={cmp.setBasis} />
        <ReportActions rows={finalRows} headers={finalHeaders} filename={exportName} disabled={cmp.compareOn ? !comparative : !data} />
      </>}
    >
      {(isFetching || (cmp.compareOn && data && !comparative)) && (
        <ReportCard><ReportMessage>{t('common.loading')}</ReportMessage></ReportCard>
      )}

      {!cmp.compareOn && data && !isFetching && (
        <ReportCard
          figures={data.lines.length > 0 ? [
            { label: t('rptOcean.total_debit'), value: <Num>{fmt(data.total_debit)}</Num> },
            { label: t('rptOcean.total_credit'), value: <Num>{fmt(data.total_credit)}</Num> },
            {
              label: t('rptOcean.difference'),
              value: <Num>{fmt(Math.abs(data.total_debit - data.total_credit))}</Num>,
              note: isBalanced ? t('rptOcean.balanced') : t('rptOcean.not_balanced'),
              tone: isBalanced ? 'good' : 'bad',
            },
            { label: t('rptOcean.accounts'), value: <Num>{data.lines.length}</Num> },
          ] : undefined}
          hint={data.lines.length > 0 ? t('rptOcean.tb_hint') : undefined}
        >
          {data.lines.length === 0 ? (
            <ReportMessage>{t('reports.tb_empty')}</ReportMessage>
          ) : (
            <ReportTableWrap>
              <table className="sb-rpt-table">
                <thead>
                  <tr>
                    <th>{t('rptOcean.col_code')}</th>
                    <th>{t('rptOcean.col_account')}</th>
                    <th className="hide-sm">{t('rptOcean.col_type')}</th>
                    <th className="num">{t('rptOcean.col_debit')}</th>
                    <th className="num">{t('rptOcean.col_credit')}</th>
                  </tr>
                </thead>
                <tbody>
                  {types.map((type) => (
                    <Fragment key={type}>
                      <tr className="sb-rpt-section"><td colSpan={5}>{typeLabel(type)}</td></tr>
                      {grouped[type].map((line) => {
                        const isControl = CONTROL_ACCOUNTS.has(line.account_code);
                        const isExpanded = expandedCodes.has(line.account_code);
                        return (
                          <Fragment key={line.account_code}>
                            <tr
                              onClick={() => isControl ? toggleExpand(line.account_code) : openLedgerForAccount(line.account_code)}
                              className={`is-click ${isExpanded ? 'is-open' : ''}`}
                              title={isControl ? t('rptOcean.tb_row_expand') : t('rptOcean.tb_row_open')}
                            >
                              <td>
                                <button
                                  type="button" className="code"
                                  onClick={(e) => { e.stopPropagation(); openLedgerForAccount(line.account_code); }}
                                  title={t('rptOcean.tb_row_open')}
                                >
                                  {isControl && <span className="chev"><ChevronRight size={13} aria-hidden="true" /></span>}
                                  {line.account_code}
                                </button>
                              </td>
                              <td>{line.account_name}</td>
                              <td className="muted hide-sm">{typeLabel(line.account_type)}</td>
                              <td className="num"><Num>{line.debit > 0 ? fmt(line.debit) : ''}</Num></td>
                              <td className="num"><Num>{line.credit > 0 ? fmt(line.credit) : ''}</Num></td>
                            </tr>
                            {isControl && isExpanded && company_id && (
                              <ControlAccountDrillDown
                                companyId={company_id}
                                accountCode={line.account_code}
                                asOfDate={asOf}
                                colSpan={5}
                                labelColSpan={2}
                              />
                            )}
                          </Fragment>
                        );
                      })}
                    </Fragment>
                  ))}
                </tbody>
                <tfoot>
                  <tr className={`sb-rpt-total ${isBalanced ? '' : 'is-bad'}`}>
                    <td colSpan={2}>{t('rptOcean.total')}</td>
                    <td className="hide-sm" />
                    <td className="num"><Num>{fmt(data.total_debit)}</Num></td>
                    <td className="num"><Num>{fmt(data.total_credit)}</Num></td>
                  </tr>
                </tfoot>
              </table>
            </ReportTableWrap>
          )}
          {data.lines.length > 0 && !isBalanced && (
            <p className="sb-rpt-warn"><AlertTriangle size={15} aria-hidden="true" /> {t('reports.tb_unbalanced')}</p>
          )}
        </ReportCard>
      )}

      {comparative && (() => {
        const c = comparative;
        const grouped: Record<string, typeof c.lines> = {};
        for (const l of c.lines) { (grouped[l.account_type] ||= []).push(l); }
        const types = TYPE_ORDER.filter((t2) => grouped[t2]?.length > 0);
        const curBal = Math.abs(c.total_debit.current - c.total_credit.current) <= 0.01;
        const prevBal = Math.abs(c.total_debit.previous - c.total_credit.previous) <= 0.01;
        const num = (n: number, muted?: boolean) => (
          <td className={`num ${muted ? 'muted' : ''}`}><Num>{n > 0 ? fmt(n) : ''}</Num></td>
        );
        return (
          <ReportCard
            title={t('rptOcean.tb_comparative')}
            meta={t('rptOcean.as_of_vs', { date: ltr(asOf), prev: ltr(cmp.asOf.previous) })}
          >
            <ReportTableWrap>
              <table className="sb-rpt-table" style={{ minWidth: 860 }}>
                <thead>
                  <tr>
                    <th>{H.code}</th><th>{H.account}</th><th>{H.type}</th>
                    <th className="num">{H.curDr}</th><th className="num">{H.curCr}</th>
                    <th className="num">{H.prevDr}</th><th className="num">{H.prevCr}</th>
                    <th className="num">{H.diff}</th>
                  </tr>
                </thead>
                <tbody>
                  {types.map((type) => (
                    <Fragment key={type}>
                      <tr className="sb-rpt-section"><td colSpan={8}>{typeLabel(type)}</td></tr>
                      {grouped[type].map((l) => (
                        <tr key={l.account_code}>
                          <td><span className="code">{l.account_code}</span></td>
                          <td>{l.account_name}</td>
                          <td className="muted">{typeLabel(l.account_type)}</td>
                          {num(l.current_debit)}{num(l.current_credit)}
                          {num(l.previous_debit, true)}{num(l.previous_credit, true)}
                          <td className={`num ${Math.abs(l.difference) < 0.005 ? 'muted' : (l.difference < 0 ? 'is-down' : 'is-up')}`}>
                            <Num>{Math.abs(l.difference) < 0.005 ? '—' : fmtVar(l.difference)}</Num>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
                <tfoot>
                  <tr className={`sb-rpt-total ${curBal && prevBal ? '' : 'is-bad'}`}>
                    <td colSpan={3}>{t('rptOcean.total')}</td>
                    <td className="num"><Num>{fmt(c.total_debit.current)}</Num></td>
                    <td className="num"><Num>{fmt(c.total_credit.current)}</Num></td>
                    <td className="num"><Num>{fmt(c.total_debit.previous)}</Num></td>
                    <td className="num"><Num>{fmt(c.total_credit.previous)}</Num></td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </ReportTableWrap>
          </ReportCard>
        );
      })()}
    </OceanReport>
  );
}
