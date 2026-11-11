/**
 * Ocean Teal (UI Design System v1.1) building blocks for list-style settings
 * and catalog pages: a page header and a drop-in replacement for <Table>.
 *
 * Presentation only. Pages keep their own queries, forms, mutations and
 * column definitions; OceanTable takes the same props as the shared <Table>
 * (same Column type), so a page swaps the component without touching data.
 *
 * OceanTable shows a table when its container is wide enough and one card per
 * row when it is narrow (phones, or desktop next to the app sidebar and the
 * settings rail). It uses a container query, so the switch follows the space
 * the list actually has rather than the window width.
 */
import type { ReactNode } from 'react';
import type { Column } from '@/ui/table';
import '@/styles/stockbolt-ocean-teal.css';

export interface OceanPageProps {
  title: string;
  /** Count or one-line description under the title. */
  subtitle?: ReactNode;
  /** Buttons on the end side of the header. */
  actions?: ReactNode;
  /** Extra header content under the title row (search, chips). */
  below?: ReactNode;
  children: ReactNode;
  testid?: string;
  /** Centre the page at a reading width (forms). */
  narrow?: boolean;
}

export function OceanPage({ title, subtitle, actions, below, children, testid, narrow }: OceanPageProps) {
  return (
    <div className={`sb-ocean sb-page sb-olist ${narrow ? 'sb-olist-narrow' : ''}`} data-testid={testid} style={{ paddingBottom: 48 }}>
      <div className="sb-hero">
        <div className="sb-clist-head">
          <div style={{ minWidth: 0 }}>
            <h1 className="sb-title" style={{ marginTop: 0 }}>{title}</h1>
            {subtitle && <div className="sb-clist-count">{subtitle}</div>}
          </div>
          {actions && <div className="sb-actions sb-olist-actions" style={{ marginTop: 0 }}>{actions}</div>}
        </div>
        {below}
      </div>
      <div className="sb-body">{children}</div>
    </div>
  );
}

export interface OceanTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  keyFn: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  /** Dim a row (e.g. inactive records). */
  rowMuted?: (row: T) => boolean;
  /** Mark a row as selected. */
  rowActive?: (row: T) => boolean;
  /** Column key to use as the card title (default: the first titled column). */
  cardTitleKey?: string;
}

/**
 * Card layout is derived from the columns: header-less columns before the
 * first titled column are the card's leading media (e.g. a logo); the title
 * column (cardTitleKey, else the first titled column) is the card title;
 * other titled columns become label/value lines; remaining header-less
 * columns (badges, actions) form the foot.
 */
export function OceanTable<T>({ columns, rows, keyFn, onRowClick, emptyMessage, rowMuted, rowActive, cardTitleKey }: OceanTableProps<T>) {
  if (rows.length === 0) {
    return <div className="sb-card sb-empty">{emptyMessage}</div>;
  }
  const firstTitled = Math.max(0, columns.findIndex((c) => c.header));
  const lead = columns.slice(0, firstTitled);
  const title = columns.find((c) => c.key === cardTitleKey) ?? columns[firstTitled];
  const rest = columns.slice(firstTitled).filter((c) => c !== title);
  const kv = rest.filter((c) => c.header);
  const foot = rest.filter((c) => !c.header);
  const cls = (r: T) => `${rowMuted?.(r) ? 'is-muted' : ''} ${rowActive?.(r) ? 'is-active' : ''} ${onRowClick ? 'is-link' : ''}`;
  const keyOpen = (r: T) => (e: React.KeyboardEvent) => {
    if (onRowClick && (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onRowClick(r); }
  };
  const align = (c: Column<T>) => (c.align === 'end' ? 'end' : c.align === 'center' ? 'center' : 'start');

  return (
    <div className="sb-otable-host">
      {/* Narrow: one card per row. */}
      <ul className="sb-ocards">
        {rows.map((r) => (
          <li key={keyFn(r)} className={`sb-card sb-ocard ${cls(r)}`}>
            <div
              className="sb-ocard-main"
              role={onRowClick ? 'button' : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={keyOpen(r)}
            >
              {lead.map((c) => <span key={c.key} className="sb-ocard-lead">{c.render(r)}</span>)}
              <span className="sb-ocard-body">
                <span className="sb-ocard-title">{title.render(r)}</span>
                {kv.length > 0 && (
                  <span className="sb-ocard-kv">
                    {kv.map((c) => (
                      <span key={c.key}><span className="sb-ocard-k">{c.header}</span><span className="sb-ocard-v">{c.render(r)}</span></span>
                    ))}
                  </span>
                )}
              </span>
            </div>
            {foot.length > 0 && (
              <div className="sb-ocard-foot" onClick={(e) => e.stopPropagation()}>
                {foot.map((c) => <span key={c.key} className="sb-ocard-slot">{c.render(r)}</span>)}
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* Wide: the same columns as a table. */}
      <div className="sb-card sb-otable-wrap">
        <table className="sb-ctable sb-otable">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={{ width: c.width, textAlign: align(c) }}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={keyFn(r)}
                className={cls(r)}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={keyOpen(r)}
              >
                {columns.map((c) => <td key={c.key} style={{ textAlign: align(c) }}>{c.render(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
