/**
 * Currency display preference (phase143) — the ONE place that decides how a
 * currency is labelled on screen and on printed documents.
 *
 *   'code'   → AED 1,234.00   (default; what every company saw before)
 *   'symbol' → د.إ 1,234.00
 *
 * PRESENTATION ONLY. The label is always derived from the amount's own
 * currency code (a document's or bank account's currency — never blindly the
 * company's base currency), and nothing here touches amounts, rounding,
 * exchange rates, tax or postings. Callers keep formatting the number exactly
 * as before and only swap their hand-written code for ccy(code).
 *
 * Not used where an ISO code is part of a data contract: e-invoice XML, WPS
 * salary files, Excel exports, exchange-rate lines and currency pickers.
 *
 * The preference is per company (companies.currency_display; NULL = 'code'),
 * loaded by <CurrencyDisplaySync/> and editable in Settings → Business
 * configuration → Accounting → Currency & display (settings.write only, RLS).
 */
import { create } from 'zustand';

export type CurrencyDisplay = 'code' | 'symbol';

interface CurrencyDisplayState { mode: CurrencyDisplay; setMode: (m: CurrencyDisplay) => void }

// The last mode seen on this device, so a reload doesn't flash ISO codes
// before the company row arrives. <CurrencyDisplaySync/> corrects it.
const LAST_KEY = 'stockbolt.currencyDisplay';
function lastMode(): CurrencyDisplay {
  try { return localStorage.getItem(LAST_KEY) === 'symbol' ? 'symbol' : 'code'; } catch { return 'code'; }
}

export const useCurrencyDisplayStore = create<CurrencyDisplayState>((set) => ({
  mode: lastMode(),
  setMode: (mode) => {
    try { localStorage.setItem(LAST_KEY, mode); } catch { /* private mode: in-memory only */ }
    set({ mode });
  },
}));

/** The company row's preference (NULL / unknown → 'code', the long-standing default). */
export function displayOf(company: unknown): CurrencyDisplay {
  return (company as { currency_display?: string | null } | null)?.currency_display === 'symbol' ? 'symbol' : 'code';
}

// Symbols Intl doesn't provide in English, chosen so no two currencies share one.
const SYMBOLS: Record<string, string> = {
  AED: 'د.إ', SAR: 'ر.س', QAR: 'ر.ق', KWD: 'د.ك', BHD: 'د.ب', OMR: 'ر.ع.',
  INR: '₹', EGP: 'E£', JOD: 'د.أ',
};

const symbolCache = new Map<string, string>();

/**
 * The currency's display symbol. Shared signs stay distinct (USD $, CAD CA$,
 * AUD A$). Falls back to the ISO code when a currency has no distinct symbol.
 */
export function currencySymbol(code: string | null | undefined): string {
  const c = (code ?? '').toUpperCase();
  if (!c) return '';
  if (SYMBOLS[c]) return SYMBOLS[c];
  const hit = symbolCache.get(c);
  if (hit) return hit;
  let s = c;
  try {
    s = new Intl.NumberFormat('en', { style: 'currency', currency: c, currencyDisplay: 'symbol' })
      .formatToParts(1).find((p) => p.type === 'currency')?.value ?? c;
  } catch { s = c; }
  symbolCache.set(c, s);
  return s;
}

// Arabic-script symbols (د.إ, ر.ق, …) are right-to-left text. Followed by a
// number, the browser's bidi rules pull the digits — and the minus sign — into
// that right-to-left run, so "د.إ -350.75" shows as "350.75- د.إ". A
// left-to-right mark after the symbol ends the run: the number keeps its sign
// in front and stays on the symbol's far side. Invisible, never copied into
// files (exports and e-invoices use ISO codes).
const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const LRM = '\u200E';

/** Label for a currency under a display mode. */
export function currencyLabel(code: string | null | undefined, mode: CurrencyDisplay): string {
  const c = (code ?? '').toUpperCase();
  if (mode !== 'symbol') return c;
  const s = currencySymbol(c);
  return RTL.test(s) ? s + LRM : s;
}

/**
 * Label for a currency under the company's saved preference. Pure function
 * (safe in print helpers and string builders); React screens that must
 * re-render when the preference changes call useCcy() instead.
 */
export function ccy(code: string | null | undefined): string {
  return currencyLabel(code, useCurrencyDisplayStore.getState().mode);
}

/** Hook form of ccy(): re-renders the component when the preference changes. */
export function useCcy(): (code: string | null | undefined) => string {
  const mode = useCurrencyDisplayStore((s) => s.mode);
  return (code) => currencyLabel(code, mode);
}

/** Label + number, e.g. "AED 1,234.00" / "د.إ 1,234.00". Number formatting unchanged (2 dp, en-US grouping). */
export function moneyLabel(amount: number | string | null | undefined, code: string | null | undefined): string {
  const n = Number(amount) || 0;
  const num = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const label = ccy(code);
  return label ? `${label} ${num}` : num;
}
