/**
 * AC-2B — shared comparative rendering helpers for the P&L and Balance Sheet
 * (both use the Account · Current · Previous · Variance · Var% column shape).
 * Trial Balance has its own Dr/Cr-per-period layout and does not use these.
 *
 * Presentation only — all figures come from the AC-2A merge functions; these
 * helpers lay them out as rows of an Ocean `sb-rpt-table`.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { formatVariancePct, type ComparativeValue } from '@/lib/comparative';
import { Num } from '@/components/ocean-report';
import { Amount, StmtAccount, StmtSection, StmtSubtotal, fmtNum, fmtParen } from './statement';

export { fmtNum };
/** Signed amount with parens for negatives (accounting convention). */
export const fmtVar = fmtParen;

/** The four value cells: Current · Previous · Variance · Variance %.
 *  `emphasize` colors the variance green/red with an arrow (bottom-line rows). */
export function VarianceCells({ v, emphasize }: { v: ComparativeValue; emphasize?: boolean }) {
  const up = v.variance > 0.005;
  const down = v.variance < -0.005;
  return (
    <>
      <Amount>{fmtNum(v.current)}</Amount>
      <Amount muted>{fmtNum(v.previous)}</Amount>
      <td className={`num ${emphasize ? (down ? 'is-down' : up ? 'is-up' : 'muted') : ''}`}>
        <span className="sb-rpt-var">
          {emphasize && up && <TrendingUp size={13} aria-hidden="true" />}
          {emphasize && down && <TrendingDown size={13} aria-hidden="true" />}
          <Num>{fmtVar(v.variance)}</Num>
        </span>
      </td>
      <Amount muted small>{formatVariancePct(v.current, v.previous)}</Amount>
    </>
  );
}

/** Column header row for a comparative statement table. */
export function ComparativeHead({ firstLabel }: { firstLabel: string }) {
  const { t } = useTranslation();
  return (
    <thead>
      <tr>
        <th>{firstLabel}</th>
        <th className="num">{t('rptOcean.col_current')}</th>
        <th className="num">{t('rptOcean.col_previous')}</th>
        <th className="num">{t('rptOcean.col_variance')}</th>
        <th className="num">{t('rptOcean.col_var_pct')}</th>
      </tr>
    </thead>
  );
}

/**
 * Collapsible comparative section: a header row (toggles the detail rows),
 * the detail `children`, and an always-visible total row with variance cells.
 */
export function ComparativeSection({
  title, total, totalLabel, children,
}: {
  title: string;
  total: ComparativeValue;
  totalLabel: string;
  children: ReactNode;
}) {
  return (
    <StmtSection
      title={title} cols={5} footerAlways
      footer={<StmtSubtotal label={totalLabel}><VarianceCells v={total} /></StmtSubtotal>}
    >
      {children}
    </StmtSection>
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
    <StmtAccount code={code} name={name} onOpen={onNavigate}>
      <VarianceCells v={v} />
    </StmtAccount>
  );
}
