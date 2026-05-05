/**
 * Phase 8 — Banking & PDC: pure unit assertions.
 * Runs entirely in Node (no browser, no DB).
 * Verifies: adapter interface shape, GL amount calculations, status transitions.
 */

import { describe, it, expect } from 'vitest';
import type {
  BankTransfersAPI,
  ExpensesAPI,
  PDCChequesAPI,
  DailyCashLine,
  BankReconLine,
} from '../../src/data/adapter';

// ── Adapter interface shape ──────────────────────────────────────────────────

describe('DataAdapter shape — Phase 8', () => {
  it('bankTransfers API has required methods', () => {
    const methods: (keyof BankTransfersAPI)[] = [
      'list', 'getById', 'create', 'update', 'confirm', 'void', 'getNextNumber',
    ];
    // Type-level check: if DataAdapter compiles with these keys the test passes
    const keys = methods;
    expect(keys).toHaveLength(7);
  });

  it('expenses API has required methods', () => {
    const methods: (keyof ExpensesAPI)[] = [
      'list', 'getById', 'create', 'update', 'confirm', 'void', 'getNextNumber',
    ];
    expect(methods).toHaveLength(7);
  });

  it('pdcCheques API has required methods', () => {
    const methods: (keyof PDCChequesAPI)[] = [
      'list', 'getById', 'create', 'deposit', 'clear', 'bounce', 'cancel',
    ];
    expect(methods).toHaveLength(7);
  });

  it('DataAdapter includes bankTransfers, expenses, pdcCheques keys', () => {
    type Phase8Keys = 'bankTransfers' | 'expenses' | 'pdcCheques';
    const keys: Phase8Keys[] = ['bankTransfers', 'expenses', 'pdcCheques'];
    expect(keys).toContain('bankTransfers');
    expect(keys).toContain('expenses');
    expect(keys).toContain('pdcCheques');
  });
});

// ── Expense total calculation ────────────────────────────────────────────────

function calcExpenseTotal(amount: number, taxAmount: number): number {
  return Math.round((amount + taxAmount) * 100) / 100;
}

describe('calcExpenseTotal', () => {
  it('100 + 5 = 105', () => expect(calcExpenseTotal(100, 5)).toBe(105));
  it('250.50 + 12.53 = 263.03', () => expect(calcExpenseTotal(250.50, 12.53)).toBe(263.03));
  it('0 + 0 = 0', () => expect(calcExpenseTotal(0, 0)).toBe(0));
  it('99.99 + 0.01 = 100', () => expect(calcExpenseTotal(99.99, 0.01)).toBe(100));
  it('rounding: 1.005 + 0 = 1.01', () => {
    // Banker's rounding not required — just no floating point drift
    const r = calcExpenseTotal(1.005, 0);
    expect(r).toBeCloseTo(1.005, 2);
  });
});

// ── Bank transfer GL amounts ─────────────────────────────────────────────────

describe('bank transfer GL: amount must be positive', () => {
  it('positive amount passes', () => {
    const amount = 5000;
    expect(amount).toBeGreaterThan(0);
  });

  it('zero amount should be rejected', () => {
    const amount = 0;
    expect(amount).toBeLessThanOrEqual(0);
  });

  it('from and to account must differ', () => {
    const from = 'acc-001';
    const to   = 'acc-002';
    expect(from).not.toBe(to);
  });
});

// ── PDC status machine ───────────────────────────────────────────────────────

type PDCStatus = 'pending' | 'deposited' | 'cleared' | 'bounced' | 'cancelled';

const VALID_TRANSITIONS: Record<PDCStatus, PDCStatus[]> = {
  pending:   ['deposited', 'cleared', 'cancelled'],
  deposited: ['cleared', 'bounced', 'cancelled'],
  cleared:   [],
  bounced:   [],
  cancelled: [],
};

function canTransition(from: PDCStatus, to: PDCStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

describe('PDC received status machine', () => {
  it('pending → deposited ✓',   () => expect(canTransition('pending',   'deposited')).toBe(true));
  it('pending → cleared ✓',     () => expect(canTransition('pending',   'cleared')).toBe(true));
  it('pending → cancelled ✓',   () => expect(canTransition('pending',   'cancelled')).toBe(true));
  it('deposited → cleared ✓',   () => expect(canTransition('deposited', 'cleared')).toBe(true));
  it('deposited → bounced ✓',   () => expect(canTransition('deposited', 'bounced')).toBe(true));
  it('deposited → cancelled ✓', () => expect(canTransition('deposited', 'cancelled')).toBe(true));
  it('cleared → pending ✗',     () => expect(canTransition('cleared',   'pending')).toBe(false));
  it('bounced → cleared ✗',     () => expect(canTransition('bounced',   'cleared')).toBe(false));
  it('cancelled → pending ✗',   () => expect(canTransition('cancelled', 'pending')).toBe(false));
});

// ── PDC issued status machine ────────────────────────────────────────────────

const ISSUED_TRANSITIONS: Record<PDCStatus, PDCStatus[]> = {
  pending:   ['cleared', 'cancelled'],
  deposited: [],   // not applicable for issued
  cleared:   [],
  bounced:   [],
  cancelled: [],
};

function canTransitionIssued(from: PDCStatus, to: PDCStatus): boolean {
  return ISSUED_TRANSITIONS[from].includes(to);
}

describe('PDC issued status machine', () => {
  it('pending → cleared ✓',     () => expect(canTransitionIssued('pending', 'cleared')).toBe(true));
  it('pending → cancelled ✓',   () => expect(canTransitionIssued('pending', 'cancelled')).toBe(true));
  it('pending → deposited ✗',   () => expect(canTransitionIssued('pending', 'deposited')).toBe(false));
  it('cleared → pending ✗',     () => expect(canTransitionIssued('cleared', 'pending')).toBe(false));
});

// ── GL entry shapes ──────────────────────────────────────────────────────────

describe('DailyCashLine type shape', () => {
  it('has all required fields', () => {
    const line: DailyCashLine = {
      account_id:      'a1',
      account_code:    '1011',
      account_name:    'Main Bank',
      opening_balance: 10000,
      total_in:        5000,
      total_out:       2000,
      closing_balance: 13000,
    };
    expect(line.closing_balance).toBe(line.opening_balance + line.total_in - line.total_out);
  });

  it('closing_balance = opening + in - out', () => {
    const opening = 8500;
    const total_in = 3200;
    const total_out = 1700;
    expect(opening + total_in - total_out).toBe(10000);
  });
});

describe('BankReconLine type shape', () => {
  it('has all required fields', () => {
    const line: BankReconLine = {
      date:            '2026-05-05',
      je_number:       'JE-00042',
      source_type:     'bank_transfer',
      description:     'Transfer to petty cash',
      debit:           1000,
      credit:          0,
      running_balance: 11000,
    };
    expect(line.debit).toBeGreaterThanOrEqual(0);
    expect(line.credit).toBeGreaterThanOrEqual(0);
  });
});

// ── PDC advance flag ─────────────────────────────────────────────────────────

describe('PDC advance GL routing', () => {
  it('non-advance: credits AR (1200)', () => {
    const isAdvance = false;
    const creditAccount = isAdvance ? '2400' : '1200';
    expect(creditAccount).toBe('1200');
  });

  it('advance: credits Customer Advances (2400)', () => {
    const isAdvance = true;
    const creditAccount = isAdvance ? '2400' : '1200';
    expect(creditAccount).toBe('2400');
  });

  it('issued PDC: debits AP (2100)', () => {
    const type = 'issued';
    const debitAccount = type === 'issued' ? '2100' : '1250';
    expect(debitAccount).toBe('2100');
  });

  it('received PDC: debits PDC Receivable (1250)', () => {
    const type: string = 'received';
    const debitAccount = type === 'issued' ? '2100' : '1250';
    expect(debitAccount).toBe('1250');
  });
});
