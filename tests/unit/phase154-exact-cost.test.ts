/**
 * phase154 — goods leave stock at the exact company-wide cost (Document 3).
 * Locks the shape of the migration; the numbers were proven on staging.
 */
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20261124000002_phase154_exact_issue_cost.sql', 'utf8').replace(/\r\n/g, '\n');
const code = sql.replace(/--[^\n]*/g, '');
const body = (fn: string) => {
  const i = code.indexOf(`FUNCTION public.${fn}(`);
  expect(i, fn).toBeGreaterThan(-1);
  return code.slice(i, code.indexOf('$function$;', i));
};
const ISSUERS = ['confirm_invoice', 'edit_invoice', 'confirm_pos_sale', 'confirm_stock_transfer', 'confirm_inventory_adjustment'];

describe('phase154 exact issue cost', () => {
  it('refuses to run over a function it was not built from', () => {
    expect((sql.match(/^ {4}\('[a-z_]+', '[0-9a-f]{32}'\)/gm) ?? []).length).toBe(11);
    expect(code).toMatch(/phase154 stopped: % differs from the expected version/);
    expect(code.indexOf('$guard$')).toBeLessThan(code.indexOf('ALTER TABLE'));
  });
  it('changes no data and no column type', () => {
    expect(code).not.toMatch(/ALTER\s+COLUMN|DROP\s+(TABLE|COLUMN)|DELETE\s+FROM\s+public\.(stock_ledger|general_ledger)/i);
    expect(code).toMatch(/ADD COLUMN IF NOT EXISTS cost_total numeric\(15,2\);/);
  });
  it.each(ISSUERS)('%s takes its cost from the one rule, still as a pinned definer', (fn) => {
    const b = body(fn);
    expect(b).toMatch(/public\._stock_issue_cost\(v_company_id, /);
    expect(b).toMatch(/SECURITY DEFINER/);
    expect(b).toMatch(/SET search_path TO/);
  });
  it('the rule is company-wide and closed to clients', () => {
    expect(body('_stock_issue_cost')).not.toMatch(/warehouse/);
    expect(code).toMatch(/REVOKE ALL ON FUNCTION public\._stock_issue_cost\(uuid, uuid, numeric, numeric\) FROM PUBLIC, anon, authenticated;/);
  });
  it('trigger, recompute and E1 use the same company-wide average, ordered by seq', () => {
    for (const fn of ['tg_recompute_stock_valuation', 'recompute_stock_valuation']) {
      expect(body(fn)).toMatch(/ROUND\(cum\.pc \/ cum\.pq, 2\)/);
      expect(body(fn)).toMatch(/PARTITION BY (sl\.)?company_id, (sl\.)?product_id\s+ORDER BY (sl\.)?seq/);
    }
    expect(body('verify_invariants')).toMatch(/SELECT DISTINCT ON \(product_id\) product_id, running_avg_cost[\s\S]*?ORDER BY product_id, seq DESC/);
  });
});
