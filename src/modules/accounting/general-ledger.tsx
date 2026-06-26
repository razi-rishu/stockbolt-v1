import { useState, useEffect, useMemo } from 'react';
import { formatDate } from '@/lib/locale';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { DocLink } from '@/ui/doc-link';
import type { LedgerEntry, CoaRow } from '@/data/adapter';

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Source chip — human label per document type ────────────────────────────
const SOURCE_LABELS: Record<string, { label: string; cls: string }> = {
  invoice:              { label: 'Sale',        cls: 'bg-brand-50 text-brand-700' },
  vendor_bill:          { label: 'Purchase',    cls: 'bg-emerald-50 text-emerald-700' },
  payment:              { label: 'Payment',     cls: 'bg-sky-50 text-sky-700' },
  expense:              { label: 'Expense',     cls: 'bg-amber-50 text-amber-700' },
  goods_receipt:        { label: 'GRN',         cls: 'bg-emerald-50 text-emerald-700' },
  credit_note:          { label: 'Credit Note', cls: 'bg-rose-50 text-rose-700' },
  debit_note:           { label: 'Debit Note',  cls: 'bg-rose-50 text-rose-700' },
  sales_return:         { label: 'Return',      cls: 'bg-rose-50 text-rose-700' },
  inventory_adjustment: { label: 'Adjustment',  cls: 'bg-surface-muted text-ink-secondary' },
  stock_transfer:       { label: 'Transfer',    cls: 'bg-surface-muted text-ink-secondary' },
  bank_transfer:        { label: 'Bank Transfer', cls: 'bg-sky-50 text-sky-700' },
  opening_balance:      { label: 'Opening',     cls: 'bg-surface-muted text-ink-secondary' },
  inventory_cogs:       { label: 'COGS',        cls: 'bg-amber-50 text-amber-700' },
};

function SourceCell({ type, id, number }: { type: string; id: string | null; number: string | null }) {
  const meta = SOURCE_LABELS[type] ?? { label: type ? type.replace(/_/g, ' ') : 'Manual', cls: 'bg-surface-muted text-ink-secondary' };
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {number && <DocLink type={type} id={id} label={number} className="font-mono text-xs text-brand-600 hover:underline" />}
      <span className={`rounded-pill px-1.5 py-0.5 text-[10px] font-semibold capitalize ${meta.cls}`}>
        {meta.label}
      </span>
    </span>
  );
}

export default function GeneralLedgerPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();
  const [searchParams] = useSearchParams();

  const today = new Date().toISOString().slice(0, 10);
  const firstOfYear = today.slice(0, 4) + '-01-01';

  // URL params (set by Trial Balance drill-down) take precedence as initial state.
  const initialCode = searchParams.get('code') ?? '';
  const initialFrom = searchParams.get('from') ?? firstOfYear;
  const initialTo   = searchParams.get('to')   ?? today;

  const [accountCode, setAccountCode] = useState(initialCode);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [query, setQuery] = useState<{ code: string; from: string; to: string } | null>(
    initialCode ? { code: initialCode, from: initialFrom, to: initialTo } : null,
  );
  // Default ON — hides the original reversed entry and its void counterpart,
  // so the ledger shows only the "net" history (no noise from edit/void pairs).
  const [hideReversed, setHideReversed] = useState(true);

  // If the URL params change after mount (e.g. user navigates from TB again with a different account),
  // re-run the query without requiring a manual click.
  useEffect(() => {
    const code = searchParams.get('code');
    const f = searchParams.get('from');
    const t2 = searchParams.get('to');
    if (code) {
      setAccountCode(code);
      if (f) setFrom(f);
      if (t2) setTo(t2);
      setQuery({ code, from: f ?? firstOfYear, to: t2 ?? today });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const { data: accounts = [] } = useQuery<CoaRow[]>({
    queryKey: ['coa', company_id],
    queryFn: () => getAdapter().coa.list(company_id!),
    enabled: !!company_id,
  });

  const { data: entries = [], isFetching } = useQuery<LedgerEntry[]>({
    queryKey: ['gl_ledger', company_id, query?.code, query?.from, query?.to],
    queryFn: () => getAdapter().accounting.getLedgerEntries(company_id!, query!.code, query!.from, query!.to),
    enabled: !!company_id && !!query,
  });

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (accountCode.trim()) setQuery({ code: accountCode.trim(), from, to });
  }

  // When hideReversed is ON, drop BOTH halves of every reversal pair:
  //  • rows whose JE has reversed_by_id set (the original that was voided/edited)
  //  • rows whose JE has reversal_of_id set (the reversal entry itself —
  //    "Edit Reversal – INV-1001" etc.)
  //  • legacy "Void opening" rows that predate the reversal_of_id link
  // Then recompute running_balance from scratch on the visible set so the
  // balance column is always correct regardless of what was filtered out.
  const visibleEntries = useMemo(() => {
    const all = entries as LedgerEntry[];
    if (!hideReversed) return all;
    const filtered = all.filter(
      (e) =>
        e.reversed_by_id === null &&
        e.reversal_of_id === null &&
        !e.description.toLowerCase().startsWith('void opening'),
    );
    let running = 0;
    return filtered.map((e) => {
      running += e.debit - e.credit;
      return { ...e, running_balance: running };
    });
  }, [entries, hideReversed]);

  const totalDebit  = visibleEntries.reduce((s, e) => s + e.debit,  0);
  const totalCredit = visibleEntries.reduce((s, e) => s + e.credit, 0);

  const selectedAccount = accounts.find((a) => a.code === query?.code);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-ink-primary">{t('accounting.gl_title')}</h1>

      <form onSubmit={handleSearch} className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('accounting.account_code')}</label>
          <select
            value={accountCode}
            onChange={(e) => setAccountCode(e.target.value)}
            className="h-9 w-56 rounded-card border border-border-subtle bg-surface-card px-3 text-sm text-ink-primary focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">{t('accounting.select_account')}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.code}>{a.code} — {a.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('accounting.from')}</label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-secondary">{t('accounting.to')}</label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36" />
        </div>
        <Button type="submit" size="sm">{t('accounting.view_ledger')}</Button>
      </form>

      {query && (
        <div className="rounded-card border border-border-subtle bg-surface-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
            <div>
              <p className="font-medium text-ink-primary">
                {query.code}{selectedAccount ? ` — ${selectedAccount.name}` : ''}
              </p>
              <p className="text-xs text-ink-tertiary">{query.from} → {query.to}</p>
            </div>
            {/* Hide-reversed toggle — keeps ledger clean after edit/void cycles */}
            <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-ink-secondary">
              <input
                type="checkbox"
                checked={hideReversed}
                onChange={(ev) => setHideReversed(ev.target.checked)}
                className="h-3.5 w-3.5 rounded border-border-subtle accent-brand-600"
              />
              Hide reversed entries
            </label>
          </div>

          {isFetching ? (
            <p className="px-4 py-6 text-sm text-ink-secondary">{t('common.loading')}</p>
          ) : visibleEntries.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-tertiary">
              {entries.length > 0 && hideReversed
                ? 'All entries are reversed / voided. Uncheck "Hide reversed entries" to view them.'
                : t('accounting.gl_empty')}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                  <th className="px-4 py-2 text-start font-medium">{t('accounting.date')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('accounting.entry_number')}</th>
                  <th className="px-4 py-2 text-start font-medium">Source</th>
                  <th className="px-4 py-2 text-start font-medium">{t('accounting.description')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('accounting.debit')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('accounting.credit')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('accounting.balance')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleEntries.map((e) => (
                  <tr key={e.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-muted/50">
                    <td className="px-4 py-2.5 text-ink-secondary">{formatDate(e.date)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">
                      <DocLink type="journal_entry" id={e.journal_entry_id} label={e.entry_number}
                        status={e.reversed_by_id ? 'reversed' : 'active'}
                        className="font-mono text-xs text-brand-600 hover:underline" />
                    </td>
                    <td className="px-4 py-2.5"><SourceCell type={e.source_type} id={e.source_id} number={e.source_number} /></td>
                    <td className="px-4 py-2.5 text-ink-primary">{e.description || '—'}</td>
                    <td className="px-4 py-2.5 text-end font-mono">{e.debit > 0 ? fmt(e.debit) : ''}</td>
                    <td className="px-4 py-2.5 text-end font-mono">{e.credit > 0 ? fmt(e.credit) : ''}</td>
                    <td className={`px-4 py-2.5 text-end font-mono ${e.running_balance < 0 ? 'text-red-500' : ''}`}>
                      {fmt(e.running_balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border-subtle font-semibold">
                  <td colSpan={4} className="px-4 py-2.5 text-xs text-ink-secondary">{t('accounting.total')}</td>
                  <td className="px-4 py-2.5 text-end font-mono">{fmt(totalDebit)}</td>
                  <td className="px-4 py-2.5 text-end font-mono">{fmt(totalCredit)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
