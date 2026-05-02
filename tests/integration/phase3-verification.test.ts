/**
 * Phase 3 Verification Test
 *
 * Tests the GL engine and MAC costing core logic:
 *   1–4.  validateLines — balance, structure, negative, Dr+Cr same line
 *   5–6.  assertMapping — sales_invoice constraints, manual no restrictions
 *   7–8.  MovingAverageCostingStrategy — first purchase, second purchase blended
 *   9.    postStockMovement — outbound uses existing MAC when unit_cost=0
 *   10.   postJournalEntry — validates then delegates to adapter
 *   11.   reverseJournalEntry — delegates to adapter
 *
 * All 11 assertions are pure unit tests (no DB required).
 *
 * Run with: npm run test:phase3
 */

import { describe, it, expect, vi } from 'vitest';
import { validateLines, assertMapping, JournalValidationError } from '../../src/core/gl/journal-validator';
import { MovingAverageCostingStrategy } from '../../src/core/costing/mac-engine';
import { postJournalEntry, reverseJournalEntry } from '../../src/core/gl/posting-engine';
import { postStockMovement } from '../../src/core/costing/mac-engine';
import type { DataAdapter, JEPayload, StockMovementPayload, StockBalance } from '../../src/data/adapter';

// ── 1. validateLines: balanced entry passes ───────────────────────────────────
describe('Phase 3 — GL Journal Validator', () => {
  it('validateLines: balanced 2-line entry passes', () => {
    expect(() =>
      validateLines([
        { account_code: '1100', debit: 500, credit: 0 },
        { account_code: '4100', debit: 0, credit: 500 },
      ]),
    ).not.toThrow();
  });

  // ── 2. validateLines: unbalanced throws ────────────────────────────────────
  it('validateLines: unbalanced entry throws JournalValidationError', () => {
    expect(() =>
      validateLines([
        { account_code: '1100', debit: 500, credit: 0 },
        { account_code: '4100', debit: 0, credit: 400 },
      ]),
    ).toThrow(JournalValidationError);
  });

  // ── 3. validateLines: negative amount throws ───────────────────────────────
  it('validateLines: negative debit throws JournalValidationError', () => {
    expect(() =>
      validateLines([
        { account_code: '1100', debit: -100, credit: 0 },
        { account_code: '4100', debit: 0, credit: -100 },
      ]),
    ).toThrow(JournalValidationError);
  });

  // ── 4. validateLines: Dr+Cr on same line throws ────────────────────────────
  it('validateLines: debit and credit on same line throws JournalValidationError', () => {
    expect(() =>
      validateLines([
        { account_code: '1100', debit: 100, credit: 100 },
        { account_code: '4100', debit: 0, credit: 0 },
      ]),
    ).toThrow(JournalValidationError);
  });
});

// ── 5–6. assertMapping ─────────────────────────────────────────────────────────
describe('Phase 3 — Journal Mapping Rules', () => {
  it('assertMapping: sales_invoice requires debit to 1200 (AR)', () => {
    expect(() =>
      assertMapping('sales_invoice', [
        { account_code: '1100', debit: 200, credit: 0 }, // wrong: not 1200
        { account_code: '4100', debit: 0, credit: 200 },
      ]),
    ).toThrow(JournalValidationError);
  });

  it('assertMapping: manual source_type has no restrictions', () => {
    expect(() =>
      assertMapping('manual', [
        { account_code: '9999', debit: 100, credit: 0 },
        { account_code: '8888', debit: 0, credit: 100 },
      ]),
    ).not.toThrow();
  });
});

// ── 7–8. MovingAverageCostingStrategy ─────────────────────────────────────────
describe('Phase 3 — MAC Engine', () => {
  const mac = new MovingAverageCostingStrategy();

  it('first purchase (zero stock) sets MAC equal to purchase cost', () => {
    const result = mac.computeNewMAC(0, 0, 10, 50);
    expect(result).toBe(50);
  });

  it('second purchase blends MAC correctly', () => {
    // 10 units @ 50 (MAC=50), then buy 5 units @ 80
    // new_MAC = (50*10 + 80*5) / 15 = (500+400)/15 = 60
    const result = mac.computeNewMAC(10, 50, 5, 80);
    expect(result).toBeCloseTo(60, 5);
  });
});

// ── 9. postStockMovement: outbound uses existing MAC when unit_cost=0 ─────────
describe('Phase 3 — postStockMovement', () => {
  it('outbound with unit_cost=0 uses existing MAC from adapter', async () => {
    const balance: StockBalance = { product_id: 'p1', warehouse_id: 'w1', quantity: 10, unit_cost: 75, total_value: 750 };
    const postMovementMock = vi.fn().mockResolvedValue({});
    const getBalanceMock   = vi.fn().mockResolvedValue(balance);
    const getMACMock       = vi.fn().mockResolvedValue(75);

    const adapter = {
      stockLedger: {
        postMovement: postMovementMock,
        getBalance:   getBalanceMock,
        getMAC:       getMACMock,
        getLedger:    vi.fn(),
      },
    } as unknown as DataAdapter;

    const payload: StockMovementPayload = {
      company_id: 'c1', product_id: 'p1', warehouse_id: 'w1',
      date: '2026-05-02', type: 'sale', direction: -1, quantity: 3, unit_cost: 0,
    };

    await postStockMovement(payload, adapter);

    expect(getMACMock).toHaveBeenCalledWith('c1', 'p1');
    const posted = postMovementMock.mock.calls[0][0];
    expect(posted.unit_cost).toBe(75);
  });
});

// ── 10–11. Posting engine delegates to adapter ────────────────────────────────
describe('Phase 3 — Posting Engine', () => {
  const mockResult = { journal_entry_id: 'je-1', entry_number: 'JE-0001' };

  function makeAdapter(overrides?: Partial<DataAdapter['accounting']>): DataAdapter {
    return {
      accounting: {
        postJE:           vi.fn().mockResolvedValue(mockResult),
        reverseJE:        vi.fn().mockResolvedValue({ journal_entry_id: 'je-2', entry_number: 'JE-0002' }),
        listJEs:          vi.fn(),
        getJEById:        vi.fn(),
        getGLLines:       vi.fn(),
        getTrialBalance:  vi.fn(),
        getLedgerEntries: vi.fn(),
        setPeriodLock:    vi.fn(),
        ...overrides,
      },
    } as unknown as DataAdapter;
  }

  it('postJournalEntry validates then calls adapter.accounting.postJE', async () => {
    const adapter = makeAdapter();
    const payload: JEPayload = {
      source_type: 'manual',
      lines: [
        { account_code: '1100', debit: 1000, credit: 0 },
        { account_code: '4100', debit: 0, credit: 1000 },
      ],
    };

    const result = await postJournalEntry(payload, adapter);
    expect(adapter.accounting.postJE).toHaveBeenCalledOnce();
    expect(result.entry_number).toBe('JE-0001');
  });

  it('reverseJournalEntry calls adapter.accounting.reverseJE', async () => {
    const adapter = makeAdapter();
    const result = await reverseJournalEntry('je-1', adapter, 'Correction');
    expect(adapter.accounting.reverseJE).toHaveBeenCalledWith('je-1', 'Correction');
    expect(result.journal_entry_id).toBe('je-2');
  });
});
