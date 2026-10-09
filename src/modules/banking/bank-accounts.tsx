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
 */
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { Modal } from '@/ui/modal';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Table, type Column } from '@/ui/table';
import { Badge } from '@/ui/badge';
import { Breadcrumbs } from '@/ui/breadcrumbs';
import { DocLink } from '@/ui/doc-link';
import { PageHeader, Stat } from '@/ui/primitives';
import { theme } from '@/ui/theme';
import type { BankAccountRow, CoaRow } from '@/data/adapter';
import { useFormInvalidBanner } from '@/hooks/use-form-invalid-banner';
import { FormErrorBanner } from '@/ui/form-error-banner';

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
  const { company_id } = useAuthStore();
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
    const ok = window.confirm(
      `Delete bank account "${row.name}"?\n\n` +
      `This cannot be undone. The delete will FAIL if any payment, expense, ` +
      `bank transfer, PDC cheque, or reconciliation references it — in that ` +
      `case use Deactivate (Edit → uncheck Active) instead.`
    );
    if (!ok) return;
    deleteMutation.mutate(row.id, {
      onError: (e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        window.alert(`Could not delete "${row.name}":\n\n${msg}`);
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
    currency: 'AED', coa_account_id: '', opening_balance: 0,
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
    if (isNaN(newAmt) || newAmt < 0) { setObError('Enter a valid amount ≥ 0'); return; }
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
  const money = (n: number | null) => n === null ? '\u2014' : `${n < 0 ? '-' : ''}AED ${fmt(Math.abs(n))}`;

  const AccountIcon = ({ kind }: { kind: string }) => (
    <span
      aria-hidden="true"
      style={{
        width: '32px', height: '32px', borderRadius: '10px', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: kind === 'cash' ? '#ECFDF5' : theme.brandSoft,
        color:      kind === 'cash' ? '#047857' : theme.brandSoftText,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {kind === 'cash'
          ? <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></>
          : <><path d="M3 10h18M5 10V8l7-4 7 4v2M5 10v8m14-8v8M3 18h18" /></>}
      </svg>
    </span>
  );

  const columns: Column<BankAccountRow>[] = [
    {
      key: 'name', header: t('banking.col_account_name'),
      render: (r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <AccountIcon kind={r.account_type ?? 'bank'} />
          <div style={{ minWidth: 0 }}>
            {/* The name opens the LEDGER. Seeing what moved through an
                account is the common action; changing its IBAN is the rare
                one, and that has its own control on the row. Falls back to
                Edit when there is no GL code, so it is never a dead click. */}
            <button
              type="button"
              title={r.coa_account_id && coaCode(r.coa_account_id) ? t('banking.view_ledger') : t('common.edit')}
              onClick={(e) => {
                e.stopPropagation();
                const code = r.coa_account_id ? coaCode(r.coa_account_id) : null;
                if (code) navigate(`/accounting/general-ledger?code=${encodeURIComponent(code)}`);
                else openEdit(r);
              }}
              style={{ background: 'transparent', border: 'none', padding: 0, fontSize: '13px', fontWeight: 600, color: theme.brandSoftText, cursor: 'pointer', textAlign: 'start' }}
            >
              {r.name}
            </button>
            {r.bank_name && <div style={{ fontSize: '11px', color: theme.inkFaint, marginTop: '1px' }}>{r.bank_name}</div>}
          </div>
        </div>
      ),
    },
    {
      key: 'type', header: t('banking.col_type'), width: '110px',
      render: (r) => (
        <Badge variant={r.account_type === 'cash' ? 'success' : 'brand'}>
          {r.account_type === 'cash' ? t('banking.type_cash') : t('banking.type_bank')}
        </Badge>
      ),
    },
    { key: 'currency', header: t('banking.col_currency'), width: '90px', render: (r) => <span className="font-mono" style={{ fontSize: '12px' }}>{r.currency}</span> },
    {
      key: 'coa', header: t('banking.col_gl_code'),
      render: (r) => (
        <span className="font-mono" style={{ fontSize: '11px', color: theme.inkMuted }}>
          {r.coa_account_id ? coaName(r.coa_account_id) : '\u2014'}
        </span>
      ),
    },
    {
      key: 'opening', header: t('banking.col_opening'), align: 'end', width: '130px',
      render: (r) => (
        <span className="font-mono" style={{ color: theme.inkMuted }}
          title={t('banking.opening_hint')}>
          {fmt(Number(r.opening_balance ?? 0))}
        </span>
      ),
    },
    {
      key: 'balance', header: t('banking.col_current'), align: 'end', width: '140px',
      render: (r) => {
        const bal = balanceOf(r.id);
        if (bal === null) {
          return <span style={{ fontSize: '12px', color: theme.inkFaint }}>{balLoading ? '\u2026' : '\u2014'}</span>;
        }
        // A negative cash account is a real condition worth seeing on the
        // page rather than only in a System Health check.
        return (
          <span className="font-mono" style={{ fontWeight: 700, color: bal < 0 ? theme.danger : theme.ink }}
            title={bal < 0 ? t('banking.negative_hint') : undefined}>
            {fmt(bal)}
          </span>
        );
      },
    },
    {
      key: 'last', header: t('banking.col_last_txn'), width: '170px',
      render: (r) => {
        const a = (activity as Record<string, import('@/data/adapter').BankAccountActivity>)[r.id];
        if (!a?.last_date) return <span style={{ fontSize: '12px', color: theme.inkFaint }}>{'\u2014'}</span>;
        return (
          <div>
            <div style={{ fontSize: '12px', color: theme.ink }}>{a.last_date}</div>
            <div style={{ fontSize: '11px', color: theme.inkFaint, marginTop: '1px' }}>
              {a.related_doc_type && a.related_doc_id
                ? <DocLink type={a.related_doc_type} id={a.related_doc_id} />
                : (a.description ?? '\u2014')}
            </div>
          </div>
        );
      },
    },
    {
      key: 'status', header: t('banking.col_status'), width: '110px',
      render: (r) => (
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          <Badge variant={r.is_active ? 'success' : 'muted'}>
            {r.is_active ? t('common.active') : t('common.inactive')}
          </Badge>
          {r.is_default && <Badge variant="brand">{t('banking.default')}</Badge>}
        </div>
      ),
    },
    {
      key: 'actions', header: t('banking.col_actions'), width: '120px', align: 'end',
      render: (r) => (
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); openEdit(r); }}
            style={{ background: 'transparent', border: 'none', padding: 0, fontSize: '12px', color: theme.brandSoftText, cursor: 'pointer' }}
            title={t('banking.edit_hint')}
          >
            {t('common.edit')}
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(r); }}
            disabled={deleteMutation.isPending}
            style={{ background: 'transparent', border: 'none', padding: 0, fontSize: '12px', color: theme.danger, cursor: 'pointer' }}
            title={t('banking.delete_hint')}
          >
            {t('common.delete')}
          </button>
        </div>
      ),
    },
  ];

  const fieldStyle: React.CSSProperties = {
    border: `1px solid ${theme.border}`, borderRadius: '8px', padding: '8px 10px',
    fontSize: '13px', color: theme.ink, background: '#fff', outline: 'none',
  };
  const filterLabel: React.CSSProperties = {
    fontSize: '10px', fontWeight: 700, color: theme.inkFaint,
    textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '3px', display: 'block',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Banking has no landing page of its own, so the section is a plain
          label. Linking it to Transfers would make "Banking" a click that
          lands somewhere you did not ask for. */}
      <Breadcrumbs items={[
        { label: t('nav.banking') },
        { label: t('banking.accounts_title') },
      ]} />

      <PageHeader
        title={t('banking.accounts_title')}
        subtitle={t('banking.accounts_subtitle')}
        actions={<Button size="sm" onClick={openAdd}>+ {t('banking.add_account')}</Button>}
      />

      {/* KPI row. Summed across every account, not the filtered view. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
        <Stat label={t('banking.kpi_total')}  value={accounts.length} hint={t('banking.kpi_total_hint')} />
        <Stat label={t('banking.kpi_active')} value={activeCount} color="success"
              hint={activeCount === accounts.length ? t('banking.kpi_all_active') : t('banking.kpi_some_inactive')} />
        <Stat label={t('banking.kpi_combined')} value={money(cards ? combined : null)}
              color={combined < 0 ? 'danger' : 'brand'} hint={t('banking.kpi_combined_hint')} />
        <Stat label={t('banking.kpi_cash')} value={money(cards ? cashOnHand : null)}
              color={cashOnHand < 0 ? 'danger' : undefined} hint={t('banking.kpi_cash_hint')} />
      </div>

      {/* Filter bar */}
      <div style={{
        background: theme.card, border: `1px solid ${theme.border}`,
        borderRadius: theme.radiusLg, padding: '12px 14px',
        display: 'flex', alignItems: 'flex-end', gap: '10px', flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 240px', minWidth: '200px' }}>
          <label style={filterLabel} htmlFor="ba-search">{t('common.search')}</label>
          <input id="ba-search" style={fieldStyle} value={search}
                 placeholder={t('banking.search_placeholder')}
                 onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <label style={filterLabel} htmlFor="ba-type">{t('banking.col_type')}</label>
          <select id="ba-type" style={fieldStyle} value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as 'all' | 'bank' | 'cash')}>
            <option value="all">{t('banking.all_types')}</option>
            <option value="bank">{t('banking.type_bank')}</option>
            <option value="cash">{t('banking.type_cash')}</option>
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <label style={filterLabel} htmlFor="ba-status">{t('banking.col_status')}</label>
          <select id="ba-status" style={fieldStyle} value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}>
            <option value="all">{t('banking.all_statuses')}</option>
            <option value="active">{t('common.active')}</option>
            <option value="inactive">{t('common.inactive')}</option>
          </select>
        </div>
      </div>

      {isLoading
        ? <div style={{ padding: '48px 0', textAlign: 'center', fontSize: '13px', color: theme.inkFaint }}>{t('common.loading')}</div>
        : <>
            <Table
              columns={columns}
              rows={visible}
              keyFn={(r) => r.id}
              emptyMessage={accounts.length === 0 ? t('banking.empty') : t('banking.empty_filtered')}
            />
            <p style={{ fontSize: '11px', color: theme.inkFaint, margin: 0 }}>
              {t('banking.balances_note')}
            </p>
          </>
      }


      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit bank account' : 'Add bank account'} width="lg">
        <form onSubmit={handleSubmit((v) => { clearBanner(); return saveMutation.mutateAsync(v); }, onInvalid)} className="flex flex-col gap-4">
          <FormErrorBanner message={bannerMessage} onDismiss={clearBanner} />
          {/* Phase 14.13f — permanence hint. Bank accounts are wiped on
               Reset Company Data, same as every other operational master. */}
          {!editing && (
            <div className="rounded-card border border-border-subtle bg-surface-muted px-3 py-2 text-xs text-ink-secondary">
              <strong>Cleared on Reset Company Data.</strong> Bank accounts are wiped along with
              transactions on a company reset. Only your company, profile, and seeded chart of
              accounts survive.
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Input label="Display name" required error={errors.name?.message} {...register('name')} />
            <Input label="Display name (Arabic)" dir="rtl" {...register('name_ar')} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Select label="Type" required {...register('account_type')}
              options={[{ value: 'bank', label: 'Bank' }, { value: 'cash', label: 'Cash' }]} />
            <Input label="Currency" required error={errors.currency?.message} {...register('currency')} />
          </div>

          <Select
            label="GL account" required
            error={errors.coa_account_id?.message}
            {...register('coa_account_id')}
            options={[
              { value: '', label: '— Select cash / bank GL account —' },
              ...cashBankAccounts.map(a => ({ value: a.id, label: `${a.code} ${a.name}` })),
            ]}
          />

          <div className="grid grid-cols-2 gap-4">
            <Input label="Bank name" {...register('bank_name')} />
            <Input label="Branch" {...register('branch')} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input label="Account number" {...register('account_number')} />
            <Input label="IBAN" {...register('iban')} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input label="SWIFT / BIC" {...register('swift_code')} />
            {/* Opening balance — read-only hint for NEW accounts (post via
                Opening Balances wizard). For EDIT, the inline OB editor below
                handles void+repost atomically through the GL. */}
            {!editing ? (
              <div>
                <Input
                  label="Opening balance"
                  type="number"
                  step="0.01"
                  min="0"
                  {...register('opening_balance')}
                />
                <p className="mt-1 text-xs" style={{ color: theme.inkFaint }}>
                  Sets the column only. For a proper GL opening entry, go to{' '}
                  <a href="/settings/opening-balances" className="font-medium" style={{ color: theme.brandSoftText }}
                    onClick={(e) => { e.preventDefault(); window.location.assign('/settings/opening-balances'); }}>
                    Settings → Opening Balances
                  </a>.
                </p>
              </div>
            ) : (
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: theme.inkMuted, display: 'block', marginBottom: '4px' }}>
                  Opening Balance
                </label>

                {/* Existing JE info card — shows once the targeted query returns */}
                {obLoading && (
                  <p style={{ fontSize: '11px', color: theme.inkFaint, margin: '0 0 6px' }}>Loading posted entry…</p>
                )}
                {!obLoading && existingBankOb && (
                  <div style={{
                    background: theme.brandSoft, border: `1px solid ${theme.brandRing}`,
                    borderRadius: '7px', padding: '6px 10px', marginBottom: '6px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
                  }}>
                    <div>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: theme.brandSoftText }}>
                        Posted: {existingBankOb.doc_number}
                      </span>
                      <span style={{ fontSize: '11px', color: theme.inkMuted, marginInlineStart: '8px' }}>
                        {existingBankOb.date} · {fmt(existingBankOb.amount)}
                      </span>
                    </div>
                    {editing && (
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          const code = (coa as CoaRow[]).find(a => a.id === editing.coa_account_id)?.code ?? '';
                          const yr = existingBankOb.date.slice(0, 4) + '-01-01';
                          window.location.assign(`/accounting/general-ledger?code=${encodeURIComponent(code)}&from=${yr}&to=${existingBankOb.date}`);
                        }}
                        style={{ fontSize: '11px', color: theme.brandSoftText, textDecoration: 'underline', whiteSpace: 'nowrap' }}
                      >
                        View in GL →
                      </a>
                    )}
                  </div>
                )}
                {!obLoading && !existingBankOb && (
                  <p style={{ fontSize: '11px', color: theme.inkFaint, margin: '0 0 6px' }}>
                    No opening JE posted yet — enter an amount and click Post.
                  </p>
                )}

                {/* Edit / post input row */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={obDraft}
                    onChange={(e) => { setObDraft(e.target.value); setObSuccess(false); setObError(''); }}
                    disabled={obLoading || obSaving}
                    style={{
                      flex: 1, height: '36px', border: `1px solid ${theme.border}`,
                      borderRadius: '7px', padding: '0 10px', fontSize: '13px',
                      background: obLoading ? theme.panelHead : '#fff', color: theme.ink,
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleSaveOb}
                    disabled={obLoading || obSaving}
                    style={{
                      height: '36px', padding: '0 14px', borderRadius: '7px',
                      border: `1px solid ${obLoading ? theme.border : theme.brand}`,
                      background: obLoading ? theme.panelHead : theme.brand,
                      color: obLoading ? theme.inkFaint : '#fff',
                      fontSize: '12px', fontWeight: 600,
                      cursor: (obLoading || obSaving) ? 'not-allowed' : 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    {obSaving ? 'Saving…' : obLoading ? 'Loading…' : existingBankOb ? 'Update' : 'Post'}
                  </button>
                </div>

                {obError && (
                  <p className="mt-1 text-xs" style={{ color: theme.danger }}>{obError}</p>
                )}
                {obSuccess && (
                  <p className="mt-1 text-xs" style={{ color: '#15803d' }}>
                    ✓ Updated — TB, BS, P&L and General Ledger will reflect the new amount.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-6 pt-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="h-4 w-4" {...register('is_default')} />
              <span style={{ fontSize: '13px', color: theme.ink }}>Set as default</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="h-4 w-4" {...register('is_active')} />
              <span style={{ fontSize: '13px', color: theme.ink }}>Active</span>
            </label>
          </div>

          {saveMutation.error && (
            <p style={{ fontSize: '12px', color: theme.danger }}>{String(saveMutation.error)}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={isSubmitting}>{editing ? 'Save changes' : 'Add account'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
