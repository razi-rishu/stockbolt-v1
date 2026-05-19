/**
 * Shared per-contact drill-down used by Trial Balance, Balance Sheet, and
 * any other report that lists control-account balances. Click a control-
 * account row → component fetches the breakdown via
 * reports.getControlAccountByContact and renders one nested row per
 * contact with debit / credit / net.
 *
 * Phase 12.24.
 */
import { useQuery } from '@tanstack/react-query';
import { getAdapter } from '@/data/index';
import type { ControlAccountContactLine } from '@/data/adapter';

/**
 * Which GL accounts are worth drilling into per contact. Conservative:
 * accounts where the contact_id column is reliably populated for most
 * rows. Adding accounts here is cheap (the drill-down silently shows
 * "(no contact)" if rows lack contact_id) — but the chevron only
 * appears for accounts in this set, so it stays uncluttered.
 */
export const CONTROL_ACCOUNTS = new Set([
  '1200', // Accounts Receivable
  '1250', // PDC Receivable
  '1260', // Bounced Cheques
  '1400', // Vendor Advances / Prepaid
  '2100', // Accounts Payable
  '2150', // GRN Accrual
  '2400', // Customer Advances
  '2450', // PDC Payable
]);

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ControlAccountDrillDown({
  companyId,
  accountCode,
  asOfDate,
  colSpan,
  /** How many cells to leave for the label area; the rest is debit + credit. */
  labelColSpan = 1,
}: {
  companyId: string;
  accountCode: string;
  asOfDate: string;
  colSpan: number;
  labelColSpan?: number;
}) {
  const { data, isFetching } = useQuery<ControlAccountContactLine[]>({
    queryKey: ['control_account_breakdown', companyId, accountCode, asOfDate],
    queryFn: () => getAdapter().reports.getControlAccountByContact(companyId, accountCode, asOfDate),
  });

  if (isFetching) {
    return (
      <tr className="bg-surface-muted/30">
        <td colSpan={colSpan} className="px-10 py-3 text-xs text-ink-tertiary">
          Loading per-contact breakdown…
        </td>
      </tr>
    );
  }

  if (!data || data.length === 0) {
    return (
      <tr className="bg-surface-muted/30">
        <td colSpan={colSpan} className="px-10 py-3 text-xs text-ink-tertiary">
          No per-contact rows for this account.
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr className="bg-surface-muted/30">
        <td colSpan={colSpan} className="px-10 pt-2 pb-1 text-[10px] uppercase tracking-wide text-ink-tertiary">
          Breakdown by contact ({data.length})
        </td>
      </tr>
      {data.map((line) => (
        <tr key={`drill-${accountCode}-${line.contact_id ?? 'none'}`} className="bg-surface-muted/30">
          <td className="pl-10 pr-4 py-1.5 text-xs text-ink-tertiary">↳</td>
          <td colSpan={labelColSpan} className="px-4 py-1.5 text-sm text-ink-secondary">
            {line.contact_name}
          </td>
          <td className="px-4 py-1.5 text-end font-mono text-xs text-ink-secondary">
            {line.debit > 0.005 ? fmt(line.debit) : ''}
          </td>
          <td className="px-4 py-1.5 text-end font-mono text-xs text-ink-secondary">
            {line.credit > 0.005 ? fmt(line.credit) : ''}
          </td>
        </tr>
      ))}
    </>
  );
}
