import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useProjectsEnabled } from '@/hooks/use-company-currency';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { Textarea } from '@/ui/textarea';
import { Modal } from '@/ui/modal';
import { StatusBadge } from '@/ui/status-badge';
import { FormErrorBanner } from '@/ui/form-error-banner';
import { useFormInvalidBanner } from '@/hooks/use-form-invalid-banner';
import type { ProjectRow, ProjectStatus } from '@/data/adapter';

const STATUSES: ProjectStatus[] = ['planned', 'active', 'completed', 'cancelled'];

const schema = z.object({
  name:              z.string().min(1, 'Required'),
  name_ar:           z.string(),
  contact_id:        z.string(),
  status:            z.enum(['planned', 'active', 'completed', 'cancelled']),
  estimated_revenue: z.coerce.number().min(0),
  estimated_cost:    z.coerce.number().min(0),
  start_date:        z.string(),
  end_date:          z.string(),
  notes:             z.string(),
});
type FormValues = z.infer<typeof schema>;

const EMPTY: FormValues = {
  name: '', name_ar: '', contact_id: '', status: 'planned',
  estimated_revenue: 0, estimated_cost: 0, start_date: '', end_date: '', notes: '',
};

/**
 * Projects / Jobs — list and CRUD (phase104 Stage 3).
 *
 * A project is a label that ledger rows point at: it stores no money. The two
 * estimate fields are a budget the operator types, and every ACTUAL figure
 * (revenue, cost, margin) is derived from gl_active at read time, because the
 * general ledger is the only source of financial truth — AGENTS.md Rule 1.
 *
 * Gated on companies.projects_enabled so a tenant who has not asked for job
 * costing never sees the module. The nav entry is gated on the same flag; this
 * second check matters because a bookmarked or hand-typed URL would otherwise
 * reach the page with the module switched off.
 */
export default function ProjectsListPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const projectsEnabled = useProjectsEnabled();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectRow | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects', company_id],
    queryFn: () => getAdapter().projects.list(company_id!),
    enabled: !!company_id && projectsEnabled,
  });

  // Customers only: a job is something billed TO someone. Suppliers reach a
  // project through the bills and expenses tagged to it, not through this field.
  const { data: customers = [] } = useQuery({
    queryKey: ['contacts', company_id, 'customer'],
    queryFn: () => getAdapter().contacts.list(company_id!, 'customer'),
    enabled: !!company_id && projectsEnabled,
  });

  const { onInvalid, bannerMessage, clearBanner } = useFormInvalidBanner('projects');
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema) as never,
    defaultValues: EMPTY,
  });

  const visible = useMemo(
    () => (statusFilter ? projects.filter(p => p.status === statusFilter) : projects),
    [projects, statusFilter],
  );

  const contactName = useMemo(() => {
    const m = new Map(customers.map(c => [c.id, c.name]));
    return (id: string | null) => (id ? m.get(id) ?? '—' : '—');
  }, [customers]);

  function openAdd() {
    setEditing(null);
    reset(EMPTY);
    setOpen(true);
  }

  function openEdit(row: ProjectRow) {
    setEditing(row);
    reset({
      name: row.name,
      name_ar: row.name_ar ?? '',
      contact_id: row.contact_id ?? '',
      status: row.status,
      estimated_revenue: Number(row.estimated_revenue ?? 0),
      estimated_cost: Number(row.estimated_cost ?? 0),
      start_date: row.start_date ?? '',
      end_date: row.end_date ?? '',
      notes: row.notes ?? '',
    });
    setOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      // Empty strings are neither dates nor uuids — send NULL, or Postgres
      // rejects '' for a date column and for the contact foreign key.
      const base = {
        name: values.name,
        name_ar: values.name_ar || null,
        contact_id: values.contact_id || null,
        status: values.status,
        estimated_revenue: values.estimated_revenue,
        estimated_cost: values.estimated_cost,
        start_date: values.start_date || null,
        end_date: values.end_date || null,
        notes: values.notes || null,
      };
      if (editing) {
        await getAdapter().projects.update(editing.id, base);
      } else {
        // company_id is a UUID, never a name — AGENTS.md Rule 4.
        await getAdapter().projects.create({ ...base, company_id: company_id!, created_by: null });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects', company_id] });
      setOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => getAdapter().projects.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects', company_id] }),
  });

  if (!projectsEnabled) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-ink-secondary">{t('projects.disabled')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink-primary">{t('projects.title')}</h1>
        <Button size="sm" onClick={openAdd}>
          {t('common.add')} {t('projects.singular')}
        </Button>
      </div>

      <div className="w-48">
        <Select
          label={t('projects.status')}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          options={[
            { value: '', label: t('projects.all_statuses') },
            ...STATUSES.map(s => ({ value: s, label: t('projects.status_' + s) })),
          ]}
        />
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-ink-tertiary">{t('common.loading')}</div>
      ) : visible.length === 0 ? (
        <p className="py-12 text-center text-ink-tertiary">{t('projects.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border-subtle bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-xs uppercase tracking-wide text-ink-tertiary">
                <th className="px-4 py-3 text-start font-semibold">{t('projects.name')}</th>
                <th className="px-4 py-3 text-start font-semibold">{t('projects.customer')}</th>
                <th className="px-4 py-3 text-start font-semibold">{t('projects.status')}</th>
                <th className="px-4 py-3 text-start font-semibold">{t('projects.dates')}</th>
                <th className="px-4 py-3 text-end font-semibold">{t('projects.est_revenue')}</th>
                <th className="px-4 py-3 text-end font-semibold">{t('projects.est_cost')}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((p) => (
                <tr key={p.id} className="group hover:bg-surface-subtle">
                  <td className="px-4 py-3">
                    <span className="font-medium text-ink-primary">{p.name}</span>
                    {p.name_ar && (
                      <span className="ms-2 text-xs text-ink-tertiary" dir="rtl">{p.name_ar}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-secondary">{contactName(p.contact_id)}</td>
                  <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                  {/* Dates and numbers stay LTR inside RTL text — Western
                      numerals are LTR characters, per AGENTS.md section 15. */}
                  <td className="px-4 py-3 text-start text-ink-secondary" dir="ltr">
                    {p.start_date || '—'}{p.end_date ? ' → ' + p.end_date : ''}
                  </td>
                  <td className="px-4 py-3 text-end text-ink-secondary" dir="ltr">
                    {Number(p.estimated_revenue ?? 0).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-end text-ink-secondary" dir="ltr">
                    {Number(p.estimated_cost ?? 0).toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => openEdit(p)}
                        className="text-xs text-brand-600 hover:underline"
                      >
                        {t('common.edit')}
                      </button>
                      <button
                        type="button"
                        onClick={() => { if (confirm(t('common.confirm_delete'))) deleteMutation.mutate(p.id); }}
                        className="text-xs text-danger-500 hover:underline"
                      >
                        {t('common.delete')}
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* A used project cannot be deleted — every project_id foreign key is ON
          DELETE RESTRICT, so the database refuses rather than orphaning a
          tagged ledger row. Say so instead of failing silently. */}
      {deleteMutation.error && (
        <p className="text-xs text-danger-500">{t('projects.delete_blocked')}</p>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? t('projects.edit') : t('projects.add')}
      >
        <form
          onSubmit={handleSubmit((v) => { clearBanner(); return saveMutation.mutateAsync(v); }, onInvalid)}
          className="flex flex-col gap-4"
        >
          <FormErrorBanner message={bannerMessage} onDismiss={clearBanner} />
          <Input label={t('projects.name')} required error={errors.name?.message} {...register('name')} />
          <Input label={t('projects.name_ar')} dir="rtl" {...register('name_ar')} />

          <Select
            label={t('projects.customer')}
            options={[
              { value: '', label: t('projects.no_customer') },
              ...customers.map(c => ({ value: c.id, label: c.name })),
            ]}
            {...register('contact_id')}
          />

          <Select
            label={t('projects.status')}
            options={STATUSES.map(s => ({ value: s, label: t('projects.status_' + s) }))}
            {...register('status')}
          />

          {/* The budget, and the only stored numbers on a project. Actuals are
              never stored — they are read back from the ledger. */}
          <div className="grid grid-cols-2 gap-4">
            <Input
              label={t('projects.est_revenue')}
              type="number"
              step="0.01"
              error={errors.estimated_revenue?.message}
              {...register('estimated_revenue')}
            />
            <Input
              label={t('projects.est_cost')}
              type="number"
              step="0.01"
              error={errors.estimated_cost?.message}
              {...register('estimated_cost')}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input label={t('projects.start_date')} type="date" {...register('start_date')} />
            <Input label={t('projects.end_date')} type="date" {...register('end_date')} />
          </div>

          <Textarea label={t('projects.notes')} rows={2} {...register('notes')} />

          {saveMutation.error && (
            <p className="text-xs text-danger-500">{String(saveMutation.error)}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={isSubmitting}>{t('common.save')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
