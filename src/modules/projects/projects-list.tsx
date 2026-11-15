import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useProjectsEnabled } from '@/hooks/use-company-currency';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Select } from '@/ui/select';
import { Textarea } from '@/ui/textarea';
import { Modal } from '@/ui/modal';
import { StatusBadge } from '@/ui/status-badge';
import { FormErrorBanner } from '@/ui/form-error-banner';
import { useFormInvalidBanner } from '@/hooks/use-form-invalid-banner';
import { OceanPage, OceanTable } from '@/components/ocean-list';
import { ReportFigures } from '@/components/ocean-report';
import type { Column } from '@/ui/table';
import type { ProjectRow, ProjectStatus } from '@/data/adapter';
import { useArabicEnabled } from '@/hooks/use-arabic-enabled';

const STATUSES: ProjectStatus[] = ['planned', 'active', 'completed', 'cancelled'];
// Spelled out (not built from a prefix) so every key is a literal the
// translation-key test can find.
const STATUS_LABEL: Record<ProjectStatus, string> = {
  planned: 'projects.status_planned', active: 'projects.status_active',
  completed: 'projects.status_completed', cancelled: 'projects.status_cancelled',
};
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  const arabicOn = useArabicEnabled();   // India companies: English only
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
      <OceanPage testid="projects-ocean" title={t('projects.title')}>
        <div className="sb-card sb-empty">{t('projects.disabled')}</div>
      </OceanPage>
    );
  }

  // Budget only — actual revenue and cost live in the Project profitability
  // report, read from the ledger.
  const open_ = projects.filter(p => p.status === 'planned' || p.status === 'active');
  const estRevenue = open_.reduce((s, p) => s + Number(p.estimated_revenue ?? 0), 0);
  const estCost = open_.reduce((s, p) => s + Number(p.estimated_cost ?? 0), 0);
  const estMargin = estRevenue - estCost;
  const countOf = (st: string) => projects.filter(p => p.status === st).length;

  const columns: Column<ProjectRow>[] = [
    { key: 'name', header: t('projects.name'), render: p => (
      <span className="sb-pay-namecode">
        <span style={{ fontWeight: 700 }}>{p.name}</span>
        {p.name_ar && <span dir="rtl" style={{ fontSize: 13, color: 'var(--sb-text-secondary)' }}>{p.name_ar}</span>}
      </span>
    ) },
    { key: 'customer', header: t('projects.customer'), render: p => contactName(p.contact_id) },
    // Dates and numbers stay LTR inside RTL text — AGENTS.md section 15.
    { key: 'dates', header: t('projects.dates'), render: p => (
      <bdi dir="ltr">{p.start_date || '—'}{p.end_date ? ' → ' + p.end_date : ''}</bdi>
    ) },
    { key: 'rev', header: t('projects.est_revenue'), align: 'end', render: p => <bdi dir="ltr" className="sb-dash-num" style={{ fontWeight: 500 }}>{fmt(Number(p.estimated_revenue ?? 0))}</bdi> },
    { key: 'cost', header: t('projects.est_cost'), align: 'end', render: p => <bdi dir="ltr" className="sb-dash-num" style={{ fontWeight: 500 }}>{fmt(Number(p.estimated_cost ?? 0))}</bdi> },
    { key: 'status', header: '', render: p => <StatusBadge status={p.status} /> },
    { key: 'actions', header: '', width: '96px', align: 'end', render: p => (
      <div className="sb-row-actions">
        <button type="button" className="sb-icon-btn" onClick={(e) => { e.stopPropagation(); openEdit(p); }}
          title={t('common.edit')} aria-label={t('common.edit')}>
          <Pencil size={15} aria-hidden="true" />
        </button>
        <button type="button" className="sb-icon-btn" style={{ color: 'var(--sb-danger)' }}
          onClick={(e) => { e.stopPropagation(); if (confirm(t('common.confirm_delete'))) deleteMutation.mutate(p.id); }}
          disabled={deleteMutation.isPending} title={t('common.delete')} aria-label={t('common.delete')}>
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </div>
    ) },
  ];

  return (
    // Ocean Teal (UI v1.1): look only — same project record, status filter,
    // add / edit / delete as before.
    <OceanPage
      testid="projects-ocean"
      title={t('projects.title')}
      subtitle={t('projOcean.count', { count: projects.length })}
      actions={
        <button type="button" className="sb-primary-btn sb-btn-inline" onClick={openAdd}>
          <Plus size={18} aria-hidden="true" /> {t('projects.add')}
        </button>
      }
      below={
        <div className="sb-chips" role="group" aria-label={t('projects.status')}>
          <button type="button" aria-pressed={statusFilter === ''} className={`sb-chip ${statusFilter === '' ? 'active' : ''}`} onClick={() => setStatusFilter('')}>
            {t('projects.all_statuses')} <bdi dir="ltr">({projects.length})</bdi>
          </button>
          {STATUSES.map(s => (
            <button key={s} type="button" aria-pressed={statusFilter === s} className={`sb-chip ${statusFilter === s ? 'active' : ''}`} onClick={() => setStatusFilter(s)}>
              {t(STATUS_LABEL[s])} <bdi dir="ltr">({countOf(s)})</bdi>
            </button>
          ))}
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {projects.length > 0 && (
          <div className="sb-card sb-rpt-card">
            <ReportFigures figures={[
              { label: t('projOcean.fig_open'), value: <bdi dir="ltr">{open_.length}</bdi>, note: t('projOcean.fig_open_note') },
              { label: t('projOcean.fig_est_revenue'), value: <bdi dir="ltr">{fmt(estRevenue)}</bdi> },
              { label: t('projOcean.fig_est_margin'), value: <bdi dir="ltr">{fmt(estMargin)}</bdi>, tone: estMargin < 0 ? 'bad' : 'brand', note: t('projOcean.fig_budget_note') },
            ]} />
          </div>
        )}

        {/* A used project cannot be deleted — every project_id foreign key is ON
            DELETE RESTRICT, so the database refuses rather than orphaning a
            tagged ledger row. Say so instead of failing silently. */}
        {deleteMutation.error && <p className="sb-alert sb-alert-danger" role="alert">{t('projects.delete_blocked')}</p>}

        {isLoading
          ? <div className="sb-card sb-empty">{t('common.loading')}</div>
          : <OceanTable
              columns={columns} rows={visible} keyFn={p => p.id} onRowClick={openEdit}
              rowMuted={p => p.status === 'cancelled'} emptyMessage={t('projects.empty')} cardTitleKey="name"
            />}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? t('projects.edit') : t('projects.add')}
      >
        <form
          onSubmit={handleSubmit((v) => { clearBanner(); return saveMutation.mutateAsync(v); }, onInvalid)}
          className="sb-ocean sb-modal-form flex flex-col gap-4"
        >
          <FormErrorBanner message={bannerMessage} onDismiss={clearBanner} />
          <Input label={t('projects.name')} required error={errors.name?.message ? t('projOcean.required') : undefined} {...register('name')} />
          {arabicOn && (
          <Input label={t('projects.name_ar')} dir="rtl" {...register('name_ar')} />
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              options={STATUSES.map(s => ({ value: s, label: t(STATUS_LABEL[s]) }))}
              {...register('status')}
            />
          </div>

          {/* The budget, and the only stored numbers on a project. Actuals are
              never stored — they are read back from the ledger. */}
          <div className="grid grid-cols-2 gap-4">
            <Input
              label={t('projects.est_revenue')}
              type="number" step="0.01" dir="ltr"
              error={errors.estimated_revenue?.message}
              {...register('estimated_revenue')}
            />
            <Input
              label={t('projects.est_cost')}
              type="number" step="0.01" dir="ltr"
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
            <p className="sb-alert sb-alert-danger" role="alert">{String(saveMutation.error)}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={isSubmitting}>{t('common.save')}</Button>
          </div>
        </form>
      </Modal>
    </OceanPage>
  );
}
