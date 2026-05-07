import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Modal } from '@/ui/modal';
import type { CoaRow } from '@/data/adapter';

// Must match the chart_of_accounts.type CHECK constraint exactly:
// ('asset','liability','equity','income','expense')
const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;

const schema = z.object({
  code:     z.string().min(1, 'Required'),
  name:     z.string().min(1, 'Required'),
  name_ar:  z.string(),
  type:     z.enum(ACCOUNT_TYPES),
  sub_type: z.string(),
  parent_id: z.string().nullable(),
});
type FormValues = z.infer<typeof schema>;

function typeColor(type: string) {
  switch (type) {
    case 'asset':     return 'bg-blue-50 text-blue-700';
    case 'liability': return 'bg-red-50 text-red-700';
    case 'equity':    return 'bg-purple-50 text-purple-700';
    case 'income':    return 'bg-green-50 text-green-700';
    case 'expense':   return 'bg-amber-50 text-amber-700';
    default:          return 'bg-surface-muted text-ink-secondary';
  }
}

export default function ChartOfAccountsPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['coa', company_id],
    queryFn: () => getAdapter().coa.list(company_id!),
    enabled: !!company_id,
  });

  const { register, handleSubmit, reset, control, setValue, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema) as any,
    defaultValues: { code: '', name: '', name_ar: '', type: 'asset', sub_type: '', parent_id: null },
  });

  // When the user picks income/expense, the Sub-type field becomes a
  // direct/indirect dropdown (drives Gross Profit grouping in the P&L).
  // For asset/liability/equity it stays a free-text field (e.g. "cash", "bank").
  const watchedType = useWatch({ control, name: 'type' });
  const isPLType = watchedType === 'income' || watchedType === 'expense';

  const createMutation = useMutation({
    mutationFn: async (v: FormValues) =>
      getAdapter().coa.create({
        company_id: company_id!,
        code: v.code,
        name: v.name,
        name_ar: v.name_ar || null,
        type: v.type,
        sub_type: v.sub_type || null,
        parent_id: v.parent_id || null,
        is_active: true,
        is_system: false,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['coa', company_id] });
      setOpen(false);
      reset();
    },
  });

  // Group by type
  const grouped = ACCOUNT_TYPES.reduce<Record<string, CoaRow[]>>((acc, type) => {
    acc[type] = accounts.filter((a) => a.type === type).sort((a, b) => a.code.localeCompare(b.code));
    return acc;
  }, {} as Record<string, CoaRow[]>);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink-primary">{t('accounting.coa_title')}</h1>
        <Button size="sm" onClick={() => { reset(); setOpen(true); }}>{t('accounting.add_account')}</Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-ink-secondary">{t('common.loading')}</p>
      ) : (
        <div className="space-y-4">
          {ACCOUNT_TYPES.map((type) => (
            <div key={type} className="rounded-card border border-border-subtle bg-surface-card">
              <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
                <span className={`rounded-pill px-2 py-0.5 text-xs font-medium capitalize ${typeColor(type)}`}>
                  {t(`accounting.type_${type}`)}
                </span>
                <span className="text-xs text-ink-tertiary">({grouped[type].length})</span>
              </div>
              {grouped[type].length === 0 ? (
                <p className="px-4 py-3 text-sm text-ink-tertiary">{t('accounting.no_accounts')}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                      <th className="px-4 py-2 text-start font-medium">{t('accounting.code')}</th>
                      <th className="px-4 py-2 text-start font-medium">{t('accounting.account_name')}</th>
                      <th className="px-4 py-2 text-start font-medium">{t('accounting.sub_type')}</th>
                      <th className="px-4 py-2 text-start font-medium">{t('accounting.system')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped[type].map((a) => (
                      <tr key={a.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-muted/50">
                        <td className="px-4 py-2.5 font-mono text-xs text-ink-primary">{a.code}</td>
                        <td className="px-4 py-2.5 text-ink-primary">{a.name}</td>
                        <td className="px-4 py-2.5 text-ink-secondary">{a.sub_type ?? '—'}</td>
                        <td className="px-4 py-2.5">
                          {a.is_system && (
                            <span className="rounded-pill bg-surface-muted px-1.5 py-0.5 text-xs text-ink-tertiary">
                              {t('accounting.system')}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={t('accounting.add_account')}>
        <form onSubmit={handleSubmit((v) => createMutation.mutate(v as FormValues))} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('accounting.code')}</label>
              <Input {...register('code')} placeholder="e.g. 1101" />
              {errors.code && <p className="mt-1 text-xs text-red-500">{errors.code.message}</p>}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('accounting.type')}</label>
              <select
                {...register('type')}
                className="h-9 w-full rounded-card border border-border-subtle bg-surface-card px-3 text-sm text-ink-primary focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {ACCOUNT_TYPES.map((t2) => (
                  <option key={t2} value={t2}>{t(`accounting.type_${t2}`)}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('accounting.account_name')}</label>
            <Input {...register('name')} placeholder={t('accounting.account_name')} />
            {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name.message}</p>}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('accounting.account_name_ar')}</label>
            <Input {...register('name_ar')} dir="rtl" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('accounting.sub_type')}</label>
            {isPLType ? (
              <>
                <select
                  {...register('sub_type')}
                  className="h-9 w-full rounded-card border border-border-subtle bg-surface-card px-3 text-sm text-ink-primary focus:outline-none focus:ring-2 focus:ring-brand-500"
                  onChange={(e) => setValue('sub_type', e.target.value)}
                >
                  <option value="direct">
                    {watchedType === 'income' ? 'Direct (Sales) — above Gross Profit' : 'Direct (COGS) — above Gross Profit'}
                  </option>
                  <option value="indirect">
                    {watchedType === 'income' ? 'Indirect (Other Income) — below Gross Profit' : 'Indirect (Operating Expense) — below Gross Profit'}
                  </option>
                </select>
                <p className="mt-1 text-xs text-ink-tertiary">
                  Direct = part of Gross Profit calculation. Indirect = reported separately as Other Income / Operating Expense.
                </p>
              </>
            ) : (
              <Input {...register('sub_type')} placeholder="e.g. cash, bank" />
            )}
          </div>
          {createMutation.isError && (
            <p className="text-xs text-red-500">{t('common.error')}</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={isSubmitting || createMutation.isPending}>{t('common.save')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
