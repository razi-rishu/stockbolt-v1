/**
 * Format-agnostic file IO primitives (CSV / XLSX parse + download).
 *
 * Moved here from src/modules/settings/import-export/_io so that shared UI
 * (src/ui/report-actions.tsx and elsewhere) can reuse the download helpers
 * without a leaf `src/ui` component reaching into a feature module's private
 * folder. The old path (`import-export/_io`) still re-exports everything from
 * here, so existing import/export consumers are unaffected.
 *
 * One uniform shape (Array<Record<string, string>>) flows through the
 * import/export wizard regardless of whether the operator uploaded a CSV or
 * an XLSX. Each module adapter consumes that shape and decides how to
 * validate + transform each row into a DB write.
 *
 * CSV: PapaParse (small, sync, universally compatible).
 * XLSX: SheetJS — dynamic-imported on demand so the ~1 MB library doesn't
 *       bloat the default bundle for operators who only use CSV.
 */

import Papa from 'papaparse';

/** A single row from a parsed file. Keys = column headers as found in
 *  the file; values = string (even numbers are kept as strings so the
 *  adapter decides how to parse — preserves leading zeros, decimal
 *  separators, etc.). */
export type RawRow = Record<string, string>;

export interface ParseResult {
  rows: RawRow[];
  headers: string[];
  /** Format-level errors (e.g. CSV parse fault). Per-row validation
   *  errors are produced by the module adapter later. */
  errors: string[];
}

// ── CSV ────────────────────────────────────────────────────────────────────
export function parseCSV(text: string): ParseResult {
  const result = Papa.parse<RawRow>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
    transform: (v) => typeof v === 'string' ? v.trim() : v,
  });
  return {
    rows: result.data ?? [],
    headers: (result.meta?.fields ?? []).map(String),
    errors: (result.errors ?? []).map(e => `Row ${e.row ?? '?'}: ${e.message}`),
  };
}

export function stringifyCSV(rows: Record<string, unknown>[], headers: string[]): string {
  // Papa.unparse infers headers from the keys of the first row by default,
  // but we want a fixed column order even when the first row is missing a
  // value — so we pass headers explicitly.
  return Papa.unparse({
    fields: headers,
    data: rows.map(r => headers.map(h => r[h] ?? '')),
  });
}

// ── XLSX (lazy-loaded) ─────────────────────────────────────────────────────
// Dynamic import means the SheetJS bundle is only paid for when the
// operator actually picks an xlsx file (~1 MB chunk fetched on demand).
async function getXlsx() {
  return import('xlsx');
}

export async function parseXLSX(buffer: ArrayBuffer): Promise<ParseResult> {
  const XLSX = await getXlsx();
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return { rows: [], headers: [], errors: ['Workbook has no sheets'] };
  }
  const sheet = wb.Sheets[sheetName];
  // Use sheet_to_json with header:1 so we get raw 2D array and can derive
  // headers explicitly — gives us the same shape as the CSV path.
  const matrix: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,        // get strings, not Date objects or numbers
    blankrows: false,
    defval: '',
  });
  if (matrix.length === 0) {
    return { rows: [], headers: [], errors: ['Sheet is empty'] };
  }
  const headers = (matrix[0] ?? []).map(h => String(h ?? '').trim());
  const rows: RawRow[] = matrix.slice(1).map(line => {
    const row: RawRow = {};
    for (let i = 0; i < headers.length; i++) {
      const v = line[i];
      row[headers[i]] = v == null ? '' : String(v).trim();
    }
    return row;
  });
  return { rows, headers, errors: [] };
}

export async function stringifyXLSX(
  rows: Record<string, unknown>[],
  headers: string[],
): Promise<ArrayBuffer> {
  const XLSX = await getXlsx();
  // Build worksheet from explicit header order so columns line up even
  // when individual rows omit a field.
  const aoa: unknown[][] = [
    headers,
    ...rows.map(r => headers.map(h => r[h] ?? '')),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Data');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

// ── Browser download helper ────────────────────────────────────────────────
export function downloadBlob(data: BlobPart, filename: string, mime: string) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the download has time to start in all browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Trigger a CSV download with a standard filename + content type. */
export function downloadCSV(rows: Record<string, unknown>[], headers: string[], filename: string) {
  downloadBlob(stringifyCSV(rows, headers), filename, 'text/csv;charset=utf-8');
}

/** Trigger an XLSX download. Lazy-loads the SheetJS module. */
export async function downloadXLSX(
  rows: Record<string, unknown>[], headers: string[], filename: string,
) {
  const buf = await stringifyXLSX(rows, headers);
  downloadBlob(buf, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

// ── Import upload guards (Audit H8-P1) ───────────────────────────────────────
/** Hard cap on import upload size. A crafted or oversized spreadsheet can hang
 *  the main-thread SheetJS parser (the xlsx HIGH ReDoS / memory-DoS advisory),
 *  so files are rejected BEFORE they are read into memory or XLSX.read() runs.
 *  10 MB comfortably covers real ERP imports (products, contacts, openings). */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/** Extensions the importer accepts (CSV/TXT text path, XLSX/XLS binary path). */
const SUPPORTED_EXT = new Set(['csv', 'txt', 'xlsx', 'xls']);

/** Concrete MIME types a browser may report per extension. `file.type` is
 *  unreliable (often '' or a generic type), so unknown/generic types fall back
 *  to the extension and are NOT rejected — only a concrete type that clearly
 *  contradicts the extension is rejected. Stricter than an extension-only check
 *  without false-rejecting legitimate uploads. */
const ALLOWED_MIME: Record<string, Set<string>> = {
  csv:  new Set(['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel']),
  txt:  new Set(['text/plain', 'text/csv']),
  xlsx: new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/zip',
    'application/x-zip-compressed',
  ]),
  xls:  new Set(['application/vnd.ms-excel']),
};

/** Types browsers emit when they cannot classify a file — always tolerated
 *  (we fall back to the extension); never used to reject. */
const GENERIC_MIME = new Set(['', 'application/octet-stream']);

function rejected(message: string): { format: 'csv'; result: ParseResult } {
  return { format: 'csv', result: { rows: [], headers: [], errors: [message] } };
}

/** Read a File picked from <input type="file"> as text (for CSV) or
 *  ArrayBuffer (for XLSX), chosen by extension. Audit H8-P1: validate the
 *  extension, size, and MIME type and reject invalid files BEFORE any read or
 *  parse (i.e. before parseXLSX -> XLSX.read). */
export async function readPickedFile(file: File): Promise<{ format: 'csv' | 'xlsx'; result: ParseResult }> {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';

  // Guard 1 — supported extension (as before, now an explicit up-front reject).
  if (!SUPPORTED_EXT.has(ext)) {
    return rejected(`Unsupported file type: .${ext}. Use .csv or .xlsx.`);
  }

  // Guard 2 — reject empty and oversized files BEFORE reading them into memory.
  if (file.size === 0) {
    return rejected('File is empty.');
  }
  if (file.size > MAX_IMPORT_BYTES) {
    const maxMb = (MAX_IMPORT_BYTES / (1024 * 1024)).toFixed(0);
    const gotMb = (file.size / (1024 * 1024)).toFixed(1);
    return rejected(`File is too large (${gotMb} MB). Maximum import size is ${maxMb} MB.`);
  }

  // Guard 3 — MIME check IN ADDITION to the extension: reject only a concrete
  // reported type that contradicts the extension; tolerate '' / generic types.
  const type = (file.type || '').toLowerCase();
  if (type && !GENERIC_MIME.has(type) && !ALLOWED_MIME[ext]?.has(type)) {
    return rejected(`File content type "${file.type}" does not match a .${ext} file.`);
  }

  // Guards passed — now, and only now, read + parse.
  if (ext === 'csv' || ext === 'txt') {
    const text = await file.text();
    return { format: 'csv', result: parseCSV(text) };
  }
  // ext is 'xlsx' | 'xls'
  const buf = await file.arrayBuffer();
  return { format: 'xlsx', result: await parseXLSX(buf) };
}
