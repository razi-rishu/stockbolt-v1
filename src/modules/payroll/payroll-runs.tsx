/**
 * Payroll Runs list — Payroll P1 (owner override 2026-06-13).
 *
 * One run per calendar month (DB-enforced unique). "New run" pre-fills
 * one item per active employee from their salary structure, then opens
 * the run editor for adjustments (overtime / bonus / deductions / loans).
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Modal } from '@/ui/modal';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import type { PayrollRunRow, PayrollRunItemInsert, EmployeeRow } from '@/data/adapter';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const STATUS_TONES: Record<string, { bg: string; text: string; border: string }> = {
  draft:     { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
  confirmed: { bg: '#f5f3ff', text: '#6d28d9', border: '#ddd6fe' },
  paid:      { bg: '#ecfdf5', text: '#047857', border: '#a7f3d0' },
  void:      { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' },
};

export default function PayrollRunsPage() {
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const now = new Date();
  const [newOpen, setNewOpen] = useState(false);
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [error, setError] = useState<string | null>(null);

  const { data: runs = [], isLoading } = useQuery<PayrollRunRow[]>({
    queryKey: ['payroll_runs', company_id],
    queryFn: () => getAdapter().payroll.listRuns(company_id!),
    enabled: !!company_id,
  });

  const { data: employees = [] } = useQuery<EmployeeRow[]>({
    queryKey: ['employees', company_id, false],
    queryFn: () => getAdapter().employees.list(company_id!),
    enabled: !!company_id,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (employees.length === 0) throw new Error('No active employees — add employees first');
      const run_number = await getAdapter().payroll.getNextRunNumber(company_id!);
      // Posting date = last day of the period month.
      const lastDay = new Date(year, month, 0).getDate();
      const date = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      const items: PayrollRunItemInsert[] = employees.map(e => ({
        company_id: company_id!,
        run_id: '',   // filled by adapter.createRun
        employee_id: e.id,
        basic_salary: Number(e.basic_salary),
        housing_allowance: Number(e.housing_allowance),
        transport_allowance: Number(e.transport_allowance),
        other_allowance: Number(e.other_allowance),
      }));
      return getAdapter().payroll.createRun({
        company_id: company_id!, run_number,
        period_year: year, period_month: month, date,
      }, items);
    },
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: ['payroll_runs', company_id] });
      setNewOpen(false);
      navigate(`/payroll/runs/${run.id}`);
    },
    onError: (e: Error) => {
      setError(/duplicate|unique/i.test(e.message)
        ? `A payroll run for ${MONTHS[month - 1]} ${year} already exists.`
        : e.message);
    },
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title="Payroll Runs"
        subtitle="One run per month — confirm posts salaries to the books, pay settles them from the bank"
        actions={<Button size="sm" onClick={() => { setError(null); setNewOpen(true); }}>+ New Run</Button>}
      />

      {isLoading ? (
        <p style={{ fontSize: '13px', color: theme.inkFaint, padding: '48px 0', textAlign: 'center' }}>Loading…</p>
      ) : runs.length === 0 ? (
        <p style={{ fontSize: '13px', color: theme.inkFaint, padding: '48px 0', textAlign: 'center' }}>
          No payroll runs yet. Create the first month's run to get started.
        </p>
      ) : (
        <div className="overflow-x-auto bg-white" style={{ border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: theme.shadowSm }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}` }}>
                {['Run #', 'Period', 'Posting Date', 'Gross', 'Deductions', 'Net Pay', 'Status'].map((l, i) => (
                  <th key={l} className="px-4 py-3" style={{
                    fontSize: '11px', fontWeight: 600, color: theme.inkMuted,
                    textTransform: 'uppercase', letterSpacing: '.06em',
                    textAlign: i >= 3 && i <= 5 ? 'end' : 'start', whiteSpace: 'nowrap',
                  }}>{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((r, idx) => {
                const tone = STATUS_TONES[r.status] ?? STATUS_TONES.draft;
                return (
                  <tr key={r.id} onClick={() => navigate(`/payroll/runs/${r.id}`)} className="cursor-pointer"
                    style={{ borderTop: idx === 0 ? 'none' : '1px solid #f1f5f9', transition: 'background-color .12s' }}
                    onMouseEnter={(ev) => { (ev.currentTarget as HTMLElement).style.background = theme.panelHead; }}
                    onMouseLeave={(ev) => { (ev.currentTarget as HTMLElement).style.background = ''; }}
                  >
                    <td className="px-4 py-3 font-mono" style={{ fontSize: '12px', color: theme.brandSoftText, fontWeight: 600 }}>{r.run_number}</td>
                    <td className="px-4 py-3" style={{ color: theme.ink, fontWeight: 500 }}>{MONTHS[r.period_month - 1]} {r.period_year}</td>
                    <td className="px-4 py-3" style={{ color: theme.inkMuted, fontSize: '13px' }}>{r.date}</td>
                    <td className="px-4 py-3 font-mono" style={{ textAlign: 'end' }}>{fmt(Number(r.total_gross))}</td>
                    <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', color: theme.inkMuted }}>{fmt(Number(r.total_deductions) + Number(r.total_loan_repayment))}</td>
                    <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', fontWeight: 600 }}>{fmt(Number(r.total_net))}</td>
                    <td className="px-4 py-3">
                      <span style={{
                        display: 'inline-block', padding: '3px 9px', borderRadius: '999px',
                        fontSize: '11px', fontWeight: 600, textTransform: 'capitalize',
                        background: tone.bg, color: tone.text, border: `1px solid ${tone.border}`,
                      }}>{r.status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── New run modal ────────────────────────────────────────────── */}
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="New payroll run">
        <div className="space-y-4">
          {error && <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">Month</label>
              <select value={month} onChange={e => setMonth(parseInt(e.target.value))}
                className="h-9 w-full rounded-card border border-border-subtle bg-surface-card px-3 text-sm text-ink-primary focus:outline-none focus:ring-2 focus:ring-brand-500">
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">Year</label>
              <select value={year} onChange={e => setYear(parseInt(e.target.value))}
                className="h-9 w-full rounded-card border border-border-subtle bg-surface-card px-3 text-sm text-ink-primary focus:outline-none focus:ring-2 focus:ring-brand-500">
                {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-ink-tertiary">
            Pre-fills one line per active employee ({employees.length}) from their salary structure.
            You can adjust overtime, bonus, deductions and loan recoveries before confirming.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setNewOpen(false)} disabled={createMutation.isPending}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating…' : 'Create draft run'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
