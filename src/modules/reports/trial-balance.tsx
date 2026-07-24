import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { ReportActions } from '@/ui/report-actions';
import { useComparativePeriods } from '@/hooks/use-comparative-periods';
import { CompareToggle } from '@/ui/compare-toggle';
import { mergeComparativeTrialBalance } from '@/lib/comparative';
import type { TrialBalance, TrialBalanceLine, Company } from '@/data/adapter';
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
    fiscalYearStart: (company as any)?.fiscal_year_start ?? null,
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

  const exportRows: Record<string, unknown>[] = (data?.lines ?? []).map(l => ({
    Code: l.account_code,
    Account: l.account_name,
    Type: l.account_type,
    Debit: (l.debit ?? 0).toFixed(2),
    Credit: (l.credit ?? 0).toFixed(2),
  }));
  const exportHeaders = ['Code', 'Account', 'Type', 'Debit', 'Credit'];

  // Comparative export overrides the single-period rows while compare is on.
  let finalRows = exportRows;
  let finalHeaders = exportHeaders;
  let exportName = `trial-balance-${asOf}`;
  if (comparative) {
    finalRows = comparative.lines.map((l) => ({
      Code: l.account_code, Account: l.account_name, Type: l.account_type,
      'Current Dr': l.current_debit.toFixed(2), 'Current Cr': l.current_credit.toFixed(2),
      'Previous Dr': l.previous_debit.toFixed(2), 'Previous Cr': l.previous_credit.toFixed(2),
      Difference: l.difference.toFixed(2),
    }));
    finalHeaders = ['Code', 'Account', 'Type', 'Current Dr', 'Current Cr', 'Previous Dr', 'Previous Cr', 'Difference'];
    exportName = `trial-balance-comparative-${asOf}`;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title={t('reports.trial_balance')}
        subtitle={cmp.compareOn ? `As of ${asOf}  ·  vs  ${cmp.asOf.previous}` : (data ? `As of ${data.as_of_date}` : '')}
        actions={
          <div data-print-hide style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <PeriodPicker
              mode="asOf" preset={preset} from={from} to={to}
              onPresetChange={(p) => { setPreset(p); setExpandedCodes(new Set()); }}
              onCustomRange={(f, tt) => { setCustomRange(f, tt); setExpandedCodes(new Set()); }}
            />
            <CompareToggle on={cmp.compareOn} basis={cmp.basis} onToggle={cmp.setCompareOn} onBasis={cmp.setBasis} />
            <ReportActions rows={finalRows} headers={finalHeaders} filename={exportName} disabled={cmp.compareOn ? !comparative : !data} />
          </div>
        }
      />

      {isFetching && <p style={{ fontSize: '13px', color: theme.inkMuted, padding: '24px 0', textAlign: 'center' }}>{t('common.loading')}</p>}

      {cmp.compareOn && data && !comparative && !isFetching && (
        <p style={{ fontSize: '13px', color: theme.inkMuted, padding: '24px 0', textAlign: 'center' }}>{t('common.loading')}</p>
      )}

      {!cmp.compareOn && data && !isFetching && (
        <div style={{
          background: theme.card,
          border: `1px solid ${theme.border}`,
          borderRadius: '12px',
          boxShadow: theme.shadowSm,
          overflow: 'hidden',
        }}>
          <div style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}`, padding: '12px 16px' }}>
            <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: theme.ink, letterSpacing: '-.01em' }}>{t('reports.trial_balance')}</p>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: theme.inkMuted }}>{t('reports.as_of')} {data.as_of_date}</p>
            <p style={{ margin: '6px 0 0', fontSize: '11px', color: theme.inkFaint }}>
              Tip: click a control account row (1200, 2100, 2400, …) to see the per-contact breakdown.
              Click the account code to drill into the General Ledger.
            </p>
          </div>

          {data.lines.length === 0 ? (
            <p style={{ padding: '24px 16px', fontSize: '13px', color: theme.inkFaint }}>{t('reports.tb_empty')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}` }}>
                  {[
                    { l: t('accounting.code'),         a: 'start' as const },
                    { l: t('accounting.account_name'), a: 'start' as const },
                    { l: t('accounting.type'),         a: 'start' as const },
                    { l: t('accounting.debit'),        a: 'end'   as const },
                    { l: t('accounting.credit'),       a: 'end'   as const },
                  ].map(c => (
                    <th
                      key={c.l}
                      className="px-4 py-3"
                      style={{
                        fontSize: '11px', fontWeight: 600, color: theme.inkMuted,
                        textTransform: 'uppercase', letterSpacing: '.06em',
                        textAlign: c.a, whiteSpace: 'nowrap',
                      }}
                    >{c.l}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {types.map((type) => (
                  <>
                    <tr key={`hdr-${type}`}>
                      <td
                        colSpan={5}
                        className="px-4 py-2"
                        style={{
                          background: '#f1f5f9',
                          fontSize: '11px', fontWeight: 700,
                          color: theme.inkMuted,
                          textTransform: 'uppercase', letterSpacing: '.08em',
                        }}
                      >
                        {t(`accounting.type_${type}`)}
                      </td>
                    </tr>
                    {grouped[type].map((line) => {
                      const isControl = CONTROL_ACCOUNTS.has(line.account_code);
                      const isExpanded = expandedCodes.has(line.account_code);
                      return (
                        <>
                          <tr
                            key={line.account_code}
                            onClick={() => isControl ? toggleExpand(line.account_code) : openLedgerForAccount(line.account_code)}
                            className="cursor-pointer"
                            style={{
                              borderTop: '1px solid #f1f5f9',
                              background: isExpanded ? theme.panelHead : undefined,
                              transition: 'background-color .12s',
                            }}
                            title={isControl ? 'Click to expand per-contact breakdown · click the code to open General Ledger' : 'Open this account in General Ledger'}
                            onMouseEnter={(e) => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = theme.panelHead; }}
                            onMouseLeave={(e) => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = ''; }}
                          >
                            <td
                              className="px-4 py-2.5 font-mono cursor-pointer"
                              style={{ fontSize: '12px', color: theme.brandSoftText, fontWeight: 600 }}
                              onClick={(e) => { e.stopPropagation(); openLedgerForAccount(line.account_code); }}
                            >
                              {isControl && (
                                <span style={{ display: 'inline-block', width: '12px', color: theme.inkFaint, marginInlineEnd: '4px' }}>
                                  {isExpanded ? '▾' : '▸'}
                                </span>
                              )}
                              {line.account_code}
                            </td>
                            <td className="px-4 py-2.5" style={{ color: theme.ink, fontSize: '13px' }}>{line.account_name}</td>
                            <td className="px-4 py-2.5" style={{ color: theme.inkMuted, fontSize: '13px', textTransform: 'capitalize' }}>{line.account_type}</td>
                            <td className="px-4 py-2.5 font-mono" style={{ textAlign: 'end', color: theme.ink }}>{line.debit > 0 ? fmt(line.debit) : ''}</td>
                            <td className="px-4 py-2.5 font-mono" style={{ textAlign: 'end', color: theme.ink }}>{line.credit > 0 ? fmt(line.credit) : ''}</td>
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
                        </>
                      );
                    })}
                  </>
                ))}
              </tbody>
              <tfoot>
                <tr style={{
                  borderTop: `2px solid ${isBalanced ? '#bbf7d0' : '#fecaca'}`,
                  background: isBalanced ? '#f0fdf4' : '#fef2f2',
                  fontWeight: 700,
                }}>
                  <td colSpan={3} className="px-4 py-3" style={{ color: theme.ink, fontSize: '13px' }}>{t('accounting.total')}</td>
                  <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', color: isBalanced ? '#15803d' : '#dc2626' }}>{fmt(data.total_debit)}</td>
                  <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', color: isBalanced ? '#15803d' : '#dc2626' }}>{fmt(data.total_credit)}</td>
                </tr>
                {!isBalanced && (
                  <tr>
                    <td colSpan={5} className="px-4 py-2" style={{ fontSize: '11px', color: '#dc2626' }}>
                      ⚠ {t('reports.tb_unbalanced')}
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          )}
        </div>
      )}

      {comparative && (() => {
        const c = comparative;
        const grouped: Record<string, typeof c.lines> = {};
        for (const l of c.lines) { (grouped[l.account_type] ||= []).push(l); }
        const types = TYPE_ORDER.filter((t2) => grouped[t2]?.length > 0);
        const curBal = Math.abs(c.total_debit.current - c.total_credit.current) <= 0.01;
        const prevBal = Math.abs(c.total_debit.previous - c.total_credit.previous) <= 0.01;
        const th = (label: string, align: 'start' | 'end') => (
          <th key={label} className="px-4 py-3" style={{ fontSize: '11px', fontWeight: 600, color: theme.inkMuted, textTransform: 'uppercase', letterSpacing: '.06em', textAlign: align, whiteSpace: 'nowrap' }}>{label}</th>
        );
        const num = (n: number, muted?: boolean) => (
          <td className="px-4 py-2.5 font-mono" style={{ textAlign: 'end', color: muted ? theme.inkMuted : theme.ink, fontSize: '13px' }}>{n > 0 ? fmt(n) : ''}</td>
        );
        return (
          <div style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: theme.shadowSm, overflow: 'hidden' }}>
            <div style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}`, padding: '12px 16px' }}>
              <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: theme.ink, letterSpacing: '-.01em' }}>{t('reports.trial_balance')} — comparative</p>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: theme.inkMuted }}>As of {asOf}  ·  vs  {cmp.asOf.previous}</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}` }}>
                  {th('Code', 'start')}{th('Account', 'start')}{th('Type', 'start')}
                  {th('Current Dr', 'end')}{th('Current Cr', 'end')}{th('Previous Dr', 'end')}{th('Previous Cr', 'end')}{th('Difference', 'end')}
                </tr>
              </thead>
              <tbody>
                {types.flatMap((type) => [
                  <tr key={`h-${type}`}>
                    <td colSpan={8} className="px-4 py-2" style={{ background: '#f1f5f9', fontSize: '11px', fontWeight: 700, color: theme.inkMuted, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                      {t(`accounting.type_${type}`)}
                    </td>
                  </tr>,
                  ...grouped[type].map((l) => (
                    <tr key={l.account_code} style={{ borderTop: '1px solid #f1f5f9' }}>
                      <td className="px-4 py-2.5 font-mono" style={{ fontSize: '12px', color: theme.brandSoftText, fontWeight: 600 }}>{l.account_code}</td>
                      <td className="px-4 py-2.5" style={{ color: theme.ink, fontSize: '13px' }}>{l.account_name}</td>
                      <td className="px-4 py-2.5" style={{ color: theme.inkMuted, fontSize: '13px', textTransform: 'capitalize' }}>{l.account_type}</td>
                      {num(l.current_debit)}{num(l.current_credit)}
                      {num(l.previous_debit, true)}{num(l.previous_credit, true)}
                      <td className="px-4 py-2.5 font-mono" style={{ textAlign: 'end', fontSize: '13px', color: Math.abs(l.difference) < 0.005 ? theme.inkFaint : (l.difference < 0 ? '#dc2626' : '#15803d') }}>
                        {Math.abs(l.difference) < 0.005 ? '—' : fmtVar(l.difference)}
                      </td>
                    </tr>
                  )),
                ])}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: `2px solid ${theme.border}`, background: theme.panelHead, fontWeight: 700 }}>
                  <td colSpan={3} className="px-4 py-3" style={{ color: theme.ink, fontSize: '13px' }}>{t('accounting.total')}</td>
                  <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', color: curBal ? '#15803d' : '#dc2626' }}>{fmt(c.total_debit.current)}</td>
                  <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', color: curBal ? '#15803d' : '#dc2626' }}>{fmt(c.total_credit.current)}</td>
                  <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', color: prevBal ? '#15803d' : '#dc2626' }}>{fmt(c.total_debit.previous)}</td>
                  <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', color: prevBal ? '#15803d' : '#dc2626' }}>{fmt(c.total_credit.previous)}</td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        );
      })()}
    </div>
  );
}
