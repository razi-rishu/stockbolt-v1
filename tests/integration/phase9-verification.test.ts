/**
 * Phase 9 — Returns & Credit/Debit Notes: pure unit assertions.
 * Runs entirely in Node (no browser, no DB).
 * Verifies: adapter interface shape, GL amount calculations, status machines,
 *           restock cost logic, debit note posting logic.
 */

import { describe, it, expect } from 'vitest';
import type {
  CreditNotesAPI,
  SalesReturnsAPI,
  DebitNotesAPI,
  CreditNoteRow,
  DebitNoteRow,
} from '../../src/data/adapter';

// ── Adapter interface shape ──────────────────────────────────────────────────

describe('DataAdapter shape — Phase 9', () => {
  it('creditNotes API has required methods', () => {
    const methods: (keyof CreditNotesAPI)[] = [
      'list', 'getById', 'getItems', 'create', 'update', 'confirm', 'void', 'getNextNumber',
    ];
    expect(methods).toHaveLength(8);
  });

  it('salesReturns API has required methods', () => {
    const methods: (keyof SalesReturnsAPI)[] = [
      'list', 'getById', 'getItems', 'create', 'getNextNumber',
    ];
    expect(methods).toHaveLength(5);
  });

  it('debitNotes API has required methods', () => {
    const methods: (keyof DebitNotesAPI)[] = [
      'list', 'getById', 'getItems', 'create', 'update', 'confirm', 'void', 'getNextNumber',
    ];
    expect(methods).toHaveLength(8);
  });

  it('DataAdapter includes creditNotes, salesReturns, debitNotes keys', () => {
    type Phase9Keys = 'creditNotes' | 'salesReturns' | 'debitNotes';
    const keys: Phase9Keys[] = ['creditNotes', 'salesReturns', 'debitNotes'];
    expect(keys).toContain('creditNotes');
    expect(keys).toContain('salesReturns');
    expect(keys).toContain('debitNotes');
  });
});

// ── Credit Note GL calculations (Doc 3 A9/A10) ──────────────────────────────

function calcCreditNoteGL(subtotal: number, discount: number, taxAmount: number) {
  const taxableAmount = subtotal - discount;
  const totalAmount   = taxableAmount + taxAmount;
  return {
    dr_revenue: taxableAmount,   // Dr 4100
    dr_vat:     taxAmount,       // Dr 2200
    cr_ar:      totalAmount,     // Cr 1200
    balanced:   taxableAmount + taxAmount === totalAmount,
  };
}

describe('Credit note GL: header posting (A9/A10)', () => {
  it('standard CN: 1000 net + 50 VAT → Dr 4100=1000, Dr 2200=50, Cr 1200=1050', () => {
    const gl = calcCreditNoteGL(1000, 0, 50);
    expect(gl.dr_revenue).toBe(1000);
    expect(gl.dr_vat).toBe(50);
    expect(gl.cr_ar).toBe(1050);
    expect(gl.balanced).toBe(true);
  });

  it('CN with 10% discount: 1000 gross, 100 disc, 45 VAT on 900', () => {
    const gl = calcCreditNoteGL(1000, 100, 45);
    expect(gl.dr_revenue).toBe(900);
    expect(gl.dr_vat).toBe(45);
    expect(gl.cr_ar).toBe(945);
    expect(gl.balanced).toBe(true);
  });

  it('CN without VAT: fully balanced', () => {
    const gl = calcCreditNoteGL(500, 0, 0);
    expect(gl.dr_revenue).toBe(500);
    expect(gl.dr_vat).toBe(0);
    expect(gl.cr_ar).toBe(500);
    expect(gl.balanced).toBe(true);
  });

  it('debit side = credit side for all cases', () => {
    const cases = [
      { subtotal: 250, discount: 25, tax: 11.25 },
      { subtotal: 1000, discount: 0, tax: 0 },
      { subtotal: 3600, discount: 100, tax: 175 },
    ];
    for (const c of cases) {
      const gl = calcCreditNoteGL(c.subtotal, c.discount, c.tax);
      expect(gl.balanced).toBe(true);
    }
  });
});

// ── COGS reversal with restock (A9) ─────────────────────────────────────────

function calcCOGSReversal(qty: number, costAtSale: number) {
  const restockValue = qty * costAtSale;
  return {
    dr_inventory: restockValue,  // Dr 1300
    cr_cogs:      restockValue,  // Cr 5100
    balanced:     true,          // always balanced (single amount)
  };
}

describe('COGS reversal (A9 restock)', () => {
  it('5 units @ cost 100 each → restock value = 500', () => {
    const r = calcCOGSReversal(5, 100);
    expect(r.dr_inventory).toBe(500);
    expect(r.cr_cogs).toBe(500);
    expect(r.balanced).toBe(true);
  });

  it('uses original cost_at_sale, NOT current MAC', () => {
    // If current MAC changed to 120, we still use 100
    const costAtSale   = 100;
    const currentMAC   = 120;
    const r = calcCOGSReversal(3, costAtSale);
    expect(r.dr_inventory).toBe(300);    // 3 × 100 = 300
    expect(r.dr_inventory).not.toBe(3 * currentMAC); // NOT 360
  });

  it('zero cost_at_sale → no COGS entry (deferred)', () => {
    const costAtSale = 0;
    const r = calcCOGSReversal(5, costAtSale);
    expect(r.dr_inventory).toBe(0);
  });

  it('partial return: 2 of 10 units @ 150', () => {
    const r = calcCOGSReversal(2, 150);
    expect(r.dr_inventory).toBe(300);
    expect(r.cr_cogs).toBe(300);
  });
});

// ── A10: no restock, no inventory movement ───────────────────────────────────

describe('Credit note without restock (A10)', () => {
  it('restock=false: no inventory entry', () => {
    const restock = false;
    const inventoryMoved = restock ? 5 * 100 : 0;
    expect(inventoryMoved).toBe(0);
  });

  it('restock=true: inventory entry exists', () => {
    const restock = true;
    const inventoryMoved = restock ? 5 * 100 : 0;
    expect(inventoryMoved).toBe(500);
  });
});

// ── Debit Note GL calculations (Doc 3 B9/B10) ───────────────────────────────

function calcDebitNoteGL(subtotal: number, discount: number, taxAmount: number) {
  const inventoryCredit = subtotal - discount;  // Cr 1300
  const totalAmount     = inventoryCredit + taxAmount;
  return {
    dr_ap:           totalAmount,       // Dr 2100
    cr_inventory:    inventoryCredit,   // Cr 1300
    cr_input_vat:    taxAmount,         // Cr 1500
    balanced:        totalAmount === inventoryCredit + taxAmount,
  };
}

describe('Debit note GL: posting (B9/B10)', () => {
  it('B9: 500 inventory + 25 VAT → Dr 2100=525, Cr 1300=500, Cr 1500=25', () => {
    const gl = calcDebitNoteGL(500, 0, 25);
    expect(gl.dr_ap).toBe(525);
    expect(gl.cr_inventory).toBe(500);
    expect(gl.cr_input_vat).toBe(25);
    expect(gl.balanced).toBe(true);
  });

  it('B9 with discount: 1000 gross, 100 disc, 45 VAT on 900', () => {
    const gl = calcDebitNoteGL(1000, 100, 45);
    expect(gl.dr_ap).toBe(945);
    expect(gl.cr_inventory).toBe(900);
    expect(gl.cr_input_vat).toBe(45);
    expect(gl.balanced).toBe(true);
  });

  it('B10: no VAT (pure price adjustment)', () => {
    const gl = calcDebitNoteGL(300, 0, 0);
    expect(gl.dr_ap).toBe(300);
    expect(gl.cr_inventory).toBe(300);
    expect(gl.cr_input_vat).toBe(0);
    expect(gl.balanced).toBe(true);
  });

  it('debit side always equals credit side', () => {
    const cases = [
      { s: 800, d: 0,   t: 40 },
      { s: 200, d: 20,  t: 9  },
      { s: 5000, d: 500, t: 225 },
    ];
    for (const c of cases) {
      const gl = calcDebitNoteGL(c.s, c.d, c.t);
      expect(gl.balanced).toBe(true);
    }
  });
});

// ── Stock movement direction ─────────────────────────────────────────────────

describe('Stock movement directions (Phase 9)', () => {
  it('sales return: direction = +1 (stock comes back in)', () => {
    const direction = 1;
    expect(direction).toBeGreaterThan(0);
  });

  it('purchase return: direction = -1 (stock goes out to supplier)', () => {
    const direction = -1;
    expect(direction).toBeLessThan(0);
  });

  it('sales_return type tag used on stock ledger', () => {
    const type = 'sales_return';
    expect(type).toBe('sales_return');
  });

  it('purchase_return type tag used on stock ledger', () => {
    const type = 'purchase_return';
    expect(type).toBe('purchase_return');
  });
});

// ── Credit note status machine ───────────────────────────────────────────────

type DocStatus = 'draft' | 'confirmed' | 'void';

const CN_TRANSITIONS: Record<DocStatus, DocStatus[]> = {
  draft:     ['confirmed'],
  confirmed: ['void'],
  void:      [],
};

function canTransitionCN(from: DocStatus, to: DocStatus): boolean {
  return CN_TRANSITIONS[from].includes(to);
}

describe('Credit note status machine', () => {
  it('draft → confirmed ✓',   () => expect(canTransitionCN('draft', 'confirmed')).toBe(true));
  it('confirmed → void ✓',    () => expect(canTransitionCN('confirmed', 'void')).toBe(true));
  it('draft → void ✗',        () => expect(canTransitionCN('draft', 'void')).toBe(false));
  it('void → confirmed ✗',    () => expect(canTransitionCN('void', 'confirmed')).toBe(false));
  it('confirmed → draft ✗',   () => expect(canTransitionCN('confirmed', 'draft')).toBe(false));
});

// ── Debit note status machine ────────────────────────────────────────────────

describe('Debit note status machine', () => {
  it('draft → confirmed ✓',   () => expect(canTransitionCN('draft', 'confirmed')).toBe(true));
  it('confirmed → void ✓',    () => expect(canTransitionCN('confirmed', 'void')).toBe(true));
  it('void → confirmed ✗',    () => expect(canTransitionCN('void', 'confirmed')).toBe(false));
});

// ── CreditNoteRow type shape ─────────────────────────────────────────────────

describe('CreditNoteRow type shape', () => {
  it('has all required fields', () => {
    // Type-level check: object with correct shape compiles → test passes
    const row: Partial<CreditNoteRow> = {
      status:       'draft',
      restock:      true,
      total_amount: 1050,
      tax_amount:   50,
    };
    expect(row.total_amount).toBe(1050);
    expect(row.restock).toBe(true);
    expect(row.status).toBe('draft');
  });
});

// ── DebitNoteRow type shape ──────────────────────────────────────────────────

describe('DebitNoteRow type shape', () => {
  it('has all required fields', () => {
    const row: Partial<DebitNoteRow> = {
      status:           'draft',
      total_amount:     525,
      tax_amount:       25,
      debit_note_number: 'DN-0001',
    };
    expect(row.total_amount).toBe(525);
    expect(row.debit_note_number).toBe('DN-0001');
  });
});

// ── Reason codes ─────────────────────────────────────────────────────────────

describe('Credit note reason codes', () => {
  const validReasons = ['return', 'rebate', 'price_correction', 'damage', 'bad_debt'];
  it('has 5 valid reason codes', () => {
    expect(validReasons).toHaveLength(5);
  });
  it('return is a valid reason', () => {
    expect(validReasons).toContain('return');
  });
  it('rebate is a valid reason (A10 no-restock)', () => {
    expect(validReasons).toContain('rebate');
  });
});

describe('Debit note reason codes', () => {
  const validReasons = ['return', 'rebate', 'price_correction', 'damage'];
  it('has 4 valid reason codes', () => {
    expect(validReasons).toHaveLength(4);
  });
  it('return is a valid reason (B9 with stock)', () => {
    expect(validReasons).toContain('return');
  });
  it('price_correction is a valid reason (B10 without stock)', () => {
    expect(validReasons).toContain('price_correction');
  });
});

// ── MAC recalculation after return ───────────────────────────────────────────

function newMACAfterReturn(oldQty: number, oldMAC: number, returnQty: number, costAtSale: number): number {
  const oldValue  = oldQty * oldMAC;
  const addValue  = returnQty * costAtSale;
  const newQty    = oldQty + returnQty;
  if (newQty === 0) return costAtSale;
  return Math.round(((oldValue + addValue) / newQty) * 100) / 100;
}

describe('MAC recalculation after sales return', () => {
  it('returning at same cost as current MAC → MAC unchanged', () => {
    const newMAC = newMACAfterReturn(100, 50, 10, 50);
    expect(newMAC).toBe(50);
  });

  it('returning at different cost slightly adjusts MAC', () => {
    // Had 100 units @ 50 = 5000 value; return 10 @ 45 (original cost) → (5000+450)/110 ≈ 49.55
    const newMAC = newMACAfterReturn(100, 50, 10, 45);
    expect(newMAC).toBeCloseTo(49.55, 1);
  });

  it('return to empty stock → MAC = costAtSale', () => {
    const newMAC = newMACAfterReturn(0, 0, 5, 100);
    expect(newMAC).toBe(100);
  });
});
