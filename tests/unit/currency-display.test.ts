// phase143 — currency display labels. Presentation only: the label changes,
// the number never does.
import { describe, it, expect, beforeEach } from 'vitest';
import { ccy, currencyLabel, currencySymbol, displayOf, moneyLabel, useCurrencyDisplayStore } from '../../src/lib/currency-display';

describe('currency display preference', () => {
  beforeEach(() => useCurrencyDisplayStore.getState().setMode('code'));

  it('defaults to the ISO code (existing behaviour)', () => {
    expect(ccy('aed')).toBe('AED');
    expect(moneyLabel(1234.5, 'INR')).toBe('INR 1,234.50');
    expect(moneyLabel(-350.75, 'QAR')).toBe('QAR -350.75');
  });

  it('symbol mode: Gulf and rupee symbols', () => {
    useCurrencyDisplayStore.getState().setMode('symbol');
    // Arabic-script symbols carry a trailing LRM so the minus sign stays in front.
    const LRM = '\u200E';
    expect(ccy('AED')).toBe('د.إ' + LRM);
    expect(ccy('QAR')).toBe('ر.ق' + LRM);
    expect(ccy('SAR')).toBe('ر.س' + LRM);
    expect(ccy('INR')).toBe('₹');
    expect(ccy('USD')).toBe('$');
    expect(moneyLabel(1234.5, 'INR')).toBe('₹ 1,234.50');
    expect(moneyLabel(-350.75, 'AED')).toBe('د.إ' + LRM + ' -350.75');
  });

  it('currencies sharing a sign stay distinct', () => {
    expect(currencySymbol('USD')).toBe('$');
    expect(currencySymbol('CAD')).toBe('CA$');
    expect(currencySymbol('AUD')).toBe('A$');
    const syms = ['USD', 'CAD', 'AUD', 'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR', 'INR', 'EUR', 'GBP'].map(currencySymbol);
    expect(new Set(syms).size).toBe(syms.length);
  });

  it('a currency without a distinct symbol keeps its code; empty stays empty', () => {
    expect(currencyLabel('PKR', 'symbol')).toBe('PKR');
    expect(currencyLabel('', 'symbol')).toBe('');
    expect(currencyLabel(null, 'code')).toBe('');
  });

  it('company preference: NULL / unknown → code', () => {
    expect(displayOf({ currency_display: null })).toBe('code');
    expect(displayOf({})).toBe('code');
    expect(displayOf({ currency_display: 'symbol' })).toBe('symbol');
    expect(displayOf(null)).toBe('code');
  });
});
