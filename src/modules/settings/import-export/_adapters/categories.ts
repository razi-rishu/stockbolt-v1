/**
 * Categories adapter — Phase 14.11b.
 *
 * Categories are self-referencing (parent_id → categories.id), so the
 * "parent" column is entered by NAME. Lookups load existing categories
 * first; for new categories in the same batch we make a second pass at
 * apply time, resolving parents only after all parent rows are inserted.
 *
 * Operator-friendly approach: just list parents BEFORE their children
 * in the file. A single linear apply pass works because by the time we
 * hit a child row, the parent is already inserted.
 */
import type { ModuleAdapter, ApplyResult, ValidationResult } from './types';
import type { CategoryRow, CategoryInsert } from '@/data/adapter';
import { getAdapter } from '@/data/index';

interface CategoryLookups {
  byName: Map<string, CategoryRow>;
}

const HEADERS = ['name', 'name_ar', 'parent', 'sort_order', 'is_active'] as const;

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v == null || v === '') return fallback;
  const s = v.toLowerCase().trim();
  if (['yes','y','true','1','active'].includes(s))  return true;
  if (['no','n','false','0','inactive'].includes(s)) return false;
  return fallback;
}

export const categoriesAdapter: ModuleAdapter<
  CategoryRow,
  CategoryInsert & { __existingId?: string; __parentName?: string }
> = {
  key: 'categories', label: 'Categories', icon: '🗂️',
  description: 'Product groupings. Self-nesting: parent column refers to another category by name.',
  headers: [...HEADERS],
  template: () => [
    { name: 'Lubricants', name_ar: 'زيوت', parent: '', sort_order: '1', is_active: 'yes' },
    { name: 'Filters',    name_ar: 'فلاتر', parent: '', sort_order: '2', is_active: 'yes' },
    { name: 'Engine Oil', name_ar: 'زيت محرك', parent: 'Lubricants', sort_order: '1', is_active: 'yes' },
  ],
  fetchAll: (cid) => getAdapter().categories.list(cid),
  serialize: (c) => ({
    name: c.name, name_ar: c.name_ar ?? '',
    parent: c.parent_id ?? '',          // resolved by export caller
    sort_order: String(c.sort_order ?? 0),
    is_active: c.is_active ? 'yes' : 'no',
  }),
  validate: (raw, ctx): ValidationResult<CategoryInsert & { __existingId?: string; __parentName?: string }> => {
    const errors: string[] = [];
    const lk   = ctx.lookups as unknown as CategoryLookups;
    const name = (raw.name ?? '').trim();
    if (!name) errors.push('name is required');
    const sortN = parseFloat(raw.sort_order ?? '0');
    if (raw.sort_order && !isFinite(sortN)) errors.push(`sort_order "${raw.sort_order}" is not a number`);

    let parent_id: string | null = null;
    const parentName = raw.parent?.trim();
    if (parentName) {
      // First check existing rows. If not there, defer to apply time —
      // the parent might be earlier in the same import batch.
      const existing = lk.byName.get(parentName.toLowerCase());
      if (existing) {
        parent_id = existing.id;
      }
      // If not existing AND not "later resolved at apply", it's a warning
      // but not a hard error — apply() handles missing parents gracefully.
    }
    if (errors.length) return { ok: false, errors };

    const row: CategoryInsert & { __existingId?: string; __parentName?: string } = {
      company_id: ctx.company_id, name,
      name_ar:    raw.name_ar?.trim() || null,
      parent_id,
      sort_order: isFinite(sortN) ? sortN : 0,
      is_active:  parseBool(raw.is_active, true),
      __parentName: parentName || undefined,    // stash for 2nd-pass resolution
    };
    const ex = lk.byName.get(name.toLowerCase());
    if (ex) row.__existingId = ex.id;
    return { ok: true, row };
  },
  apply: async (rows, ctx, policy) => {
    const out: ApplyResult = { inserted: 0, updated: 0, skipped: 0, errors: [] };
    const api = getAdapter().categories;
    // Mutable lookup so newly-created categories resolve their children.
    const nameToId = new Map<string, string>();
    const lk = ctx.lookups as unknown as CategoryLookups;
    for (const [k, c] of lk.byName.entries()) nameToId.set(k, c.id);

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const { __existingId, __parentName, ...insert } = r;

      // Re-resolve parent against the running lookup (catches in-batch
      // parents created earlier in the loop).
      if (__parentName && !insert.parent_id) {
        const id = nameToId.get(__parentName.toLowerCase());
        if (id) insert.parent_id = id;
        else {
          out.errors.push({ rowIndex: i, message: `parent "${__parentName}" not found — put parent rows BEFORE their children in the file` });
          continue;
        }
      }

      try {
        if (__existingId) {
          if (policy === 'skip')  { out.skipped++; continue; }
          if (policy === 'error') { out.errors.push({ rowIndex: i, message: `Category "${insert.name}" already exists` }); continue; }
          const { company_id: _c, ...update } = insert;
          void _c;
          await api.update(__existingId, update);
          out.updated++;
          nameToId.set(insert.name.toLowerCase(), __existingId);
        } else {
          const created = await api.create(insert);
          out.inserted++;
          nameToId.set(insert.name.toLowerCase(), created.id);
        }
      } catch (e) {
        out.errors.push({ rowIndex: i, message: e instanceof Error ? e.message : 'Unknown error' });
      }
    }
    return out;
  },
};

export async function buildCategoryLookups(company_id: string): Promise<CategoryLookups> {
  const rows = await getAdapter().categories.list(company_id);
  const byName = new Map<string, CategoryRow>();
  for (const r of rows) byName.set(r.name.toLowerCase(), r);
  return { byName };
}

/** Resolve parent IDs to NAMES for export. */
export async function serializeCategoriesForExport(rows: CategoryRow[]): Promise<Record<string, string>[]> {
  const byId = new Map(rows.map(r => [r.id, r.name]));
  return rows.map(c => ({
    ...categoriesAdapter.serialize(c),
    parent: c.parent_id ? byId.get(c.parent_id) ?? '' : '',
  }));
}
