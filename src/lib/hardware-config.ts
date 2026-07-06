/**
 * Hardware config — barcode scanner + receipt printer (Settings → Hardware).
 *
 * Stored in localStorage ON PURPOSE: scanners and printers are attached to a
 * specific till/PC, so the config is per-device, not per-company. Defaults are
 * chosen so a typical USB keyboard-wedge scanner + system print dialog work
 * with zero setup; everything is adjustable from the settings page.
 */
import type { ProductRow } from '@/data/adapter';

export type ScanField = 'barcode' | 'sku' | 'oe_number' | 'replacement_numbers';

export interface HardwareConfig {
  scanner: {
    /** Capture scans on the POS screen (keyboard-wedge burst detection). */
    enabled: boolean;
    /** Which product fields a scanned code is matched against, in priority order. */
    matchFields: ScanField[];
    /** Ignore captures shorter than this (avoids stray keystrokes). */
    minLength: number;
    /** Characters some scanners prepend/append — stripped before matching. */
    prefix: string;
    suffix: string;
  };
  printer: {
    /** Receipt paper — drives future thermal layouts; A4 uses the normal template. */
    paper: 'a4' | 'thermal80' | 'thermal58';
    /** Open the print dialog automatically after a POS sale. */
    autoPrintAfterSale: boolean;
    copies: number;
  };
}

export const DEFAULT_HARDWARE_CONFIG: HardwareConfig = {
  scanner: {
    enabled: true,
    matchFields: ['barcode', 'sku', 'oe_number', 'replacement_numbers'],
    minLength: 4,
    prefix: '',
    suffix: '',
  },
  printer: {
    paper: 'thermal80',
    autoPrintAfterSale: false,
    copies: 1,
  },
};

const KEY = 'stockbolt.hardware';

export function loadHardwareConfig(): HardwareConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_HARDWARE_CONFIG;
    const parsed = JSON.parse(raw) as Partial<HardwareConfig>;
    return {
      scanner: { ...DEFAULT_HARDWARE_CONFIG.scanner, ...(parsed.scanner ?? {}) },
      printer: { ...DEFAULT_HARDWARE_CONFIG.printer, ...(parsed.printer ?? {}) },
    };
  } catch {
    return DEFAULT_HARDWARE_CONFIG;
  }
}

export function saveHardwareConfig(cfg: HardwareConfig): void {
  localStorage.setItem(KEY, JSON.stringify(cfg));
}

/** Strip scanner prefix/suffix and whitespace from a captured code. */
export function normalizeScan(code: string, cfg: HardwareConfig): string {
  let c = code.trim();
  const { prefix, suffix } = cfg.scanner;
  if (prefix && c.startsWith(prefix)) c = c.slice(prefix.length);
  if (suffix && c.endsWith(suffix)) c = c.slice(0, c.length - suffix.length);
  return c.trim();
}

/**
 * The scan MAPPING: resolve a scanned code to a product by checking each
 * configured field in priority order (default barcode → SKU → OE number →
 * replacement numbers). Exact, case-insensitive matches only — a scan must
 * never add the wrong part.
 */
export function resolveScan(rawCode: string, products: ProductRow[], cfg: HardwareConfig): ProductRow | null {
  const code = normalizeScan(rawCode, cfg).toLowerCase();
  if (!code || code.length < cfg.scanner.minLength) return null;
  for (const field of cfg.scanner.matchFields) {
    for (const p of products) {
      if (field === 'replacement_numbers') {
        if ((p.replacement_numbers ?? []).some(r => r?.toLowerCase() === code)) return p;
      } else {
        const v = (p[field] ?? '') as string;
        if (v && v.toLowerCase() === code) return p;
      }
    }
  }
  return null;
}
