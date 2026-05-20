import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Input } from '@/ui/input';
import { Button } from '@/ui/button';
import { PageHeader, Panel } from '@/ui/primitives';
import { theme } from '@/ui/theme';

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

function todayIso() { return new Date().toISOString().slice(0, 10); }
function firstOfMonthIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function ProfitLossPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const [from, setFrom] = useState(firstOfMonthIso);
  const [to, setTo]     = useState(todayIso);
  const [trigger, setTrigger] = useState(0);

  const { data: pl, isLoading, error } = useQuery({
    queryKey: ['pl', company_id, from, to, trigger],
    queryFn: () => getAdapter().reports.getProfitAndLoss(company_id!, from, to),
    enabled: !!company_id && trigger > 0,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader title={t('reports.pl_title')} subtitle={`${from} — ${to}`} />

      <Panel icon="📅" title="Period">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap' }}>
          <Input type="date" label={t('reports.from')} value={from} onChange={e => setFrom(e.target.value)} />
          <Input type="date" label={t('reports.to')} value={to} onChange={e => setTo(e.target.value)} />
          <Button size="sm" onClick={() => setTrigger(n => n + 1)}>{t('reports.run')}</Button>
        </div>
      </Panel>

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

        // Section row helper (light-grey strip header)
        const sectionHeader = (label: string) => (
          <tr>
            <td colSpan={2} className="px-5 py-2" style={{
              background: '#f1f5f9',
              fontSize: '11px', fontWeight: 700, color: theme.inkMuted,
              textTransform: 'uppercase', letterSpacing: '.08em',
            }}>{label}</td>
          </tr>
        );

        return (
        <div style={{
          background: theme.card, border: `1px solid ${theme.border}`,
          borderRadius: '12px', boxShadow: theme.shadowSm, overflow: 'hidden',
        }}>
          <div style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}`, padding: '12px 20px' }}>
            <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: theme.ink, letterSpacing: '-.01em' }}>{t('reports.pl_title')}</p>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: theme.inkMuted }}>{t('reports.period')}: {from} — {to}</p>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {/* ── Direct income (Sales) ─────────────────────────── */}
              {sectionHeader('Revenue (Direct Income)')}
              {directIncome.map(l => {
                const isContra = l.amount < 0;
                return (
                  <tr key={l.account_code} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td className="px-5 py-2" style={{ color: theme.ink, fontSize: '13px' }}>
                      {l.account_code}{' '}
                      {isContra ? <span style={{ color: theme.inkFaint }}>Less:</span> : null}{' '}
                      {l.account_name}
                    </td>
                    <td className="px-5 py-2 font-mono" style={{ textAlign: 'end', color: isContra ? theme.inkFaint : theme.ink, fontSize: '13px' }}>
                      {fmtSigned(l.amount)}
                    </td>
                  </tr>
                );
              })}
              <tr style={{ background: theme.panelHead, borderTop: '1px solid #f1f5f9', fontWeight: 600 }}>
                <td className="px-5 py-2" style={{ color: theme.ink, fontSize: '13px' }}>{t('reports.total_revenue')}</td>
                <td className="px-5 py-2 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '13px' }}>{fmt(pl.revenue)}</td>
              </tr>

              {/* ── Direct expense (COGS) ─────────────────────────── */}
              {sectionHeader('Cost of Goods Sold (Direct Expense)')}
              {directExpense.length === 0 ? (
                <tr style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td className="px-5 py-2" style={{ color: theme.inkFaint, fontSize: '13px' }}>No direct expenses</td>
                  <td className="px-5 py-2 font-mono" style={{ textAlign: 'end', color: theme.inkFaint, fontSize: '13px' }}>—</td>
                </tr>
              ) : directExpense.map(l => (
                <tr key={l.account_code} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td className="px-5 py-2" style={{ color: theme.ink, fontSize: '13px' }}>{l.account_code} {l.account_name}</td>
                  <td className="px-5 py-2 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '13px' }}>({fmt(l.amount)})</td>
                </tr>
              ))}

              {/* ── Gross Profit ──────────────────────────────────── */}
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

              {/* ── Indirect income ──────────────────────────────── */}
              {otherIncome.length > 0 && (
                <>
                  {sectionHeader('Other Income (Indirect)')}
                  {otherIncome.map(l => (
                    <tr key={l.account_code} style={{ borderTop: '1px solid #f1f5f9' }}>
                      <td className="px-5 py-2" style={{ color: theme.ink, fontSize: '13px' }}>{l.account_code} {l.account_name}</td>
                      <td className="px-5 py-2 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '13px' }}>{fmt(l.amount)}</td>
                    </tr>
                  ))}
                  <tr style={{ background: theme.panelHead, borderTop: '1px solid #f1f5f9', fontWeight: 600 }}>
                    <td className="px-5 py-2" style={{ color: theme.ink, fontSize: '13px' }}>Total Other Income</td>
                    <td className="px-5 py-2 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '13px' }}>{fmt(pl.other_income)}</td>
                  </tr>
                </>
              )}

              {/* ── Operating expenses ────────────────────────────── */}
              {sectionHeader('Operating Expenses (Indirect)')}
              {operatingExp.length === 0 ? (
                <tr style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td className="px-5 py-2" style={{ color: theme.inkFaint, fontSize: '13px' }}>No operating expenses</td>
                  <td className="px-5 py-2 font-mono" style={{ textAlign: 'end', color: theme.inkFaint, fontSize: '13px' }}>—</td>
                </tr>
              ) : operatingExp.map(l => (
                <tr key={l.account_code} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td className="px-5 py-2" style={{ color: theme.ink, fontSize: '13px' }}>{l.account_code} {l.account_name}</td>
                  <td className="px-5 py-2 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '13px' }}>({fmt(l.amount)})</td>
                </tr>
              ))}
              {operatingExp.length > 0 && (
                <tr style={{ background: theme.panelHead, borderTop: '1px solid #f1f5f9', fontWeight: 600 }}>
                  <td className="px-5 py-2" style={{ color: theme.ink, fontSize: '13px' }}>Total Operating Expenses</td>
                  <td className="px-5 py-2 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '13px' }}>({fmt(pl.operating_expenses)})</td>
                </tr>
              )}

              {/* ── Net Profit ────────────────────────────────────── */}
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
