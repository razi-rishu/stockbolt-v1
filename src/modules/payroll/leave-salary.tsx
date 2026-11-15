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
import { formatDate } from '@/lib/locale';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useInvalidateBooks } from '@/hooks/use-invalidate-books';
import { useTranslation } from 'react-i18next';
import { Wallet } from 'lucide-react';
import { Button } from '@/ui/button';
import { Modal } from '@/ui/modal';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { StatusBadge } from '@/ui/status-badge';
import { OceanPage } from '@/components/ocean-list';
import { ReportCard, ReportFigures, ReportMessage, ReportTable, Num, type ReportColumn } from '@/components/ocean-report';
import { useServiceLabel } from './use-service-label';
import type { EmployeeRow, BankAccountRow, LeaveSalaryRow, LeaveSalaryInsert } from '@/data/adapter';

const ANNUAL_LEAVE_DAYS = 30;
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;


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
  const { t } = useTranslation();
  const service = useServiceLabel();
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
      if (!empId) throw new Error(t('payOcean.err_pick_employee'));
      if (!bankId) throw new Error(t('payOcean.err_pick_bank'));
      const d = parseFloat(days) || 0;
      const amt = parseFloat(amount) || 0;
      if (d <= 0) throw new Error(t('payOcean.err_days'));
      if (amt <= 0) throw new Error(t('payOcean.err_amount'));
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

  const payableOf = (e: EmployeeRow) => round2(dailyWage(e, isIndia) * balanceOf(e).balance);
  const totalBalance = round1(activeEmps.reduce((s, e) => s + balanceOf(e).balance, 0));
  const totalPayable = activeEmps.reduce((s, e) => s + payableOf(e), 0);
  const paidTotal = rows.filter(r => r.status === 'paid').reduce((s, r) => s + Number(r.amount), 0);

  const balanceCols: ReportColumn<EmployeeRow>[] = [
    { key: 'emp', header: t('payOcean.col_employee'), cell: e => (
      <span className="sb-pay-namecode"><span className="strong">{e.name}</span>{e.code && <bdi dir="ltr" className="code">{e.code}</bdi>}</span>
    ) },
    { key: 'service', header: t('payOcean.col_service'), cls: 'muted', cell: e => service(e.joining_date as string | null) },
    { key: 'earned', header: t('payOcean.col_earned_days'), num: true, cls: 'muted', cell: e => balanceOf(e).earned },
    { key: 'paid', header: t('payOcean.col_paid_days'), num: true, cls: 'muted', cell: e => balanceOf(e).paid },
    { key: 'balance', header: t('payOcean.col_balance_days'), num: true, cls: 'strong', cell: e => balanceOf(e).balance, foot: totalBalance },
    { key: 'payable', header: t('payOcean.col_payable'), num: true, cls: 'strong', cell: e => fmt(payableOf(e)), foot: fmt(totalPayable) },
    { key: 'pay', header: '', cell: e => (
      <Button size="sm" variant="secondary" disabled={balanceOf(e).balance <= 0} onClick={() => openPay(e)}>
        <Wallet size={14} aria-hidden="true" /> {t('payOcean.pay')}
      </Button>
    ) },
  ];

  const paymentCols: ReportColumn<LeaveSalaryRow>[] = [
    { key: 'emp', header: t('payOcean.col_employee'), cls: 'strong', cell: r => empMap[r.employee_id]?.name ?? '—' },
    { key: 'days', header: t('payOcean.col_days'), num: true, cls: 'muted', cell: r => Number(r.days) },
    { key: 'date', header: t('payOcean.col_date_paid'), cls: 'muted', cell: r => <Num>{formatDate(r.date)}</Num> },
    { key: 'amount', header: t('common.amount'), num: true, cls: 'strong', cell: r => fmt(Number(r.amount)) },
    { key: 'status', header: '', cell: r => <StatusBadge status={r.status} /> },
  ];

  return (
    // Ocean Teal (UI v1.1): look only — same balance maths, pay-out and
    // posting as before.
    <OceanPage
      testid="leave-salary-ocean"
      title={t('payOcean.leave_title')}
      subtitle={t('payOcean.leave_subtitle')}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* ── Leave balances ── */}
        <ReportCard
          title={t('payOcean.balances_title')}
          figures={activeEmps.length > 0 ? [
            { label: t('payOcean.fig_active'), value: <Num>{activeEmps.length}</Num> },
            { label: t('payOcean.fig_balance_days'), value: <Num>{totalBalance}</Num> },
            { label: t('payOcean.fig_payable'), value: <Num>{fmt(totalPayable)}</Num>, tone: 'warn', note: t('payOcean.fig_payable_note') },
          ] : undefined}
        >
          {activeEmps.length === 0
            ? <ReportMessage>{t('payOcean.no_active')}</ReportMessage>
            : <ReportTable columns={balanceCols} rows={activeEmps} rowKey={e => e.id} footLabel={t('rptOcean.total')} minWidth={820} />}
        </ReportCard>

        {/* ── Payment history ── */}
        <ReportCard
          title={t('payOcean.payments_title')}
          aside={paidTotal > 0 ? <span className="sb-pill sb-pill-good"><Num>{fmt(paidTotal)}</Num></span> : undefined}
        >
          {isLoading
            ? <ReportMessage>{t('common.loading')}</ReportMessage>
            : rows.length === 0
              ? <ReportMessage>{t('payOcean.no_payments')}</ReportMessage>
              : <ReportTable columns={paymentCols} rows={rows} rowKey={r => r.id} minWidth={560} />}
        </ReportCard>
      </div>

      {/* ── Pay modal ── */}
      <Modal open={open} onClose={() => setOpen(false)}
        title={selected ? t('payOcean.pay_leave_for', { name: selected.name }) : t('payOcean.pay_leave')}>
        <div className="sb-ocean sb-modal-form flex flex-col gap-4">
          {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}

          {selBal && (
            <div className="sb-card sb-rpt-card" style={{ boxShadow: 'none' }}>
              <ReportFigures figures={[
                { label: t('payOcean.earned'), value: <Num>{selBal.earned}</Num>, note: t('payOcean.days') },
                { label: t('payOcean.paid'), value: <Num>{selBal.paid}</Num>, note: t('payOcean.days') },
                { label: t('payOcean.balance'), value: <Num>{selBal.balance}</Num>, note: t('payOcean.days'), tone: 'brand' },
              ]} />
              <p className="sb-rpt-hint">
                {t(isIndia ? 'payOcean.wage_india' : 'payOcean.wage_gcc')}{' '}
                <bdi dir="ltr"><strong>{selected ? fmt(dailyWage(selected, isIndia)) : '—'}</strong></bdi> {t('payOcean.per_day')}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Input label={t('payOcean.f_days_to_pay')} dir="ltr" type="number" min="0" step="0.5" value={days} onChange={e => setDays(e.target.value)} />
            <Input label={t('payOcean.f_amount_auto')} dir="ltr" type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('payOcean.col_date_paid')} type="date" value={date} onChange={e => setDate(e.target.value)} />
            <Select label={t('payOcean.f_pay_from')} value={bankId} onChange={e => setBankId(e.target.value)}
              options={[{ value: '', label: t('payOcean.select_bank') }, ...banks.map(b => ({ value: b.id, label: b.name }))]} />
          </div>
          <p className="sb-info-note" style={{ fontSize: 13 }}>
            {t('payOcean.leave_explain', { count: Number(days) || 0 })}{' '}
            <bdi dir="ltr"><strong>Dr 6100 / Cr {t('payOcean.bank')}</strong></bdi>
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={payMutation.isPending}>{t('common.cancel')}</Button>
            <Button onClick={() => payMutation.mutate()} disabled={payMutation.isPending || !empId || !bankId || !(parseFloat(amount) > 0)}>
              {payMutation.isPending ? t('payOcean.posting') : t('payOcean.record_pay')}
            </Button>
          </div>
        </div>
      </Modal>
    </OceanPage>
  );
}
