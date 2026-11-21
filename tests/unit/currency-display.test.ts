// phase143 — currency display labels. Presentation only: the label changes,
// the number never does.
import { describe, it, expect, beforeEach } from 'vitest';
import { DIRHAM_SIGN, ccy, currencyLabel, currencySymbol, displayOf, moneyLabel, useCurrencyDisplayStore } from '../../src/lib/currency-display';

describe('currency display preference', () => {
  beforeEach(() => useCurrencyDisplayStore.getState().setMode('code'));

  it('defaults to the ISO code (existing behaviour)', () => {
    expect(ccy('aed')).toBe('AED');
    expect(moneyLabel(1234.5, 'INR')).toBe('INR 1,234.50');
    expect(moneyLabel(-350.75, 'QAR')).toBe('QAR -350.75');
  });

  it('symbol mode, English screen: dirham sign and Latin Gulf forms', () => {
    useCurrencyDisplayStore.getState().setMode('symbol');
    expect(currencySymbol('AED', 'en')).toBe(DIRHAM_SIGN);
    expect(['SAR', 'QAR', 'KWD', 'BHD', 'OMR', 'JOD'].map((c) => currencySymbol(c, 'en'))).toEqual(['SR', 'QR', 'KD', 'BD', 'RO', 'JD']);
    // No Arabic script on an English screen, so no direction mark either.
    expect(currencyLabel('AED', 'symbol', 'en')).toBe(DIRHAM_SIGN);
    expect(currencyLabel('QAR', 'symbol', 'en')).toBe('QR');
    expect(currencyLabel('INR', 'symbol', 'en')).toBe('₹');
    // Default language (tests run without an Arabic UI) is English.
    expect(moneyLabel(-350.75, 'SAR')).toBe('SR -350.75');
    expect(moneyLabel(1234.5, 'INR')).toBe('₹ 1,234.50');
  });

  it('symbol mode, Arabic screen: Arabic signs with a direction mark', () => {
    // Arabic-script symbols carry a trailing LRM so the minus sign stays in front.
    const LRM = '‎';
    expect(currencyLabel('AED', 'symbol', 'ar')).toBe('د.إ' + LRM);
    expect(currencyLabel('QAR', 'symbol', 'ar')).toBe('ر.ق' + LRM);
    expect(currencyLabel('SAR', 'symbol', 'ar')).toBe('ر.س' + LRM);
    expect(currencyLabel('INR', 'symbol', 'ar')).toBe('₹');
    expect(currencyLabel('USD', 'symbol', 'ar')).toBe('$');
  });

  it('currencies sharing a sign stay distinct', () => {
    expect(currencySymbol('USD')).toBe('$');
    expect(currencySymbol('CAD')).toBe('CA$');
    expect(currencySymbol('AUD')).toBe('A$');
    const codes = ['USD', 'CAD', 'AUD', 'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR', 'JOD', 'INR', 'EUR', 'GBP', 'EGP'];
    for (const lang of ['en', 'ar'] as const) {
      const syms = codes.map((c) => currencySymbol(c, lang));
      expect(new Set(syms).size, lang).toBe(syms.length);
    }
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
