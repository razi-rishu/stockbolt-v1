/**
 * Shared currency master list — the single source of truth for currency
 * pickers across the app. This is the same set shown on Settings → Exchange
 * Rates, so document currency dropdowns stay "as per Exchange Rate".
 *
 * GCC + India + the major trade currencies StockBolt commonly deals with.
 */
export interface CurrencyDef {
  code: string;
  name: string;
}

export const ALL_CURRENCIES: CurrencyDef[] = [
  { code: 'AED', name: 'UAE Dirham' },
  { code: 'SAR', name: 'Saudi Riyal' },
  { code: 'QAR', name: 'Qatari Riyal' },
  { code: 'OMR', name: 'Omani Rial' },
  { code: 'BHD', name: 'Bahraini Dinar' },
  { code: 'KWD', name: 'Kuwaiti Dinar' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'CNY', name: 'Chinese Yuan' },
  { code: 'PKR', name: 'Pakistani Rupee' },
];

/** Human name for a currency code, falling back to the code itself. */
export function currencyName(code: string): string {
  return ALL_CURRENCIES.find(c => c.code === code)?.name ?? code;
}

/**
 * Options for a currency `<Select>`, formatted "AED — UAE Dirham".
 * `current` ensures whatever a document already stores stays selectable even
 * if it isn't in the master list (legacy / custom code), so the dropdown never
 * blanks out an existing value.
 */
export function currencyOptions(current?: string): { value: string; label: string }[] {
  const opts = ALL_CURRENCIES.map(c => ({ value: c.code, label: `${c.code} — ${c.name}` }));
  if (current && !ALL_CURRENCIES.some(c => c.code === current)) {
    opts.unshift({ value: current, label: current });
  }
  return opts;
}
