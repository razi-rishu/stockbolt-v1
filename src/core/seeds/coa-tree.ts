/**
 * CoA tree-options helper — Phase 14.13b.
 *
 * Takes the flat CoaRow[] from `coa.list()` and returns it in tree-order
 * with a depth indicator per row. Consumers map this into picker
 * options like:
 *
 *   buildCoaTreeOptions(rows).map(({ row, depth }) => ({
 *     value: row.id,
 *     label: '  '.repeat(depth) + row.code + ' — ' + row.name,
 *   }))
 *
 * Children appear immediately after their parent. Orphan rows (parent_id
 * points to a missing parent) fall back to top-level so they stay
 * visible. Inactive rows are still included by default — the caller
 * decides whether to filter them out.
 *
 * Stable sort within each parent group: by code.
 */
import type { CoaRow } from '@/data/adapter';

export interface CoaTreeEntry {
  row:   CoaRow;
  depth: number;
}

export function buildCoaTreeOptions(rows: CoaRow[]): CoaTreeEntry[] {
  // Index children by parent_id (null = top-level).
  const byParent = new Map<string | null, CoaRow[]>();
  for (const r of rows) {
    const key = r.parent_id ?? null;
    const arr = byParent.get(key) ?? [];
    arr.push(r);
    byParent.set(key, arr);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => a.code.localeCompare(b.code));
  }

  const seen = new Set<string>();
  const out: CoaTreeEntry[] = [];
  const walk = (parentId: string | null, depth: number) => {
    const kids = byParent.get(parentId) ?? [];
    for (const k of kids) {
      if (seen.has(k.id)) continue;     // cycle guard
      seen.add(k.id);
      out.push({ row: k, depth });
      walk(k.id, depth + 1);
    }
  };
  walk(null, 0);

  // Orphans — append at the end as top-level so they stay visible if
  // their parent_id points to a deleted/foreign row.
  for (const r of rows) {
    if (!seen.has(r.id)) {
      out.push({ row: r, depth: 0 });
      seen.add(r.id);
    }
  }
  return out;
}

/** Pre-formatted "indent + code + name" label used by most pickers.
 *  Uses NBSP ( ) so the indent survives in `<option>` (which
 *  collapses regular whitespace) and in any `<select>` rendering. */
export function coaOptionLabel(row: CoaRow, depth: number): string {
  const prefix = depth === 0 ? '' : '  '.repeat(depth) + '↳ ';
  return `${prefix}${row.code} — ${row.name}`;
}
