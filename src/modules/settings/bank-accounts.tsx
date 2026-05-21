/**
 * Bank accounts settings — Phase 12.45.
 *
 * CRUD UI for the bank_accounts master table. Each row links to a GL
 * account in the CoA (the cash/bank side of every payment posts into
 * `coa_account_id`). The "default" flag picks the account that gets
 * pre-selected on new payments.
 */
import { useState } from 'react';
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

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['bankAccounts', company_id],
    queryFn:  () => getAdapter().bankAccounts.list(company_id!),
    enabled:  !!company_id,
  });

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
        opening_balance: values.opening_balance,
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
    { key: 'opening',  header: 'Opening Balance', align: 'end', width: '130px', render: (r) => <span className="font-mono" style={{ color: theme.ink }}>{fmt(Number(r.opening_balance ?? 0))}</span> },
    { key: 'default',  header: '', width: '80px', render: (r) => r.is_default ? <Badge variant="brand">Default</Badge> : null },
    { key: 'status',   header: '', width: '80px', render: (r) => <Badge variant={r.is_active ? 'success' : 'muted'}>{r.is_active ? 'Active' : 'Inactive'}</Badge> },
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
        <form onSubmit={handleSubmit((v) => saveMutation.mutateAsync(v))} className="flex flex-col gap-4">
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
            <Input label="Opening balance" type="number" step="0.01" {...register('opening_balance')} />
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
