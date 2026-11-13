/**
 * Bank Accounts — Phase 12.45, moved out of Settings in Phase 95.
 *
 * Lives under Banking now. It was reachable only at /settings/bank-accounts,
 * which rendered it inside the Settings two-pane shell: you navigated from
 * the Banking section and landed in a Settings rail. The route moved; the old
 * path redirects so existing links keep working.
 *
 * CRUD UI for the bank_accounts master table. Each row links to a GL
 * account in the CoA (the cash/bank side of every payment posts into
 * `coa_account_id`). The "default" flag picks the account that gets
 * pre-selected on new payments.
 *
 * Ocean Teal layout (2026-11): look only, same data and actions.
 */
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useCompanyCurrency } from '@/hooks/use-company-currency';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { Modal } from '@/ui/modal';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Column } from '@/ui/table';
import { DocLink } from '@/ui/doc-link';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import { Banknote, CheckCircle2, Landmark, Pencil, Plus, Search, Trash2, Wallet } from 'lucide-react';
import type { BankAccountRow, CoaRow } from '@/data/adapter';
import { useFormInvalidBanner } from '@/hooks/use-form-invalid-banner';
import { FormErrorBanner } from '@/ui/form-error-banner';
import { useArabicEnabled } from '@/hooks/use-arabic-enabled';

const schema = z.object({
  name:           z.string().min(1, 'Required'),
  name_ar:        z.string(),
  account_type:   z.enum(['bank', 'cash']),
  bank_name:      z.string(),
  account_number: z.string(),
  iban:           z.string(),
  swift_code:     z.string(),
  branch:         z.string(),
  currency:       z.string().min(3, 'e.g. AED'),
  coa_account_id: z.string().min(1, 'Required'),
  opening_balance: z.coerce.number().min(0),
  is_default:     z.boolean(),
  is_active:      z.boolean(),
});
type FormValues = z.infer<typeof schema>;

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BankAccountsPage() {
  const { t } = useTranslation();
  const arabicOn = useArabicEnabled();   // India companies: English only
  const { company_id } = useAuthStore();
  // The company's own currency (INR for an Indian company). A literal 'AED'
  // here labelled every Indian company's balances in dirhams and pre-filled
  // new bank accounts with the wrong currency.
  const companyCurrency = useCompanyCurrency();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const [editing, setEditing] = useState<BankAccountRow | null>(null);

  // Settings page wants to see EVERY bank account (including inactive),
  // otherwise the operator can't restore / delete a deactivated row.
  // Pickers elsewhere still call the default list() which filters to active.
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['bankAccounts', company_id, 'all'],
    queryFn:  () => getAdapter().bankAccounts.list(company_id!, { includeInactive: true }),
    enabled:  !!company_id,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await getAdapter().bankAccounts.remove(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bankAccounts', company_id] });
      qc.invalidateQueries({ queryKey: ['bankAccounts', company_id, 'all'] });
      qc.invalidateQueries({ queryKey: ['bank_accounts', company_id] });
    },
  });

  function onDelete(row: BankAccountRow) {
    const ok = window.confirm(t('baOcean.delete_confirm', { name: row.name }));
    if (!ok) return;
    deleteMutation.mutate(row.id, {
      onError: (e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        window.alert(t('baOcean.delete_failed', { name: row.name, msg }));
      },
    });
  }

  // CoA picker — Cash / Bank accounts only (asset class)
  const { data: coa = [] } = useQuery({
    queryKey: ['coa', company_id],
    queryFn:  () => getAdapter().coa.list(company_id!),
    enabled:  !!company_id,
  });
  // Restrict the GL picker to asset-class accounts so bank lines hit the
  // correct side of the trial balance. CoA exposes `type` (not
  // `account_type`) — keep the filter cheap by name.
  const cashBankAccounts = (coa as CoaRow[]).filter(a => a.type === 'asset' && a.is_active);

  const defaults: FormValues = {
    name: '', name_ar: '', account_type: 'bank',
    bank_name: '', account_number: '', iban: '', swift_code: '', branch: '',
    currency: companyCurrency, coa_account_id: '', opening_balance: 0,
    is_default: false, is_active: true,
  };

  // ── Opening-balance inline editor (Phase 14.14p) ──────────────────────
  // Uses a targeted getBankOpeningJE query (by source_id = bank_account_id)
  // instead of the heavy listPosted union, so we always know whether to
  // call edit() vs postBank() — no race condition, no code-matching hack.
  const [obDraft, setObDraft]     = useState('');
  const [obSaving, setObSaving]   = useState(false);
  const [obError, setObError]     = useState('');
  const [obSuccess, setObSuccess] = useState(false);

  // Keep obDraft in sync when a different bank is opened for editing.
  useEffect(() => {
    if (editing) {
      setObDraft(String(Number(editing.opening_balance ?? 0)));
      setObError('');
      setObSuccess(false);
    }
  }, [editing?.id]);

  // Targeted fetch — only this bank's non-voided opening JE.
  const {
    data: existingBankOb,
    isFetching: obLoading,
    refetch: refetchBankOb,
  } = useQuery({
    queryKey: ['bank_ob_je', editing?.id],
    queryFn:  () => getAdapter().openingBalances.getBankOpeningJE(editing!.id),
    enabled:  !!editing?.id,
    staleTime: 0,
  });

  async function handleSaveOb() {
    const newAmt = parseFloat(obDraft);
    if (isNaN(newAmt) || newAmt < 0) { setObError(t('baOcean.ob_invalid')); return; }
    setObSaving(true); setObError(''); setObSuccess(false);
    try {
      const dateStr = existingBankOb?.date ?? new Date().toISOString().slice(0, 10);
      if (existingBankOb) {
        // Atomic void + repost inside a single Postgres transaction.
        await getAdapter().openingBalances.edit({
          doc_id: existingBankOb.doc_id,
          void_doc_type: 'opening_bank',
          payload: {
            kind: 'bank', bank_account_id: editing!.id,
            direction: 'debit', amount: newAmt,
            date: dateStr, notes: null,
          },
        });
      } else {
        await getAdapter().openingBalances.postBank({
          bank_account_id: editing!.id, direction: 'debit',
          amount: newAmt, date: dateStr, notes: null,
        });
      }
      // Refresh targeted JE query + bank account list.
      await refetchBankOb();
      qc.invalidateQueries({ queryKey: ['bankAccounts', company_id] });
      qc.invalidateQueries({ queryKey: ['bankAccounts', company_id, 'all'] });
      qc.invalidateQueries({ queryKey: ['bank_accounts', company_id] });
      // Update editing snapshot so table row reflects new amount immediately.
      setEditing(prev => prev ? { ...prev, opening_balance: newAmt } : prev);
      setObDraft(String(newAmt));
      setObSuccess(true);
    } catch (e) {
      setObError(e instanceof Error ? e.message : String(e));
    } finally {
      setObSaving(false);
    }
  }
  // ── /Opening-balance inline editor ─────────────────────────────────────

  const { onInvalid, bannerMessage, clearBanner } = useFormInvalidBanner('bank-accounts');
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema) as any,
    defaultValues: defaults,
  });

  function openAdd() {
    setEditing(null);
    reset(defaults);
    setOpen(true);
  }

  function openEdit(row: BankAccountRow) {
    setEditing(row);
    reset({
      name: row.name,
      name_ar: row.name_ar ?? '',
      account_type: (row.account_type as 'bank' | 'cash') ?? 'bank',
      bank_name: row.bank_name ?? '',
      account_number: row.account_number ?? '',
      iban: row.iban ?? '',
      swift_code: row.swift_code ?? '',
      branch: row.branch ?? '',
      currency: row.currency,
      coa_account_id: row.coa_account_id,
      opening_balance: Number(row.opening_balance ?? 0),
      is_default: row.is_default,
      is_active: row.is_active,
    });
    setOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const row = {
        company_id: company_id!,
        name: values.name,
        name_ar: values.name_ar || null,
        account_type: values.account_type,
        bank_name: values.bank_name || null,
        account_number: values.account_number || null,
        iban: values.iban || null,
        swift_code: values.swift_code || null,
        branch: values.branch || null,
        currency: values.currency,
        coa_account_id: values.coa_account_id,
        // Phase 14.14h — never write opening_balance from this form when
        // editing. The number is now read-only in the UI but a malicious /
        // stale form submit could still try; preserve the existing value
        // so accidental edits cannot quietly diverge from the GL-side
        // posted balance.
        opening_balance: editing ? Number(editing.opening_balance ?? 0) : values.opening_balance,
        is_default: values.is_default,
        is_active: values.is_active,
      };
      if (editing) await getAdapter().bankAccounts.update(editing.id, row);
      else        await getAdapter().bankAccounts.create(row);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bankAccounts', company_id] });
      setOpen(false);
    },
  });

  const coaName = (id: string) => {
    const a = (coa as CoaRow[]).find(r => r.id === id);
    return a ? `${a.code} ${a.name}` : id.slice(0, 8) + '…';
  };

  // The GL account CODE behind a bank account. The ledger filters by code,
  // not by id, so this is what the link needs.
  const coaCode = (id: string) =>
    (coa as CoaRow[]).find(r => r.id === id)?.code ?? null;

  // ── Everything below is DERIVED, never stored ────────────────────────
  // There is no balance column on bank_accounts and there must never be one
  // (Rule 1). The balance comes from get_dashboard_cards, which aggregates
  // gl_active in the database and keys the result by bank_account id.
  const { data: cards, isLoading: balLoading } = useQuery({
    queryKey: ['dashboardCards', company_id],
    queryFn:  () => getAdapter().reports.getDashboardCards(company_id!),
    enabled:  !!company_id,
  });
  const balanceOf = (id: string): number | null => {
    const hit = cards?.bank_balances.find(b => b.id === id);
    return hit ? Number(hit.balance) : null;
  };

  // What last moved through each account, for the activity column.
  const accountKey = accounts.map(a => a.id).join(',');
  const { data: activity = {} } = useQuery({
    queryKey: ['bankActivity', company_id, accountKey],
    queryFn:  () => getAdapter().bankAccounts.listActivity(
      company_id!,
      accounts.map(a => ({ id: a.id, coa_account_id: a.coa_account_id })),
    ),
    enabled:  !!company_id && accounts.length > 0,
  });

  // ── Filters ──────────────────────────────────────────────────────────
  const [search, setSearch]             = useState('');
  const [typeFilter, setTypeFilter]     = useState<'all' | 'bank' | 'cash'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const visible = (accounts as BankAccountRow[]).filter(a => {
    if (typeFilter !== 'all' && a.account_type !== typeFilter) return false;
    if (statusFilter === 'active'   && !a.is_active) return false;
    if (statusFilter === 'inactive' &&  a.is_active) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [a.name, a.name_ar, a.bank_name, a.currency, a.account_number,
            a.coa_account_id ? coaName(a.coa_account_id) : '']
      .some(v => (v ?? '').toLowerCase().includes(q));
  });

  // KPI tiles. Summed over EVERY account, not just the filtered view - a
  // filter narrows the list you are reading, it does not change how much
  // money the business holds.
  const activeCount  = (accounts as BankAccountRow[]).filter(a => a.is_active).length;
  const sumBalances  = (rows: BankAccountRow[]) =>
    rows.reduce((t, a) => t + (balanceOf(a.id) ?? 0), 0);
  const combined     = sumBalances(accounts as BankAccountRow[]);
  const cashOnHand   = sumBalances((accounts as BankAccountRow[]).filter(a => a.account_type === 'cash'));
  // Until the aggregate lands, say nothing rather than claim zero.
  const money = (n: number | null) => n === null ? '\u2014' : `${n < 0 ? '-' : ''}${companyCurrency} ${fmt(Math.abs(n))}`;

  const AccountIcon = ({ kind }: { kind: string }) => (
    <span className={`sb-ba-ico ${kind === 'cash' ? 'is-cash' : ''}`} aria-hidden="true">
      {kind === 'cash' ? <Wallet size={16} /> : <Landmark size={16} />}
    </span>
  );

  const columns: Column<BankAccountRow>[] = [
    {
      key: 'name', header: t('banking.col_account_name'),
      render: (r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <AccountIcon kind={r.account_type ?? 'bank'} />
          <div style={{ minWidth: 0 }}>
            {/* The name opens the LEDGER. Seeing what moved through an
                account is the common action; changing its IBAN is the rare
                one, and that has its own control on the row. Falls back to
                Edit when there is no GL code, so it is never a dead click. */}
            <button
              type="button"
              className="sb-row-link"
              title={r.coa_account_id && coaCode(r.coa_account_id) ? t('banking.view_ledger') : t('common.edit')}
              onClick={(e) => {
                e.stopPropagation();
                const code = r.coa_account_id ? coaCode(r.coa_account_id) : null;
                if (code) navigate(`/accounting/general-ledger?code=${encodeURIComponent(code)}`);
                else openEdit(r);
              }}
            >
              {r.name}
            </button>
            {r.bank_name && <div className="sb-fx-name" style={{ fontSize: 12 }}>{r.bank_name}</div>}
            {/* Type and currency ride under the name: two narrow columns of
                their own pushed status and actions off a 1440px screen. */}
            <div className="sb-ba-meta">
              <span className={`sb-pill ${r.account_type === 'cash' ? 'sb-pill-good' : ''}`} title={t('banking.col_type')}>
                {r.account_type === 'cash' ? t('banking.type_cash') : t('banking.type_bank')}
              </span>
              <bdi dir="ltr" className="sb-mono" title={t('banking.col_currency')}>{r.currency}</bdi>
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'coa', header: t('banking.col_gl_code'),
      render: (r) => (
        <bdi dir="ltr" className="sb-acct-code" style={{ fontWeight: 600 }}>
          {r.coa_account_id ? coaName(r.coa_account_id) : '—'}
        </bdi>
      ),
    },
    {
      key: 'opening', header: t('banking.col_opening'), align: 'end', width: '130px',
      render: (r) => (
        <bdi dir="ltr" className="text-ink-secondary" title={t('banking.opening_hint')}>
          {fmt(Number(r.opening_balance ?? 0))}
        </bdi>
      ),
    },
    {
      key: 'balance', header: t('banking.col_current'), align: 'end', width: '140px',
      render: (r) => {
        const bal = balanceOf(r.id);
        if (bal === null) {
          return <span className="sb-fx-name">{balLoading ? '…' : '—'}</span>;
        }
        // A negative cash account is a real condition worth seeing on the
        // page rather than only in a System Health check.
        return (
          <bdi dir="ltr" className={`sb-dash-num ${bal < 0 ? 'is-bad' : ''}`}
            title={bal < 0 ? t('banking.negative_hint') : undefined}>
            {fmt(bal)}
          </bdi>
        );
      },
    },
    {
      key: 'last', header: t('banking.col_last_txn'), width: '170px',
      render: (r) => {
        const a = (activity as Record<string, import('@/data/adapter').BankAccountActivity>)[r.id];
        if (!a?.last_date) return <span className="sb-fx-name">{'—'}</span>;
        return (
          <div>
            <bdi dir="ltr" style={{ fontSize: 12 }}>{a.last_date}</bdi>
            <div className="sb-fx-name" style={{ fontSize: 12 }}>
              {a.related_doc_type && a.related_doc_id
                ? <DocLink type={a.related_doc_type} id={a.related_doc_id} />
                : (a.description ?? '—')}
            </div>
          </div>
        );
      },
    },
    {
      key: 'status', header: t('banking.col_status'), width: '120px',
      render: (r) => (
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          <span className={`sb-pill ${r.is_active ? 'sb-pill-good' : 'sb-pill-muted'}`}>
            {r.is_active ? t('common.active') : t('common.inactive')}
          </span>
          {r.is_default && <span className="sb-pill">{t('banking.default')}</span>}
        </div>
      ),
    },
    {
      key: 'actions', header: '', width: '96px', align: 'end',
      render: (r) => (
        <div className="sb-row-actions">
          <button
            type="button" className="sb-icon-btn"
            onClick={(e) => { e.stopPropagation(); openEdit(r); }}
            title={t('banking.edit_hint')} aria-label={t('common.edit')}
          >
            <Pencil size={15} aria-hidden="true" />
          </button>
          <button
            type="button" className="sb-icon-btn" style={{ color: 'var(--sb-danger)' }}
            onClick={(e) => { e.stopPropagation(); onDelete(r); }}
            disabled={deleteMutation.isPending}
            title={t('banking.delete_hint')} aria-label={t('common.delete')}
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <OceanPage
      testid="bank-accounts-ocean"
      title={t('banking.accounts_title')}
      subtitle={t('banking.accounts_subtitle')}
      actions={
        <button type="button" className="sb-primary-btn sb-btn-inline" onClick={openAdd}>
          <Plus size={18} aria-hidden="true" />{t('banking.add_account')}
        </button>
      }
      below={
        <div className="sb-ba-filters">
          <label className="sb-search" style={{ margin: 0 }}>
            <Search size={18} className="sb-icon" aria-hidden="true" />
            <span className="sr-only">{t('common.search')}</span>
            <input type="search" value={search} placeholder={t('banking.search_placeholder')}
              onChange={(e) => setSearch(e.target.value)} />
          </label>
          <select className="sb-pc-select" aria-label={t('banking.col_type')} value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'all' | 'bank' | 'cash')}>
            <option value="all">{t('banking.all_types')}</option>
            <option value="bank">{t('banking.type_bank')}</option>
            <option value="cash">{t('banking.type_cash')}</option>
          </select>
          <select className="sb-pc-select" aria-label={t('banking.col_status')} value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}>
            <option value="all">{t('banking.all_statuses')}</option>
            <option value="active">{t('common.active')}</option>
            <option value="inactive">{t('common.inactive')}</option>
          </select>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* KPI chips. Summed across every account, not the filtered view. */}
        <div className="sb-exp-kpis" data-testid="bank-kpis">
          <div className="sb-exp-kpi is-hero">
            <span className="sb-exp-kpi-ico" aria-hidden="true"><Banknote size={17} /></span>
            <div className="sb-exp-kpi-txt">
              <span className="sb-exp-kpi-label">{t('banking.kpi_combined')}</span>
              <bdi dir="ltr" className="sb-exp-kpi-val" style={combined < 0 ? { color: '#FECACA' } : undefined}>{money(cards ? combined : null)}</bdi>
              <span className="sb-exp-kpi-sub" style={{ color: '#D7F4F1' }}>{t('banking.kpi_combined_hint')}</span>
            </div>
          </div>
          <div className="sb-exp-kpi">
            <span className="sb-exp-kpi-ico" aria-hidden="true"><Wallet size={17} /></span>
            <div className="sb-exp-kpi-txt">
              <span className="sb-exp-kpi-label">{t('banking.kpi_cash')}</span>
              <bdi dir="ltr" className={`sb-exp-kpi-val ${cashOnHand < 0 ? 'is-warn' : ''}`}>{money(cards ? cashOnHand : null)}</bdi>
              <span className="sb-exp-kpi-sub">{t('banking.kpi_cash_hint')}</span>
            </div>
          </div>
          <div className="sb-exp-kpi">
            <span className="sb-exp-kpi-ico" aria-hidden="true"><Landmark size={17} /></span>
            <div className="sb-exp-kpi-txt">
              <span className="sb-exp-kpi-label">{t('banking.kpi_total')}</span>
              <span className="sb-exp-kpi-val">{accounts.length}</span>
              <span className="sb-exp-kpi-sub">{t('banking.kpi_total_hint')}</span>
            </div>
          </div>
          <div className="sb-exp-kpi">
            <span className={`sb-exp-kpi-ico ${activeCount < accounts.length ? 'is-warn' : ''}`} aria-hidden="true"><CheckCircle2 size={17} /></span>
            <div className="sb-exp-kpi-txt">
              <span className="sb-exp-kpi-label">{t('banking.kpi_active')}</span>
              <span className="sb-exp-kpi-val">{activeCount}</span>
              <span className="sb-exp-kpi-sub">{activeCount === accounts.length ? t('banking.kpi_all_active') : t('banking.kpi_some_inactive')}</span>
            </div>
          </div>
        </div>

        {isLoading
          ? <p className="sb-empty" style={{ margin: 0, textAlign: 'center' }}>{t('common.loading')}</p>
          : <>
              <OceanTable
                columns={columns}
                rows={visible}
                keyFn={(r) => r.id}
                rowMuted={(r) => !r.is_active}
                emptyMessage={accounts.length === 0 ? t('banking.empty') : t('banking.empty_filtered')}
              />
              <p className="sb-form-hint" style={{ margin: 0 }}>{t('banking.balances_note')}</p>
            </>
        }
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? t('baOcean.edit_title') : t('baOcean.add_title')} width="lg">
        <form onSubmit={handleSubmit((v) => { clearBanner(); return saveMutation.mutateAsync(v); }, onInvalid)} className="sb-ocean sb-modal-form flex flex-col gap-4">
          <FormErrorBanner message={bannerMessage} onDismiss={clearBanner} />
          {/* Phase 14.13f — permanence hint. Bank accounts are wiped on
               Reset Company Data, same as every other operational master. */}
          {!editing && (
            <p className="sb-info-note" style={{ fontSize: 13 }}>
              <strong>{t('baOcean.reset_title')}</strong> {t('baOcean.reset_body')}
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label={t('baOcean.f_name')} required error={errors.name?.message ? t('baOcean.required') : undefined} {...register('name')} />
            {arabicOn && (
            <Input label={t('baOcean.f_name_ar')} dir="rtl" {...register('name_ar')} />
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select label={t('banking.col_type')} required {...register('account_type')}
              options={[{ value: 'bank', label: t('banking.type_bank') }, { value: 'cash', label: t('banking.type_cash') }]} />
            <Input label={t('banking.col_currency')} required error={errors.currency?.message ? t('baOcean.currency_hint') : undefined} {...register('currency')} />
          </div>

          <Select
            label={t('baOcean.f_gl')} required
            error={errors.coa_account_id?.message ? t('baOcean.required') : undefined}
            {...register('coa_account_id')}
            options={[
              { value: '', label: t('baOcean.f_gl_pick') },
              ...cashBankAccounts.map(a => ({ value: a.id, label: `${a.code} ${a.name}` })),
            ]}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label={t('baOcean.f_bank_name')} {...register('bank_name')} />
            <Input label={t('baOcean.f_branch')} {...register('branch')} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label={t('baOcean.f_account_no')} dir="ltr" {...register('account_number')} />
            <Input label={t('baOcean.f_iban')} dir="ltr" {...register('iban')} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label={t('baOcean.f_swift')} dir="ltr" {...register('swift_code')} />
            {/* Opening balance — read-only hint for NEW accounts (post via
                Opening Balances wizard). For EDIT, the inline OB editor below
                handles void+repost atomically through the GL. */}
            {!editing ? (
              <div>
                <Input
                  label={t('banking.col_opening')}
                  type="number"
                  step="0.01"
                  min="0"
                  {...register('opening_balance')}
                />
                <p className="sb-form-hint" style={{ margin: '4px 0 0' }}>
                  {t('baOcean.ob_new_hint')}{' '}
                  <a href="/settings/opening-balances" className="sb-link"
                    onClick={(e) => { e.preventDefault(); window.location.assign('/settings/opening-balances'); }}>
                    {t('baOcean.ob_link')}
                  </a>
                </p>
              </div>
            ) : (
              <div>
                <span className="sb-ba-oblabel">{t('banking.col_opening')}</span>

                {/* Existing JE info card — shows once the targeted query returns */}
                {obLoading && (
                  <p className="sb-form-hint" style={{ margin: '0 0 6px' }}>{t('baOcean.ob_loading')}</p>
                )}
                {!obLoading && existingBankOb && (
                  <div className="sb-ba-ob">
                    <div>
                      <span style={{ fontWeight: 700 }}>{t('baOcean.ob_posted', { number: existingBankOb.doc_number })}</span>
                      <bdi dir="ltr" style={{ marginInlineStart: 8, color: 'var(--sb-text-secondary)' }}>
                        {existingBankOb.date} · {fmt(existingBankOb.amount)}
                      </bdi>
                    </div>
                    {editing && (
                      <a
                        href="#"
                        className="sb-link"
                        onClick={(e) => {
                          e.preventDefault();
                          const code = (coa as CoaRow[]).find(a => a.id === editing.coa_account_id)?.code ?? '';
                          const yr = existingBankOb.date.slice(0, 4) + '-01-01';
                          window.location.assign(`/accounting/general-ledger?code=${encodeURIComponent(code)}&from=${yr}&to=${existingBankOb.date}`);
                        }}
                        style={{ whiteSpace: 'nowrap' }}
                      >
                        {t('baOcean.ob_view_gl')}
                      </a>
                    )}
                  </div>
                )}
                {!obLoading && !existingBankOb && (
                  <p className="sb-form-hint" style={{ margin: '0 0 6px' }}>{t('baOcean.ob_none')}</p>
                )}

                {/* Edit / post input row */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    dir="ltr"
                    className="sb-pc-select"
                    value={obDraft}
                    onChange={(e) => { setObDraft(e.target.value); setObSuccess(false); setObError(''); }}
                    disabled={obLoading || obSaving}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <Button type="button" size="sm" onClick={handleSaveOb} disabled={obLoading || obSaving}>
                    {obSaving ? t('baOcean.ob_saving') : obLoading ? t('common.loading') : existingBankOb ? t('baOcean.ob_update') : t('baOcean.ob_post')}
                  </Button>
                </div>

                {obError && <p className="sb-alert sb-alert-danger" style={{ marginTop: 8, fontSize: 13 }}>{obError}</p>}
                {obSuccess && <p className="sb-alert sb-alert-good" style={{ marginTop: 8, fontSize: 13 }}>{t('baOcean.ob_done')}</p>}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-6 pt-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="h-4 w-4" style={{ accentColor: 'var(--sb-primary)' }} {...register('is_default')} />
              <span style={{ fontSize: 14 }}>{t('baOcean.f_default')}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="h-4 w-4" style={{ accentColor: 'var(--sb-primary)' }} {...register('is_active')} />
              <span style={{ fontSize: 14 }}>{t('common.active')}</span>
            </label>
          </div>

          {saveMutation.error && (
            <p className="sb-alert sb-alert-danger">{String(saveMutation.error)}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={isSubmitting}>{editing ? t('baOcean.save_changes') : t('banking.add_account')}</Button>
          </div>
        </form>
      </Modal>
    </OceanPage>
  );
}
