/**
 * ReportActions — shared Print + Export-to-Excel buttons for report pages
 * (Phase 46b). Drop into any report once it has derived a flat rows/headers
 * array from whatever it already renders into a table.
 *
 * Print uses in-page window.print(): the report's filter bar is wrapped in
 * data-print-hide and AppLayout's sidebar/topbar carry data-print-hide too
 * (both fixed in the same phase), so the printout is just the report body on
 * a clean page. No dedicated print route needed.
 *
 * Export reuses the generic downloadXLSX from src/lib/io-export (lazy-loads
 * SheetJS only when clicked — no bundle cost for users who never export).
 */
import { useState } from 'react';
import { downloadXLSX } from '@/lib/io-export';

interface ReportActionsProps {
  /** Flat rows keyed by the header labels below. */
  rows: Record<string, unknown>[];
  /** Column order for the sheet (also the object keys read from each row). */
  headers: string[];
  /** Download filename WITHOUT extension, e.g. "trial-balance-2026-07". */
  filename: string;
  /** Disable both actions until the report has data. */
  disabled?: boolean;
}

const btn =
  'inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-white px-3 py-1.5 text-xs font-semibold text-ink-secondary transition-colors hover:border-border-strong hover:text-ink-primary disabled:pointer-events-none disabled:opacity-50';

export function ReportActions({ rows, headers, filename, disabled }: ReportActionsProps) {
  const [exporting, setExporting] = useState(false);
  const noData = disabled || rows.length === 0;

  async function onExport() {
    if (noData) return;
    setExporting(true);
    try {
      await downloadXLSX(rows, headers, `${filename}.xlsx`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div data-print-hide className="inline-flex items-center gap-2">
      <button type="button" onClick={() => window.print()} disabled={disabled} className={btn} title="Print this report">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" rx="1" />
        </svg>
        Print
      </button>
      <button type="button" onClick={onExport} disabled={noData || exporting} className={btn} title="Export to Excel (.xlsx)">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
        </svg>
        {exporting ? 'Exporting…' : 'Excel'}
      </button>
    </div>
  );
}
