import { useState, type ReactNode } from 'react';
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

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Accounting-style formatter: negative numbers render as parens, no minus.
 *   -2.50  →  "(2.50)"
 *    2.50  →  "2.50"
 * Used for contra-revenue lines (4150 Sales Discounts) on the P&L so
 * they read as "Less: Sales Discounts (2.50)" instead of "-2.50".
 */
function fmtSigned(n: number) {
  if (n < 0) return `(${fmt(-n)})`;
  return fmt(n);
}

// ── Collapsible P&L section ────────────────────────────────────────────────
// Must be defined at module level so React can preserve hook state between
// renders. paren=true renders the total as "(n)" — convention for costs.
function PLSection({ title, total, totalLabel, paren = false, children }: {
  title: string;
  total: number;
  totalLabel: string;
  paren?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const displayTotal = paren ? `(${fmt(total)})` : fmt(total);
  return (
    <>
      <tr
        onClick={() => setOpen(o => !o)}
        title={open ? 'Click to collapse' : 'Click to expand'}
        style={{ cursor: 'pointer', userSelect: 'none' }}
      >
        <td colSpan={2} className="px-5 py-2" style={{
          background: '#f1f5f9',
          fontSize: '11px', fontWeight: 700, color: theme.inkMuted,
          textTransform: 'uppercase', letterSpacing: '.08em',
        }}>
          <span style={{ marginInlineEnd: '6px', fontSize: '9px', opacity: 0.6 }}>{open ? '▾' : '▸'}</span>
          {title}
          {!open && (
            <span style={{ float: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: theme.ink, fontSize: '12px', textTransform: 'none', letterSpacing: 0 }}>
              {displayTotal}
            </span>
          )}
        </td>
      </tr>
      {open && (
        <>
          {children}
          <tr style={{ background: theme.panelHead, borderTop: '1px solid #f1f5f9', fontWeight: 600 }}>
            <td className="px-5 py-2" style={{ color: theme.ink, fontSize: '13px' }}>{totalLabel}</td>
            <td className="px-5 py-2 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '13px' }}>{displayTotal}</td>
          </tr>
        </>
      )}
    </>
  );
}

export default function ProfitLossPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  // Phase 46b — preset period picker. Preset clicks auto-run; default = this month.
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.report.profit-loss.period', 'this_month');

  function openLedger(code: string) {
    navigate(`/accounting/general-ledger?code=${encodeURIComponent(code)}&from=${from}&to=${to}`);
  }

  const { data: pl, isLoading, error } = useQuery({
    queryKey: ['pl', company_id, from, to],
    queryFn: () => getAdapter().reports.getProfitAndLoss(company_id!, from, to),
    enabled: !!company_id,
  });

  // Phase 46b — flatten the P&L into rows for Excel export (Section column
  // preserves the grouping that the collapsible UI can't carry into a sheet).
  const exportRows: Record<string, unknown>[] = [];
  if (pl) {
    const push = (section: string, code: string, name: string, amount: number) =>
      exportRows.push({ Section: section, 'Account Code': code, Account: name, Amount: amount.toFixed(2) });
    const isDirect = (l: typeof pl.lines[number]) => l.sub_type !== 'indirect';
    for (const l of pl.lines.filter(l => l.account_type === 'income'  &&  isDirect(l))) push('Revenue', l.account_code, l.account_name, l.amount);
    for (const l of pl.lines.filter(l => l.account_type === 'expense' &&  isDirect(l))) push('COGS', l.account_code, l.account_name, -l.amount);
    push('Totals', '', 'Gross Profit', pl.gross_profit);
    for (const l of pl.lines.filter(l => l.account_type === 'income'  && !isDirect(l))) push('Other Income', l.account_code, l.account_name, l.amount);
    for (const l of pl.lines.filter(l => l.account_type === 'expense' && !isDirect(l))) push('Operating Expenses', l.account_code, l.account_name, -l.amount);
    push('Totals', '', 'Net Profit', pl.net_profit);
  }
  const exportHeaders = ['Section', 'Account Code', 'Account', 'Amount'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title={t('reports.pl_title')}
        subtitle={`${from} — ${to}`}
        actions={
          <div data-print-hide style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <PeriodPicker
              mode="range" preset={preset} from={from} to={to}
              onPresetChange={setPreset} onCustomRange={setCustomRange}
            />
            <ReportActions rows={exportRows} headers={exportHeaders} filename={`profit-loss-${from}_${to}`} disabled={!pl} />
          </div>
        }
      />

      {isLoading && <p style={{ fontSize: '13px', color: theme.inkMuted, padding: '24px 0', textAlign: 'center' }}>{t('common.loading')}</p>}
      {error && <p style={{ fontSize: '13px', color: theme.danger }}>{String(error)}</p>}

      {pl && (() => {
        // NULL sub_type defaults to 'direct' (matches adapter) so legacy
        // accounts still appear above Gross Profit rather than disappearing.
        const isDirect = (l: typeof pl.lines[number]) => l.sub_type !== 'indirect';
        const directIncome   = pl.lines.filter(l => l.account_type === 'income'  &&  isDirect(l));
        const directExpense  = pl.lines.filter(l => l.account_type === 'expense' &&  isDirect(l));
        const otherIncome    = pl.lines.filter(l => l.account_type === 'income'  && !isDirect(l));
        const operatingExp   = pl.lines.filter(l => l.account_type === 'expense' && !isDirect(l));

        const cogsTotal = pl.revenue - pl.gross_profit;

        return (
        <div style={{
          background: theme.card, border: `1px solid ${theme.border}`,
          borderRadius: '12px', boxShadow: theme.shadowSm, overflow: 'hidden',
        }}>
          <div style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}`, padding: '12px 20px' }}>
            <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: theme.ink, letterSpacing: '-.01em' }}>{t('reports.pl_title')}</p>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: theme.inkMuted }}>{t('reports.period')}: {from} — {to}</p>
            <p style={{ margin: '4px 0 0', fontSize: '11px', color: theme.inkFaint }}>
              Click any account row to drill into its General Ledger. Click section headers to collapse/expand.
            </p>
          </div>
          <table className="w-full text-sm">
            <tbody>

              {/* ── Revenue (Direct Income) ───────────────────────── */}
              <PLSection title="Revenue (Direct Income)" total={pl.revenue} totalLabel={t('reports.total_revenue')}>
                {directIncome.length === 0 ? (
                  <tr style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td className="px-5 py-2" style={{ color: theme.inkFaint, fontSize: '13px' }}>No revenue accounts</td>
                    <td className="px-5 py-2 font-mono" style={{ textAlign: 'end', color: theme.inkFaint, fontSize: '13px' }}>—</td>
                  </tr>
                ) : directIncome.map(l => {
                  const isContra = l.amount < 0;
                  return (
                    <tr
                      key={l.account_code}
                      onClick={() => openLedger(l.account_code)}
                      className="cursor-pointer"
                      style={{ borderTop: '1px solid #f1f5f9', transition: 'background-color .12s' }}
                      title={`Open ${l.account_code} in General Ledger`}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.panelHead; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                    >
                      <td className="px-5 py-2" style={{ color: theme.ink, fontSize: '13px' }}>
                        <span style={{ color: theme.brandSoftText, fontWeight: 600, marginInlineEnd: '6px' }}>{l.account_code}</span>
                        {isContra ? <span style={{ color: theme.inkFaint }}>Less: </span> : null}
                        {l.account_name}
                      </td>
                      <td className="px-5 py-2 font-mono" style={{ textAlign: 'end', color: isContra ? theme.inkFaint : theme.ink, fontSize: '13px' }}>
                        {fmtSigned(l.amount)}
                      </td>
                    </tr>
                  );
                })}
              </PLSection>

              {/* ── Cost of Goods Sold ────────────────────────────── */}
              <PLSection title="Cost of Goods Sold (Direct Expense)" total={cogsTotal} totalLabel="Total COGS" paren>
                {directExpense.length === 0 ? (
                  <tr style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td className="px-5 py-2" style={{ color: theme.inkFaint, fontSize: '13px' }}>No direct expenses</td>
                    <td className="px-5 py-2 font-mono" style={{ textAlign: 'end', color: theme.inkFaint, fontSize: '13px' }}>—</td>
                  </tr>
                ) : directExpense.map(l => (
                  <tr
                    key={l.account_code}
                    onClick={() => openLedger(l.account_code)}
                    className="cursor-pointer"
                    style={{ borderTop: '1px solid #f1f5f9', transition: 'background-color .12s' }}
                    title={`Open ${l.account_code} in General Ledger`}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.panelHead; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                  >
                    <td className="px-5 py-2" style={{ color: theme.ink, fontSize: '13px' }}>
                      <span style={{ color: theme.brandSoftText, fontWeight: 600, marginInlineEnd: '6px' }}>{l.account_code}</span>
                      {l.account_name}
                    </td>
                    <td className="px-5 py-2 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '13px' }}>({fmt(l.amount)})</td>
                  </tr>
                ))}
              </PLSection>

              {/* ── Gross Profit — always visible, never collapsible ── */}
              <tr style={{
                background: theme.brandSoft,
                borderTop: `2px solid ${theme.border}`,
                borderBottom: `2px solid ${theme.border}`,
                fontWeight: 700,
              }}>
                <td className="px-5 py-2" style={{ color: theme.ink, fontSize: '13px' }}>{t('reports.gross_profit')}</td>
                <td className="px-5 py-2 font-mono" style={{ textAlign: 'end', color: pl.gross_profit < 0 ? '#dc2626' : theme.brandSoftText, fontSize: '13px' }}>
                  {fmt(pl.gross_profit)}
                </td>
              </tr>

              {/* ── Other Income (Indirect) — only when present ────── */}
              {otherIncome.length > 0 && (
                <PLSection title="Other Income (Indirect)" total={pl.other_income} totalLabel="Total Other Income">
                  {otherIncome.map(l => (
                    <tr
                      key={l.account_code}
                      onClick={() => openLedger(l.account_code)}
                      className="cursor-pointer"
                      style={{ borderTop: '1px solid #f1f5f9', transition: 'background-color .12s' }}
                      title={`Open ${l.account_code} in General Ledger`}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.panelHead; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                    >
                      <td className="px-5 py-2" style={{ color: theme.ink, fontSize: '13px' }}>
                        <span style={{ color: theme.brandSoftText, fontWeight: 600, marginInlineEnd: '6px' }}>{l.account_code}</span>
                        {l.account_name}
                      </td>
                      <td className="px-5 py-2 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '13px' }}>{fmt(l.amount)}</td>
                    </tr>
                  ))}
                </PLSection>
              )}

              {/* ── Operating Expenses (Indirect) ─────────────────── */}
              <PLSection title="Operating Expenses (Indirect)" total={pl.operating_expenses} totalLabel="Total Operating Expenses" paren>
                {operatingExp.length === 0 ? (
                  <tr style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td className="px-5 py-2" style={{ color: theme.inkFaint, fontSize: '13px' }}>No operating expenses</td>
                    <td className="px-5 py-2 font-mono" style={{ textAlign: 'end', color: theme.inkFaint, fontSize: '13px' }}>—</td>
                  </tr>
                ) : operatingExp.map(l => (
                  <tr
                    key={l.account_code}
                    onClick={() => openLedger(l.account_code)}
                    className="cursor-pointer"
                    style={{ borderTop: '1px solid #f1f5f9', transition: 'background-color .12s' }}
                    title={`Open ${l.account_code} in General Ledger`}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.panelHead; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                  >
                    <td className="px-5 py-2" style={{ color: theme.ink, fontSize: '13px' }}>
                      <span style={{ color: theme.brandSoftText, fontWeight: 600, marginInlineEnd: '6px' }}>{l.account_code}</span>
                      {l.account_name}
                    </td>
                    <td className="px-5 py-2 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '13px' }}>({fmt(l.amount)})</td>
                  </tr>
                ))}
              </PLSection>

              {/* ── Net Profit — always visible, never collapsible ─── */}
              <tr style={{
                borderTop: `2px solid ${theme.border}`,
                background: pl.net_profit < 0 ? '#fef2f2' : '#f0fdf4',
                fontWeight: 700,
              }}>
                <td className="px-5 py-3" style={{ color: theme.ink, fontSize: '14px' }}>{t('reports.net_profit')}</td>
                <td className="px-5 py-3 font-mono" style={{ textAlign: 'end', color: pl.net_profit < 0 ? '#dc2626' : '#15803d', fontSize: '14px' }}>
                  {fmt(pl.net_profit)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        );
      })()}
    </div>
  );
}
