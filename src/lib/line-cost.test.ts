import { describe, expect, it } from 'vitest';
import { lineBaseQty, lineCogs } from './line-cost';

describe('lineCogs (phase154)', () => {
  it('uses the exact cost when the sale recorded one', () => {
    expect(lineCogs({ quantity: 100, cost_at_sale: 0.03, cost_total: 3.2 })).toBe(3.2);
    expect(lineCogs({ quantity: 5, cost_at_sale: 2, cost_total: 0 })).toBe(0);
    expect(lineCogs({ quantity: '2', cost_at_sale: '9', cost_total: '17.99' })).toBe(17.99);
  });
  it('keeps the old calculation for older lines and for databases without the column', () => {
    expect(lineCogs({ quantity: 4, cost_at_sale: 10, cost_total: null })).toBe(40);
    expect(lineCogs({ quantity: 4, cost_at_sale: 10 })).toBe(40);
    expect(lineCogs({ quantity: 4, cost_at_sale: null })).toBe(0);
  });
  it('a pack line without an exact cost counts its pieces (phase155)', () => {
    expect(lineCogs({ quantity: 2, base_quantity: 24, cost_at_sale: 8 })).toBe(192);
    expect(lineBaseQty({ quantity: 2, base_quantity: 24 })).toBe(24);
    expect(lineBaseQty({ quantity: 2, base_quantity: null })).toBe(2);
    expect(lineBaseQty({ quantity: '0.5' })).toBe(0.5);
  });
});
