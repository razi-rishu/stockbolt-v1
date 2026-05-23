/**
 * Chart of Accounts adapter — Phase 14.11b.
 *
 * Each row is identified by `code` (the natural accounting key — 1000
 * Cash, 4100 Sales Revenue, etc.). System accounts (is_system=true)
 * are protected: import skips them with a clear message so a careless
 * paste doesn't try to rename 1200 AR or change 3010's type and break
 * RPCs that hard-code account codes.
 *
 * The "type" column accepts the flat-type vocabulary the
 * /accounting/chart-of-accounts page uses ("current_asset",
 * "fixed_asset", "current_liability", "long_term_liability", "equity",
 * "direct_income", "indirect_income", "direct_expense",
 * "indirect_expense"). validate() decodes that into the (type, sub_type)
 * tuple the DB expects, mirroring the logic in chart-of-accounts.tsx.
 */
import type { ModuleAdapter, ApplyResult, ValidationResult } from './types';
import type { CoaRow, CoaInsert } from '@/data/adapter';
import { getAdapter } from '@/data/index';

const HEADERS = ['code', 'name', 'name_ar', 'type', 'is_active'] as const;

// Same flat-type mapping used by chart-of-accounts.tsx — keep in sync.
const FLAT_MAP: Record<string, { type: 'asset'|'liability'|'equity'|'income'|'expense'; sub_type: string | null }> = {
  'current_asset':       { type: 'asset',     sub_type: 'current'  },
  'fixed_asset':         { type: 'asset',     sub_type: 'fixed'    },
  'current_liability':   { type: 'liability', sub_type: 'current'  },
  'long_term_liability': { type: 'liability', sub_type: 'long_term'},
  'equity':              { type: 'equity',    sub_type: null       },
  'direct_income':       { type: 'income',    sub_type: 'direct'   },
  'indirect_income':     { type: 'income',    sub_type: 'indirect' },
  'direct_expense':      { type: 'expense',   sub_type: 'direct'   },
  'indirect_expense':    { type: 'expense',   sub_type: 'indirect' },
};

// Reverse map for export: (type, sub_type) → flat string.
function flatStringFor(r: { type: string; sub_type: string | null }): string {
  for (const [flat, m] of Object.entries(FLAT_MAP)) {
    if (m.type === r.type && (m.sub_type ?? null) === (r.sub_type ?? null)) return flat;
  }
  // Fallback for legacy rows with unusual sub_types.
  if (r.type === 'asset')     return 'current_asset';
  if (r.type === 'liability') return 'current_liability';
  if (r.type === 'income')    return 'direct_income';
  if (r.type === 'expense')   return 'indirect_expense';
  return 'equity';
}

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v == null || v === '') return fallback;
  const s = v.toLowerCase().trim();
  if (['yes','y','true','1','active'].includes(s))  return true;
  if (['no','n','false','0','inactive'].includes(s)) return false;
  return fallback;
}

export const coaAdapter: ModuleAdapter<CoaRow, CoaInsert & { __existingId?: string; __isSystem?: boolean }> = {
  key: 'coa', label: 'Chart of accounts', icon: '📒',
  description: 'GL accounts. System accounts are skipped on import (built-in RPCs reference them by code).',
  headers: [...HEADERS],
  template: () => [
    { code: '4500', name: 'Service Revenue', name_ar: 'إيرادات الخدمات', type: 'direct_income',     is_active: 'yes' },
    { code: '6300', name: 'Marketing',       name_ar: 'تسويق',          type: 'indirect_expense', is_active: 'yes' },
    { code: '1700', name: 'Office Furniture',name_ar: 'أثاث المكتب',    type: 'fixed_asset',       is_active: 'yes' },
  ],
  fetchAll: (cid) => getAdapter().coa.list(cid),
  serialize: (a) => ({
    code:      a.code,
    name:      a.name,
    name_ar:   a.name_ar ?? '',
    type:      flatStringFor(a),
    is_active: a.is_active ? 'yes' : 'no',
  }),
  validate: (raw, ctx): ValidationResult<CoaInsert & { __existingId?: string; __isSystem?: boolean }> => {
    const errors: string[] = [];
    const code = (raw.code ?? '').trim();
    const name = (raw.name ?? '').trim();
    if (!code) errors.push('code is required');
    if (!name) errors.push('name is required');

    const flatRaw = (raw.type ?? '').trim().toLowerCase();
    const flat = FLAT_MAP[flatRaw];
    if (!flat) {
      errors.push(`type "${raw.type}" must be one of: ${Object.keys(FLAT_MAP).join(', ')}`);
    }
    if (errors.length) return { ok: false, errors };

    const existing = ctx.existing.get(`code:${code.toLowerCase()}`) as ({ id: string; is_system?: boolean } | undefined);
    const row: CoaInsert & { __existingId?: string; __isSystem?: boolean } = {
      company_id: ctx.company_id, code, name,
      name_ar:   raw.name_ar?.trim() || null,
      type:      flat!.type,
      sub_type:  flat!.sub_type,
      parent_id: null,
      is_active: parseBool(raw.is_active, true),
      is_system: false,
      __existingId: existing?.id,
      __isSystem:   existing?.is_system,
    };
    return { ok: true, row };
  },
  apply: async (rows, _ctx, policy) => {
    const out: ApplyResult = { inserted: 0, updated: 0, skipped: 0, errors: [] };
    const api = getAdapter().coa;
    for (let i = 0; i < rows.length; i++) {
      const { __existingId, __isSystem, ...insert } = rows[i];
      try {
        if (__isSystem) {
          // Always refuse to overwrite system accounts via import.
          out.skipped++;
          out.errors.push({
            rowIndex: i,
            message: `Code ${insert.code} is a system account — protected from import. Edit name/name_ar in /accounting/chart-of-accounts directly.`,
          });
          continue;
        }
        if (__existingId) {
          if (policy === 'skip')  { out.skipped++; continue; }
          if (policy === 'error') { out.errors.push({ rowIndex: i, message: `Account ${insert.code} already exists` }); continue; }
          await api.update(__existingId, {
            name:     insert.name,
            name_ar:  insert.name_ar,
            type:     insert.type,
            sub_type: insert.sub_type,
            is_active: insert.is_active,
          });
          out.updated++;
        } else {
          await api.create(insert);
          out.inserted++;
        }
      } catch (e) {
        out.errors.push({ rowIndex: i, message: e instanceof Error ? e.message : 'Unknown error' });
      }
    }
    return out;
  },
};

/** Lookups for CoA — the existing-map is keyed on code; we also stash
 *  is_system on each entry so validate() can flag protection at preview
 *  time. The wizard's natural-key function pulls is_system into the
 *  existing map via the registry. */
export async function buildCoaLookups(_company_id: string): Promise<Record<string, unknown>> {
  return {};   // CoA validate() reads only ctx.existing — no extra lookups needed.
}
