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
import { OceanPage } from '@/components/ocean-list';
import { AlertTriangle, CalendarClock, CalendarRange, PlayCircle, Plus, Search, Undo2, XCircle } from 'lucide-react';
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
 * Ocean Teal layout (2026-11): look only, same data and actions.
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
      prepaid_expense:  '',
      deferred_revenue: 'sb-pill-good',
      accrued_expense:  'sb-pill-warn',
    };
    return <span className={`sb-pill ${map[k]}`}>{t(`am.kind_${k}`)}</span>;
  };
  const statusPill = (s: AmortizationScheduleRow['status']) => {
    const map: Record<string, string> = {
      active: 'sb-pill-good',
      completed: 'sb-pill-muted',
      cancelled: 'sb-pill-bad',
    };
    return <span className={`sb-pill ${map[s]}`}>{t(`am.status_${s}`)}</span>;
  };

  return (
    <OceanPage
      testid="amortization-ocean"
      title={t('am.title')}
      subtitle={t('am.subtitle')}
      actions={canWrite ? (
        <>
          <Button variant="secondary" size="sm" onClick={() => { setRunResult(null); runMutation.reset(); setRunOpen(true); }}>
            <PlayCircle size={15} aria-hidden="true" /> {t('am.run')}
          </Button>
          <Button size="sm" onClick={openCreate}><Plus size={15} aria-hidden="true" /> {t('am.new_schedule')}</Button>
        </>
      ) : undefined}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Coverage warning — the balance-sheet account must hold what we amortize */}
      {coverage.length > 0 && (
        <div className="sb-alert sb-alert-warn" style={{ display: 'flex', gap: 10 }}>
          <AlertTriangle size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
          <p style={{ margin: '0 0 4px' }}>{t('am.coverage_title')}</p>
          <ul className="list-inside list-disc" style={{ margin: 0, fontWeight: 500, fontSize: 13 }}>
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
        </div>
      )}

      <div className="sb-acct-md">
        {/* ── Register ────────────────────────────────────────────────────── */}
        <div className="sb-card sb-doc-card sb-doc-lines">
          <div className="sb-doc-lines-head sb-acct-filterbar">
            <label className="sb-search" style={{ margin: 0, flex: 1, minWidth: 180 }}>
              <Search size={18} className="sb-icon" aria-hidden="true" />
              <span className="sr-only">{t('am.search_placeholder')}</span>
              <input
                type="search"
                placeholder={t('am.search_placeholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <select
              className="sb-pc-select"
              style={{ width: 'auto' }}
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)}
            >
              <option value="all">{t('am.filter_all_kinds')}</option>
              {AMORTIZATION_KINDS.map((k) => <option key={k} value={k}>{t(`am.kind_${k}`)}</option>)}
            </select>
            <select
              className="sb-pc-select"
              style={{ width: 'auto' }}
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
            <table className="w-full text-sm" style={{ minWidth: 640 }}>
              <thead>
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
                  <tr><td colSpan={6} className="sb-empty text-center">{t('common.loading')}</td></tr>
                )}
                {!isLoading && visible.length === 0 && (
                  <tr><td colSpan={6} className="sb-empty text-center">{t('am.empty')}</td></tr>
                )}
                {visible.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => setSelectedId(s.id)}
                    className={`sb-acct-row ${selectedId === s.id ? 'is-selected' : ''}`}
                  >
                    <td className="px-4 py-2">
                      <span className="font-medium">{s.name}</span>
                      {s.reference && <div className="sb-fx-name" style={{ fontSize: 12 }}>{s.reference}</div>}
                      <div className="sb-acct-progress" aria-hidden="true">
                        <span style={{ width: `${s.periods ? Math.min(100, (Number(s.periods_posted) / Number(s.periods)) * 100) : 0}%` }} />
                      </div>
                      <div className="sb-fx-name" style={{ fontSize: 12 }}>
                        <bdi dir="ltr">{s.periods_posted}/{s.periods}</bdi> {t('am.periods_posted')}
                      </div>
                    </td>
                    <td className="px-4 py-2">{kindPill(s.kind)}</td>
                    <td className="px-4 py-2 text-end text-ink-secondary"><bdi dir="ltr">{MONEY(Number(s.total_amount))}</bdi></td>
                    <td className="px-4 py-2 text-end text-ink-secondary"><bdi dir="ltr">{MONEY(Number(s.amortized_amount))}</bdi></td>
                    <td className="px-4 py-2 text-end">
                      <bdi dir="ltr" className="sb-dash-num">{MONEY(round2(Number(s.total_amount) - Number(s.amortized_amount)))}</bdi>
                    </td>
                    <td className="px-4 py-2">{statusPill(s.status)}</td>
                  </tr>
                ))}
              </tbody>
              {visible.length > 0 && (
                <tfoot>
                  <tr className="sb-acct-total-row">
                    <td className="px-4 py-2" colSpan={2}>{t('am.totals_open')}</td>
                    <td className="px-4 py-2 text-end"><bdi dir="ltr">{MONEY(totals.total)}</bdi></td>
                    <td className="px-4 py-2 text-end"><bdi dir="ltr">{MONEY(totals.amortized)}</bdi></td>
                    <td className="px-4 py-2 text-end"><bdi dir="ltr">{MONEY(round2(totals.total - totals.amortized))}</bdi></td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* ── Detail ──────────────────────────────────────────────────────── */}
        <div className="sb-card sb-doc-card sb-acct-detail">
          {!selected ? (
            <div className="sb-acct-empty">
              <span className="sb-side-ico" style={{ background: 'var(--sb-primary-light)', color: 'var(--sb-primary-dark)' }} aria-hidden="true"><CalendarRange size={18} /></span>
              <p className="sb-fx-name" style={{ margin: 0 }}>{t('am.select_hint')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
                  <span className="sb-side-ico" style={{ background: 'var(--sb-primary-light)', color: 'var(--sb-primary-dark)' }} aria-hidden="true"><CalendarRange size={17} /></span>
                  <div style={{ minWidth: 0 }}>
                  <h2 className="sb-doc-card-title" style={{ margin: 0 }}>{selected.name}</h2>
                  <p className="sb-fx-name" style={{ margin: 0, fontSize: 12 }}>
                    {t('am.detail_summary', { periods: selected.periods, start: selected.start_date })}
                  </p>
                  <p style={{ margin: '2px 0 0' }}>
                    <bdi dir="ltr" className="sb-acct-code">{selected.bs_account_code} ↔ {selected.pl_account_code}</bdi>
                  </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {kindPill(selected.kind)}
                  {statusPill(selected.status)}
                </div>
              </div>

              <div className="sb-acct-tiles">
                <div><span className="sb-info-label">{t('am.col_total')}</span><bdi dir="ltr" className="sb-dash-num">{MONEY(Number(selected.total_amount))}</bdi></div>
                <div><span className="sb-info-label">{t('am.col_amortized')}</span><bdi dir="ltr" className="sb-dash-num">{MONEY(Number(selected.amortized_amount))}</bdi></div>
                <div><span className="sb-info-label">{t('am.col_remaining')}</span><bdi dir="ltr" className="sb-dash-num" style={{ color: 'var(--sb-primary-dark)' }}>{MONEY(remaining)}</bdi></div>
              </div>

              {selected.status === 'cancelled' && (
                <div className="sb-info-note" style={{ fontSize: 13 }}>
                  <p style={{ margin: 0 }}>{t('am.cancelled_note', { remaining: MONEY(remaining) })}</p>
                  {selected.cancel_reason && <p style={{ margin: '4px 0 0', fontStyle: 'italic' }}>{selected.cancel_reason}</p>}
                </div>
              )}

              {canWrite && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => openEdit(selected)}>{t('common.edit')}</Button>
                  {entries.some((e) => !e.reversed_at) && (
                    <Button size="sm" variant="danger" onClick={() => { reverseMutation.reset(); setReverseOpen(true); }}>
                      <Undo2 size={15} aria-hidden="true" /> {t('am.reverse_last')}
                    </Button>
                  )}
                  {selected.status === 'active' && (
                    <Button size="sm" variant="danger" onClick={() => { cancelMutation.reset(); setCancelOpen(true); }}>
                      <XCircle size={15} aria-hidden="true" /> {t('am.cancel_schedule')}
                    </Button>
                  )}
                </div>
              )}

              {/* Schedule: posted then projected */}
              <div>
                <p className="sb-acct-label" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}><CalendarClock size={14} aria-hidden="true" />{t('am.schedule')}</p>
                <div className="sb-acct-schedule">
                  <table className="w-full text-xs">
                    <thead>
                      <tr>
                        <th className="px-2 py-1.5 text-start">#</th>
                        <th className="px-2 py-1.5 text-start">{t('am.col_period')}</th>
                        <th className="px-2 py-1.5 text-end">{t('am.col_amount')}</th>
                        <th className="px-2 py-1.5 text-start">{t('am.col_entry')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e) => (
                        <tr key={e.id} className={e.reversed_at ? 'sb-acct-reversed' : undefined}>
                          <td className="px-2 py-1.5">{e.period_index}</td>
                          <td className="px-2 py-1.5"><bdi dir="ltr">{e.period_end}</bdi></td>
                          <td className="px-2 py-1.5 text-end"><bdi dir="ltr">{MONEY(Number(e.amount))}</bdi></td>
                          <td className="px-2 py-1.5">
                            {e.journal_entry_id
                              ? <DocLink type="journal_entry" id={e.journal_entry_id} status={e.reversed_at ? 'reversed' : 'active'} />
                              : '—'}
                          </td>
                        </tr>
                      ))}
                      {projected.map((r) => (
                        <tr key={`p-${r.index}`} className="sb-acct-projected">
                          <td className="px-2 py-1.5">{r.index}</td>
                          <td className="px-2 py-1.5"><bdi dir="ltr">{r.period_end}</bdi></td>
                          <td className="px-2 py-1.5 text-end"><bdi dir="ltr">{MONEY(r.amount)}</bdi></td>
                          <td className="px-2 py-1.5"><span className="sb-pill sb-pill-muted" style={{ fontSize: 11, padding: '1px 8px' }}>{t('am.projected')}</span></td>
                        </tr>
                      ))}
                      {entries.length === 0 && projected.length === 0 && (
                        <tr><td colSpan={4} className="sb-empty text-center">{t('am.no_schedule')}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      </div>

      {/* ── Schedule form ────────────────────────────────────────────────── */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? t('am.edit_schedule') : t('am.new_schedule')} width="lg">
        <div className="sb-ocean sb-modal-form space-y-3">
          {basisLocked && (
            <p className="sb-alert sb-alert-warn">
              {t('am.basis_locked')}
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

          <p className="sb-info-note">
            {t(`am.direction_${form.kind}`)}
          </p>

          {formPreview && (
            <p className="sb-info-note">
              {t('am.form_preview', {
                first: MONEY(formPreview.first),
                count: formPreview.count,
                last: MONEY(formPreview.last.amount),
                end: formPreview.last.period_end,
              })}
            </p>
          )}

          {saveMutation.error && <p className="sb-alert sb-alert-danger">{(saveMutation.error as Error).message}</p>}
        </div>
        <div className="sb-ocean sb-modal-foot mt-4 flex justify-end gap-2">
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
          <div className="sb-ocean sb-modal-form space-y-3">
            <div className="sb-alert sb-alert-good">
              <p style={{ margin: 0 }}>{t('am.run_done')}</p>
              <p style={{ margin: 0, fontWeight: 500, fontSize: 13 }}>
                {t('am.run_done_detail', {
                  count: runResult.entries_posted,
                  total: MONEY(Number(runResult.total_amount)),
                  period: runResult.period_end,
                })}
              </p>
            </div>
            <p className="sb-form-hint" style={{ margin: 0 }}>{t('am.run_posted_note')}</p>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setRunOpen(false)}>{t('common.done')}</Button>
            </div>
          </div>
        ) : (
          <div className="sb-ocean sb-modal-form space-y-3">
            <Input label={t('am.f_period_end')} type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            {periodLocked && (
              <p className="sb-alert sb-alert-danger">
                {t('am.period_locked', { lock: lockDate })}
              </p>
            )}
            <div className="sb-acct-schedule">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="px-2 py-1.5 text-start">{t('am.col_schedule')}</th>
                    <th className="px-2 py-1.5 text-end">{t('am.col_periods')}</th>
                    <th className="px-2 py-1.5 text-end">{t('am.col_amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {runPreview.rows.map((r) => (
                    <tr key={r.s.id}>
                      <td className="px-2 py-1.5">{r.s.name}</td>
                      <td className="px-2 py-1.5 text-end text-ink-secondary">{r.periods}</td>
                      <td className="px-2 py-1.5 text-end"><bdi dir="ltr">{MONEY(r.amount)}</bdi></td>
                    </tr>
                  ))}
                  {runPreview.rows.length === 0 && (
                    <tr><td colSpan={3} className="sb-empty text-center">{t('am.nothing_due')}</td></tr>
                  )}
                </tbody>
                {runPreview.rows.length > 0 && (
                  <tfoot>
                    <tr className="sb-acct-total-row">
                      <td className="px-2 py-1.5" colSpan={2}>{t('am.total_to_post')}</td>
                      <td className="px-2 py-1.5 text-end"><bdi dir="ltr">{MONEY(runPreview.total)}</bdi></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <p className="sb-form-hint" style={{ margin: 0 }}>{t('am.run_preview_note')}</p>
            {runMutation.error && <p className="sb-alert sb-alert-danger">{(runMutation.error as Error).message}</p>}
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
        <div className="sb-ocean sb-modal-form space-y-3">
          <p className="sb-alert sb-alert-warn">{t('am.cancel_confirm', { remaining: MONEY(remaining) })}</p>
          <Input label={t('am.cancel_reason')} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          {cancelMutation.error && <p className="sb-alert sb-alert-danger">{(cancelMutation.error as Error).message}</p>}
        </div>
        <div className="sb-ocean sb-modal-foot mt-4 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setCancelOpen(false)}>{t('common.back')}</Button>
          <Button size="sm" variant="danger" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
            {t('am.confirm_cancel')}
          </Button>
        </div>
      </Modal>

      {/* ── Reverse last installment ─────────────────────────────────────── */}
      <Modal open={reverseOpen} onClose={() => setReverseOpen(false)} title={t('am.reverse_last')} width="md">
        <div className="sb-ocean sb-modal-form space-y-3">
          <p className="sb-alert sb-alert-warn">{t('am.reverse_confirm')}</p>
          {reverseMutation.error && <p className="sb-alert sb-alert-danger">{(reverseMutation.error as Error).message}</p>}
        </div>
        <div className="sb-ocean sb-modal-foot mt-4 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setReverseOpen(false)}>{t('common.cancel')}</Button>
          <Button size="sm" variant="danger" onClick={() => reverseMutation.mutate()} disabled={reverseMutation.isPending}>
            {t('am.confirm_reverse')}
          </Button>
        </div>
      </Modal>
    </OceanPage>
  );
}
