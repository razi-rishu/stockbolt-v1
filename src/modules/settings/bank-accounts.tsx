/**
 * Bank accounts settings — Phase 12.45.
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
import { Table, type Column } from '@/ui/table';
import { Badge } from '@/ui/badge';
import { PageHeader } from '@/ui/primitives';
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

export default function BankAccountsSettingsPage() {
  const { company_id } = useAuthStore();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
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

  const columns: Column<BankAccountRow>[] = [
    {
      key: 'name', header: 'Name',
      render: (r) => (
        <div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); openEdit(r); }}
            style={{ background: 'transparent', border: 'none', padding: 0, fontSize: '13px', fontWeight: 600, color: theme.brandSoftText, cursor: 'pointer' }}
          >
            {r.name}
          </button>
          {r.bank_name && <div style={{ fontSize: '11px', color: theme.inkFaint, marginTop: '2px' }}>{r.bank_name}</div>}
        </div>
      ),
    },
    { key: 'type',     header: 'Type',     width: '90px',  render: (r) => <span style={{ textTransform: 'capitalize' }}>{r.account_type}</span> },
    { key: 'currency', header: 'Currency', width: '90px',  render: (r) => <span className="font-mono" style={{ fontSize: '12px' }}>{r.currency}</span> },
    { key: 'account_number', header: 'Account #', render: (r) => r.account_number ? <span className="font-mono" style={{ fontSize: '12px', color: theme.inkMuted }}>{r.account_number}</span> : '—' },
    { key: 'coa',      header: 'GL Account', render: (r) => <span className="font-mono" style={{ fontSize: '11px', color: theme.inkMuted }}>{coaName(r.coa_account_id)}</span> },
    {
      key: 'opening',
      header: 'Opening (posted)',
      align: 'end',
      width: '140px',
      render: (r) => (
        <span
          className="font-mono"
          style={{ color: theme.ink }}
          title="Read-only mirror of the opening JE posted via Settings → Opening Balances. Edits to the bank-accounts form do NOT change this — void + re-post the opening JE instead."
        >
          {fmt(Number(r.opening_balance ?? 0))}
        </span>
      ),
    },
    { key: 'default',  header: '', width: '80px', render: (r) => r.is_default ? <Badge variant="brand">Default</Badge> : null },
    { key: 'status',   header: '', width: '80px', render: (r) => <Badge variant={r.is_active ? 'success' : 'muted'}>{r.is_active ? 'Active' : 'Inactive'}</Badge> },
    {
      key: 'delete', header: '', width: '70px',
      render: (r) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(r); }}
          disabled={deleteMutation.isPending}
          style={{ background: 'transparent', border: 'none', padding: 0, fontSize: '12px', color: '#dc2626', cursor: 'pointer', textDecoration: 'underline' }}
          title="Permanently delete this bank account (refuses if it's referenced by any transaction)"
        >
          Delete
        </button>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        title="Bank Accounts"
        subtitle={`${accounts.length} account${accounts.length === 1 ? '' : 's'} — used to receive payments and post expenses.`}
        crumb="Settings · Accounting"
        actions={<Button size="sm" onClick={openAdd}>+ Add bank account</Button>}
      />

      {isLoading
        ? <div style={{ padding: '48px 0', textAlign: 'center', fontSize: '13px', color: theme.inkFaint }}>Loading…</div>
        : <Table columns={columns} rows={accounts} keyFn={(r) => r.id} emptyMessage="No bank accounts yet. Click Add to create one." />
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
