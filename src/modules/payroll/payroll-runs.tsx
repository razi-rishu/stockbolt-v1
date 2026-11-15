/**
 * Payroll Runs list — Payroll P1 (owner override 2026-06-13).
 *
 * One run per calendar month (DB-enforced unique). "New run" pre-fills
 * one item per active employee from their salary structure, then opens
 * the run editor for adjustments (overtime / bonus / deductions / loans).
 */
import { useState } from 'react';
import { formatDate } from '@/lib/locale';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Button } from '@/ui/button';
import { Modal } from '@/ui/modal';
import { Select } from '@/ui/select';
import { StatusBadge } from '@/ui/status-badge';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import { ReportFigures } from '@/components/ocean-report';
import type { Column } from '@/ui/table';
import { usePeriodPicker } from '@/hooks/use-period-picker';
import { PeriodPicker } from '@/ui/period-picker';
import { VoidedToggle } from '@/ui/voided-toggle';
import { useHideVoided, showsInList } from '@/hooks/use-hide-voided';
import type { PayrollRunRow, PayrollRunItemInsert, EmployeeRow } from '@/data/adapter';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PayrollRunsPage() {
  const { t, i18n } = useTranslation();
  const { company_id } = useAuthStore();
  const navigate = useNavigate();
  // Month names in the screen language.
  const monthName = (m: number) => new Date(2000, m - 1, 1).toLocaleString(i18n.language, { month: 'long' });
  const qc = useQueryClient();

  const now = new Date();
  const [newOpen, setNewOpen] = useState(false);
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [error, setError] = useState<string | null>(null);
  // Phase 47c — period filter (default All time = show every run).
  const { preset, from, to, setPreset, setCustomRange } = usePeriodPicker('stockbolt.list.payroll-runs.period', 'all_time');
  const { hideVoided, setHideVoided } = useHideVoided('stockbolt.list.payroll-runs.voided');

  const { data: allRuns = [], isLoading } = useQuery<PayrollRunRow[]>({
    queryKey: ['payroll_runs', company_id],
    queryFn: () => getAdapter().payroll.listRuns(company_id!),
    enabled: !!company_id,
  });
  const runsInPeriod = allRuns.filter(r => {
    if (from && (r.date as string) < from) return false;
    if (to && (r.date as string) > to) return false;
    return true;
  });
  // Z4 — the count is what THIS period is holding back, not all
  // history, so "Show 2 voided" always reveals exactly two.
  const runsVoidedCount = runsInPeriod.filter(r => r.status === 'void').length;
  const runs = runsInPeriod.filter(r => showsInList(r, hideVoided));

  const { data: employees = [] } = useQuery<EmployeeRow[]>({
    queryKey: ['employees', company_id, false],
    queryFn: () => getAdapter().employees.list(company_id!),
    enabled: !!company_id,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (employees.length === 0) throw new Error(t('payOcean.err_no_employees'));
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
        ? t('payOcean.err_run_exists', { period: `${monthName(month)} ${year}` })
        : e.message);
    },
  });

  const live = runs.filter(r => r.status !== 'void');
  const totalNet = live.reduce((s, r) => s + Number(r.total_net), 0);
  const unpaidNet = live.filter(r => r.status === 'confirmed').reduce((s, r) => s + Number(r.total_net), 0);

  const columns: Column<PayrollRunRow>[] = [
    { key: 'period', header: t('payOcean.col_period'), render: r => (
      <span className="sb-pay-namecode">
        <span style={{ fontWeight: 700 }}>{monthName(r.period_month)} <bdi dir="ltr">{r.period_year}</bdi></span>
        <bdi dir="ltr" className="sb-acct-code">{r.run_number}</bdi>
      </span>
    ) },
    { key: 'date', header: t('payOcean.col_posting_date'), render: r => <bdi dir="ltr">{formatDate(r.date)}</bdi> },
    { key: 'gross', header: t('payOcean.col_gross'), align: 'end', render: r => <bdi dir="ltr" className="sb-dash-num" style={{ fontWeight: 500 }}>{fmt(Number(r.total_gross))}</bdi> },
    { key: 'deductions', header: t('payOcean.col_deductions'), align: 'end', render: r => <bdi dir="ltr" className="sb-dash-num" style={{ fontWeight: 500, color: 'var(--sb-text-secondary)' }}>{fmt(Number(r.total_deductions) + Number(r.total_loan_repayment))}</bdi> },
    { key: 'net', header: t('payOcean.col_net'), align: 'end', render: r => <bdi dir="ltr" className="sb-dash-num">{fmt(Number(r.total_net))}</bdi> },
    { key: 'status', header: '', render: r => <StatusBadge status={r.status} /> },
  ];

  return (
    // Ocean Teal (UI v1.1): look only — same runs, period filter, voided
    // toggle and "new run" pre-fill as before.
    <OceanPage
      testid="payroll-runs-ocean"
      title={t('payOcean.runs_title')}
      subtitle={t('payOcean.runs_subtitle')}
      actions={<>
        <PeriodPicker mode="range" allowAllTime preset={preset} from={from} to={to} onPresetChange={setPreset} onCustomRange={setCustomRange} />
        <VoidedToggle hideVoided={hideVoided} onChange={setHideVoided} count={runsVoidedCount} />
        <button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => { setError(null); setNewOpen(true); }}>
          <Plus size={18} aria-hidden="true" /> {t('payOcean.new_run')}
        </button>
      </>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {runs.length > 0 && (
          <div className="sb-card sb-rpt-card">
            <ReportFigures figures={[
              { label: t('payOcean.fig_runs'), value: <bdi dir="ltr">{live.length}</bdi> },
              { label: t('payOcean.fig_net_total'), value: <bdi dir="ltr">{fmt(totalNet)}</bdi>, tone: 'brand' },
              { label: t('payOcean.fig_unpaid'), value: <bdi dir="ltr">{fmt(unpaidNet)}</bdi>, tone: unpaidNet > 0 ? 'warn' : undefined, note: t('payOcean.fig_unpaid_note') },
            ]} />
          </div>
        )}

        {isLoading
          ? <div className="sb-card sb-empty">{t('common.loading')}</div>
          : <OceanTable
              columns={columns} rows={runs} keyFn={r => r.id} onRowClick={r => navigate(`/payroll/runs/${r.id}`)}
              rowMuted={r => r.status === 'void'} emptyMessage={t('payOcean.runs_empty')} cardTitleKey="period"
            />}
      </div>

      {/* ── New run modal ── */}
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title={t('payOcean.new_run_title')}>
        <div className="sb-ocean sb-modal-form flex flex-col gap-4">
          {error && <p className="sb-alert sb-alert-danger" role="alert">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Select label={t('payOcean.f_month')} value={String(month)} onChange={e => setMonth(parseInt(e.target.value))}
              options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: monthName(i + 1) }))} />
            <Select label={t('payOcean.f_year')} value={String(year)} onChange={e => setYear(parseInt(e.target.value))}
              options={[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => ({ value: String(y), label: String(y) }))} />
          </div>
          <p className="sb-info-note" style={{ fontSize: 13 }}>{t('payOcean.new_run_body', { count: employees.length })}</p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setNewOpen(false)} disabled={createMutation.isPending}>{t('common.cancel')}</Button>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
              {createMutation.isPending ? t('payOcean.creating') : t('payOcean.create_draft')}
            </Button>
          </div>
        </div>
      </Modal>
    </OceanPage>
  );
}
