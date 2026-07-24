/**
 * AC-2B — shared comparative rendering helpers for the P&L and Balance Sheet
 * (both use the Account · Current · Previous · Variance · Var% column shape).
 * Trial Balance has its own Dr/Cr-per-period layout and does not use these.
 *
 * Presentation only — all figures come from the AC-2A merge functions; these
 * helpers just format and lay them out in the report pages' theme styling.
 */
import { useState, type ReactNode } from 'react';
import { theme } from '@/ui/theme';
import { formatVariancePct, type ComparativeValue } from '@/lib/comparative';

export function fmtNum(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** Signed amount with parens for negatives (accounting convention). */
export function fmtVar(n: number): string {
  return n < 0 ? `(${fmtNum(-n)})` : fmtNum(n);
}

/** The four value cells: Current · Previous · Variance · Variance %.
 *  `emphasize` colors the variance green/red with an arrow (bottom-line rows). */
export function VarianceCells({ v, emphasize }: { v: ComparativeValue; emphasize?: boolean }) {
  const up = v.variance > 0.005;
  const down = v.variance < -0.005;
  const varColor = emphasize ? (down ? '#dc2626' : up ? '#15803d' : theme.inkMuted) : theme.ink;
  const arrow = emphasize ? (up ? '▲ ' : down ? '▼ ' : '') : '';
  return (
    <>
      <td className="px-5 py-2 font-mono" style={{ textAlign: 'end', color: theme.ink, fontSize: '13px' }}>{fmtNum(v.current)}</td>
      <td className="px-5 py-2 font-mono" style={{ textAlign: 'end', color: theme.inkMuted, fontSize: '13px' }}>{fmtNum(v.previous)}</td>
      <td className="px-5 py-2 font-mono" style={{ textAlign: 'end', color: varColor, fontSize: '13px', fontWeight: emphasize ? 700 : 400 }}>
        {arrow}{fmtVar(v.variance)}
      </td>
      <td className="px-5 py-2 font-mono" style={{ textAlign: 'end', color: theme.inkMuted, fontSize: '12px' }}>
        {formatVariancePct(v.current, v.previous)}
      </td>
    </>
  );
}

/** Column header row for a comparative statement table. */
export function ComparativeHead({ firstLabel }: { firstLabel: string }) {
  const cell = (label: string, align: 'start' | 'end') => (
    <th key={label} className="px-5 py-3" style={{
      fontSize: '11px', fontWeight: 600, color: theme.inkMuted,
      textTransform: 'uppercase', letterSpacing: '.06em', textAlign: align, whiteSpace: 'nowrap',
    }}>{label}</th>
  );
  return (
    <thead>
      <tr style={{ background: theme.panelHead, borderBottom: `1px solid ${theme.border}` }}>
        {cell(firstLabel, 'start')}
        {cell('Current', 'end')}
        {cell('Previous', 'end')}
        {cell('Variance', 'end')}
        {cell('Var %', 'end')}
      </tr>
    </thead>
  );
}

/**
 * Collapsible comparative section: a header row (toggles the detail rows),
 * the detail `children`, and an always-visible total row with variance cells.
 */
export function ComparativeSection({
  title, total, totalLabel, children, defaultOpen = true,
}: {
  title: string;
  total: ComparativeValue;
  totalLabel: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <tr onClick={() => setOpen((o) => !o)} title={open ? 'Click to collapse' : 'Click to expand'} style={{ cursor: 'pointer', userSelect: 'none' }}>
        <td colSpan={5} className="px-5 py-2" style={{
          background: '#f1f5f9', fontSize: '11px', fontWeight: 700, color: theme.inkMuted,
          textTransform: 'uppercase', letterSpacing: '.08em',
        }}>
          <span style={{ marginInlineEnd: '6px', fontSize: '9px', opacity: 0.6 }}>{open ? '▾' : '▸'}</span>
          {title}
        </td>
      </tr>
      {open && children}
      <tr style={{ background: theme.panelHead, borderTop: '1px solid #f1f5f9', fontWeight: 600 }}>
        <td className="px-5 py-2" style={{ color: theme.ink, fontSize: '13px' }}>{totalLabel}</td>
        <VarianceCells v={total} />
      </tr>
    </>
  );
}

/** A single account row in a comparative section (drill-down preserved). */
export function ComparativeAccountRow({
  code, name, v, onNavigate,
}: {
  code: string;
  name: string;
  v: ComparativeValue;
  onNavigate?: (code: string) => void;
}) {
  return (
    <tr
      onClick={() => onNavigate?.(code)}
      className={onNavigate ? 'cursor-pointer' : undefined}
      style={{ borderTop: '1px solid #f1f5f9', transition: 'background-color .12s' }}
      title={onNavigate ? `Open ${code} in General Ledger` : undefined}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.panelHead; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
    >
      <td className="px-5 py-2" style={{ color: theme.ink, fontSize: '13px' }}>
        <span style={{ color: theme.brandSoftText, fontWeight: 600, marginInlineEnd: '6px' }}>{code}</span>
        {name}
      </td>
      <VarianceCells v={v} />
    </tr>
  );
}
