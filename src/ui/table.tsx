import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  width?: string;
  /** Horizontal alignment of the cell content (default 'start'). */
  align?: 'start' | 'center' | 'end';
}

interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  keyFn: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
}

/**
 * Shared data table.
 *
 * Restyled in Phase 12.32 (design-system pass) to match the inventory-wizard
 * sample: 12px-rounded slate-200 border, light slate-50 header strip with
 * 11px uppercase tracking labels, soft slate-100 row dividers, indigo hover.
 */
export function Table<T>({ columns, rows, keyFn, onRowClick, emptyMessage = 'No records found.' }: TableProps<T>) {
  return (
    <div
      className="overflow-x-auto bg-white"
      style={{
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        boxShadow: '0 1px 2px rgba(15,23,42,.04)',
      }}
    >
      <table className="w-full text-sm">
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-4 py-3 font-semibold"
                style={{
                  fontSize: '11px',
                  color: '#64748b',
                  textTransform: 'uppercase',
                  letterSpacing: '.06em',
                  textAlign: col.align === 'end' ? 'end' : col.align === 'center' ? 'center' : 'start',
                  width: col.width,
                  whiteSpace: 'nowrap',
                }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center" style={{ color: '#94a3b8', fontSize: '13px' }}>
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => (
              <tr
                key={keyFn(row)}
                onClick={() => onRowClick?.(row)}
                className={onRowClick ? 'cursor-pointer' : ''}
                style={{
                  borderTop: idx === 0 ? 'none' : '1px solid #f1f5f9',
                  transition: 'background-color .12s',
                }}
                onMouseEnter={(e) => {
                  if (onRowClick) (e.currentTarget as HTMLElement).style.background = '#f8fafc';
                }}
                onMouseLeave={(e) => {
                  if (onRowClick) (e.currentTarget as HTMLElement).style.background = '';
                }}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className="px-4 py-3"
                    style={{
                      color: '#1e293b',
                      fontSize: '13px',
                      textAlign: col.align === 'end' ? 'end' : col.align === 'center' ? 'center' : 'start',
                    }}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
