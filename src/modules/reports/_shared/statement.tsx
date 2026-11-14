/**
 * Ocean Teal building blocks for statement-style reports (Profit & Loss,
 * Balance Sheet, Cash Flow): rows of a `sb-rpt-table`.
 *
 * Presentation only — every figure is passed in already computed.
 */
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { Num } from '@/components/ocean-report';

export function fmtNum(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** Negative amounts in brackets (accounting convention). */
export function fmtParen(n: number): string {
  return n < 0 ? `(${fmtNum(-n)})` : fmtNum(n);
}

/** One right-aligned amount cell. */
export function Amount({ children, muted, tone, small }: {
  children: ReactNode; muted?: boolean; tone?: 'up' | 'down'; small?: boolean;
}) {
  const cls = ['num', muted ? 'muted' : '', tone ? `is-${tone}` : ''].filter(Boolean).join(' ');
  return <td className={cls} style={small ? { fontSize: 12.5 } : undefined}><Num>{children}</Num></td>;
}

export type StmtTone = 'brand' | 'bad' | 'ink' | 'good';

/** Full-width heading for a major block (ASSETS / LIABILITIES / EQUITY). */
export function StmtBanner({ label, tone = 'brand', cols }: { label: string; tone?: StmtTone; cols: number }) {
  return <tr className={`sb-rpt-banner is-${tone}`}><td colSpan={cols}>{label}</td></tr>;
}

/**
 * Collapsible section: a heading row that toggles the detail rows. `footer`
 * is the subtotal row; `footerAlways` keeps it visible when collapsed (the
 * comparative layout), otherwise the collapsed heading shows `collapsedValue`.
 */
export function StmtSection({ title, cols, children, footer, footerAlways, collapsedValue }: {
  title: string;
  cols: number;
  children: ReactNode;
  footer?: ReactNode;
  footerAlways?: boolean;
  collapsedValue?: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  return (
    <>
      <tr
        className={`sb-rpt-section is-toggle ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={open ? t('rptOcean.collapse') : t('rptOcean.expand')}
      >
        <td colSpan={cols}>
          <span className="sb-rpt-section-in">
            <span className="chev"><ChevronRight size={13} aria-hidden="true" /></span>
            <span>{title}</span>
            {!open && collapsedValue != null && <Num className="sb-rpt-section-val">{collapsedValue}</Num>}
          </span>
        </td>
      </tr>
      {open && children}
      {(open || footerAlways) && footer}
    </>
  );
}

/** Subtotal row under a section. `children` are the amount cells. */
export function StmtSubtotal({ label, children }: { label: string; children: ReactNode }) {
  return <tr className="sb-rpt-subtotal"><td>{label}</td>{children}</tr>;
}

/** Emphasised result row (Gross profit, Total assets, Net profit…). */
export function StmtKeyRow({ label, tone = 'brand', big, children }: {
  label: string; tone?: StmtTone; big?: boolean; children: ReactNode;
}) {
  return <tr className={`sb-rpt-key is-${tone} ${big ? 'is-big' : ''}`}><td>{label}</td>{children}</tr>;
}

/** "No … accounts" placeholder row. */
export function StmtEmpty({ label, cols }: { label: string; cols: number }) {
  return (
    <tr>
      <td className="muted">{label}</td>
      <td colSpan={cols - 1} className="num muted">—</td>
    </tr>
  );
}

/**
 * Account row. The whole row opens the ledger unless `onToggle` is given
 * (control accounts): then the row expands a breakdown and only the code
 * opens the ledger.
 */
export function StmtAccount({ code, name, prefix, onOpen, onToggle, expanded, children }: {
  code: string;
  name: string;
  /** Muted lead-in before the name, e.g. "Less:". */
  prefix?: string;
  onOpen?: (code: string) => void;
  onToggle?: () => void;
  expanded?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const openTitle = t('rptOcean.open_in_gl', { code });
  const clickable = !!(onToggle || onOpen);
  return (
    <tr
      className={`${clickable ? 'is-click' : ''} ${expanded ? 'is-open' : ''}`}
      onClick={onToggle ?? (onOpen ? () => onOpen(code) : undefined)}
      title={onToggle ? t('rptOcean.tb_row_expand') : (onOpen ? openTitle : undefined)}
    >
      <td>
        <span className="sb-rpt-acct">
          {onToggle && <span className="chev"><ChevronRight size={13} aria-hidden="true" /></span>}
          {onToggle && onOpen ? (
            <button type="button" className="code" title={openTitle} onClick={(e) => { e.stopPropagation(); onOpen(code); }}>{code}</button>
          ) : (
            <span className="code">{code}</span>
          )}
          <span>{prefix && <span className="muted">{prefix} </span>}{name}</span>
        </span>
      </td>
      {children}
    </tr>
  );
}
