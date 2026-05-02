import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getAdapter } from '@/data/index';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import type { LedgerEntry, CoaRow } from '@/data/adapter';

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function GeneralLedgerPage() {
  const { t } = useTranslation();
  const { company_id } = useAuthStore();

  const today = new Date().toISOString().slice(0, 10);
  const firstOfYear = today.slice(0, 4) + '-01-01';

  const [accountCode, setAccountCode] = useState('');
  const [from, setFrom] = useState(firstOfYear);
  const [to, setTo] = useState(today);
  const [query, setQuery] = useState<{ code: string; from: string; to: string } | null>(null);

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

  const totalDebit  = entries.reduce((s, e) => s + e.debit,  0);
  const totalCredit = entries.reduce((s, e) => s + e.credit, 0);

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
          <div className="border-b border-border-subtle px-4 py-3">
            <p className="font-medium text-ink-primary">
              {query.code}{selectedAccount ? ` — ${selectedAccount.name}` : ''}
            </p>
            <p className="text-xs text-ink-tertiary">{query.from} → {query.to}</p>
          </div>

          {isFetching ? (
            <p className="px-4 py-6 text-sm text-ink-secondary">{t('common.loading')}</p>
          ) : entries.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-tertiary">{t('accounting.gl_empty')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle bg-surface-muted text-xs text-ink-tertiary">
                  <th className="px-4 py-2 text-start font-medium">{t('accounting.date')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('accounting.entry_number')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('accounting.description')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('accounting.debit')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('accounting.credit')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('accounting.balance')}</th>
                </tr>
              </thead>
              <tbody>
                {(entries as LedgerEntry[]).map((e) => (
                  <tr key={e.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-muted/50">
                    <td className="px-4 py-2.5 text-ink-secondary">{e.date}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-brand-600">{e.entry_number}</td>
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
                  <td colSpan={3} className="px-4 py-2.5 text-xs text-ink-secondary">{t('accounting.total')}</td>
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
