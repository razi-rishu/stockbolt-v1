import { describe, it, expect } from 'vitest';
import {
  foldSalesReturnsByReason,
  foldPurchaseReturnsByReason,
  type SalesReturnRaw,
  type PurchaseReturnRaw,
} from '@/lib/returns-analysis';

/**
 * R6a — the fold behind the Returns Analysis report.
 *
 * The report itself is behind auth and cannot be rendered here, but the only
 * thing in it that can be WRONG is this arithmetic, so that is what is tested.
 */
describe('returns analysis — sales side', () => {
  it('splits cost by condition exactly as phase 76 posts it', () => {
    const rows: SalesReturnRaw[] = [{
      reason: 'defective',
      restocking_fee: 0,
      credit_notes: { total_amount: 1000 },
      sales_return_items: [
        { qty_returned: 2, condition: 'resellable', unit_cost: 100 },  // 200 back on the shelf
        { qty_returned: 3, condition: 'damaged',    unit_cost: 50  },  // 150 to 6700
      ],
    }];
    const [line] = foldSalesReturnsByReason(rows);
    expect(line!.restocked_value).toBe(200);
    expect(line!.written_off).toBe(150);
    expect(line!.qty).toBe(5);
  });

  it('treats a null condition as restocked, never as written off', () => {
    // Nothing posts to 6700 unless the line says 'damaged'. A report that
    // guessed otherwise would show a write-off the ledger never made.
    const [line] = foldSalesReturnsByReason([{
      reason: 'other', restocking_fee: null, credit_notes: null,
      sales_return_items: [{ qty_returned: 1, condition: null, unit_cost: 10 }],
    }]);
    expect(line!.written_off).toBe(0);
    expect(line!.restocked_value).toBe(10);
  });

  it('counts header figures ONCE PER RETURN, not once per line', () => {
    // The bug this file exists to prevent: adding the credit-note total or the
    // restocking fee inside the item loop multiplies it by the line count.
    const [line] = foldSalesReturnsByReason([{
      reason: 'wrong_part',
      restocking_fee: 25,
      credit_notes: { total_amount: 900 },
      sales_return_items: [
        { qty_returned: 1, condition: 'resellable', unit_cost: 10 },
        { qty_returned: 1, condition: 'resellable', unit_cost: 10 },
        { qty_returned: 1, condition: 'resellable', unit_cost: 10 },
      ],
    }]);
    expect(line!.credit_value).toBe(900);
    expect(line!.fees).toBe(25);
    expect(line!.returns).toBe(1);
  });

  it('groups by reason and sorts by credit value, biggest first', () => {
    const mk = (reason: string | null, total: number): SalesReturnRaw => ({
      reason, restocking_fee: 0, credit_notes: { total_amount: total }, sales_return_items: [],
    });
    const out = foldSalesReturnsByReason([mk('defective', 100), mk('wrong_part', 500), mk('defective', 50)]);
    expect(out.map(r => r.reason)).toEqual(['wrong_part', 'defective']);
    expect(out[0]!.credit_value).toBe(500);
    expect(out[1]!.credit_value).toBe(150);
    expect(out[1]!.returns).toBe(2);
  });

  it('buckets a missing reason under the empty key rather than dropping it', () => {
    const out = foldSalesReturnsByReason([{
      reason: null, restocking_fee: null, credit_notes: { total_amount: 40 }, sales_return_items: null,
    }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.reason).toBe('');
    expect(out[0]!.credit_value).toBe(40);
  });

  it('returns nothing for no returns', () => {
    expect(foldSalesReturnsByReason([])).toEqual([]);
  });
});

describe('returns analysis — purchase side', () => {
  it('sums quantity and cost per line, value per document', () => {
    const rows: PurchaseReturnRaw[] = [{
      reason: 'damaged_in_transit',
      debit_notes: { total_amount: 750 },
      purchase_return_items: [
        { qty_returned: 4, unit_cost: 25 },
        { qty_returned: 6, unit_cost: 50 },
      ],
    }];
    const [line] = foldPurchaseReturnsByReason(rows);
    expect(line!.qty).toBe(10);
    expect(line!.cost).toBe(400);
    expect(line!.debit_value).toBe(750);
    expect(line!.returns).toBe(1);
  });

  it('has no write-off concept at all', () => {
    // purchase_return_items carries a condition, but nothing posts from it.
    // A written_off figure here would imply a journal entry never made.
    const [line] = foldPurchaseReturnsByReason([{
      reason: 'defective', debit_notes: null,
      purchase_return_items: [{ qty_returned: 1, unit_cost: 10 }],
    }]);
    expect(line).not.toHaveProperty('written_off');
  });

  it('survives a return with no debit note and no lines', () => {
    const out = foldPurchaseReturnsByReason([{
      reason: null, debit_notes: null, purchase_return_items: null,
    }]);
    expect(out[0]).toEqual({ reason: '', returns: 1, qty: 0, debit_value: 0, cost: 0 });
  });
});
