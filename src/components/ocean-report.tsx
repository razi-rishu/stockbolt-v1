/**
 * Ocean Teal report frame (Reports step 1, 2026-11).
 *
 * Presentation only. A report keeps its own queries, maths and export rows;
 * this file supplies the page header (title, subtitle, period + Print/Excel
 * controls), a report card with an optional figures strip, and the classes
 * for the report table (`sb-rpt-table`, see stockbolt-ocean-teal.css).
 *
 * Report tables stay real tables at every width (they carry totals, section
 * rows and drill-down rows that do not survive a card layout); on a phone the
 * table scrolls sideways inside its card.
 */
import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { OceanPage } from '@/components/ocean-list';
import '@/styles/stockbolt-ocean-teal.css';

export interface OceanReportProps {
  title: string;
  /** One line under the title: the period, "as of" date, etc. */
  subtitle?: ReactNode;
  /** Period picker, compare toggle, Print/Excel — hidden on paper. */
  controls?: ReactNode;
  testid?: string;
  children: ReactNode;
}

export function OceanReport({ title, subtitle, controls, testid, children }: OceanReportProps) {
  return (
    <OceanPage
      testid={testid}
      title={title}
      subtitle={subtitle}
      actions={controls ? <div data-print-hide className="sb-rpt-controls">{controls}</div> : undefined}
    >
      <div className="sb-rpt">{children}</div>
    </OceanPage>
  );
}

export type ReportTone = 'good' | 'bad' | 'warn' | 'brand';

export interface ReportFigure {
  label: string;
  value: ReactNode;
  /** Small line under the value (e.g. "balanced"). */
  note?: ReactNode;
  tone?: ReportTone;
}

export interface ReportCardProps {
  title?: ReactNode;
  /** Right-hand side of the card head (badges, small controls). */
  aside?: ReactNode;
  /** Muted line under the card title. */
  meta?: ReactNode;
  /** How-to-read hint shown under the head; hidden on paper. */
  hint?: ReactNode;
  figures?: ReportFigure[];
  children?: ReactNode;
}

export function ReportCard({ title, aside, meta, hint, figures, children }: ReportCardProps) {
  return (
    <section className="sb-card sb-rpt-card">
      {(title || aside || meta) && (
        <div className="sb-rpt-card-head">
          <div style={{ minWidth: 0 }}>
            {title && <h2 className="sb-rpt-card-title">{title}</h2>}
            {meta && <p className="sb-rpt-card-meta">{meta}</p>}
          </div>
          {aside && <div className="sb-rpt-card-aside">{aside}</div>}
        </div>
      )}
      {figures && figures.length > 0 && <ReportFigures figures={figures} />}
      {hint && (
        <p className="sb-rpt-hint" data-print-hide>
          <Info size={14} aria-hidden="true" /> <span>{hint}</span>
        </p>
      )}
      {children}
    </section>
  );
}

export function ReportFigures({ figures }: { figures: ReportFigure[] }) {
  return (
    <div className="sb-rpt-figs">
      {figures.map((f, i) => (
        <div key={i} className={f.tone ? `is-${f.tone}` : undefined}>
          <span className="sb-rpt-fig-label">{f.label}</span>
          <span className="sb-rpt-fig-value">{f.value}</span>
          {f.note && <span className="sb-rpt-fig-note">{f.note}</span>}
        </div>
      ))}
    </div>
  );
}

/** Horizontal-scroll wrapper for a `sb-rpt-table`. */
// data-phone-keep: the app shell turns plain tables into cards; report tables
// keep their columns, totals and section rows and scroll sideways instead.
export function ReportTableWrap({ children }: { children: ReactNode }) {
  return <div className="sb-rpt-scroll" data-phone-keep>{children}</div>;
}

/** Centred loading / empty message inside a report card. */
export function ReportMessage({ children, tone }: { children: ReactNode; tone?: 'muted' | 'bad' }) {
  return <p className={`sb-rpt-msg ${tone === 'bad' ? 'is-bad' : ''}`}>{children}</p>;
}

/** Wrap a date/number passed into a translated sentence so it stays
 *  left-to-right inside Arabic text (Unicode isolate marks). */
export function ltr(s: string | number): string {
  return `\u2066${s}\u2069`;
}

/** Numbers stay left-to-right inside Arabic text. */
export function Num({ children, className }: { children: ReactNode; className?: string }) {
  return <bdi dir="ltr" className={className}>{children}</bdi>;
}

/**
 * Flat report table driven by a column list. The same columns give the
 * screen table, the totals row and (via `exportFromColumns`) the Excel
 * sheet, so the three cannot drift apart.
 */
export interface ReportColumn<T> {
  key: string;
  header: string;
  /** Tooltip on the column heading. */
  title?: string;
  /** Right-aligned figure, kept left-to-right in Arabic. */
  num?: boolean;
  /** Extra cell classes: 'muted' | 'strong' | 'is-up' | 'is-down' | 'is-warn'. */
  cls?: string | ((row: T) => string | undefined);
  cell: (row: T) => ReactNode;
  /** Totals-row content for this column. */
  foot?: ReactNode;
  /** Excel value. Columns without it are left out of the sheet. */
  exp?: (row: T) => unknown;
  /** Hide on narrow screens. */
  hideSm?: boolean;
  /** Heading is a figure/range ("31–60"): keep it left-to-right in Arabic. */
  headerLtr?: boolean;
}

export function ReportTable<T>({ columns, rows, rowKey, footLabel, minWidth, onRowClick }: {
  columns: ReportColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  /** Label in the first cell of the totals row. */
  footLabel?: string;
  /** Below this width the table scrolls sideways instead of squeezing. */
  minWidth?: number;
  onRowClick?: (row: T) => void;
}) {
  const cellCls = (c: ReportColumn<T>, row?: T) => [
    c.num ? 'num' : '',
    c.hideSm ? 'hide-sm' : '',
    row ? (typeof c.cls === 'function' ? c.cls(row) ?? '' : c.cls ?? '') : '',
  ].filter(Boolean).join(' ') || undefined;
  const hasFoot = columns.some((c) => c.foot !== undefined);
  return (
    <ReportTableWrap>
      <table className="sb-rpt-table sb-rpt-flat" style={minWidth != null ? { minWidth } : undefined}>
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={cellCls(c)} title={c.title}>{c.headerLtr ? <Num>{c.header}</Num> : c.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className={onRowClick ? 'is-click' : undefined} onClick={onRowClick ? () => onRowClick(row) : undefined}>
              {columns.map((c) => (
                <td key={c.key} className={cellCls(c, row)}>{c.num ? <Num>{c.cell(row)}</Num> : c.cell(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {hasFoot && (
          <tfoot>
            <tr className="sb-rpt-total">
              {columns.map((c, i) => (
                <td key={c.key} className={cellCls(c)}>
                  {c.foot !== undefined ? (c.num ? <Num>{c.foot}</Num> : c.foot) : (i === 0 ? footLabel : null)}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </ReportTableWrap>
  );
}

/** Excel rows + headers from the same column list (screen-language headers). */
export function exportFromColumns<T>(columns: ReportColumn<T>[], rows: T[]): { rows: Record<string, unknown>[]; headers: string[] } {
  const cols = columns.filter((c) => c.exp);
  return {
    headers: cols.map((c) => c.header),
    rows: rows.map((r) => Object.fromEntries(cols.map((c) => [c.header, c.exp!(r)]))),
  };
}

/** Two-decimal amount, Western digits. */
export function money(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
