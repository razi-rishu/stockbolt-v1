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
