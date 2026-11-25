/**
 * phase157 — Repack (Document 3 C5). Locks the migration's shape and the
 * screen's checks; the numbers were proven on staging with the real functions.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkRepack, type RepackLine } from '@/lib/repack';
import { ALL_ON, inventoryLinkVisible, inventorySettingsFrom } from '@/lib/inventory-settings';
import { STOCK_MOVEMENT_TYPES } from '@/lib/stock-movement';

const sql = readFileSync('supabase/migrations/20261125000002_phase157_repack.sql', 'utf8').replace(/--.*/g, '');
const body = (fn: string) => {
  const i = sql.indexOf(`FUNCTION public.${fn}(`);
  expect(i, fn).toBeGreaterThan(-1);
  return sql.slice(i, sql.indexOf('$function$;', i));
};

describe('phase157 migration', () => {
  it('is off for every company and changes no existing function or row', () => {
    expect(sql).toMatch(/repack_enabled boolean NOT NULL DEFAULT false/);
    const made = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]).sort();
    expect(made).toEqual(['confirm_stock_repack', 'tg_stock_repack_guard', 'tg_stock_repack_items_guard', 'void_stock_repack']);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.(stock_ledger|general_ledger|journal_entries)/i);
  });
  it('extends the live CHECK lists, it never replaces them from the file', () => {
    expect(sql).toMatch(/pg_get_constraintdef\(c\.oid\)/);
    expect(sql).not.toMatch(/ADD CONSTRAINT stock_ledger_type_check|ADD CONSTRAINT journal_entries_source_type_check/);
  });
  it.each(['confirm_stock_repack', 'void_stock_repack'])('%s is a pinned definer, permission-checked, company-scoped, on the voucher date', (fn) => {
    const b = body(fn);
    expect(b).toMatch(/SECURITY DEFINER/);
    expect(b).toMatch(/SET search_path TO 'public', 'pg_temp'/);
    expect(b).toMatch(/has_perm\('inventory\.write'\)/);
    expect(b).toMatch(/company_id = v_company FOR UPDATE/);
    expect(b).toMatch(/v_lock IS NOT NULL AND v_doc\.date <= v_lock/);
    expect(b).not.toMatch(/CURRENT_DATE/);
  });
  it('both posting functions end up owned by ledger_writer, which keeps no CREATE', () => {
    expect(sql).toMatch(/ALTER FUNCTION public\.confirm_stock_repack\(uuid\) OWNER TO ledger_writer/);
    expect(sql).toMatch(/ALTER FUNCTION public\.void_stock_repack\(uuid, text\) OWNER TO ledger_writer/);
    expect(sql.indexOf('REVOKE CREATE ON SCHEMA public FROM ledger_writer')).toBeGreaterThan(sql.indexOf('OWNER TO ledger_writer'));
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.confirm_stock_repack\(uuid\), public\.void_stock_repack\(uuid, text\) FROM PUBLIC, anon/);
  });
  it('what is made takes exactly what was used; only wastage reaches 6700 / 1300', () => {
    const b = body('confirm_stock_repack');
    expect(b).toMatch(/'repack_in', 1,\s+v_doc\.output_quantity, v_unit, v_made,/);
    expect((b.match(/INSERT INTO public\.journal_entries/g) ?? []).length).toBe(1);
    expect(b.indexOf('IF v_waste > 0')).toBeLessThan(b.indexOf('INSERT INTO public.journal_entries'));
    expect(b).toMatch(/_approval_rule_applies\(v_company, ARRAY\['inventory_adjustment'\], v_waste\)/);
  });
  it('both tables have RLS and nothing for anon', () => {
    for (const t of ['stock_repacks', 'stock_repack_items']) expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`));
    expect(sql).not.toMatch(/GRANT[^;]*\bTO\b[^;]*\banon\b/);
  });
});

describe('repack screen', () => {
  const stock = (id: string) => ({ sugar: { qty: 50, mac: 12.5 }, bag: { qty: 300, mac: 0.1 }, free: { qty: 5, mac: 0 } }[id]);
  const dec = (id: string) => id === 'sugar';
  const go = (out: { product_id: string | null; quantity: number }, lines: RepackLine[]) => checkRepack(out, lines, stock, dec);
  const l = (product_id: string, quantity: number, kind: 'input' | 'waste' = 'input'): RepackLine => ({ product_id, quantity, kind });

  it('the approved example: 48 KG + 240 bags, 2 KG wasted', () => {
    expect(go({ product_id: 'packet', quantity: 240 }, [l('sugar', 48), l('bag', 240), l('sugar', 2, 'waste')]))
      .toEqual({ value: 624, unit_cost: 2.6, waste: 25, problems: [] });
  });
  it('says what is wrong before anything is saved', () => {
    const kinds = (c: ReturnType<typeof go>) => c.problems.map((p) => p.kind);
    expect(kinds(go({ product_id: null, quantity: 0 }, []))).toEqual(['no_output', 'no_input']);
    expect(kinds(go({ product_id: 'packet', quantity: 2.5 }, [l('sugar', 1)]))).toEqual(['whole_units']);
    expect(kinds(go({ product_id: 'sugar', quantity: 1 }, [l('sugar', 1)]))).toEqual(['same_product']);
    expect(kinds(go({ product_id: 'packet', quantity: 1 }, [l('free', 1)]))).toEqual(['no_cost']);
    expect(go({ product_id: 'packet', quantity: 1 }, [l('sugar', 49), l('sugar', 2, 'waste')]).problems)
      .toEqual([{ kind: 'not_enough', product_id: 'sugar', have: 50, need: 51 }]);
  });
  it('stock not read yet is left to the database', () => {
    expect(go({ product_id: 'packet', quantity: 1 }, [l('unknown', 1)]).problems).toEqual([]);
  });
  it('the menu link follows the switch, off by default', () => {
    expect(ALL_ON.repack_enabled).toBe(false);
    expect(inventoryLinkVisible('/inventory/repack', inventorySettingsFrom(null))).toBe(false);
    expect(inventoryLinkVisible('/inventory/repack', inventorySettingsFrom({ repack_enabled: true }))).toBe(true);
    expect(STOCK_MOVEMENT_TYPES).toContain('repack_in');
  });
});
