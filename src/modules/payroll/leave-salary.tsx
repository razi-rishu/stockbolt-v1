/**
 * Leave Salary — Payroll P3b (owner spec 2026-06-13).
 *
 * Accrual model: an employee earns 30 paid leave days per year of service,
 * pro-rated from the joining date (flat, from day one). Leave salary pays
 * out the earned-but-unpaid balance.
 *
 *   Earned days  = (days since joining ÷ 365.25) × 30
 *   Paid days    = Σ days on this employee's PAID leave-salary records
 *   Balance      = Earned − Paid
 *   Amount       = days × daily wage   (GCC: full wage ÷ 30 · India: basic ÷ 26)
 *
 * The page shows a live balance per active employee; "Pay" pre-fills the
 * payable days and amount. Each payment posts Dr 6100 / Cr bank and the
 * days settled reduce the balance.
 */
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useInvalidateBooks } from '@/hooks/use-invalidate-books';
import { Button } from '@/ui/button';
import { Modal } from '@/ui/modal';
import { PageHeader } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import { serviceLabel } from './gratuity';
import type { EmployeeRow, BankAccountRow, LeaveSalaryRow, LeaveSalaryInsert } from '@/data/adapter';

const ANNUAL_LEAVE_DAYS = 30;
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;
const inputCls = 'h-9 w-full rounded-card border border-border-subtle bg-surface-card px-3 text-sm text-ink-primary focus:outline-none focus:ring-2 focus:ring-brand-500';

const STATUS_TONE: Record<string, { bg: string; text: string; border: string }> = {
  draft: { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
  paid:  { bg: '#ecfdf5', text: '#047857', border: '#a7f3d0' },
  void:  { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' },
};

/** Annual leave earned to date — flat 30/year pro-rated from joining. */
function earnedLeaveDays(joiningDate: string | null | undefined): number {
  if (!joiningDate) return 0;
  const start = new Date(joiningDate + (joiningDate.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(start.getTime())) return 0;
  const years = (Date.now() - start.getTime()) / (365.25 * 24 * 3600 * 1000);
  return years > 0 ? round1(years * ANNUAL_LEAVE_DAYS) : 0;
}

/** Daily wage used to value leave days, per registered country. */
function dailyWage(e: EmployeeRow, isIndia: boolean): number {
  const basic = Number(e.basic_salary);
  if (isIndia) return basic / 26;
  return (basic + Number(e.housing_allowance) + Number(e.transport_allowance) + Number(e.other_allowance)) / 30;
}

export default function LeaveSalaryPage() {
  const { company_id } = useAuthStore();
  const qc = useQueryClient();
  const invalidateBooks = useInvalidateBooks();
  const today = new Date().toISOString().slice(0, 10);

  const [open, setOpen] = useState(false);
  const [empId, setEmpId] = useState('');
  const [days, setDays] = useState('');
  const [amount, setAmount] = useState('');
  const [bankId, setBankId] = useState('');
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery<LeaveSalaryRow[]>({
    queryKey: ['leave_salary', company_id],
    queryFn: () => getAdapter().payroll.listLeaveSalary(company_id!),
    enabled: !!company_id,
  });
  const { data: employees = [] } = useQuery<EmployeeRow[]>({
    queryKey: ['employees', company_id, true],
    queryFn: () => getAdapter().employees.list(company_id!, { includeInactive: true }),
    enabled: !!company_id,
  });
  const { data: banks = [] } = useQuery<BankAccountRow[]>({
    queryKey: ['bank_accounts', company_id],
    queryFn: () => getAdapter().bankAccounts.list(company_id!),
    enabled: !!company_id,
  });
  const { data: company } = useQuery({
    queryKey: ['company', company_id],
    queryFn: () => getAdapter().companies.getById(company_id!),
    enabled: !!company_id,
  });
  const isIndia = company?.country_code === 'IN';
  const empMap = Object.fromEntries(employees.map(e => [e.id, e]));

  // Paid leave days per employee (only PAID records reduce the balance).
  const paidDaysByEmp: Record<string, number> = {};
  for (const r of rows) {
    if (r.status === 'paid') paidDaysByEmp[r.employee_id] = (paidDaysByEmp[r.employee_id] ?? 0) + Number(r.days);
  }

  function balanceOf(e: EmployeeRow) {
    const earned = earnedLeaveDays(e.joining_date as string | null);
    const paid = paidDaysByEmp[e.id] ?? 0;
    return { earned, paid, balance: round1(Math.max(0, earned - paid)) };
  }

  // Auto-recompute the payout amount whenever employee or days change.
  useEffect(() => {
    const e = empMap[empId];
    const d = parseFloat(days) || 0;
    if (e && d > 0) setAmount(String(round2(dailyWage(e, isIndia) * d)));
    else setAmount('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empId, days, isIndia]);

  function openPay(e: EmployeeRow) {
    const { balance } = balanceOf(e);
    setEmpId(e.id);
    setDays(String(balance));
    setBankId(banks[0]?.id ?? '');
    setDate(today);
    setError(null);
    setOpen(true);
  }

  const payMutation = useMutation({
    mutationFn: async () => {
      if (!empId) throw new Error('Pick an employee');
      if (!bankId) throw new Error('Pick a bank account');
      const d = parseFloat(days) || 0;
      const amt = parseFloat(amount) || 0;
      if (d <= 0) throw new Error('Days must be greater than zero');
      if (amt <= 0) throw new Error('Amount must be positive');
      const row: LeaveSalaryInsert = {
        company_id: company_id!, employee_id: empId,
        leave_from: null, leave_to: null,
        days: d, amount: amt, bank_account_id: bankId, date, status: 'draft',
      };
      const created = await getAdapter().payroll.createLeaveSalary(row);
      await getAdapter().payroll.payLeaveSalary(created.id);
    },
    onSuccess: async () => {
      await invalidateBooks();
      qc.invalidateQueries({ queryKey: ['leave_salary', company_id] });
      setOpen(false); setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const activeEmps = employees.filter(e => e.is_active);
  const selected = empMap[empId];
  const selBal = selected ? balanceOf(selected) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title="Leave Salary"
        subtitle="Each employee earns 30 paid leave days a year, accrued from their joining date. Pay out the earned balance below."
      />

      {/* ── Leave balances ─────────────────────────────────────────────── */}
      <div className="overflow-x-auto bg-white" style={{ border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: theme.shadowSm }}>
        <div className="border-b border-border-subtle px-4 py-3">
          <h2 className="text-sm font-semibold text-ink-primary">Leave balances</h2>
        </div>
        {activeEmps.length === 0 ? (
          <p style={{ fontSize: '13px', color: theme.inkFaint, padding: '32px 0', textAlign: 'center' }}>No active employees.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}` }}>
                {['Employee', 'Service', 'Earned (days)', 'Paid (days)', 'Balance (days)', 'Payable', ''].map((l, i) => (
                  <th key={l} className="px-4 py-3" style={{
                    fontSize: '11px', fontWeight: 600, color: theme.inkMuted,
                    textTransform: 'uppercase', letterSpacing: '.06em',
                    textAlign: i >= 2 && i <= 5 ? 'end' : 'start', whiteSpace: 'nowrap',
                  }}>{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeEmps.map((e, idx) => {
                const b = balanceOf(e);
                const payable = round2(dailyWage(e, isIndia) * b.balance);
                return (
                  <tr key={e.id} style={{ borderTop: idx === 0 ? 'none' : '1px solid #f1f5f9' }}>
                    <td className="px-4 py-3" style={{ color: theme.ink, fontWeight: 500 }}>
                      {e.name}{e.code ? <span className="font-mono" style={{ marginInlineStart: '8px', fontSize: '10px', color: theme.inkFaint }}>{e.code}</span> : null}
                    </td>
                    <td className="px-4 py-3" style={{ color: theme.inkMuted, fontSize: '13px' }}>{serviceLabel(e.joining_date as string | null)}</td>
                    <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', color: theme.inkMuted }}>{b.earned}</td>
                    <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', color: theme.inkMuted }}>{b.paid}</td>
                    <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', fontWeight: 700, color: '#6d28d9' }}>{b.balance}</td>
                    <td className="px-4 py-3 font-mono" style={{ textAlign: 'end' }}>{fmt(payable)}</td>
                    <td className="px-4 py-3" style={{ textAlign: 'end' }}>
                      <Button size="sm" variant="ghost" disabled={b.balance <= 0} onClick={() => openPay(e)}>Pay</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Payment history ────────────────────────────────────────────── */}
      <div className="overflow-x-auto bg-white" style={{ border: `1px solid ${theme.border}`, borderRadius: '12px', boxShadow: theme.shadowSm }}>
        <div className="border-b border-border-subtle px-4 py-3">
          <h2 className="text-sm font-semibold text-ink-primary">Payments</h2>
        </div>
        {isLoading ? (
          <p style={{ fontSize: '13px', color: theme.inkFaint, padding: '32px 0', textAlign: 'center' }}>Loading…</p>
        ) : rows.length === 0 ? (
          <p style={{ fontSize: '13px', color: theme.inkFaint, padding: '32px 0', textAlign: 'center' }}>No leave salary paid yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}` }}>
                {['Employee', 'Days', 'Date Paid', 'Amount', 'Status'].map((l, i) => (
                  <th key={l} className="px-4 py-3" style={{
                    fontSize: '11px', fontWeight: 600, color: theme.inkMuted,
                    textTransform: 'uppercase', letterSpacing: '.06em',
                    textAlign: i >= 1 && i <= 3 ? 'end' : 'start', whiteSpace: 'nowrap',
                  }}>{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const tone = STATUS_TONE[r.status] ?? STATUS_TONE.draft;
                return (
                  <tr key={r.id} style={{ borderTop: idx === 0 ? 'none' : '1px solid #f1f5f9' }}>
                    <td className="px-4 py-3" style={{ color: theme.ink, fontWeight: 500 }}>{empMap[r.employee_id]?.name ?? '—'}</td>
                    <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', color: theme.inkMuted }}>{r.days}</td>
                    <td className="px-4 py-3" style={{ textAlign: 'end', color: theme.inkMuted, fontSize: '13px' }}>{r.date}</td>
                    <td className="px-4 py-3 font-mono" style={{ textAlign: 'end', fontWeight: 600 }}>{fmt(Number(r.amount))}</td>
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
        )}
      </div>

      {/* ── Pay modal ──────────────────────────────────────────────────── */}
      <Modal open={open} onClose={() => setOpen(false)} title={selected ? `Pay leave salary — ${selected.name}` : 'Pay leave salary'}>
        <div className="space-y-4">
          {error && <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          {selBal && (
            <div className="rounded-card bg-surface-muted/60 px-4 py-3 text-sm">
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-secondary">
                <span>Earned: <strong className="text-ink-primary">{selBal.earned} days</strong></span>
                <span>Paid: <strong className="text-ink-primary">{selBal.paid} days</strong></span>
                <span>Balance: <strong style={{ color: '#6d28d9' }}>{selBal.balance} days</strong></span>
              </div>
              <p className="mt-1 text-[11px] text-ink-tertiary">
                Daily wage {isIndia ? 'basic ÷ 26' : 'full wage ÷ 30'} ({isIndia ? 'India' : 'GCC'}) = {selected ? fmt(dailyWage(selected, isIndia)) : '—'}/day
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">Days to pay</label>
              <input className={inputCls} type="number" min="0" step="0.5" value={days} onChange={e => setDays(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">Amount (auto)</label>
              <input className={inputCls} type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">Date paid</label>
              <input className={inputCls} type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">Pay from bank</label>
              <select className={inputCls} value={bankId} onChange={e => setBankId(e.target.value)}>
                <option value="">— select bank —</option>
                {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-ink-tertiary">
            Posts Dr 6100 Salaries &amp; Benefits / Cr bank. The {days || 0} day{Number(days) === 1 ? '' : 's'} paid reduce this employee's balance.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={payMutation.isPending}>Cancel</Button>
            <Button onClick={() => payMutation.mutate()} disabled={payMutation.isPending || !empId || !bankId || !(parseFloat(amount) > 0)}>
              {payMutation.isPending ? 'Posting…' : 'Record & Pay'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
