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
import { monthlyCharge, projectSchedule, type DepreciationAsset } from '@/lib/depreciation';
import type {
  Company, CoaRow, FixedAssetRow, FixedAssetInsert, DepreciationEntryRow,
  RunDepreciationResult, DisposeAssetResult,
} from '@/data/adapter';

/**
 * AC-5B — Fixed Assets (master-detail).
 *
 * Left: the asset register (filter + totals). Right: the selected asset's
 * position, its posted depreciation schedule (each row drills through to the
 * journal entry) and the projected remaining months, plus Dispose / Reverse.
 *
 * Run Depreciation previews the per-asset charge for every month that would be
 * caught up, then posts via run_depreciation(). The preview is computed with
 * src/lib/depreciation.ts, which MIRRORS the SQL helper _fixed_asset_monthly_charge
 * — it is not the authoritative number. The success panel therefore reports the
 * ACTUAL posted total so any drift between the two is visible immediately.
 *
 * All posting actions require accounting.write and are period-lock guarded by
 * post_journal_entry inside the RPCs.
 */

const MONEY = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Last day of the month containing `iso` (or of the previous month if asked). */
function monthEndOf(year: number, month1: number): string {
  const d = new Date(Date.UTC(year, month1, 0)).getUTCDate();
  return `${year}-${String(month1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
/** Default run period = the last COMPLETED month-end. */
function defaultPeriodEnd(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-based → previous month in 1-based terms
  return m === 0 ? monthEndOf(y - 1, 12) : monthEndOf(y, m);
}
function toDepAsset(a: FixedAssetRow): DepreciationAsset {
  return {
    cost: Number(a.cost),
    salvage_value: Number(a.salvage_value),
    useful_life_months: Number(a.useful_life_months),
    method: a.method,
    wdv_rate: Number(a.wdv_rate),
    in_service_date: a.in_service_date,
  };
}
/** Every month-end from the asset's next un-depreciated month through `to`. */
function pendingPeriods(a: FixedAssetRow, to: string): string[] {
  const out: string[] = [];
  const start = a.last_depreciated_period
    ? new Date(`${a.last_depreciated_period}T00:00:00Z`)
    : new Date(`${a.in_service_date}T00:00:00Z`);
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth() + 1;                    // 1-based
  if (a.last_depreciated_period) { m += 1; if (m > 12) { m = 1; y += 1; } }
  for (let guard = 0; guard < 600; guard++) {
    const pe = monthEndOf(y, m);
    if (pe > to) break;
    out.push(pe);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

const emptyForm: FixedAssetInsert = {
  name: '', asset_tag: '', category: '',
  acquisition_date: '', in_service_date: '',
  cost: 0, salvage_value: 0, useful_life_months: 60,
  method: 'straight_line', wdv_rate: 0,
  asset_account_code: '', accum_dep_account_code: '1790', expense_account_code: '6750',
  notes: '',
};

export default function FixedAssetsPage() {
  const { t } = useTranslation();
  const { company_id, role, permissions } = useAuthStore();
  const qc = useQueryClient();
  const canWrite = hasPerm(role, permissions, 'accounting.write');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disposed' | 'fully_depreciated'>('all');
  const [search, setSearch] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FixedAssetRow | null>(null);
  const [form, setForm] = useState<FixedAssetInsert>(emptyForm);

  const [runOpen, setRunOpen] = useState(false);
  const [periodEnd, setPeriodEnd] = useState(defaultPeriodEnd());
  const [runResult, setRunResult] = useState<RunDepreciationResult | null>(null);

  const [disposeOpen, setDisposeOpen] = useState(false);
  const [disposal, setDisposal] = useState({ date: '', proceeds: '0', account: '' });
  const [disposeResult, setDisposeResult] = useState<DisposeAssetResult | null>(null);
  const [reverseOpen, setReverseOpen] = useState(false);

  const { data: company } = useQuery<Company | null>({
    queryKey: ['company', company_id],
    queryFn: () => getAdapter().companies.getById(company_id!),
    enabled: !!company_id,
  });
  const currency = (company as any)?.currency ?? '';
  const lockDate: string | null = (company as any)?.period_lock_date ?? null;

  const { data: assets = [], isLoading } = useQuery<FixedAssetRow[]>({
    queryKey: ['fixed_assets', company_id],
    queryFn: () => getAdapter().fixedAssets.list(company_id!),
    enabled: !!company_id,
  });

  const { data: coa = [] } = useQuery<CoaRow[]>({
    queryKey: ['coa', company_id],
    queryFn: () => getAdapter().coa.list(company_id!),
    enabled: !!company_id,
  });
  const fixedAccounts = useMemo(
    () => coa.filter((c) => c.type === 'asset' && c.sub_type === 'fixed' && c.is_active && c.code !== '1790'),
    [coa],
  );
  const cashAccounts = useMemo(
    () => coa.filter((c) => c.type === 'asset' && c.sub_type === 'current' && c.is_active),
    [coa],
  );

  const selected = assets.find((a) => a.id === selectedId) ?? null;

  const { data: entries = [] } = useQuery<DepreciationEntryRow[]>({
    queryKey: ['depreciation_entries', selectedId],
    queryFn: () => getAdapter().fixedAssets.listEntries(selectedId!),
    enabled: !!selectedId,
  });

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assets.filter((a) => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (!q) return true;
      return a.name.toLowerCase().includes(q) || (a.asset_tag ?? '').toLowerCase().includes(q);
    });
  }, [assets, statusFilter, search]);

  const totals = useMemo(() => visible.reduce(
    (acc, a) => {
      if (a.status === 'disposed') return acc;   // disposed assets are off the books
      acc.cost += Number(a.cost);
      acc.accum += Number(a.accumulated_depreciation);
      return acc;
    },
    { cost: 0, accum: 0 },
  ), [visible]);

  // ── Run-depreciation preview (mirror of the SQL helper; NOT authoritative) ──
  const runPreview = useMemo(() => {
    const rows: Array<{ asset: FixedAssetRow; periods: number; charge: number }> = [];
    for (const a of assets) {
      if (a.status !== 'active') continue;
      if (a.in_service_date > periodEnd) continue;
      let accumulated = Number(a.accumulated_depreciation);
      let charge = 0;
      let periods = 0;
      for (const pe of pendingPeriods(a, periodEnd)) {
        const c = monthlyCharge(toDepAsset(a), pe, accumulated);
        if (c <= 0) break;
        accumulated = round2(accumulated + c);
        charge = round2(charge + c);
        periods += 1;
      }
      if (periods > 0) rows.push({ asset: a, periods, charge });
    }
    return { rows, total: round2(rows.reduce((s, r) => s + r.charge, 0)) };
  }, [assets, periodEnd]);

  const periodLocked = !!lockDate && periodEnd <= lockDate;

  // ── Mutations ─────────────────────────────────────────────────────────────
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['fixed_assets', company_id] });
    qc.invalidateQueries({ queryKey: ['depreciation_entries', selectedId] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: FixedAssetInsert = {
        ...form,
        cost: Number(form.cost), salvage_value: Number(form.salvage_value),
        useful_life_months: Number(form.useful_life_months), wdv_rate: Number(form.wdv_rate),
        asset_tag: form.asset_tag || null, category: form.category || null, notes: form.notes || null,
      };
      if (editing) await getAdapter().fixedAssets.update(editing.id, payload);
      else {
        const created = await getAdapter().fixedAssets.create(company_id!, payload);
        setSelectedId(created.id);
      }
    },
    onSuccess: () => { setFormOpen(false); invalidate(); },
  });

  const runMutation = useMutation({
    mutationFn: () => getAdapter().fixedAssets.runDepreciation(periodEnd),
    onSuccess: (res) => { setRunResult(res); invalidate(); },
  });

  const disposeMutation = useMutation({
    mutationFn: () => getAdapter().fixedAssets.dispose({
      asset_id: selected!.id,
      disposal_date: disposal.date,
      proceeds: Number(disposal.proceeds) || 0,
      proceeds_account_code: disposal.account,
    }),
    onSuccess: (res) => { setDisposeResult(res); invalidate(); },
  });

  const reverseMutation = useMutation({
    mutationFn: () => getAdapter().fixedAssets.reverseLast(selected!.id),
    onSuccess: () => { setReverseOpen(false); invalidate(); },
  });

  // ── Derived detail values ─────────────────────────────────────────────────
  const bookValue = selected ? round2(Number(selected.cost) - Number(selected.accumulated_depreciation)) : 0;
  const disposalGainLoss = selected ? round2((Number(disposal.proceeds) || 0) - bookValue) : 0;
  /** Disposing before catching depreciation up overstates the gain — warn. */
  const disposeNeedsCatchUp = !!selected && !!disposal.date &&
    pendingPeriods(selected, disposal.date).length > 0 && selected.status === 'active';

  const projected = useMemo(() => {
    if (!selected || selected.status === 'disposed') return [];
    const all = projectSchedule(toDepAsset(selected));
    const posted = new Set(entries.filter((e) => !e.reversed_at).map((e) => e.period_end));
    return all.filter((r) => !posted.has(r.period_end));
  }, [selected, entries]);

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyForm, asset_account_code: fixedAccounts[0]?.code ?? '' });
    setFormOpen(true);
  }
  function openEdit(a: FixedAssetRow) {
    setEditing(a);
    setForm({
      name: a.name, asset_tag: a.asset_tag ?? '', category: a.category ?? '',
      acquisition_date: a.acquisition_date, in_service_date: a.in_service_date,
      cost: Number(a.cost), salvage_value: Number(a.salvage_value),
      useful_life_months: Number(a.useful_life_months), method: a.method, wdv_rate: Number(a.wdv_rate),
      asset_account_code: a.asset_account_code, accum_dep_account_code: a.accum_dep_account_code,
      expense_account_code: a.expense_account_code, notes: a.notes ?? '',
    });
    setFormOpen(true);
  }

  /** Once anything is posted the basis is frozen — editing it would desync the
   *  asset from its ledger. Descriptive fields stay editable. */
  const basisLocked = !!editing && Number(editing.accumulated_depreciation) > 0;

  const statusPill = (s: FixedAssetRow['status']) => {
    const map: Record<string, string> = {
      active: 'bg-success-50 text-success-600',
      fully_depreciated: 'bg-surface-subtle text-ink-tertiary',
      disposed: 'bg-danger-50 text-danger-600',
    };
    return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[s]}`}>{t(`fa.status_${s}`)}</span>;
  };

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink-primary">{t('fa.title')}</h1>
          <p className="text-xs text-ink-tertiary">{t('fa.subtitle')}</p>
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => { setRunResult(null); runMutation.reset(); setRunOpen(true); }}>
              {t('fa.run_depreciation')}
            </Button>
            <Button size="sm" onClick={openCreate} disabled={fixedAccounts.length === 0}>
              {t('fa.new_asset')}
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        {/* ── Register ────────────────────────────────────────────────────── */}
        <div className="glass-card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-3">
            <input
              className="h-9 flex-1 rounded-input border border-border-subtle bg-surface-input px-3 text-sm text-ink-primary focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder={t('fa.search_placeholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="h-9 rounded-input border border-border-subtle bg-surface-input px-2 text-sm text-ink-primary focus:outline-none focus:ring-1 focus:ring-brand-500"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            >
              <option value="all">{t('fa.filter_all')}</option>
              <option value="active">{t('fa.status_active')}</option>
              <option value="fully_depreciated">{t('fa.status_fully_depreciated')}</option>
              <option value="disposed">{t('fa.status_disposed')}</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-subtle text-xs uppercase tracking-wide text-ink-tertiary">
                <tr>
                  <th className="px-4 py-2 text-start">{t('fa.col_asset')}</th>
                  <th className="px-4 py-2 text-start">{t('fa.col_in_service')}</th>
                  <th className="px-4 py-2 text-end">{t('fa.col_cost')}</th>
                  <th className="px-4 py-2 text-end">{t('fa.col_accumulated')}</th>
                  <th className="px-4 py-2 text-end">{t('fa.col_book_value')}</th>
                  <th className="px-4 py-2 text-start">{t('fa.col_status')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-ink-tertiary">{t('common.loading')}</td></tr>
                )}
                {!isLoading && visible.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-ink-tertiary">{t('fa.empty')}</td></tr>
                )}
                {visible.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => setSelectedId(a.id)}
                    className={`cursor-pointer border-t border-border-subtle hover:bg-surface-subtle ${selectedId === a.id ? 'bg-brand-50' : ''}`}
                  >
                    <td className="px-4 py-2">
                      <span className="font-medium text-ink-primary">{a.name}</span>
                      {a.asset_tag && <span className="ms-2 text-xs text-ink-tertiary">{a.asset_tag}</span>}
                      {a.category && <div className="text-xs text-ink-tertiary">{a.category}</div>}
                    </td>
                    <td className="px-4 py-2 text-ink-secondary">{a.in_service_date}</td>
                    <td className="px-4 py-2 text-end text-ink-secondary">{MONEY(Number(a.cost))}</td>
                    <td className="px-4 py-2 text-end text-ink-secondary">{MONEY(Number(a.accumulated_depreciation))}</td>
                    <td className="px-4 py-2 text-end font-medium text-ink-primary">
                      {MONEY(round2(Number(a.cost) - Number(a.accumulated_depreciation)))}
                    </td>
                    <td className="px-4 py-2">{statusPill(a.status)}</td>
                  </tr>
                ))}
              </tbody>
              {visible.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border-strong bg-surface-subtle font-semibold text-ink-primary">
                    <td className="px-4 py-2" colSpan={2}>{t('fa.totals_on_book')}</td>
                    <td className="px-4 py-2 text-end">{MONEY(totals.cost)}</td>
                    <td className="px-4 py-2 text-end">{MONEY(totals.accum)}</td>
                    <td className="px-4 py-2 text-end">{MONEY(round2(totals.cost - totals.accum))}</td>
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
            <p className="py-10 text-center text-sm text-ink-tertiary">{t('fa.select_hint')}</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-ink-primary">{selected.name}</h2>
                  <p className="text-xs text-ink-tertiary">
                    {selected.asset_tag ? `${selected.asset_tag} · ` : ''}
                    {t(`fa.method_${selected.method}`)}
                    {selected.method === 'straight_line'
                      ? ` · ${selected.useful_life_months} ${t('fa.months')}`
                      : ` · ${Number(selected.wdv_rate)}%`}
                  </p>
                </div>
                {statusPill(selected.status)}
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-card bg-surface-subtle p-2">
                  <p className="text-xs text-ink-tertiary">{t('fa.col_cost')}</p>
                  <p className="text-sm font-semibold text-ink-primary">{MONEY(Number(selected.cost))}</p>
                </div>
                <div className="rounded-card bg-surface-subtle p-2">
                  <p className="text-xs text-ink-tertiary">{t('fa.col_accumulated')}</p>
                  <p className="text-sm font-semibold text-ink-primary">{MONEY(Number(selected.accumulated_depreciation))}</p>
                </div>
                <div className="rounded-card bg-surface-subtle p-2">
                  <p className="text-xs text-ink-tertiary">{t('fa.col_book_value')}</p>
                  <p className="text-sm font-semibold text-ink-primary">{MONEY(bookValue)}</p>
                </div>
              </div>

              {selected.status === 'disposed' && (
                <div className="rounded-card border border-border-subtle bg-surface-subtle p-3 text-xs text-ink-secondary">
                  <p>{t('fa.disposed_on')} {selected.disposal_date} · {t('fa.proceeds')} {MONEY(Number(selected.disposal_proceeds ?? 0))}</p>
                  <p className={Number(selected.disposal_gain_loss) >= 0 ? 'text-success-600' : 'text-danger-600'}>
                    {Number(selected.disposal_gain_loss) >= 0 ? t('fa.gain') : t('fa.loss')}{' '}
                    {MONEY(Math.abs(Number(selected.disposal_gain_loss ?? 0)))}
                    {selected.disposal_je_id && <> · <DocLink type="journal_entry" id={selected.disposal_je_id} /></>}
                  </p>
                </div>
              )}

              {canWrite && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => openEdit(selected)}>{t('common.edit')}</Button>
                  {selected.status !== 'disposed' && (
                    <Button size="sm" onClick={() => {
                      setDisposeResult(null); disposeMutation.reset();
                      setDisposal({ date: '', proceeds: '0', account: cashAccounts[0]?.code ?? '' });
                      setDisposeOpen(true);
                    }}>{t('fa.dispose')}</Button>
                  )}
                  {entries.some((e) => !e.reversed_at) && selected.status !== 'disposed' && (
                    <Button size="sm" variant="danger" onClick={() => { reverseMutation.reset(); setReverseOpen(true); }}>
                      {t('fa.reverse_last')}
                    </Button>
                  )}
                </div>
              )}

              {/* Schedule: posted rows then projected */}
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">{t('fa.schedule')}</p>
                <div className="max-h-80 overflow-y-auto rounded-card border border-border-subtle">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-surface-subtle text-ink-tertiary">
                      <tr>
                        <th className="px-2 py-1.5 text-start">{t('fa.col_period')}</th>
                        <th className="px-2 py-1.5 text-end">{t('fa.col_charge')}</th>
                        <th className="px-2 py-1.5 text-end">{t('fa.col_book_value')}</th>
                        <th className="px-2 py-1.5 text-start">{t('fa.col_entry')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e) => (
                        <tr key={e.id} className={`border-t border-border-subtle ${e.reversed_at ? 'text-ink-tertiary line-through' : ''}`}>
                          <td className="px-2 py-1.5">{e.period_end}</td>
                          <td className="px-2 py-1.5 text-end">{MONEY(Number(e.charge))}</td>
                          <td className="px-2 py-1.5 text-end">{MONEY(Number(e.book_value_after))}</td>
                          <td className="px-2 py-1.5">
                            {e.journal_entry_id
                              ? <DocLink type="journal_entry" id={e.journal_entry_id} status={e.reversed_at ? 'reversed' : 'active'} />
                              : '—'}
                          </td>
                        </tr>
                      ))}
                      {projected.map((r) => (
                        <tr key={`p-${r.period_end}`} className="border-t border-border-subtle text-ink-tertiary">
                          <td className="px-2 py-1.5">{r.period_end}</td>
                          <td className="px-2 py-1.5 text-end">{MONEY(r.charge)}</td>
                          <td className="px-2 py-1.5 text-end">{MONEY(r.book_value)}</td>
                          <td className="px-2 py-1.5 italic">{t('fa.projected')}</td>
                        </tr>
                      ))}
                      {entries.length === 0 && projected.length === 0 && (
                        <tr><td colSpan={4} className="px-2 py-4 text-center text-ink-tertiary">{t('fa.no_schedule')}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Asset form ───────────────────────────────────────────────────── */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? t('fa.edit_asset') : t('fa.new_asset')} width="lg">
        <div className="space-y-3">
          {basisLocked && (
            <p className="rounded-card border border-warning-500/40 bg-warning-50 px-3 py-2 text-xs text-warning-600">
              {t('fa.basis_locked')}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Input label={t('fa.f_name')} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input label={t('fa.f_tag')} value={form.asset_tag ?? ''} onChange={(e) => setForm({ ...form, asset_tag: e.target.value })} />
            <Input label={t('fa.f_category')} value={form.category ?? ''} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <Select
              label={t('fa.f_asset_account')}
              options={fixedAccounts.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))}
              value={form.asset_account_code}
              disabled={basisLocked}
              onChange={(e) => setForm({ ...form, asset_account_code: e.target.value })}
            />
            <Input label={t('fa.f_acquisition_date')} type="date" required value={form.acquisition_date}
              onChange={(e) => setForm({ ...form, acquisition_date: e.target.value })} />
            <Input label={t('fa.f_in_service_date')} type="date" required value={form.in_service_date} disabled={basisLocked}
              onChange={(e) => setForm({ ...form, in_service_date: e.target.value })} />
            <Input label={`${t('fa.f_cost')} (${currency})`} type="number" step="0.01" required value={String(form.cost)} disabled={basisLocked}
              onChange={(e) => setForm({ ...form, cost: Number(e.target.value) })} />
            <Input label={`${t('fa.f_salvage')} (${currency})`} type="number" step="0.01" value={String(form.salvage_value)} disabled={basisLocked}
              onChange={(e) => setForm({ ...form, salvage_value: Number(e.target.value) })} />
            <Select
              label={t('fa.f_method')}
              options={[
                { value: 'straight_line', label: t('fa.method_straight_line') },
                { value: 'reducing_balance', label: t('fa.method_reducing_balance') },
              ]}
              value={form.method}
              disabled={basisLocked}
              onChange={(e) => setForm({ ...form, method: e.target.value as FixedAssetInsert['method'] })}
            />
            {form.method === 'straight_line' ? (
              <Input label={t('fa.f_life_months')} type="number" min="1" required value={String(form.useful_life_months)} disabled={basisLocked}
                onChange={(e) => setForm({ ...form, useful_life_months: Number(e.target.value) })} />
            ) : (
              <Input label={t('fa.f_wdv_rate')} type="number" step="0.001" min="0" max="100" required value={String(form.wdv_rate)} disabled={basisLocked}
                onChange={(e) => setForm({ ...form, wdv_rate: Number(e.target.value) })} />
            )}
          </div>

          {/* Live schedule summary from the pure lib */}
          {form.cost > 0 && form.in_service_date && (
            (() => {
              const rows = projectSchedule({
                cost: Number(form.cost), salvage_value: Number(form.salvage_value),
                useful_life_months: Number(form.useful_life_months) || 1,
                method: form.method, wdv_rate: Number(form.wdv_rate),
                in_service_date: form.in_service_date,
              });
              if (rows.length === 0) return null;
              return (
                <p className="rounded-card bg-surface-subtle px-3 py-2 text-xs text-ink-secondary">
                  {t('fa.preview_summary', {
                    first: MONEY(rows[0].charge),
                    months: rows.length,
                    total: MONEY(rows[rows.length - 1].accumulated),
                    end: rows[rows.length - 1].period_end,
                  })}
                </p>
              );
            })()
          )}

          {saveMutation.error && <p className="text-xs text-danger-600">{(saveMutation.error as Error).message}</p>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setFormOpen(false)}>{t('common.cancel')}</Button>
          <Button size="sm" onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !form.name || !form.in_service_date || !form.acquisition_date || !form.asset_account_code}>
            {t('common.save')}
          </Button>
        </div>
      </Modal>

      {/* ── Run depreciation ─────────────────────────────────────────────── */}
      <Modal open={runOpen} onClose={() => setRunOpen(false)} title={t('fa.run_depreciation')} width="lg">
        {runResult ? (
          <div className="space-y-3">
            <div className="rounded-card border border-success-500/40 bg-success-50 px-3 py-3 text-sm text-success-600">
              <p className="font-semibold">{t('fa.run_done')}</p>
              <p className="text-xs">
                {t('fa.run_done_detail', { count: runResult.entries_posted, total: MONEY(Number(runResult.total_charge)), period: runResult.period_end })}
              </p>
            </div>
            <p className="text-xs text-ink-tertiary">{t('fa.run_posted_note')}</p>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setRunOpen(false)}>{t('common.done')}</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Input label={t('fa.f_period_end')} type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            {periodLocked && (
              <p className="rounded-card border border-danger-500/40 bg-danger-50 px-3 py-2 text-xs text-danger-600">
                {t('fa.period_locked', { lock: lockDate })}
              </p>
            )}
            <div className="max-h-72 overflow-y-auto rounded-card border border-border-subtle">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface-subtle text-ink-tertiary">
                  <tr>
                    <th className="px-2 py-1.5 text-start">{t('fa.col_asset')}</th>
                    <th className="px-2 py-1.5 text-end">{t('fa.col_months')}</th>
                    <th className="px-2 py-1.5 text-end">{t('fa.col_charge')}</th>
                  </tr>
                </thead>
                <tbody>
                  {runPreview.rows.map((r) => (
                    <tr key={r.asset.id} className="border-t border-border-subtle">
                      <td className="px-2 py-1.5 text-ink-primary">{r.asset.name}</td>
                      <td className="px-2 py-1.5 text-end text-ink-secondary">{r.periods}</td>
                      <td className="px-2 py-1.5 text-end text-ink-secondary">{MONEY(r.charge)}</td>
                    </tr>
                  ))}
                  {runPreview.rows.length === 0 && (
                    <tr><td colSpan={3} className="px-2 py-4 text-center text-ink-tertiary">{t('fa.nothing_due')}</td></tr>
                  )}
                </tbody>
                {runPreview.rows.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-border-strong bg-surface-subtle font-semibold text-ink-primary">
                      <td className="px-2 py-1.5" colSpan={2}>{t('fa.total_charge')}</td>
                      <td className="px-2 py-1.5 text-end">{MONEY(runPreview.total)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <p className="text-xs text-ink-tertiary">{t('fa.run_preview_note')}</p>
            {runMutation.error && <p className="text-xs text-danger-600">{(runMutation.error as Error).message}</p>}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setRunOpen(false)}>{t('common.cancel')}</Button>
              <Button size="sm" onClick={() => runMutation.mutate()}
                disabled={runMutation.isPending || runPreview.rows.length === 0 || periodLocked}>
                {t('fa.post_depreciation')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Dispose ──────────────────────────────────────────────────────── */}
      <Modal open={disposeOpen} onClose={() => setDisposeOpen(false)} title={t('fa.dispose')} width="md">
        {disposeResult ? (
          <div className="space-y-3">
            <div className="rounded-card border border-success-500/40 bg-success-50 px-3 py-3 text-sm text-success-600">
              <p className="font-semibold">{t('fa.dispose_done')}</p>
              <p className="text-xs">
                {Number(disposeResult.gain_loss) >= 0 ? t('fa.gain') : t('fa.loss')} {MONEY(Math.abs(Number(disposeResult.gain_loss)))}
                {' · '}<DocLink type="journal_entry" id={disposeResult.journal_entry_id} />
              </p>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setDisposeOpen(false)}>{t('common.done')}</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Input label={t('fa.f_disposal_date')} type="date" required value={disposal.date}
              onChange={(e) => setDisposal({ ...disposal, date: e.target.value })} />
            <Input label={`${t('fa.proceeds')} (${currency})`} type="number" step="0.01" value={disposal.proceeds}
              onChange={(e) => setDisposal({ ...disposal, proceeds: e.target.value })} />
            <Select
              label={t('fa.f_proceeds_account')}
              options={cashAccounts.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))}
              value={disposal.account}
              onChange={(e) => setDisposal({ ...disposal, account: e.target.value })}
            />

            {disposeNeedsCatchUp && (
              <p className="rounded-card border border-warning-500/40 bg-warning-50 px-3 py-2 text-xs text-warning-600">
                {t('fa.dispose_catch_up')}
              </p>
            )}

            <div className="rounded-card bg-surface-subtle px-3 py-2 text-xs text-ink-secondary">
              <p>{t('fa.col_book_value')}: {MONEY(bookValue)}</p>
              <p className={disposalGainLoss >= 0 ? 'text-success-600' : 'text-danger-600'}>
                {disposalGainLoss >= 0 ? t('fa.gain_to_4250') : t('fa.loss_to_6910')}: {MONEY(Math.abs(disposalGainLoss))}
              </p>
            </div>

            {disposeMutation.error && <p className="text-xs text-danger-600">{(disposeMutation.error as Error).message}</p>}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setDisposeOpen(false)}>{t('common.cancel')}</Button>
              <Button size="sm" onClick={() => disposeMutation.mutate()}
                disabled={disposeMutation.isPending || !disposal.date || (Number(disposal.proceeds) > 0 && !disposal.account)}>
                {t('fa.confirm_dispose')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Reverse last depreciation ────────────────────────────────────── */}
      <Modal open={reverseOpen} onClose={() => setReverseOpen(false)} title={t('fa.reverse_last')} width="md">
        <p className="text-sm text-ink-secondary">{t('fa.reverse_confirm')}</p>
        {reverseMutation.error && <p className="mt-2 text-xs text-danger-600">{(reverseMutation.error as Error).message}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setReverseOpen(false)}>{t('common.cancel')}</Button>
          <Button size="sm" variant="danger" onClick={() => reverseMutation.mutate()} disabled={reverseMutation.isPending}>
            {t('fa.confirm_reverse')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
