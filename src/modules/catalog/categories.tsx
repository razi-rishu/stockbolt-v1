import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';
import { Modal } from '@/ui/modal';
import ImportExportButton from '@/modules/settings/import-export/ImportExportButton';
import type { CategoryRow } from '@/data/adapter';
import { useFormInvalidBanner } from '@/hooks/use-form-invalid-banner';
import { FormErrorBanner } from '@/ui/form-error-banner';

const schema = z.object({
  name:           z.string().min(1, 'Required'),
  name_ar:        z.string(),
  parent_id:      z.string().nullable(),
  icon:           z.string(),
  image_url:      z.string(),
  description:    z.string(),
  description_ar: z.string(),
  is_active:      z.boolean(),
});
type FormValues = z.infer<typeof schema>;
const EMPTY: FormValues = { name: '', name_ar: '', parent_id: null, icon: '', image_url: '', description: '', description_ar: '', is_active: true };

interface FlatNode { node: CategoryRow; depth: number; hasChildren: boolean; siblings: CategoryRow[]; index: number; }

/**
 * Categories — nested tree (Phase 32 / catalog C7).
 *
 * `categories` is already hierarchical (parent_id, sort_order, is_active) and C1
 * added icon/image_url/description/description_ar. This rebuild renders the tree
 * (expand/collapse), edits the enriched fields, reorders siblings via ↑/↓ (writes
 * sort_order), and adds sub-categories inline. UI-only — no migration.
 */
export default function CategoriesPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['categories', company_id],
    queryFn: () => getAdapter().categories.list(company_id!),
    enabled: !!company_id,
  });

  const { onInvalid, bannerMessage, clearBanner } = useFormInvalidBanner('categories');
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema) as any,
    defaultValues: EMPTY,
  });

  // ── build tree → flat list honouring collapse state ──
  const flat = useMemo(() => {
    const byParent = new Map<string, CategoryRow[]>();
    for (const c of categories) {
      const key = c.parent_id ?? '__root__';
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(c);
    }
    const sortFn = (a: CategoryRow, b: CategoryRow) => ((a.sort_order ?? 0) - (b.sort_order ?? 0)) || a.name.localeCompare(b.name);
    for (const arr of byParent.values()) arr.sort(sortFn);
    const out: FlatNode[] = [];
    const walk = (parentKey: string, depth: number) => {
      const siblings = byParent.get(parentKey) ?? [];
      siblings.forEach((node, index) => {
        const hasChildren = byParent.has(node.id);
        out.push({ node, depth, hasChildren, siblings, index });
        if (hasChildren && !collapsed.has(node.id)) walk(node.id, depth + 1);
      });
    };
    walk('__root__', 0);
    return out;
  }, [categories, collapsed]);

  function openAdd(parentId: string | null = null) {
    setEditing(null);
    reset({ ...EMPTY, parent_id: parentId });
    setOpen(true);
  }
  function openEdit(row: CategoryRow) {
    setEditing(row);
    const r = row as any;
    reset({
      name: row.name, name_ar: row.name_ar ?? '', parent_id: row.parent_id ?? null,
      icon: r.icon ?? '', image_url: r.image_url ?? '', description: r.description ?? '', description_ar: r.description_ar ?? '',
      is_active: row.is_active ?? true,
    });
    setOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const row: any = {
        company_id: company_id!, name: values.name, name_ar: values.name_ar || null,
        parent_id: values.parent_id || null, is_active: values.is_active,
      };
      // C1 enrichment columns — send only when filled (migration-tolerant).
      if (values.icon) row.icon = values.icon;
      if (values.image_url) row.image_url = values.image_url;
      if (values.description) row.description = values.description;
      if (values.description_ar) row.description_ar = values.description_ar;
      if (editing) {
        await getAdapter().categories.update(editing.id, row);
      } else {
        await getAdapter().categories.create(row);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['categories', company_id] }); setOpen(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => getAdapter().categories.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories', company_id] }),
  });

  const reorderMutation = useMutation({
    mutationFn: async ({ siblings, from, to }: { siblings: CategoryRow[]; from: number; to: number }) => {
      const arr = [...siblings];
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      // Renumber the whole sibling group so legacy rows (all sort_order 0) settle correctly.
      const writes = arr
        .map((n, i) => (n.sort_order !== i ? getAdapter().categories.update(n.id, { sort_order: i }) : null))
        .filter(Boolean) as Promise<void>[];
      await Promise.all(writes);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories', company_id] }),
  });

  function move(fn: FlatNode, dir: -1 | 1) {
    const to = fn.index + dir;
    if (to < 0 || to >= fn.siblings.length) return;
    reorderMutation.mutate({ siblings: fn.siblings, from: fn.index, to });
  }

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // exclude self + descendants from the parent picker to avoid cycles
  const blockedIds = useMemo(() => {
    if (!editing) return new Set<string>();
    const ids = new Set<string>([editing.id]);
    let added = true;
    while (added) {
      added = false;
      for (const c of categories) {
        if (c.parent_id && ids.has(c.parent_id) && !ids.has(c.id)) { ids.add(c.id); added = true; }
      }
    }
    return ids;
  }, [editing, categories]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink-primary">{t('catalog.categories.title')}</h1>
        <div className="flex gap-2">
          <ImportExportButton moduleKey="categories" />
          <Button size="sm" onClick={() => openAdd(null)}>{t('common.add')} {t('catalog.categories.singular')}</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-ink-tertiary">{t('common.loading')}</div>
      ) : flat.length === 0 ? (
        <p className="py-12 text-center text-ink-tertiary">{t('catalog.categories.empty')}</p>
      ) : (
        <div className="overflow-hidden rounded-card border border-border-subtle bg-white">
          <ul className="divide-y divide-slate-100">
            {flat.map((fn) => {
              const r = fn.node as any;
              return (
                <li
                  key={fn.node.id}
                  className="group flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-slate-50"
                  style={{ paddingInlineStart: 12 + fn.depth * 22 }}
                >
                  {fn.hasChildren ? (
                    <button onClick={() => toggle(fn.node.id)} className="flex h-5 w-5 items-center justify-center text-ink-tertiary hover:text-ink-primary">
                      {collapsed.has(fn.node.id) ? '▸' : '▾'}
                    </button>
                  ) : (
                    <span className="inline-block h-5 w-5" />
                  )}
                  {r.icon && <span className="text-base leading-none">{r.icon}</span>}
                  <span className={`font-medium ${fn.node.is_active === false ? 'text-ink-tertiary line-through' : 'text-ink-primary'}`}>{fn.node.name}</span>
                  {fn.node.name_ar && <span className="text-xs text-ink-tertiary" dir="rtl">{fn.node.name_ar}</span>}
                  {fn.node.is_active === false && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">{t('catalog.categories.inactive')}</span>}

                  <span className="ms-auto flex items-center gap-2 opacity-0 group-hover:opacity-100">
                    <button onClick={() => move(fn, -1)} disabled={fn.index === 0} className="text-xs text-ink-secondary hover:text-ink-primary disabled:opacity-30" title={t('catalog.categories.move_up')}>↑</button>
                    <button onClick={() => move(fn, 1)} disabled={fn.index === fn.siblings.length - 1} className="text-xs text-ink-secondary hover:text-ink-primary disabled:opacity-30" title={t('catalog.categories.move_down')}>↓</button>
                    <button onClick={() => openAdd(fn.node.id)} className="text-xs text-brand-600 hover:underline">{t('catalog.categories.add_child')}</button>
                    <button onClick={() => openEdit(fn.node)} className="text-xs text-brand-600 hover:underline">{t('common.edit')}</button>
                    <button onClick={() => { if (confirm(t('common.confirm_delete'))) deleteMutation.mutate(fn.node.id); }} className="text-xs text-danger-500 hover:underline">{t('common.delete')}</button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? t('catalog.categories.edit') : t('catalog.categories.add')}>
        <form onSubmit={handleSubmit((v) => { clearBanner(); return saveMutation.mutateAsync(v); }, onInvalid)} className="flex flex-col gap-4">
          <FormErrorBanner message={bannerMessage} onDismiss={clearBanner} />
          <Input label={t('catalog.categories.name')} required error={errors.name?.message} {...register('name')} />
          <Input label={t('catalog.categories.name_ar')} dir="rtl" {...register('name_ar')} />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-ink-primary">{t('catalog.categories.parent')}</label>
            <select className="h-10 rounded-input border border-border-strong bg-surface-subtle px-4 text-sm focus:border-brand-500 focus:outline-none" {...register('parent_id')}>
              <option value="">{t('catalog.categories.no_parent')}</option>
              {categories.filter((c) => !blockedIds.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('catalog.categories.icon')} hint={t('catalog.categories.icon_hint')} {...register('icon')} />
            <Input label={t('catalog.categories.image_url')} placeholder="https://" {...register('image_url')} />
          </div>
          <Textarea label={t('catalog.categories.description')} rows={2} {...register('description')} />
          <Textarea label={t('catalog.categories.description_ar')} rows={2} dir="rtl" {...register('description_ar')} />
          <label className="flex items-center gap-2 text-sm text-ink-primary">
            <input type="checkbox" {...register('is_active')} className="h-4 w-4 rounded border-border-strong" />
            {t('catalog.categories.active')}
          </label>
          {saveMutation.error && <p className="text-xs text-danger-500">{String(saveMutation.error)}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={isSubmitting}>{t('common.save')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
