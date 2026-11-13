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
import { OceanPage } from '@/components/ocean-list';
import { Plus, ChevronDown, ChevronRight, ArrowUp, ArrowDown, Pencil, Trash2, FolderPlus } from 'lucide-react';
import { useArabicEnabled } from '@/hooks/use-arabic-enabled';

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
  const arabicOn = useArabicEnabled();   // India companies: English only
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

  // Ocean Teal (UI v1.1): look only — same tree, collapse, reorder, add
  // sub-category, edit and delete as before. Row actions are always visible
  // (they were hover-only, which a phone cannot reach).
  return (
    <OceanPage
      testid="categories-ocean"
      title={t('settingsNav.items.categories.title')}
      subtitle={t('settingsPages.categories.count', { count: categories.length })}
      actions={<>
        <span className="sb-clist-io"><ImportExportButton moduleKey="categories" /></span>
        <button type="button" className="sb-primary-btn sb-btn-inline" onClick={() => openAdd(null)}><Plus size={18} aria-hidden="true" />{t('catalog.categories.add')}</button>
      </>}
    >
      {isLoading ? (
        <div className="sb-card sb-empty">{t('common.loading')}</div>
      ) : flat.length === 0 ? (
        <div className="sb-card sb-empty">{t('catalog.categories.empty')}</div>
      ) : (
        <div className="sb-card sb-tree" style={{ padding: 0 }}>
          <ul>
            {flat.map((fn) => {
              const r = fn.node as any;
              const inactive = fn.node.is_active === false;
              return (
                <li key={fn.node.id} className={`sb-tree-row ${inactive ? 'is-muted' : ''}`} style={{ paddingInlineStart: 8 + fn.depth * 24 }}>
                  <span className="sb-tree-main">
                    {fn.hasChildren ? (
                      <button type="button" onClick={() => toggle(fn.node.id)} className="sb-tree-toggle" aria-expanded={!collapsed.has(fn.node.id)} aria-label={fn.node.name}>
                        {collapsed.has(fn.node.id) ? <ChevronRight size={18} className="sb-flip" aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
                      </button>
                    ) : (
                      <span className="sb-tree-toggle" aria-hidden="true" />
                    )}
                    {r.icon && <span className="sb-tree-emoji">{r.icon}</span>}
                    <span style={{ minWidth: 0 }}>
                      <span className="sb-tree-name">{fn.node.name}</span>
                      {fn.node.name_ar && <span className="sb-tree-ar"><bdi>{fn.node.name_ar}</bdi></span>}
                    </span>
                    {inactive && <span className="sb-pill sb-pill-muted">{t('catalog.categories.inactive')}</span>}
                  </span>

                  <span className="sb-tree-actions">
                    <button type="button" onClick={() => move(fn, -1)} disabled={fn.index === 0} className="sb-icon-btn" title={t('catalog.categories.move_up')} aria-label={`${t('catalog.categories.move_up')} ${fn.node.name}`}><ArrowUp size={16} aria-hidden="true" /></button>
                    <button type="button" onClick={() => move(fn, 1)} disabled={fn.index === fn.siblings.length - 1} className="sb-icon-btn" title={t('catalog.categories.move_down')} aria-label={`${t('catalog.categories.move_down')} ${fn.node.name}`}><ArrowDown size={16} aria-hidden="true" /></button>
                    <button type="button" onClick={() => openAdd(fn.node.id)} className="sb-icon-btn" aria-label={`${t('catalog.categories.add_child')} ${fn.node.name}`}><FolderPlus size={16} aria-hidden="true" /><span>{t('catalog.categories.add_child')}</span></button>
                    <button type="button" onClick={() => openEdit(fn.node)} className="sb-icon-btn" aria-label={`${t('common.edit')} ${fn.node.name}`}><Pencil size={16} aria-hidden="true" /><span>{t('common.edit')}</span></button>
                    <button type="button" onClick={() => { if (confirm(t('common.confirm_delete'))) deleteMutation.mutate(fn.node.id); }} className="sb-icon-btn sb-danger" aria-label={`${t('common.delete')} ${fn.node.name}`}><Trash2 size={16} aria-hidden="true" /><span>{t('common.delete')}</span></button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? t('catalog.categories.edit') : t('catalog.categories.add')}>
        <form onSubmit={handleSubmit((v) => { clearBanner(); return saveMutation.mutateAsync(v); }, onInvalid)} className="sb-ocean sb-form sb-modal-form">
          <FormErrorBanner message={bannerMessage} onDismiss={clearBanner} />
          <Input label={t('catalog.categories.name')} required error={errors.name?.message} {...register('name')} />
          {arabicOn && (
          <Input label={t('catalog.categories.name_ar')} dir="rtl" {...register('name_ar')} />
          )}
          <div className="flex flex-col gap-1">
            <label className="sb-select-label" htmlFor="category-parent">{t('catalog.categories.parent')}</label>
            <select id="category-parent" className="sb-field" {...register('parent_id')}>
              <option value="">{t('catalog.categories.no_parent')}</option>
              {categories.filter((c) => !blockedIds.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('catalog.categories.icon')} hint={t('catalog.categories.icon_hint')} {...register('icon')} />
            <Input label={t('catalog.categories.image_url')} placeholder="https://" {...register('image_url')} />
          </div>
          <Textarea label={t('catalog.categories.description')} rows={2} {...register('description')} />
          {arabicOn && (
          <Textarea label={t('catalog.categories.description_ar')} rows={2} dir="rtl" {...register('description_ar')} />
          )}
          <label className="sb-check-row">
            <input type="checkbox" {...register('is_active')} />
            <span className="sb-check-text">{t('catalog.categories.active')}</span>
          </label>
          {saveMutation.error && <p className="text-xs text-danger-500">{String(saveMutation.error)}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={isSubmitting}>{t('common.save')}</Button>
          </div>
        </form>
      </Modal>
    </OceanPage>
  );
}
