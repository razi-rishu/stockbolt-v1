/**
 * Expenses list — Phase 13.02.
 *
 * Lives under /purchasing/expenses (Zoho parity — expenses sit in the
 * purchasing module, not banking, since they're vendor-side
 * transactions). The old /banking/expenses still works during the
 * transition and links here from the Settings hub.
 *
 * Features:
 *   - PageHeader with count subtitle
 *   - Filter pills: All / Draft / Confirmed / Void / This-month
 *   - Sample table chrome with tinted status pills
 *   - Click a row to open the editor (multi-line aware)
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import { StatusBadge } from '@/ui/status-badge';
import type { ExpenseRow } from '@/data/adapter';

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 14px',
        borderRadius: '999px',
        fontSize: '12px', fontWeight: 600,
        border: active ? `1px solid ${theme.brand}` : `1px solid ${theme.border}`,
        background: active ? theme.brand : '#fff',
        color: active ? '#fff' : theme.inkMuted,
        cursor: 'pointer',
        transition: 'background-color .12s, color .12s',
      }}
    >{label}</button>
  );
}

type Filter = 'all' | 'draft' | 'confirmed' | 'void' | 'this_month';

export default function ExpensesPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');

  const { data: expenses = [], isLoading } = useQuery<ExpenseRow[]>({
    queryKey: ['expenses', company_id],
    queryFn:  () => getAdapter().expenses.list(company_id!),
    enabled:  !!company_id,
  });

  const filtered = useMemo(() => {
    if (filter === 'all') return expenses;
    if (filter === 'this_month') {
      const month = new Date().toISOString().slice(0, 7); // YYYY-MM
      return expenses.filter(e => (e.date as unknown as string).startsWith(month));
    }
    return expenses.filter(e => e.status === filter);
  }, [expenses, filter]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title={t('banking.expenses_title')}
        subtitle={`${filtered.length} ${filtered.length === 1 ? 'expense' : 'expenses'}`}
        actions={
          <Link to="/purchasing/expenses/new">
            <Button>+ New expense</Button>
          </Link>
        }
      />

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        <FilterPill label="All"        active={filter === 'all'}        onClick={() => setFilter('all')} />
        <FilterPill label="Draft"      active={filter === 'draft'}      onClick={() => setFilter('draft')} />
        <FilterPill label="Confirmed"  active={filter === 'confirmed'}  onClick={() => setFilter('confirmed')} />
        <FilterPill label="Void"       active={filter === 'void'}       onClick={() => setFilter('void')} />
        <FilterPill label="This month" active={filter === 'this_month'} onClick={() => setFilter('this_month')} />
      </div>

      {isLoading ? (
        <p style={{ padding: '48px 0', textAlign: 'center', fontSize: '13px', color: theme.inkFaint }}>
          {t('common.loading')}
        </p>
      ) : filtered.length === 0 ? (
        <p style={{ padding: '48px 0', textAlign: 'center', fontSize: '13px', color: theme.inkFaint }}>
          {filter === 'all'
            ? 'No expenses yet. Click + New to create one.'
            : `No ${filter === 'this_month' ? 'expenses this month' : `${filter} expenses`}.`}
        </p>
      ) : (
        <div
          className="overflow-x-auto bg-white"
          style={{ border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: theme.shadowSm }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}` }}>
                {[
                  { l: 'Number',   a: 'start' as const },
                  { l: 'Date',     a: 'start' as const },
                  { l: 'Description', a: 'start' as const },
                  { l: 'Amount',   a: 'end'   as const },
                  { l: 'Tax',      a: 'end'   as const },
                  { l: 'Total',    a: 'end'   as const },
                  { l: 'Status',   a: 'start' as const },
                  { l: '',         a: 'end'   as const },
                ].map((c, i) => (
                  <th key={i} className="px-4 py-3" style={{
                    fontSize: '11px', fontWeight: 600, color: theme.inkMuted,
                    textTransform: 'uppercase', letterSpacing: '.06em',
                    textAlign: c.a, whiteSpace: 'nowrap',
                  }}>{c.l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((exp, idx) => (
                <tr
                  key={exp.id}
                  onClick={() => navigate(`/purchasing/expenses/${exp.id}`)}
                  className="cursor-pointer"
                  style={{
                    borderTop: idx === 0 ? 'none' : '1px solid #f1f5f9',
                    transition: 'background-color .12s',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.panelHead; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                >
                  <td className="px-4 py-3 font-mono" style={{ fontSize: '12px', color: theme.brandSoftText, fontWeight: 600 }}>
                    {exp.expense_number}
                  </td>
                  <td className="px-4 py-3" style={{ color: theme.inkMuted, fontSize: '13px' }}>{exp.date}</td>
                  <td className="px-4 py-3" style={{ color: theme.ink, fontSize: '13px', maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {exp.description}
                  </td>
                  <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '13px' }}>{fmt(Number(exp.amount))}</td>
                  <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', color: theme.inkMuted, fontSize: '13px' }}>{fmt(Number(exp.tax_amount))}</td>
                  <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '13px', fontWeight: 600 }}>{fmt(Number(exp.total_amount))}</td>
                  <td className="px-4 py-3"><StatusBadge status={exp.status} /></td>
                  <td className="px-4 py-3" style={{ textAlign: 'end' }}>
                    <Link
                      to={`/purchasing/expenses/${exp.id}`}
                      style={{ fontSize: '11px', color: theme.brand, fontWeight: 600, textDecoration: 'none' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t('common.view')} →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
