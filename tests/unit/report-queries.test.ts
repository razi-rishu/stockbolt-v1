/**
 * Three reports silently showed "No transactions" because they asked for
 * columns that do not exist (found 2026-11-24). scripts/check-query-columns.mjs
 * checks every query against staging; this locks the three without a database.
 */
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync('src/data/supabaseAdapter.ts', 'utf8').replace(/\r\n/g, '\n');
const fn = (name: string) => { const i = src.indexOf(`async ${name}(`); return src.slice(i, src.indexOf('\n      async ', i + 10)); };

describe('report queries', () => {
  it('never ask a product for "code" (the column is sku)', () => {
    expect(src).not.toMatch(/products(!inner)?\(\s*code\b/);
  });
  it('Purchases by Product counts every stock purchase, paged', () => {
    expect(fn('getPurchasesByProduct')).toMatch(/fetchAllPages[\s\S]*'stock_active'[\s\S]*\.eq\('type', 'purchase'\)/);
  });
  it('Outstanding POs uses real statuses and receipt lines', () => {
    const f = fn('getOutstandingPOs');
    expect(f).toMatch(/'draft', 'sent', 'partially_received'/);
    expect(f).toMatch(/goods_receipts\(status, goods_receipt_items\(total_cost\)\)/);
  });
});
