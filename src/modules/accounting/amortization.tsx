import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { hasPerm } from '@/lib/permissions';
import { Button } from '@/ui/button';
import { Modal } from '@/ui/modal';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { DocLink } from '@/ui/doc-link';
import {
  projectSchedule, duePeriods, AMORTIZATION_KINDS, type AmortizationKind,
} from '@/lib/amortization';
import type {
  Company, CoaRow, TrialBalance,
  AmortizationScheduleRow, AmortizationScheduleInsert, AmortizationEntryRow,
  RunAmortizationResult,
} from '@/data/adapter';

/**
 * AC-6B — Prepaid & Deferred (amortization schedules), master-detail.
 *
 * Left: the schedule register with a coverage warning. Right: the selected
 * schedule's position, its posted installments (each drilling through to the
 * journal entry) and the projected remainder, plus Cancel / Reverse last.
 *
 * Run Amortization previews every installment that would be caught up, then
 * posts via run_amortization(). The preview uses src/lib/amortization.ts, which
 * MIRRORS the SQL helper _amortization_installment — it is not the authoritative
 * number, so the success panel reports the ACTUAL posted total.
 *
 * Account pickers are filtered BY KIND, which makes the classic mis-post
 * (crediting revenue on a prepaid) unreachable rather than merely discouraged.
 *
 * All posting requires accounting.write and is period-lock guarded by
 * post_journal_entry inside the RPCs.
 */

const MONEY = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function monthEndOf(year: number, month1: number): string {
  const d = new Date(Date.UTC(year, month1, 0)).getUTCDate();
  return `${year}-${String(month1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
/** Default run period = the last COMPLETED month-end. */
function defaultPeriodEnd(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();   // 0-based → previous month in 1-based terms
  return m === 0 ? monthEndOf(y - 1, 12) : monthEndOf(y, m);
}

/** Default balance-sheet account per kind. */
const DEFAULT_BS: Record<AmortizationKind, string> = {
  prepaid_expense:  '1410',
  deferred_revenue: '2500',
  accrued_expense:  '2300',
};

const emptyForm: AmortizationScheduleInsert = {
  kind: 'prepaid_expense',
  name: '', reference: '', contact_id: null,
  bs_account_code: '1410', pl_account_code: '',
  total_amount: 0, periods: 12, start_date: '',
  notes: '',
};

export default function AmortizationPage() {
  const { t } = useTranslation();
  const { company_id, role, permissions } = useAuthStore();
  const qc = useQueryClient();
  const canWrite = hasPerm(role, permissions, 'accounting.write');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<'all' | AmortizationKind>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed' | 'cancelled'>('all');
  const [search, setSearch] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AmortizationScheduleRow | null>(null);
  const [form, setForm] = useState<AmortizationScheduleInsert>(emptyForm);

  const [runOpen, setRunOpen] = useState(false);
  const [periodEnd, setPeriodEnd] = useState(defaultPeriodEnd());
  const [runResult, setRunResult] = useState<RunAmortizationResult | null>(null);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [reverseOpen, setReverseOpen] = useState(false);

  const { data: company } = useQuery<Company | null>({
    queryKey: ['company', company_id],
    queryFn: () => getAdapter().companies.getById(company_id!),
    enabled: !!company_id,
  });
  const currency = (company as any)?.currency ?? '';
  const lockDate: string | null = (company as any)?.period_lock_date ?? null;

  const { data: schedules = [], isLoading } = useQuery<AmortizationScheduleRow[]>({
    queryKey: ['amortization_schedules', company_id],
    queryFn: () => getAdapter().amortization.list(company_id!),
    enabled: !!company_id,
  });

  const { data: coa = [] } = useQuery<CoaRow[]>({
    queryKey: ['coa', company_id],
    queryFn: () => getAdapter().coa.list(company_id!),
    enabled: !!company_id,
  });

  // Trial balance drives the coverage warning (see below).
  const { data: tb } = useQuery<TrialBalance | null>({
    queryKey: ['tb_for_amortization', company_id, periodEnd],
    queryFn: () => getAdapter().accounting.getTrialBalance(company_id!, periodEnd),
    enabled: !!company_id,
  });

  const selected = schedules.find((s) => s.id === selectedId) ?? null;

  const { data: entries = [] } = useQuery<AmortizationEntryRow[]>({
    queryKey: ['amortization_entries', selectedId],
    queryFn: () => getAdapter().amortization.listEntries(selectedId!),
    enabled: !!selectedId,
  });

  // Account pickers, filtered by kind so a wrong-side post is unreachable.
  const bsAccounts = useMemo(() => {
    const active = coa.filter((c) => c.is_active);
    if (form.kind === 'prepaid_expense') return active.filter((c) => c.type === 'asset' && c.sub_type === 'current');
    return active.filter((c) => c.type === 'liability');
  }, [coa, form.kind]);
  const plAccounts = useMemo(() => {
    const active = coa.filter((c) => c.is_active);
    return form.kind === 'deferred_revenue'
      ? active.filter((c) => c.type === 'income')
      : active.filter((c) => c.type === 'expense');
  }, [coa, form.kind]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return schedules.filter((s) => {
      if (kindFilter !== 'all' && s.kind !== kindFilter) return false;
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q) || (s.reference ?? '').toLowerCase().includes(q);
    });
  }, [schedules, kindFilter, statusFilter, search]);

  const totals = useMemo(() => visible.reduce(
    (acc, s) => {
      if (s.status === 'cancelled') return acc;
      acc.total += Number(s.total_amount);
      acc.amortized += Number(s.amortized_amount);
      return acc;
    },
    { total: 0, amortized: 0 },
  ), [visible]);

  /**
   * Coverage warning — prepaid and deferred revenue draw an EXISTING balance
   * down, so the balance-sheet account must actually hold it. A shortfall means
   * the prepayment/receipt was never booked there and amortizing would drive the
   * account negative. Accruals BUILD a liability, so they need no coverage.
   */
  const coverage = useMemo(() => {
    if (!tb) return [];
    const byAccount = new Map<string, number>();
    for (const s of schedules) {
      if (s.status !== 'active') continue;
      if (s.kind === 'accrued_expense') continue;   // builds up; nothing to cover
      const remaining = round2(Number(s.total_amount) - Number(s.amortized_amount));
      if (remaining <= 0) continue;
      byAccount.set(s.bs_account_code, round2((byAccount.get(s.bs_account_code) ?? 0) + remaining));
    }
    const out: Array<{ code: string; name: string; needed: number; available: number }> = [];
    for (const [code, needed] of byAccount) {
      const line = tb.lines.find((l) => l.account_code === code);
      // asset accounts carry a debit balance, liabilities a credit balance
      const available = line
        ? round2(line.account_type === 'asset' ? line.debit - line.credit : line.credit - line.debit)
        : 0;
      if (available + 0.01 < needed) {
        out.push({ code, name: line?.account_name ?? code, needed, available });
      }
    }
    return out;
  }, [schedules, tb]);

  // ── Run preview (mirror of the SQL helper; NOT authoritative) ─────────────
  const runPreview = useMemo(() => {
    const rows: Array<{ s: AmortizationScheduleRow; periods: number; amount: number }> = [];
    for (const s of schedules) {
      if (s.status !== 'active') continue;
      const due = duePeriods(
        { total_amount: Number(s.total_amount), periods: s.periods, start_date: s.start_date },
        s.periods_posted,
        periodEnd,
      );
      if (due.length > 0) {
        rows.push({ s, periods: due.length, amount: round2(due.reduce((a, r) => a + r.amount, 0)) });
      }
    }
    return { rows, total: round2(rows.reduce((a, r) => a + r.amount, 0)) };
  }, [schedules, periodEnd]);

  const periodLocked = !!lockDate && periodEnd <= lockDate;

  // ── Mutations ─────────────────────────────────────────────────────────────
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['amortization_schedules', company_id] });
    qc.invalidateQueries({ queryKey: ['amortization_entries', selectedId] });
    qc.invalidateQueries({ queryKey: ['tb_for_amortization', company_id] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: AmortizationScheduleInsert = {
        ...form,
        total_amount: Number(form.total_amount),
        periods: Number(form.periods),
        reference: form.reference || null,
        contact_id: form.contact_id || null,
        notes: form.notes || null,
      };
      if (editing) await getAdapter().amortization.update(editing.id, payload);
      else {
        const created = await getAdapter().amortization.create(company_id!, payload);
        setSelectedId(created.id);
      }
    },
    onSuccess: () => { setFormOpen(false); invalidate(); },
  });

  const runMutation = useMutation({
    mutationFn: () => getAdapter().amortization.run(periodEnd),
    onSuccess: (res) => { setRunResult(res); invalidate(); },
  });

  const cancelMutation = useMutation({
    mutationFn: () => getAdapter().amortization.cancel(selected!.id, cancelReason || undefined),
    onSuccess: () => { setCancelOpen(false); setCancelReason(''); invalidate(); },
  });

  const reverseMutation = useMutation({
    mutationFn: () => getAdapter().amortization.reverseLast(selected!.id),
    onSuccess: () => { setReverseOpen(false); invalidate(); },
  });

  // ── Derived detail ────────────────────────────────────────────────────────
  const remaining = selected ? round2(Number(selected.total_amount) - Number(selected.amortized_amount)) : 0;

  const projected = useMemo(() => {
    if (!selected || selected.status === 'cancelled') return [];
    const all = projectSchedule({
      total_amount: Number(selected.total_amount), periods: selected.periods, start_date: selected.start_date,
    });
    const posted = new Set(entries.filter((e) => !e.reversed_at).map((e) => e.period_index));
    return all.filter((r) => !posted.has(r.index));
  }, [selected, entries]);

  const formPreview = useMemo(() => {
    if (!(Number(form.total_amount) > 0) || !form.start_date || !(Number(form.periods) > 0)) return null;
    const rows = projectSchedule({
      total_amount: Number(form.total_amount), periods: Number(form.periods), start_date: form.start_date,
    });
    return rows.length ? { first: rows[0].amount, last: rows[rows.length - 1], count: rows.length } : null;
  }, [form.total_amount, form.periods, form.start_date]);

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyForm, bs_account_code: DEFAULT_BS.prepaid_expense });
    setFormOpen(true);
  }
  function openEdit(s: AmortizationScheduleRow) {
    setEditing(s);
    setForm({
      kind: s.kind, name: s.name, reference: s.reference ?? '', contact_id: s.contact_id,
      bs_account_code: s.bs_account_code, pl_account_code: s.pl_account_code,
      total_amount: Number(s.total_amount), periods: s.periods, start_date: s.start_date,
      notes: s.notes ?? '',
    });
    setFormOpen(true);
  }
  /** Once anything is posted the basis is frozen — changing it would desync the
   *  schedule from its ledger. Descriptive fields stay editable. */
  const basisLocked = !!editing && editing.periods_posted > 0;

  function setKind(kind: AmortizationKind) {
    setForm((f) => ({ ...f, kind, bs_account_code: DEFAULT_BS[kind], pl_account_code: '' }));
  }

  const kindPill = (k: AmortizationScheduleRow['kind']) => {
    const map: Record<string, string> = {
      prepaid_expense:  'bg-brand-50 text-brand-600',
      deferred_revenue: 'bg-success-50 text-success-600',
      accrued_expense:  'bg-warning-50 text-warning-600',
    };
    return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[k]}`}>{t(`am.kind_${k}`)}</span>;
  };
  const statusPill = (s: AmortizationScheduleRow['status']) => {
    const map: Record<string, string> = {
      active: 'bg-success-50 text-success-600',
      completed: 'bg-surface-subtle text-ink-tertiary',
      cancelled: 'bg-danger-50 text-danger-600',
    };
    return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[s]}`}>{t(`am.status_${s}`)}</span>;
  };

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink-primary">{t('am.title')}</h1>
          <p className="text-xs text-ink-tertiary">{t('am.subtitle')}</p>
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => { setRunResult(null); runMutation.reset(); setRunOpen(true); }}>
              {t('am.run')}
            </Button>
            <Button size="sm" onClick={openCreate}>{t('am.new_schedule')}</Button>
          </div>
        )}
      </div>

      {/* Coverage warning — the balance-sheet account must hold what we amortize */}
      {coverage.length > 0 && (
        <div className="rounded-card border border-warning-500/40 bg-warning-50 px-4 py-3 text-sm text-warning-600">
          <p className="mb-1 font-medium">{t('am.coverage_title')}</p>
          <ul className="list-inside list-disc text-xs">
            {coverage.map((c) => (
              <li key={c.code}>
                {t('am.coverage_line', {
                  code: c.code, name: c.name,
                  needed: MONEY(c.needed), available: MONEY(c.available),
                })}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        {/* ── Register ────────────────────────────────────────────────────── */}
        <div className="glass-card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-3">
            <input
              className="h-9 flex-1 rounded-input border border-border-subtle bg-surface-input px-3 text-sm text-ink-primary focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder={t('am.search_placeholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="h-9 rounded-input border border-border-subtle bg-surface-input px-2 text-sm text-ink-primary focus:outline-none focus:ring-1 focus:ring-brand-500"
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)}
            >
              <option value="all">{t('am.filter_all_kinds')}</option>
              {AMORTIZATION_KINDS.map((k) => <option key={k} value={k}>{t(`am.kind_${k}`)}</option>)}
            </select>
            <select
              className="h-9 rounded-input border border-border-subtle bg-surface-input px-2 text-sm text-ink-primary focus:outline-none focus:ring-1 focus:ring-brand-500"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            >
              <option value="all">{t('am.filter_all_statuses')}</option>
              <option value="active">{t('am.status_active')}</option>
              <option value="completed">{t('am.status_completed')}</option>
              <option value="cancelled">{t('am.status_cancelled')}</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-subtle text-xs uppercase tracking-wide text-ink-tertiary">
                <tr>
                  <th className="px-4 py-2 text-start">{t('am.col_schedule')}</th>
                  <th className="px-4 py-2 text-start">{t('am.col_kind')}</th>
                  <th className="px-4 py-2 text-end">{t('am.col_total')}</th>
                  <th className="px-4 py-2 text-end">{t('am.col_amortized')}</th>
                  <th className="px-4 py-2 text-end">{t('am.col_remaining')}</th>
                  <th className="px-4 py-2 text-start">{t('am.col_status')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-ink-tertiary">{t('common.loading')}</td></tr>
                )}
                {!isLoading && visible.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-ink-tertiary">{t('am.empty')}</td></tr>
                )}
                {visible.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => setSelectedId(s.id)}
                    className={`cursor-pointer border-t border-border-subtle hover:bg-surface-subtle ${selectedId === s.id ? 'bg-brand-50' : ''}`}
                  >
                    <td className="px-4 py-2">
                      <span className="font-medium text-ink-primary">{s.name}</span>
                      {s.reference && <div className="text-xs text-ink-tertiary">{s.reference}</div>}
                      <div className="text-xs text-ink-tertiary">
                        {s.periods_posted}/{s.periods} {t('am.periods_posted')}
                      </div>
                    </td>
                    <td className="px-4 py-2">{kindPill(s.kind)}</td>
                    <td className="px-4 py-2 text-end text-ink-secondary">{MONEY(Number(s.total_amount))}</td>
                    <td className="px-4 py-2 text-end text-ink-secondary">{MONEY(Number(s.amortized_amount))}</td>
                    <td className="px-4 py-2 text-end font-medium text-ink-primary">
                      {MONEY(round2(Number(s.total_amount) - Number(s.amortized_amount)))}
                    </td>
                    <td className="px-4 py-2">{statusPill(s.status)}</td>
                  </tr>
                ))}
              </tbody>
              {visible.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border-strong bg-surface-subtle font-semibold text-ink-primary">
                    <td className="px-4 py-2" colSpan={2}>{t('am.totals_open')}</td>
                    <td className="px-4 py-2 text-end">{MONEY(totals.total)}</td>
                    <td className="px-4 py-2 text-end">{MONEY(totals.amortized)}</td>
                    <td className="px-4 py-2 text-end">{MONEY(round2(totals.total - totals.amortized))}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* ── Detail ──────────────────────────────────────────────────────── */}
        <div className="glass-card p-4">
          {!selected ? (
            <p className="py-10 text-center text-sm text-ink-tertiary">{t('am.select_hint')}</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-ink-primary">{selected.name}</h2>
                  <p className="text-xs text-ink-tertiary">
                    {t('am.detail_summary', { periods: selected.periods, start: selected.start_date })}
                  </p>
                  <p className="text-xs text-ink-tertiary">
                    {selected.bs_account_code} ↔ {selected.pl_account_code}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {kindPill(selected.kind)}
                  {statusPill(selected.status)}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-card bg-surface-subtle p-2">
                  <p className="text-xs text-ink-tertiary">{t('am.col_total')}</p>
                  <p className="text-sm font-semibold text-ink-primary">{MONEY(Number(selected.total_amount))}</p>
                </div>
                <div className="rounded-card bg-surface-subtle p-2">
                  <p className="text-xs text-ink-tertiary">{t('am.col_amortized')}</p>
                  <p className="text-sm font-semibold text-ink-primary">{MONEY(Number(selected.amortized_amount))}</p>
                </div>
                <div className="rounded-card bg-surface-subtle p-2">
                  <p className="text-xs text-ink-tertiary">{t('am.col_remaining')}</p>
                  <p className="text-sm font-semibold text-ink-primary">{MONEY(remaining)}</p>
                </div>
              </div>

              {selected.status === 'cancelled' && (
                <div className="rounded-card border border-border-subtle bg-surface-subtle p-3 text-xs text-ink-secondary">
                  <p>{t('am.cancelled_note', { remaining: MONEY(remaining) })}</p>
                  {selected.cancel_reason && <p className="mt-1 italic">{selected.cancel_reason}</p>}
                </div>
              )}

              {canWrite && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => openEdit(selected)}>{t('common.edit')}</Button>
                  {entries.some((e) => !e.reversed_at) && (
                    <Button size="sm" variant="danger" onClick={() => { reverseMutation.reset(); setReverseOpen(true); }}>
                      {t('am.reverse_last')}
                    </Button>
                  )}
                  {selected.status === 'active' && (
                    <Button size="sm" variant="danger" onClick={() => { cancelMutation.reset(); setCancelOpen(true); }}>
                      {t('am.cancel_schedule')}
                    </Button>
                  )}
                </div>
              )}

              {/* Schedule: posted then projected */}
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">{t('am.schedule')}</p>
                <div className="max-h-80 overflow-y-auto rounded-card border border-border-subtle">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-surface-subtle text-ink-tertiary">
                      <tr>
                        <th className="px-2 py-1.5 text-start">#</th>
                        <th className="px-2 py-1.5 text-start">{t('am.col_period')}</th>
                        <th className="px-2 py-1.5 text-end">{t('am.col_amount')}</th>
                        <th className="px-2 py-1.5 text-start">{t('am.col_entry')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e) => (
                        <tr key={e.id} className={`border-t border-border-subtle ${e.reversed_at ? 'text-ink-tertiary line-through' : ''}`}>
                          <td className="px-2 py-1.5">{e.period_index}</td>
                          <td className="px-2 py-1.5">{e.period_end}</td>
                          <td className="px-2 py-1.5 text-end">{MONEY(Number(e.amount))}</td>
                          <td className="px-2 py-1.5">
                            {e.journal_entry_id
                              ? <DocLink type="journal_entry" id={e.journal_entry_id} status={e.reversed_at ? 'reversed' : 'active'} />
                              : '—'}
                          </td>
                        </tr>
                      ))}
                      {projected.map((r) => (
                        <tr key={`p-${r.index}`} className="border-t border-border-subtle text-ink-tertiary">
                          <td className="px-2 py-1.5">{r.index}</td>
                          <td className="px-2 py-1.5">{r.period_end}</td>
                          <td className="px-2 py-1.5 text-end">{MONEY(r.amount)}</td>
                          <td className="px-2 py-1.5 italic">{t('am.projected')}</td>
                        </tr>
                      ))}
                      {entries.length === 0 && projected.length === 0 && (
                        <tr><td colSpan={4} className="px-2 py-4 text-center text-ink-tertiary">{t('am.no_schedule')}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Schedule form ────────────────────────────────────────────────── */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? t('am.edit_schedule') : t('am.new_schedule')} width="lg">
        <div className="space-y-3">
          {basisLocked && (
            <p className="rounded-card border border-warning-500/40 bg-warning-50 px-3 py-2 text-xs text-warning-600">
              {t('am.basis_locked')}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Select
              label={t('am.f_kind')}
              options={AMORTIZATION_KINDS.map((k) => ({ value: k, label: t(`am.kind_${k}`) }))}
              value={form.kind}
              disabled={basisLocked}
              onChange={(e) => setKind(e.target.value as AmortizationKind)}
            />
            <Input label={t('am.f_name')} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input label={t('am.f_reference')} value={form.reference ?? ''} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            <Input label={t('am.f_start_date')} type="date" required value={form.start_date} disabled={basisLocked}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            <Input label={`${t('am.f_total')} (${currency})`} type="number" step="0.01" min="0.01" required
              value={String(form.total_amount)} disabled={basisLocked}
              onChange={(e) => setForm({ ...form, total_amount: Number(e.target.value) })} />
            <Input label={t('am.f_periods')} type="number" min="1" required value={String(form.periods)} disabled={basisLocked}
              onChange={(e) => setForm({ ...form, periods: Number(e.target.value) })} />
            <Select
              label={t('am.f_bs_account')}
              options={bsAccounts.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))}
              value={form.bs_account_code}
              disabled={basisLocked}
              onChange={(e) => setForm({ ...form, bs_account_code: e.target.value })}
            />
            <Select
              label={form.kind === 'deferred_revenue' ? t('am.f_revenue_account') : t('am.f_expense_account')}
              options={[{ value: '', label: t('am.select_account') }, ...plAccounts.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))]}
              value={form.pl_account_code}
              disabled={basisLocked}
              onChange={(e) => setForm({ ...form, pl_account_code: e.target.value })}
            />
          </div>

          <p className="rounded-card bg-surface-subtle px-3 py-2 text-xs text-ink-secondary">
            {t(`am.direction_${form.kind}`)}
          </p>

          {formPreview && (
            <p className="rounded-card bg-surface-subtle px-3 py-2 text-xs text-ink-secondary">
              {t('am.form_preview', {
                first: MONEY(formPreview.first),
                count: formPreview.count,
                last: MONEY(formPreview.last.amount),
                end: formPreview.last.period_end,
              })}
            </p>
          )}

          {saveMutation.error && <p className="text-xs text-danger-600">{(saveMutation.error as Error).message}</p>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setFormOpen(false)}>{t('common.cancel')}</Button>
          <Button size="sm" onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !form.name || !form.start_date || !form.pl_account_code
              || !form.bs_account_code || !(Number(form.total_amount) > 0) || !(Number(form.periods) > 0)}>
            {t('common.save')}
          </Button>
        </div>
      </Modal>

      {/* ── Run amortization ─────────────────────────────────────────────── */}
      <Modal open={runOpen} onClose={() => setRunOpen(false)} title={t('am.run')} width="lg">
        {runResult ? (
          <div className="space-y-3">
            <div className="rounded-card border border-success-500/40 bg-success-50 px-3 py-3 text-sm text-success-600">
              <p className="font-semibold">{t('am.run_done')}</p>
              <p className="text-xs">
                {t('am.run_done_detail', {
                  count: runResult.entries_posted,
                  total: MONEY(Number(runResult.total_amount)),
                  period: runResult.period_end,
                })}
              </p>
            </div>
            <p className="text-xs text-ink-tertiary">{t('am.run_posted_note')}</p>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setRunOpen(false)}>{t('common.done')}</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Input label={t('am.f_period_end')} type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            {periodLocked && (
              <p className="rounded-card border border-danger-500/40 bg-danger-50 px-3 py-2 text-xs text-danger-600">
                {t('am.period_locked', { lock: lockDate })}
              </p>
            )}
            <div className="max-h-72 overflow-y-auto rounded-card border border-border-subtle">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface-subtle text-ink-tertiary">
                  <tr>
                    <th className="px-2 py-1.5 text-start">{t('am.col_schedule')}</th>
                    <th className="px-2 py-1.5 text-end">{t('am.col_periods')}</th>
                    <th className="px-2 py-1.5 text-end">{t('am.col_amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {runPreview.rows.map((r) => (
                    <tr key={r.s.id} className="border-t border-border-subtle">
                      <td className="px-2 py-1.5 text-ink-primary">{r.s.name}</td>
                      <td className="px-2 py-1.5 text-end text-ink-secondary">{r.periods}</td>
                      <td className="px-2 py-1.5 text-end text-ink-secondary">{MONEY(r.amount)}</td>
                    </tr>
                  ))}
                  {runPreview.rows.length === 0 && (
                    <tr><td colSpan={3} className="px-2 py-4 text-center text-ink-tertiary">{t('am.nothing_due')}</td></tr>
                  )}
                </tbody>
                {runPreview.rows.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-border-strong bg-surface-subtle font-semibold text-ink-primary">
                      <td className="px-2 py-1.5" colSpan={2}>{t('am.total_to_post')}</td>
                      <td className="px-2 py-1.5 text-end">{MONEY(runPreview.total)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <p className="text-xs text-ink-tertiary">{t('am.run_preview_note')}</p>
            {runMutation.error && <p className="text-xs text-danger-600">{(runMutation.error as Error).message}</p>}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setRunOpen(false)}>{t('common.cancel')}</Button>
              <Button size="sm" onClick={() => runMutation.mutate()}
                disabled={runMutation.isPending || runPreview.rows.length === 0 || periodLocked}>
                {t('am.post')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Cancel schedule ──────────────────────────────────────────────── */}
      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title={t('am.cancel_schedule')} width="md">
        <p className="text-sm text-ink-secondary">{t('am.cancel_confirm', { remaining: MONEY(remaining) })}</p>
        <div className="mt-3">
          <Input label={t('am.cancel_reason')} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
        </div>
        {cancelMutation.error && <p className="mt-2 text-xs text-danger-600">{(cancelMutation.error as Error).message}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setCancelOpen(false)}>{t('common.back')}</Button>
          <Button size="sm" variant="danger" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
            {t('am.confirm_cancel')}
          </Button>
        </div>
      </Modal>

      {/* ── Reverse last installment ─────────────────────────────────────── */}
      <Modal open={reverseOpen} onClose={() => setReverseOpen(false)} title={t('am.reverse_last')} width="md">
        <p className="text-sm text-ink-secondary">{t('am.reverse_confirm')}</p>
        {reverseMutation.error && <p className="mt-2 text-xs text-danger-600">{(reverseMutation.error as Error).message}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setReverseOpen(false)}>{t('common.cancel')}</Button>
          <Button size="sm" variant="danger" onClick={() => reverseMutation.mutate()} disabled={reverseMutation.isPending}>
            {t('am.confirm_reverse')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
