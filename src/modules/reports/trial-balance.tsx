import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { PageHeader, Panel } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import type { TrialBalance, TrialBalanceLine } from '@/data/adapter';
import { ControlAccountDrillDown, CONTROL_ACCOUNTS } from './_shared/control-account-drilldown';

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

  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [queryDate, setQueryDate] = useState<string | null>(null);
  // Phase 12.24 — set of account codes whose per-contact drill-down is open.
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(new Set());

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
    if (!queryDate) return;
    const yearStart = queryDate.slice(0, 4) + '-01-01';
    navigate(`/accounting/general-ledger?code=${encodeURIComponent(code)}&from=${yearStart}&to=${queryDate}`);
  }

  const { data, isFetching } = useQuery<TrialBalance>({
    queryKey: ['trial_balance', company_id, queryDate],
    queryFn: () => getAdapter().accounting.getTrialBalance(company_id!, queryDate!),
    enabled: !!company_id && !!queryDate,
  });

  function handleRun(e: React.FormEvent) {
    e.preventDefault();
    setQueryDate(asOfDate);
    setExpandedCodes(new Set()); // collapse all when re-running
  }

  // Group lines by account type
  const grouped: Record<string, TrialBalanceLine[]> = {};
  for (const line of data?.lines ?? []) {
    if (!grouped[line.account_type]) grouped[line.account_type] = [];
    grouped[line.account_type].push(line);
  }
  const types = TYPE_ORDER.filter((t2) => grouped[t2]?.length > 0);

  const isBalanced = data ? Math.abs(data.total_debit - data.total_credit) <= 0.01 : true;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader title={t('reports.trial_balance')} subtitle={data ? `As of ${data.as_of_date}` : 'Pick a date and Run'} />

      {/* Filter panel */}
      <Panel icon="📅" title="Period" compact>
        <form onSubmit={handleRun} style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', color: theme.inkMuted, fontWeight: 500 }}>{t('reports.as_of_date')}</span>
          <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)}
            style={{ height: '32px', padding: '0 10px', fontSize: '13px', border: `1px solid ${theme.border}`, borderRadius: '7px', background: '#fff', color: theme.ink, outline: 'none' }} />
          <Button type="submit" size="sm">{t('reports.run')}</Button>
        </form>
      </Panel>

      {isFetching && <p style={{ fontSize: '13px', color: theme.inkMuted, padding: '24px 0', textAlign: 'center' }}>{t('common.loading')}</p>}

      {data && !isFetching && (
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
                          {isControl && isExpanded && queryDate && company_id && (
                            <ControlAccountDrillDown
                              companyId={company_id}
                              accountCode={line.account_code}
                              asOfDate={queryDate}
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
    </div>
  );
}
