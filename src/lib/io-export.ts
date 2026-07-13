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

/** Read a File picked from <input type="file"> as text (for CSV) or
 *  ArrayBuffer (for XLSX), chosen by extension. */
export async function readPickedFile(file: File): Promise<{ format: 'csv' | 'xlsx'; result: ParseResult }> {
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext === 'csv' || ext === 'txt') {
    const text = await file.text();
    return { format: 'csv', result: parseCSV(text) };
  }
  if (ext === 'xlsx' || ext === 'xls') {
    const buf = await file.arrayBuffer();
    return { format: 'xlsx', result: await parseXLSX(buf) };
  }
  return {
    format: 'csv',
    result: { rows: [], headers: [], errors: [`Unsupported file type: .${ext}. Use .csv or .xlsx.`] },
  };
}
